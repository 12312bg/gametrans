import { Injectable } from '@nestjs/common';
import {
  BATCH_ACTION_PERMISSION,
  BatchAction,
  ContextPart,
  ENTRY_CATEGORIES,
  LINKED_CATEGORIES,
  PERMISSIONS,
  ReplaceOptions,
  STAGES,
  Stage,
  can,
  formatContext,
  permissionForTransition,
  permissionToEdit,
  buildMatcher,
  replaceWithSegments,
} from '@gametrans/shared';
import { Prisma } from '@prisma/client';
import { AccessService, ProjectContext } from '../common/access.service';
import { ActivityService } from '../common/activity.service';
import { fail } from '../common/errors';
import type { Translator } from '../common/locale';
import { chunk, escapeLike, pageParams } from '../common/query';
import { PrismaService } from '../prisma/prisma.service';

export interface EntryFilter {
  fileId?: string;
  stage?: string;
  category?: string;
  q?: string;
  field?: string;
  translatorId?: string;
  sort?: string;
}

const USER_BRIEF = { select: { id: true, username: true, displayName: true } } as const;

export const ENTRY_SELECT = {
  id: true,
  fileId: true,
  key: true,
  original: true,
  translation: true,
  contextData: true,
  contextSearch: true,
  category: true,
  danger: true,
  stage: true,
  version: true,
  sortOrder: true,
  updatedAt: true,
  file: { select: { path: true } },
  translator: USER_BRIEF,
  reviewer: USER_BRIEF,
} satisfies Prisma.EntrySelect;

const MAX_BATCH = 200_000;

/** 附加按请求语言渲染的位置说明；旧数据回退为原中文文本 */
export function withContextText<T extends { contextData: unknown; contextSearch: string }>(e: T, t: Translator) {
  const parts = e.contextData as ContextPart[] | null;
  return { ...e, contextText: parts ? formatContext(parts, t) : e.contextSearch };
}

function normalizeText(s: string): string {
  return s.replace(/\r\n?/g, '\n');
}

function splitList<T extends string>(raw: string | undefined, allowed: readonly T[]): T[] | undefined {
  if (!raw) return undefined;
  const items = raw.split(',').filter((x): x is T => (allowed as readonly string[]).includes(x));
  return items.length ? items : undefined;
}

