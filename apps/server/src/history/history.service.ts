import { Injectable } from '@nestjs/common';
import { fail } from '../common/errors';
import { HISTORY_TYPE_ACTIONS, HISTORY_TYPES, HistoryType } from '@gametrans/shared';
import { Prisma } from '@prisma/client';
import { pageParams } from '../common/query';
import { PrismaService } from '../prisma/prisma.service';

interface EntryRow {
  id: string;
  action: string;
  translation: string;
  stage: string;
  note: string;
  createdAt: Date;
  entryId: string;
  key: string;
  original: string;
  fileId: string;
  path: string;
  prevTranslation: string | null;
  prevStage: string | null;
  nextOriginal: string | null;
  userId: string | null;
  username: string | null;
  displayName: string | null;
}

interface Group {
  kind: 'entry' | 'term';
  gkey: string;
  n: number;
  firstId: string;
  createdAt: Date;
}

interface BaseRecord {
  kind: 'entry' | 'term';
  id: string;
  action: string;
  createdAt: Date;
  user: { id: string; username: string; displayName: string } | null;
  note?: string;
  [k: string]: unknown;
}

/** 批量操作在列表中预览的条数 */
const SAMPLE_SIZE = 3;

const user = (r: { userId: string | null; username: string | null; displayName: string | null }) =>
  r.userId ? { id: r.userId, username: r.username!, displayName: r.displayName! } : null;

/** 项目历史记录：词条修改与术语修改合并按时间倒序 */
@Injectable()
export class HistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(projectId: string, q: { type?: string; userId?: string; page?: string; pageSize?: string }) {
    const { page, pageSize, skip, take } = pageParams(q.page, q.pageSize, 100);
    const type = HISTORY_TYPES.includes(q.type as HistoryType) ? (q.type as HistoryType) : undefined;
    const withEntries = type !== 'term';
    const withTerms = !type || type === 'term';
    const userCond = (col: string) => (q.userId ? Prisma.sql`AND ${Prisma.raw(col)} = ${q.userId}` : Prisma.empty);
    const actionCond = type && type !== 'term' ? Prisma.sql`AND h.action IN (${Prisma.join(HISTORY_TYPE_ACTIONS[type])})` : Prisma.empty;

    // 同一次批量操作（batchId 相同）合并为一组
    const parts: Prisma.Sql[] = [];
    if (withEntries) {
      parts.push(
        Prisma.sql`SELECT 'entry' AS kind, COALESCE(h."batchId", h.id) AS gkey, h.id, h."createdAt" FROM "EntryHistory" h WHERE h."projectId" = ${projectId} ${actionCond} ${userCond('h."userId"')}`,
      );
    }
    if (withTerms) {
      parts.push(
        Prisma.sql`SELECT 'term' AS kind, COALESCE(t."batchId", t.id) AS gkey, t.id, t."createdAt" FROM "TermHistory" t WHERE t."projectId" = ${projectId} ${userCond('t."userId"')}`,
      );
    }
    const union = Prisma.join(parts, ' UNION ALL ');
    const [groups, [{ total }]] = await Promise.all([
      this.prisma.$queryRaw<Group[]>`
        SELECT kind, gkey, count(*)::int AS n, min(id) AS "firstId", max("createdAt") AS "createdAt"
        FROM (${union}) x GROUP BY kind, gkey
        ORDER BY "createdAt" DESC, gkey DESC LIMIT ${take} OFFSET ${skip}`,
      this.prisma.$queryRaw<{ total: number }[]>`SELECT count(*)::int AS total FROM (SELECT 1 FROM (${union}) x GROUP BY kind, gkey) y`,
    ]);

    const single = (k: Group['kind']) => groups.filter((g) => g.kind === k && g.n === 1).map((g) => g.firstId);
    const batched = (k: Group['kind']) => groups.filter((g) => g.kind === k && g.n > 1).map((g) => g.gkey);
    const [entrySamples, termSamples] = await Promise.all([this.samples('EntryHistory', batched('entry')), this.samples('TermHistory', batched('term'))]);
    const [entries, terms] = await Promise.all([
      this.entryRecords([...single('entry'), ...entrySamples.map((r) => r.id)]),
      this.termRecords([...single('term'), ...termSamples.map((r) => r.id)]),
    ]);

