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
  checkMarkup,
  hasMarkupWarnings,
  hasMissingMarkup,
  MarkupReport,
  replaceWithSegments,
} from '@gametrans/shared';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AccessService, ProjectContext } from '../common/access.service';
import { ActivityService } from '../common/activity.service';
import { AppException, fail } from '../common/errors';
import type { Translator } from '../common/locale';
import { chunk, escapeLike, pageParams } from '../common/query';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

export interface BulkSaveItem {
  id: string;
  version: number;
  translation: string;
  stage?: Stage;
  /** 说明：写入修改历史；严格模式下附带说明可保存缺少控制符的译文（如原文控制符本身有误） */
  note?: string;
}

export interface BulkSaveResult {
  id: string;
  status: 'saved' | 'unchanged' | 'conflict' | 'rejected' | 'error';
  warnings?: MarkupReport;
  error?: { code: string; message: string };
  /** 处理后词条的当前译文、状态与版本 */
  entry?: { translation: string; stage: Stage; version: number };
}

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
/** 整段事件最多返回的词条数 */
const SCENE_LIMIT = 2000;

/** 从「显示文章」的位置说明中取说话人（姓名框）与脸图 */
function speakerOf(parts: ContextPart[] | null): { name?: string; face?: string } | null {
  const p = parts?.find((x) => x.k.startsWith('ctx.cmd.showText'))?.p as { speaker?: string; face?: string; index?: number } | undefined;
  if (!p || (!p.speaker && !p.face)) return null;
  return { ...(p.speaker ? { name: p.speaker } : {}), ...(p.face ? { face: `${p.face}(${p.index ?? 0})` } : {}) };
}

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
    private readonly rt: RealtimeService,
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

  /**
   * 整段事件：与该词条同一事件页（或公共事件、敌群页）的全部词条，按指令顺序排列，
   * 带说话人与分支路径。不在事件中的词条返回 scene: null。
   */
  async scene(projectId: string, id: string, t: Translator) {
    const e = await this.prisma.entry.findFirst({ where: { id, projectId }, select: { id: true, key: true, fileId: true, contextData: true, contextSearch: true, file: { select: { path: true } } } });
    if (!e) throw fail('ENTRY_NOT_FOUND');
    const at = e.key.indexOf('/list/');
    if (at < 0) return { scene: null, items: [] };
    const prefix = e.key.slice(0, at + '/list/'.length);
    const rows = await this.prisma.entry.findMany({
      where: { fileId: e.fileId, key: { startsWith: prefix } },
      orderBy: { sortOrder: 'asc' },
      take: SCENE_LIMIT + 1,
      select: { id: true, key: true, original: true, translation: true, stage: true, version: true, category: true, contextData: true, branch: true, translator: USER_BRIEF, reviewer: USER_BRIEF },
    });
    const parts = (e.contextData as ContextPart[] | null) ?? null;
    return {
      scene: {
        fileId: e.fileId,
        path: e.file.path,
        prefix,
        // 位置说明去掉最后一段（具体指令），即事件 / 页
        title: parts ? formatContext(parts.slice(0, -1), t) : e.contextSearch,
        truncated: rows.length > SCENE_LIMIT,
      },
      items: rows.slice(0, SCENE_LIMIT).map(({ contextData, ...r }) => ({ ...r, speaker: speakerOf(contextData as ContextPart[] | null), current: r.id === id })),
    };
  }

  async update(ctx: ProjectContext, id: string, dto: { translation: string; stage?: Stage; version: number }) {
    const projectId = ctx.project.id;
    const e = await this.prisma.entry.findFirst({ where: { id, projectId } });
    if (!e) throw fail('ENTRY_NOT_FOUND');
    if (!(await this.saveOne(ctx, e, dto))) return this.get(projectId, id);
    const updated = await this.get(projectId, id);
    this.rt.entry(projectId, ctx.user, updated);
    return updated;
  }

  /**
   * 保存一条词条的译文 / 状态（乐观锁）。返回 false 表示没有变化；
   * 版本不一致抛出 ENTRY_CONFLICT，权限或状态不允许时抛出相应错误。
   */
  private async saveOne(
    ctx: ProjectContext,
    e: { id: string; translation: string; stage: string; version: number },
    dto: { translation: string; stage?: Stage; version: number },
    extra: { batchId?: string; note?: string } = {},
  ): Promise<boolean> {
    const projectId = ctx.project.id;
    const userId = ctx.user!.id;
    const id = e.id;
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
    if (!changed && next === cur) return false;

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
      data: { entryId: id, projectId, userId, action: changed ? 'TRANSLATE' : 'STAGE', translation, stage: next, note: extra.note ?? '', batchId: extra.batchId },
    });
    return true;
  }

  /**
   * 批量保存（最多 500 条）：逐条独立处理，互不影响，逐条返回结果与控制符检查。
   * strict 时，译文漏掉控制符 / 占位符 / 标签的词条不写入，除非该条附带说明（note）。
   */
  async bulkSave(ctx: ProjectContext, items: BulkSaveItem[], strict = false, t: Translator) {
    const projectId = ctx.project.id;
    const ids = [...new Set(items.map((i) => i.id))];
    if (ids.length !== items.length) throw fail('BULK_DUPLICATE_IDS');
    const rows = await this.prisma.entry.findMany({ where: { projectId, id: { in: ids } }, select: { id: true, original: true, category: true, translation: true, stage: true, version: true } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const batchId = randomUUID();
    const results: BulkSaveResult[] = [];
    let saved = 0;
    for (const item of items) {
      const e = byId.get(item.id);
      if (!e) {
        results.push({ id: item.id, status: 'error', error: { code: 'ENTRY_NOT_FOUND', message: t('error.ENTRY_NOT_FOUND') } });
        continue;
      }
      const translation = normalizeText(item.translation);
      const markup = checkMarkup(e.original, translation, e.category);
      const warnings = hasMarkupWarnings(markup) ? markup : undefined;
      const note = item.note?.trim() || undefined;
      if (strict && hasMissingMarkup(markup) && !note) {
        results.push({ id: item.id, status: 'rejected', warnings, error: { code: 'MARKUP_MISSING', message: t('error.MARKUP_MISSING') } });
        continue;
      }
      try {
        const changed = await this.saveOne(ctx, e, { ...item, translation }, { batchId, note });
        if (changed) saved++;
        results.push({ id: item.id, status: changed ? 'saved' : 'unchanged', warnings });
      } catch (err) {
        if (!(err instanceof AppException)) throw err;
        results.push({
          id: item.id,
          status: err.code === 'ENTRY_CONFLICT' ? 'conflict' : 'error',
          warnings,
          error: { code: err.code, message: t(`error.${err.code}`, err.params) },
        });
      }
    }
    // 附上保存后（或冲突时的当前）译文与状态，便于调用方核对
    const after = await this.prisma.entry.findMany({ where: { projectId, id: { in: ids } }, select: { id: true, translation: true, stage: true, version: true } });
    const now = new Map(after.map((r) => [r.id, r]));
    for (const r of results) {
      const cur = now.get(r.id);
      if (cur) r.entry = { translation: cur.translation, stage: cur.stage as Stage, version: cur.version };
    }
    if (saved) {
      await this.activity.log(projectId, ctx.user!.id, 'entries.bulkSave', { count: saved });
      this.rt.entries(projectId, ctx.user, saved);
    }
    const count = (s: BulkSaveResult['status']) => results.filter((r) => r.status === s).length;
    return {
      saved,
      unchanged: count('unchanged'),
      conflict: count('conflict'),
      rejected: count('rejected'),
      error: count('error'),
      batchId: saved ? batchId : null,
      results,
    };
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
    const updated = await this.get(ctx.project.id, id);
    this.rt.entry(ctx.project.id, ctx.user, updated);
    return updated;
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
    const batchId = randomUUID();
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
            batchId,
          })),
        });
      }
    }
    if (rows.length) {
      await this.activity.log(projectId, userId, 'entries.batch', { action, count: rows.length });
      this.rt.entries(projectId, ctx.user, rows.length);
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
      const batchId = randomUUID();
      const data: Prisma.EntryUncheckedUpdateManyInput = { translation: src.translation, stage: to, translatorId: userId, version: { increment: 1 }, updatedAt: new Date() };
      if (to === 'REVIEWED') data.reviewerId = userId;
      else if (to !== 'LOCKED') data.reviewerId = null;
      await this.prisma.$transaction([
        this.prisma.entry.updateMany({ where: { id: { in: ids } }, data }),
        this.prisma.entryHistory.createMany({
          data: ids.map((entryId) => ({ entryId, projectId, userId, action: 'SYNC', translation: src.translation, stage: to, batchId })),
        }),
      ]);
      const text = src.original.length > 30 ? `${src.original.slice(0, 30)}…` : src.original;
      await this.activity.log(projectId, userId, 'entries.sync', { text, count: ids.length });
      this.rt.entries(projectId, ctx.user, ids.length);
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
    const batchId = randomUUID();
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
        data: updated.map((u) => ({ entryId: u.id, projectId, userId, action: 'REPLACE', translation: u.translation, stage: u.stage, note, batchId })),
      });
    }
    if (affected) {
      const short = (s: string) => (s.length > 30 ? `${s.slice(0, 30)}…` : s);
      await this.activity.log(projectId, userId, 'entries.replace', { find: short(o.find), replace: short(o.replace), count: affected });
      this.rt.entries(projectId, ctx.user, affected);
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

  /**
   * 批量精确匹配：按原文（完全相同，换行统一为 \n）查找项目内已有译文。
   * 同一原文有多种译法时全部返回，按「已审核优先、使用次数多优先」排序，每种译法附带最多 5 个来源。
   */
  async lookup(projectId: string, texts: string[], includeQuestioned = false) {
    const wanted = [...new Set(texts.map(normalizeText))];
    const stages: Stage[] = includeQuestioned ? ['TRANSLATED', 'REVIEWED', 'LOCKED', 'QUESTIONED'] : ['TRANSLATED', 'REVIEWED', 'LOCKED'];
    const rows = await this.prisma.entry.findMany({
      where: { projectId, original: { in: wanted }, translation: { not: '' }, stage: { in: stages } },
      select: { id: true, key: true, original: true, translation: true, stage: true, updatedAt: true, file: { select: { path: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 50_000,
    });
    type Candidate = { translation: string; count: number; reviewed: number; stages: Partial<Record<Stage, number>>; lastUsed: Date; sources: { entryId: string; path: string; key: string; stage: Stage }[] };
    const byText = new Map<string, Map<string, Candidate>>();
    for (const r of rows) {
      const m = byText.get(r.original) ?? new Map<string, Candidate>();
      byText.set(r.original, m);
      const c = m.get(r.translation) ?? { translation: r.translation, count: 0, reviewed: 0, stages: {}, lastUsed: r.updatedAt, sources: [] };
      m.set(r.translation, c);
      const stage = r.stage as Stage;
      c.count++;
      if (stage === 'REVIEWED' || stage === 'LOCKED') c.reviewed++;
      c.stages[stage] = (c.stages[stage] ?? 0) + 1;
      if (r.updatedAt > c.lastUsed) c.lastUsed = r.updatedAt;
      if (c.sources.length < 5) c.sources.push({ entryId: r.id, path: r.file.path, key: r.key, stage });
    }
    return {
      results: texts.map((text) => {
        const cands = [...(byText.get(normalizeText(text))?.values() ?? [])].sort(
          (a, b) => b.reviewed - a.reviewed || b.count - a.count || b.lastUsed.getTime() - a.lastUsed.getTime(),
        );
        return { text, matches: cands.map(({ lastUsed, ...c }) => ({ ...c, lastUsed })) };
      }),
    };
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
    const batchId = randomUUID();
    for (const part of chunk(updated, 5000)) {
      await this.prisma.entryHistory.createMany({
        data: part.map((r) => ({ entryId: r.id, projectId, userId, action: 'TM_FILL', translation: r.translation, stage: 'TRANSLATED' as const, batchId })),
      });
    }
    if (updated.length) {
      await this.activity.log(projectId, userId, 'tm.fill', { count: updated.length });
      this.rt.entries(projectId, ctx.user, updated.length);
    }
    return { affected: updated.length };
  }
}
