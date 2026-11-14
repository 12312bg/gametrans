import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { RtEntryPatch, RtEvent, RtPresenceItem, RtUser } from '@gametrans/shared';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import Redis from 'ioredis';
import { config } from '../config';

const CHANNEL = 'gametrans:rt';
const presenceKey = (pid: string) => `gametrans:presence:${pid}`;
/** 本实例每隔这么久刷新一次在线状态；超过 STALE_MS 未刷新的记录视为离线（实例崩溃时） */
const REFRESH_MS = 20_000;
const STALE_MS = 60_000;
/** SSE 注释行心跳，防止代理断开空闲连接 */
const PING_MS = 25_000;

interface Conn {
  id: string;
  projectId: string;
  user: RtUser | null;
  res: Response;
  entryId: string | null;
}

interface PresenceRecord {
  user: RtUser;
  entryId: string | null;
  ts: number;
}

/** Prisma 查询结果中的词条 → 推送用的补丁 */
export function entryPatch(e: {
  id: string;
  version: number;
  translation: string;
  stage: string;
  translator: RtUser | null;
  reviewer: RtUser | null;
  updatedAt: Date;
}): RtEntryPatch {
  return {
    id: e.id,
    version: e.version,
    translation: e.translation,
    stage: e.stage as RtEntryPatch['stage'],
    translator: e.translator,
    reviewer: e.reviewer,
    updatedAt: e.updatedAt.toISOString(),
  };
}

export const rtUser = (u: { id: string; username: string; displayName: string } | null | undefined): RtUser | null =>
  u ? { id: u.id, username: u.username, displayName: u.displayName } : null;

/**
 * 项目内实时推送：SSE 连接保存在本实例内存中，事件经 Redis 发布 / 订阅分发到所有实例；
 * 在线状态存放在 Redis 哈希里（字段为连接 ID）。
 */
