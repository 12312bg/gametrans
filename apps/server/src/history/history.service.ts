import { Injectable } from '@nestjs/common';
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

    const parts: Prisma.Sql[] = [];
    if (withEntries) {
      parts.push(Prisma.sql`SELECT 'entry' AS kind, h.id, h."createdAt" FROM "EntryHistory" h WHERE h."projectId" = ${projectId} ${actionCond} ${userCond('h."userId"')}`);
    }
    if (withTerms) {
      parts.push(Prisma.sql`SELECT 'term' AS kind, t.id, t."createdAt" FROM "TermHistory" t WHERE t."projectId" = ${projectId} ${userCond('t."userId"')}`);
    }
    const union = Prisma.join(parts, ' UNION ALL ');
    const [ids, [{ total }]] = await Promise.all([
      this.prisma.$queryRaw<{ kind: 'entry' | 'term'; id: string }[]>`
        SELECT kind, id FROM (${union}) x ORDER BY "createdAt" DESC, id DESC LIMIT ${take} OFFSET ${skip}`,
      this.prisma.$queryRaw<{ total: number }[]>`SELECT count(*)::int AS total FROM (${union}) x`,
    ]);

    const entryIds = ids.filter((i) => i.kind === 'entry').map((i) => i.id);
    const termIds = ids.filter((i) => i.kind === 'term').map((i) => i.id);
    const [entryRows, termRows] = await Promise.all([
      entryIds.length ? this.entryDetails(entryIds) : Promise.resolve([] as EntryRow[]),
      termIds.length
        ? this.prisma.termHistory.findMany({ where: { id: { in: termIds } }, include: { user: { select: { id: true, username: true, displayName: true } } } })
        : Promise.resolve([]),
    ]);
    const byId = new Map<string, unknown>();
    for (const r of entryRows) {
      byId.set(r.id, {
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
    for (const r of termRows) {
      byId.set(r.id, { kind: 'term', id: r.id, action: r.action, createdAt: r.createdAt, user: r.user, termId: r.termId, term: r.term, before: r.before, after: r.after });
    }
    return { items: ids.map((i) => byId.get(i.id)).filter(Boolean), total, page, pageSize };
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