@Injectable()
export class EntriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly activity: ActivityService,
  ) {}

  buildWhere(projectId: string, raw: EntryFilter): Prisma.EntryWhereInput {
    // 查询参数可能来自请求体，逐项确保为字符串
    const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined);
    const f: EntryFilter = {
      fileId: str(raw?.fileId),
      stage: str(raw?.stage),
      category: str(raw?.category),
      q: str(raw?.q),
      field: str(raw?.field),
      translatorId: str(raw?.translatorId),
    };
    const and: Prisma.EntryWhereInput[] = [{ projectId }];
    if (f.fileId) and.push({ fileId: f.fileId });
    const stages = splitList(f.stage, STAGES);
    // 默认不显示已隐藏的词条
    and.push({ stage: stages ? { in: stages } : { not: 'HIDDEN' } });
    const cats = splitList(f.category, ENTRY_CATEGORIES);
    if (cats) and.push({ category: { in: cats } });
    if (f.translatorId) and.push({ translatorId: f.translatorId });
    const q = f.q?.trim() ? f.q : undefined;
    if (q) {
      const c = { contains: escapeLike(q), mode: 'insensitive' as const };
      switch (f.field) {
        case 'original':
          and.push({ original: c });
          break;
        case 'translation':
          and.push({ translation: c });
          break;
        case 'key':
          and.push({ key: c });
          break;
        case 'context':
          and.push({ contextSearch: c });
          break;
        default:
          and.push({ OR: [{ original: c }, { translation: c }, { key: c }, { contextSearch: c }] });
      }
    }
    return { AND: and };
  }

  async list(projectId: string, f: EntryFilter, page?: string, pageSize?: string) {
    const { skip, take, ...p } = pageParams(page, pageSize, 500);
    const where = this.buildWhere(projectId, f);
    const orderBy: Prisma.EntryOrderByWithRelationInput[] =
      f.sort === 'updated' ? [{ updatedAt: 'desc' }] : [{ file: { path: 'asc' } }, { sortOrder: 'asc' }];
    const [items, total] = await Promise.all([
      this.prisma.entry.findMany({ where, skip, take, orderBy, select: ENTRY_SELECT }),
      this.prisma.entry.count({ where }),
    ]);
    return { items, total, ...p };
  }

  /** 词条在筛选结果（默认排序）中的序号，不在结果中时为 null */
  async position(projectId: string, id: string, f: EntryFilter) {
    const e = await this.prisma.entry.findFirst({ where: { id, projectId }, select: { id: true, fileId: true, sortOrder: true, file: { select: { path: true } } } });
    if (!e) throw fail('ENTRY_NOT_FOUND');
    const where = this.buildWhere(projectId, { ...f, sort: undefined });
    if (!(await this.prisma.entry.count({ where: { AND: [where, { id }] } }))) return { index: null };
    const before = await this.prisma.entry.count({
      where: { AND: [where, { OR: [{ file: { path: { lt: e.file.path } } }, { fileId: e.fileId, sortOrder: { lt: e.sortOrder } }] }] },
    });
    return { index: before };
  }

  async get(projectId: string, id: string) {
    const e = await this.prisma.entry.findFirst({ where: { id, projectId }, select: ENTRY_SELECT });
    if (!e) throw fail('ENTRY_NOT_FOUND');
    return e;
  }

  /** 同一文件中前后相邻的词条，帮助理解对话上下文 */
  async neighbors(projectId: string, id: string, span = 3) {
    const e = await this.get(projectId, id);
    const pick = { id: true, original: true, translation: true, stage: true, category: true, sortOrder: true } as const;
    const [before, after] = await Promise.all([
      this.prisma.entry.findMany({
        where: { fileId: e.fileId, sortOrder: { lt: e.sortOrder }, stage: { not: 'HIDDEN' } },
        orderBy: { sortOrder: 'desc' },
        take: span,
        select: pick,
      }),
      this.prisma.entry.findMany({
        where: { fileId: e.fileId, sortOrder: { gt: e.sortOrder }, stage: { not: 'HIDDEN' } },
        orderBy: { sortOrder: 'asc' },
        take: span,
        select: pick,
      }),
    ]);
    return { before: before.reverse(), after };
  }

  async update(ctx: ProjectContext, id: string, dto: { translation: string; stage?: Stage; version: number }) {
    const projectId = ctx.project.id;
    const userId = ctx.user!.id;
    const e = await this.prisma.entry.findFirst({ where: { id, projectId } });
    if (!e) throw fail('ENTRY_NOT_FOUND');
    if (dto.version !== e.version) {
      throw fail('ENTRY_CONFLICT', undefined, { current: await this.get(projectId, id) });
    }
    const translation = normalizeText(dto.translation);
    const changed = translation !== e.translation;
    const cur = e.stage as Stage;
    if (changed) this.access.assert(ctx, permissionToEdit(cur));

    let next: Stage;
    if (dto.stage) next = dto.stage;
    else if (!changed) next = cur;
    else if (translation === '') next = cur === 'LOCKED' || cur === 'HIDDEN' ? cur : 'UNTRANSLATED';
    else next = cur === 'UNTRANSLATED' || cur === 'QUESTIONED' ? 'TRANSLATED' : cur;

    if (translation === '' && (next === 'TRANSLATED' || next === 'REVIEWED')) {
      throw fail('EMPTY_TRANSLATION_STAGE');
    }
    if (translation !== '' && next === 'UNTRANSLATED') next = 'TRANSLATED';
    const tp = permissionForTransition(cur, next);
    if (tp) this.access.assert(ctx, tp);
    if (!changed && next === cur) return this.get(projectId, id);

    const data: Prisma.EntryUncheckedUpdateManyInput = {
      translation,
      stage: next,
      version: { increment: 1 },
      updatedAt: new Date(),
    };
    if (changed) data.translatorId = translation ? userId : null;
    if (next === 'REVIEWED' && cur !== 'REVIEWED') data.reviewerId = userId;
    if (cur === 'REVIEWED' && next !== 'REVIEWED' && next !== 'LOCKED') data.reviewerId = null;

    const res = await this.prisma.entry.updateMany({ where: { id, version: dto.version }, data });
    if (!res.count) {
      throw fail('ENTRY_CONFLICT', undefined, { current: await this.get(projectId, id) });
    }
    await this.prisma.entryHistory.create({
      data: { entryId: id, projectId, userId, action: changed ? 'TRANSLATE' : 'STAGE', translation, stage: next },
    });
    return this.get(projectId, id);
  }

  async history(projectId: string, id: string) {
    await this.get(projectId, id);
    return this.prisma.entryHistory.findMany({
      where: { entryId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { user: USER_BRIEF },
    });
  }

  async rollback(ctx: ProjectContext, id: string, historyId: string, version: number) {
    const h = await this.prisma.entryHistory.findFirst({ where: { id: historyId, entryId: id, projectId: ctx.project.id } });
    if (!h) throw fail('HISTORY_NOT_FOUND');
    const e = await this.prisma.entry.findFirst({ where: { id, projectId: ctx.project.id } });
    if (!e) throw fail('ENTRY_NOT_FOUND');
    if (version !== e.version) {
      throw fail('ENTRY_CONFLICT', undefined, { current: await this.get(ctx.project.id, id) });
    }
    const cur = e.stage as Stage;
    this.access.assert(ctx, permissionToEdit(cur));
    let next: Stage = cur;
    if (h.translation === '') next = cur === 'LOCKED' || cur === 'HIDDEN' ? cur : 'UNTRANSLATED';
    else if (cur === 'UNTRANSLATED' || cur === 'QUESTIONED') next = 'TRANSLATED';
    const res = await this.prisma.entry.updateMany({
      where: { id, version },
      data: {
        translation: h.translation,
        stage: next,
        translatorId: h.translation ? ctx.user!.id : null,
        version: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    if (!res.count) throw fail('ENTRY_CONFLICT', undefined, { current: await this.get(ctx.project.id, id) });
    await this.prisma.entryHistory.create({
      data: {
        entryId: id,
        projectId: ctx.project.id,
        userId: ctx.user!.id,
        action: 'ROLLBACK',
        translation: h.translation,
        stage: next,
        note: h.createdAt.toISOString(),
      },
    });
    return this.get(ctx.project.id, id);
  }

  async batch(ctx: ProjectContext, action: BatchAction, ids: string[] | undefined, filter: EntryFilter | undefined) {
    this.access.assert(ctx, BATCH_ACTION_PERMISSION[action]);
    const projectId = ctx.project.id;
    const userId = ctx.user!.id;
    const target: Prisma.EntryWhereInput = ids?.length
      ? { projectId, id: { in: ids.slice(0, MAX_BATCH) } }
      : this.buildWhere(projectId, filter ?? {});

    const ALL_VISIBLE: Stage[] = ['UNTRANSLATED', 'TRANSLATED', 'QUESTIONED', 'REVIEWED', 'LOCKED'];
    const rules: Record<BatchAction, { from: Stage[]; needText?: boolean; to: (hasText: boolean) => Stage }> = {
      review: { from: ['TRANSLATED', 'QUESTIONED'], needText: true, to: () => 'REVIEWED' },
      unreview: { from: ['REVIEWED'], to: () => 'TRANSLATED' },
      question: { from: ['UNTRANSLATED', 'TRANSLATED', 'REVIEWED'], to: () => 'QUESTIONED' },
      lock: { from: ['UNTRANSLATED', 'TRANSLATED', 'QUESTIONED', 'REVIEWED'], to: () => 'LOCKED' },
      unlock: { from: ['LOCKED'], to: (t) => (t ? 'REVIEWED' : 'UNTRANSLATED') },
      hide: { from: ALL_VISIBLE, to: () => 'HIDDEN' },
      unhide: { from: ['HIDDEN'], to: (t) => (t ? 'TRANSLATED' : 'UNTRANSLATED') },
      clear: { from: ['TRANSLATED', 'QUESTIONED', 'REVIEWED'], to: () => 'UNTRANSLATED' },
    };
    const rule = rules[action];
    const rows = await this.prisma.entry.findMany({
      where: { AND: [target, { stage: { in: rule.from } }, rule.needText ? { translation: { not: '' } } : {}] },
      select: { id: true, translation: true },
      take: MAX_BATCH,
    });
    const groups = new Map<Stage, { id: string; translation: string }[]>();
    for (const r of rows) {
      const to = rule.to(r.translation !== '');
      const g = groups.get(to) ?? [];
      g.push(r);
      groups.set(to, g);
    }
    const now = new Date();
    for (const [to, list] of groups) {
      for (const part of chunk(list, 5000)) {
        const data: Prisma.EntryUncheckedUpdateManyInput = { stage: to, version: { increment: 1 }, updatedAt: now };
        if (action === 'review') data.reviewerId = userId;
        if (action === 'unreview') data.reviewerId = null;
        if (action === 'clear') Object.assign(data, { translation: '', translatorId: null, reviewerId: null });
        await this.prisma.entry.updateMany({ where: { id: { in: part.map((r) => r.id) } }, data });
        await this.prisma.entryHistory.createMany({
          data: part.map((r) => ({
            entryId: r.id,
            projectId,
            userId,
            action: 'BATCH',
            translation: action === 'clear' ? '' : r.translation,
            stage: to,
            note: action,
          })),
        });
      }
    }
    if (rows.length) {
      await this.activity.log(projectId, userId, 'entries.batch', { action, count: rows.length });
    }
    return { affected: rows.length };
  }

  /** 原文相同的其他脚本 / 插件字符串（同一个值常在一处赋值、另一处比较） */
  async linked(projectId: string, id: string) {
    const e = await this.get(projectId, id);
    if (!LINKED_CATEGORIES.includes(e.category as never)) return [];
    return this.prisma.entry.findMany({
      where: { projectId, original: e.original, category: { in: LINKED_CATEGORIES }, id: { not: id } },
      orderBy: [{ file: { path: 'asc' } }, { sortOrder: 'asc' }],
      take: 200,
      select: ENTRY_SELECT,
    });
  }

  /** 把该词条的译文与状态复制到原文相同的脚本 / 插件字符串；无权修改的跳过 */
  async syncLinked(ctx: ProjectContext, id: string) {
    const projectId = ctx.project.id;
    const userId = ctx.user!.id;
    const src = await this.prisma.entry.findFirst({ where: { id, projectId } });
    if (!src) throw fail('ENTRY_NOT_FOUND');
    if (!LINKED_CATEGORIES.includes(src.category as never) || !src.translation) return { affected: 0, skipped: 0 };
    const to = src.stage as Stage;
    const targets = await this.prisma.entry.findMany({
      where: { projectId, original: src.original, category: { in: LINKED_CATEGORIES }, id: { not: id } },
      select: { id: true, stage: true, translation: true },
    });
    const pending = targets.filter((x) => x.translation !== src.translation || x.stage !== to);
    const allowed = pending.filter((x) => {
      const from = x.stage as Stage;
      const tp = permissionForTransition(from, to);
      return can(ctx, permissionToEdit(from)) && (!tp || can(ctx, tp));
    });
    if (allowed.length) {
      const ids = allowed.map((x) => x.id);
      const data: Prisma.EntryUncheckedUpdateManyInput = { translation: src.translation, stage: to, translatorId: userId, version: { increment: 1 }, updatedAt: new Date() };
      if (to === 'REVIEWED') data.reviewerId = userId;
      else if (to !== 'LOCKED') data.reviewerId = null;
      await this.prisma.$transaction([
        this.prisma.entry.updateMany({ where: { id: { in: ids } }, data }),
        this.prisma.entryHistory.createMany({
          data: ids.map((entryId) => ({ entryId, projectId, userId, action: 'SYNC', translation: src.translation, stage: to })),
        }),
      ]);
      const text = src.original.length > 30 ? `${src.original.slice(0, 30)}…` : src.original;
      await this.activity.log(projectId, userId, 'entries.sync', { text, count: ids.length });
    }
    return { affected: allowed.length, skipped: pending.length - allowed.length };
  }

  /**
   * 批量替换译文（审核员及以上）。只改当前用户有权修改的词条，状态不变，写入历史可回滚；
   * dryRun 时只返回预览。未指定范围时为整个项目（含已隐藏）。
   */
  async replace(ctx: ProjectContext, o: ReplaceOptions & { filter?: EntryFilter; dryRun?: boolean }, t: Translator) {
    this.access.assert(ctx, PERMISSIONS.REVIEW);
    const re = buildMatcher(o);
    if (!re) throw fail('REPLACE_INVALID_PATTERN');
    const projectId = ctx.project.id;
    const where = this.buildWhere(projectId, o.filter ?? { stage: STAGES.join(',') });
    // 普通文本先用数据库缩小范围，最终以 JS 的匹配结果为准
    const narrow: Prisma.EntryWhereInput = o.regex
      ? { translation: { not: '' } }
      : { translation: { contains: escapeLike(o.find), ...(o.caseSensitive ? {} : { mode: 'insensitive' as const }) } };
    const rows = await this.prisma.entry.findMany({
      where: { AND: [where, narrow] },
      select: { id: true, key: true, translation: true, stage: true, version: true, contextData: true, contextSearch: true, file: { select: { path: true } } },
      orderBy: [{ file: { path: 'asc' } }, { sortOrder: 'asc' }],
      take: MAX_BATCH,
    });
    const changes: (typeof rows[number] & { after: string })[] = [];
    let skipped = 0;
    let occurrences = 0;
    for (const r of rows) {
      const { result, count } = replaceWithSegments(r.translation, re, o);
      if (!count || result === r.translation) continue;
      if (!can(ctx, permissionToEdit(r.stage as Stage))) {
        skipped++;
        continue;
      }
      occurrences += count;
      changes.push({ ...r, after: result });
    }
    if (o.dryRun) {
      const items = changes.slice(0, 200).map(({ after, translation, version: _v, ...r }) => ({ ...withContextText(r, t), before: translation, after }));
      return { affected: changes.length, skipped, occurrences, items };
    }

    const userId = ctx.user!.id;
    const note = `${o.find} → ${o.replace}`.slice(0, 200);
    let affected = 0;
    for (const part of chunk(changes, 2000)) {
      // 版本号不一致说明期间被他人修改，跳过
      const updated = await this.prisma.$queryRaw<{ id: string; stage: Stage; translation: string }[]>`
        UPDATE "Entry" AS e
        SET "translation" = v.t, "version" = e."version" + 1, "updatedAt" = now()
        FROM (
          SELECT unnest(${part.map((c) => c.id)}::text[]) AS id,
                 unnest(${part.map((c) => c.after)}::text[]) AS t,
                 unnest(${part.map((c) => c.version)}::int[]) AS ver
        ) AS v
        WHERE e.id = v.id AND e."version" = v.ver
        RETURNING e.id, e.stage, e.translation`;
      affected += updated.length;
      await this.prisma.entryHistory.createMany({
        data: updated.map((u) => ({ entryId: u.id, projectId, userId, action: 'REPLACE', translation: u.translation, stage: u.stage, note })),
      });
    }
    if (affected) {
      const short = (s: string) => (s.length > 30 ? `${s.slice(0, 30)}…` : s);
      await this.activity.log(projectId, userId, 'entries.replace', { find: short(o.find), replace: short(o.replace), count: affected });
    }
    return { affected, skipped: skipped + (changes.length - affected), occurrences };
  }

  /** 翻译记忆：按原文三元组相似度推荐项目内已有译文 */
  async suggestions(projectId: string, id: string) {
    const e = await this.get(projectId, id);
    const rows = await this.prisma.$queryRaw<
      { id: string; original: string; translation: string; stage: string; path: string; score: number }[]
    >`
      SELECT e.id, e.original, e.translation, e.stage::text AS stage, f.path, similarity(e.original, ${e.original})::float AS score
      FROM "Entry" e JOIN "File" f ON f.id = e."fileId"
      WHERE e."projectId" = ${projectId}
        AND e.id <> ${id}
        AND e.translation <> ''
        AND e.stage <> 'HIDDEN'
        AND e.original % ${e.original}
      ORDER BY score DESC, e."updatedAt" DESC
      LIMIT 8`;
    // 合并重复译文，保留最高分
    const seen = new Set<string>();
    return rows.filter((r) => {
      const k = `${r.original}\u0000${r.translation}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  /** 翻译记忆批量填充：把完全相同原文的已有译文填入未翻译词条 */
  async fill(ctx: ProjectContext, fileId?: string) {
    const projectId = ctx.project.id;
    const userId = ctx.user!.id;
    const fileCond = fileId ? Prisma.sql`AND e."fileId" = ${fileId}` : Prisma.empty;
    const updated = await this.prisma.$queryRaw<{ id: string; translation: string }[]>`
      WITH src AS (
        SELECT DISTINCT ON (original) original, translation
        FROM "Entry"
        WHERE "projectId" = ${projectId} AND translation <> '' AND stage IN ('TRANSLATED', 'REVIEWED', 'LOCKED')
        ORDER BY original, (stage IN ('REVIEWED', 'LOCKED')) DESC, "updatedAt" DESC
      )
      UPDATE "Entry" e
      SET translation = src.translation, stage = 'TRANSLATED', version = e.version + 1,
          "updatedAt" = now(), "translatorId" = ${userId}
      FROM src
      WHERE e."projectId" = ${projectId} AND e.stage = 'UNTRANSLATED' AND e.translation = ''
        AND e.original = src.original ${fileCond}
      RETURNING e.id, e.translation`;
    for (const part of chunk(updated, 5000)) {
      await this.prisma.entryHistory.createMany({
        data: part.map((r) => ({ entryId: r.id, projectId, userId, action: 'TM_FILL', translation: r.translation, stage: 'TRANSLATED' as const })),
      });
    }
    if (updated.length) await this.activity.log(projectId, userId, 'tm.fill', { count: updated.length });
    return { affected: updated.length };
  }
}