@Injectable()
export class RealtimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeService.name);
  private pub!: Redis;
  private sub!: Redis;
  private readonly conns = new Map<string, Conn>();
  private readonly byProject = new Map<string, Set<Conn>>();
  private timers: NodeJS.Timeout[] = [];

  async onModuleInit() {
    const opts = { maxRetriesPerRequest: null, lazyConnect: false } as const;
    this.pub = new Redis(config.redisUrl, opts);
    this.sub = new Redis(config.redisUrl, opts);
    for (const r of [this.pub, this.sub]) r.on('error', (e) => this.logger.warn(`Redis: ${e.message}`));
    this.sub.on('message', (_ch, raw) => {
      try {
        const { projectId, event } = JSON.parse(raw) as { projectId: string; event: RtEvent };
        this.deliver(projectId, event);
      } catch (e) {
        this.logger.warn(`Bad realtime message: ${(e as Error).message}`);
      }
    });
    await this.sub.subscribe(CHANNEL);
    this.timers.push(setInterval(() => void this.refreshPresence(), REFRESH_MS));
    this.timers.push(setInterval(() => this.ping(), PING_MS));
    for (const t of this.timers) t.unref();
  }

  async onModuleDestroy() {
    for (const t of this.timers) clearInterval(t);
    const projects = new Set<string>();
    for (const c of this.conns.values()) {
      projects.add(c.projectId);
      await this.pub.hdel(presenceKey(c.projectId), c.id).catch(() => undefined);
      c.res.end();
    }
    for (const pid of projects) await this.broadcastPresence(pid).catch(() => undefined);
    this.sub.disconnect();
    this.pub.disconnect();
  }

  /** 发布事件；Redis 不可用时只影响实时推送，不影响业务请求 */
  publish(projectId: string, event: RtEvent): void {
    this.pub.publish(CHANNEL, JSON.stringify({ projectId, event })).catch((e) => this.logger.warn(`Publish failed: ${(e as Error).message}`));
  }

  entry(projectId: string, by: RtUser | null | undefined, e: Parameters<typeof entryPatch>[0]) {
    this.publish(projectId, { type: 'entry', by: rtUser(by), entry: entryPatch(e) });
  }

  entries(projectId: string, by: RtUser | null | undefined, count: number) {
    if (count > 0) this.publish(projectId, { type: 'entries', by: rtUser(by), count });
  }

  /** 建立 SSE 连接 */
  async open(projectId: string, user: RtUser | null, res: Response, onClose: () => void): Promise<void> {
    const conn: Conn = { id: randomUUID(), projectId, user, res, entryId: null };
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write('retry: 3000\n\n');

    this.conns.set(conn.id, conn);
    const set = this.byProject.get(projectId) ?? new Set();
    set.add(conn);
    this.byProject.set(projectId, set);

    res.on('close', () => {
      this.conns.delete(conn.id);
      set.delete(conn);
      if (!set.size) this.byProject.delete(projectId);
      onClose();
      if (conn.user) {
        void this.pub
          .hdel(presenceKey(projectId), conn.id)
          .then(() => this.broadcastPresence(projectId))
          .catch(() => undefined);
      }
    });

    this.send(conn, { type: 'hello', connId: conn.id });
    if (user) {
      await this.savePresence(conn);
      await this.broadcastPresence(projectId);
    } else {
      this.send(conn, { type: 'presence', items: await this.presence(projectId) });
    }
  }

  /** 客户端上报正在编辑的词条；连接必须属于该用户与项目 */
  async focus(projectId: string, userId: string, connId: string, entryId: string | null): Promise<boolean> {
    const conn = this.conns.get(connId);
    // 多实例时连接可能在其他实例上：由该实例处理（经 Redis 转发会更复杂，这里直接写哈希）
    if (conn) {
      if (conn.projectId !== projectId || conn.user?.id !== userId) return false;
      if (conn.entryId === entryId) return true;
      conn.entryId = entryId;
      await this.savePresence(conn);
    } else {
      const raw = await this.pub.hget(presenceKey(projectId), connId);
      if (!raw) return false;
      const rec = JSON.parse(raw) as PresenceRecord;
      if (rec.user.id !== userId) return false;
      if (rec.entryId === entryId) return true;
      await this.pub.hset(presenceKey(projectId), connId, JSON.stringify({ ...rec, entryId, ts: Date.now() }));
    }
    await this.broadcastPresence(projectId);
    return true;
  }

  private send(conn: Conn, event: RtEvent) {
    conn.res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  private deliver(projectId: string, event: RtEvent) {
    for (const c of this.byProject.get(projectId) ?? []) this.send(c, event);
  }

  private ping() {
    for (const c of this.conns.values()) c.res.write(': ping\n\n');
  }

  private async savePresence(conn: Conn) {
    if (!conn.user) return;
    const rec: PresenceRecord = { user: conn.user, entryId: conn.entryId, ts: Date.now() };
    await this.pub.hset(presenceKey(conn.projectId), conn.id, JSON.stringify(rec));
    await this.pub.pexpire(presenceKey(conn.projectId), STALE_MS * 2);
  }

  private async refreshPresence() {
    const projects = new Set<string>();
    try {
      for (const c of this.conns.values()) {
        if (!c.user) continue;
        await this.savePresence(c);
        projects.add(c.projectId);
      }
      // 清理其他实例崩溃留下的记录
      for (const pid of projects) {
        if (await this.prune(pid)) await this.broadcastPresence(pid);
      }
    } catch (e) {
      this.logger.warn(`Presence refresh failed: ${(e as Error).message}`);
    }
  }

  private async prune(projectId: string): Promise<boolean> {
    const all = await this.pub.hgetall(presenceKey(projectId));
    const stale = Object.entries(all)
      .filter(([, v]) => Date.now() - (JSON.parse(v) as PresenceRecord).ts > STALE_MS)
      .map(([k]) => k);
    if (stale.length) await this.pub.hdel(presenceKey(projectId), ...stale);
    return stale.length > 0;
  }

  /** 项目在线用户（按用户合并多个标签页） */
  async presence(projectId: string): Promise<RtPresenceItem[]> {
    const all = await this.pub.hgetall(presenceKey(projectId));
    const byUser = new Map<string, RtPresenceItem>();
    for (const v of Object.values(all)) {
      const rec = JSON.parse(v) as PresenceRecord;
      if (Date.now() - rec.ts > STALE_MS) continue;
      const item = byUser.get(rec.user.id) ?? { user: rec.user, entryIds: [] };
      if (rec.entryId && !item.entryIds.includes(rec.entryId)) item.entryIds.push(rec.entryId);
      byUser.set(rec.user.id, item);
    }
    return [...byUser.values()].sort((a, b) => a.user.displayName.localeCompare(b.user.displayName));
  }

  private async broadcastPresence(projectId: string) {
    this.publish(projectId, { type: 'presence', items: await this.presence(projectId) });
  }
}