    const items = groups.map((g) => {
      const records = g.kind === 'entry' ? entries : terms;
      if (g.n === 1) return records.get(g.firstId);
      const sampleIds = (g.kind === 'entry' ? entrySamples : termSamples).filter((r) => r.batchId === g.gkey).map((r) => r.id);
      const samples = sampleIds.map((id) => records.get(id)).filter(Boolean) as BaseRecord[];
      const head = samples[0];
      if (!head) return undefined;
      return {
        kind: g.kind === 'entry' ? 'entry-batch' : 'term-batch',
        id: g.gkey,
        batchId: g.gkey,
        action: head.action,
        note: head.note ?? '',
        user: head.user,
        createdAt: g.createdAt,
        count: g.n,
        samples,
      };
    });
    return { items: items.filter(Boolean), total, page, pageSize };
  }

  /** 一次批量操作中的全部记录（分页） */
  async batch(projectId: string, batchId: string, q: { page?: string; pageSize?: string }) {
    const { page, pageSize, skip, take } = pageParams(q.page, q.pageSize, 100);
    const where = { projectId, batchId };
    const order = [{ createdAt: 'asc' as const }, { id: 'asc' as const }];
    const entryTotal = await this.prisma.entryHistory.count({ where });
    if (entryTotal) {
      const rows = await this.prisma.entryHistory.findMany({ where, orderBy: order, skip, take, select: { id: true } });
      const map = await this.entryRecords(rows.map((r) => r.id));
      return { items: rows.map((r) => map.get(r.id)).filter(Boolean), total: entryTotal, page, pageSize };
    }
    const termTotal = await this.prisma.termHistory.count({ where });
    if (!termTotal) throw fail('HISTORY_NOT_FOUND');
    const rows = await this.prisma.termHistory.findMany({ where, orderBy: order, skip, take, select: { id: true } });
    const map = await this.termRecords(rows.map((r) => r.id));
    return { items: rows.map((r) => map.get(r.id)).filter(Boolean), total: termTotal, page, pageSize };
  }

  /** 每个批量操作取前几条作为预览 */
  private samples(table: 'EntryHistory' | 'TermHistory', batchIds: string[]) {
    if (!batchIds.length) return Promise.resolve([] as { id: string; batchId: string }[]);
    return this.prisma.$queryRaw<{ id: string; batchId: string }[]>`
      SELECT id, "batchId" FROM (
        SELECT id, "batchId", row_number() OVER (PARTITION BY "batchId" ORDER BY "createdAt", id) AS rn
        FROM ${Prisma.raw(`"${table}"`)} WHERE "batchId" IN (${Prisma.join(batchIds)})
      ) s WHERE rn <= ${SAMPLE_SIZE} ORDER BY rn`;
  }

  private async entryRecords(ids: string[]): Promise<Map<string, BaseRecord>> {
    const map = new Map<string, BaseRecord>();
    if (!ids.length) return map;
    for (const r of await this.entryDetails(ids)) {
      map.set(r.id, {
        kind: 'entry',
        id: r.id,
        action: r.action,
        createdAt: r.createdAt,
        user: user(r),
        note: r.note,
        entry: { id: r.entryId, key: r.key, fileId: r.fileId, path: r.path },
        translation: r.translation,
        stage: r.stage,
        prevTranslation: r.prevTranslation,
        prevStage: r.prevStage,
        // 原文变更：note 为旧原文，新原文取下一次变更记录的旧原文或当前原文
        ...(r.action === 'SOURCE_CHANGED' ? { oldOriginal: r.note, newOriginal: r.nextOriginal ?? r.original } : {}),
      });
    }
    return map;
  }

  private async termRecords(ids: string[]): Promise<Map<string, BaseRecord>> {
    const map = new Map<string, BaseRecord>();
    if (!ids.length) return map;
    const rows = await this.prisma.termHistory.findMany({ where: { id: { in: ids } }, include: { user: { select: { id: true, username: true, displayName: true } } } });
    for (const r of rows) {
      map.set(r.id, { kind: 'term', id: r.id, action: r.action, createdAt: r.createdAt, user: r.user, termId: r.termId, term: r.term, before: r.before, after: r.after });
    }
    return map;
  }

  /** 词条记录与该词条上一条记录（用于对比）；同一时刻按 id 排序 */
  private entryDetails(ids: string[]) {
    return this.prisma.$queryRaw<EntryRow[]>`
      SELECT h.id, h.action, h.translation, h.stage::text AS stage, h.note, h."createdAt",
             e.id AS "entryId", e.key, e.original, e."fileId", f.path,
             prev.translation AS "prevTranslation", prev.stage::text AS "prevStage",
             nxt.note AS "nextOriginal",
             u.id AS "userId", u.username, u."displayName"
      FROM "EntryHistory" h
      JOIN "Entry" e ON e.id = h."entryId"
      JOIN "File" f ON f.id = e."fileId"
      LEFT JOIN "User" u ON u.id = h."userId"
      LEFT JOIN LATERAL (
        SELECT p.translation, p.stage FROM "EntryHistory" p
        WHERE p."entryId" = h."entryId" AND (p."createdAt" < h."createdAt" OR (p."createdAt" = h."createdAt" AND p.id < h.id))
        ORDER BY p."createdAt" DESC, p.id DESC LIMIT 1
      ) prev ON true
      LEFT JOIN LATERAL (
        SELECT n.note FROM "EntryHistory" n
        WHERE h.action = 'SOURCE_CHANGED' AND n."entryId" = h."entryId" AND n.action = 'SOURCE_CHANGED'
          AND (n."createdAt" > h."createdAt" OR (n."createdAt" = h."createdAt" AND n.id > h.id))
        ORDER BY n."createdAt" ASC, n.id ASC LIMIT 1
      ) nxt ON true
      WHERE h.id IN (${Prisma.join(ids)})`;
  }
}
