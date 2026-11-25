import { Injectable } from '@nestjs/common';
import { TwineMacroStat, analyzeTwineMacros, extractEntries } from '@gametrans/rpgmaker';
import { DEFAULT_TWINE_MACROS, ParserConfig, TwineConfig, normalizeTwineConfig } from '@gametrans/shared';
import { Prisma, Project } from '@prisma/client';
import { ActivityService } from '../common/activity.service';
import { ProjectContext } from '../common/access.service';
import { fail } from '../common/errors';
import { StorageService } from '../common/storage.service';
import { PrismaService } from '../prisma/prisma.service';

/** 分析时最多读取的文件数（故事通常只有一两个 HTML） */
const MAX_ANALYZE_FILES = 50;
/** 缓存的项目数：分析一个几 MB 的故事要几百毫秒，文件不变时复用 */
const CACHE_SIZE = 20;
/** 预览中每个宏列出的示例数 */
const PREVIEW_SAMPLES = 3;

interface Loaded {
  sig: string;
  files: { path: string; bytes: Uint8Array }[];
  macros?: TwineMacroStat[];
}

/** 每个宏在确认界面中的状态：已有规则、已标记不翻译、待确认 */
export type MacroStatus = 'configured' | 'ignored' | 'new';

/** 项目保存的规则（按当前格式规范化，如旧版本的 system 分类改为 ui） */
const configOf = (project: Project): TwineConfig => {
  const raw = (project.parserConfig as ParserConfig | null)?.twine ?? { macros: [] };
  const r = normalizeTwineConfig(raw);
  return r.ok ? r.value : raw;
};

@Injectable()
export class TwineService {
  private cache = new Map<string, Loaded>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly activity: ActivityService,
  ) {}

  private requireTwine(project: Project) {
    if (project.engine !== 'TWINE') throw fail('NOT_TWINE_PROJECT');
  }

  rules(ctx: ProjectContext) {
    this.requireTwine(ctx.project);
    const config = configOf(ctx.project);
    return { builtin: DEFAULT_TWINE_MACROS, macros: config.macros, ignored: config.ignored ?? [] };
  }

  async saveRules(ctx: ProjectContext, input: unknown) {
    this.requireTwine(ctx.project);
    const prev = (ctx.project.parserConfig as ParserConfig | null) ?? {};
    // 没有提交 ignored 时保留原来的「不翻译」名单
    const body = input as { macros?: unknown; ignored?: unknown };
    const r = normalizeTwineConfig(body?.ignored === undefined ? { ...body, ignored: prev.twine?.ignored ?? [] } : body);
    if (!r.ok) throw fail('VALIDATION_FAILED', { field: 'macros' }, { messageKey: r.error });
    const twine: TwineConfig = r.value;
    const parserConfig: ParserConfig = { ...prev, twine };
    await this.prisma.project.update({ where: { id: ctx.project.id }, data: { parserConfig: parserConfig as unknown as Prisma.InputJsonValue } });
    await this.activity.log(ctx.project.id, ctx.user?.id, 'project.twineRules', { count: twine.macros.length });
    return { builtin: DEFAULT_TWINE_MACROS, macros: twine.macros, ignored: twine.ignored ?? [] };
  }

  /** 读取项目的故事文件；文件内容不变时使用缓存 */
  private async load(projectId: string): Promise<Loaded> {
    const files = await this.prisma.file.findMany({ where: { projectId }, orderBy: { path: 'asc' }, take: MAX_ANALYZE_FILES, select: { path: true, storageKey: true, sha256: true } });
    const sig = files.map((f) => `${f.path}:${f.sha256}`).join('|');
    const hit = this.cache.get(projectId);
    if (hit?.sig === sig) {
      // 最近使用的放到最后
      this.cache.delete(projectId);
      this.cache.set(projectId, hit);
      return hit;
    }
    const loaded: Loaded = { sig, files: [] };
    for (const f of files) {
      if (await this.storage.exists(f.storageKey)) loaded.files.push({ path: f.path, bytes: await this.storage.read(f.storageKey) });
    }
    this.cache.set(projectId, loaded);
    while (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
    return loaded;
  }

  /**
   * 统计项目中所有故事文件的自定义宏，按宏定义判断参数用途并推荐规则。
   * pending 为有推荐、但还没有规则也没有标记为不翻译的宏（需要用户确认）。
   */
  async analyze(ctx: ProjectContext) {
    this.requireTwine(ctx.project);
    const loaded = await this.load(ctx.project.id);
    loaded.macros ??= analyzeTwineMacros(loaded.files);
    const config = configOf(ctx.project);
    const configured = new Set(config.macros.map((r) => r.name));
    const ignored = new Set(config.ignored ?? []);
    const macros = loaded.macros.map((m) => ({ ...m, status: (configured.has(m.name) ? 'configured' : ignored.has(m.name) ? 'ignored' : 'new') as MacroStatus }));
    const pending = macros.filter((m) => m.status === 'new' && m.suggested).map((m) => m.name);
    return { files: loaded.files.length, macros, pending };
  }

  /**
   * 预览一组规则的效果：与当前规则相比新增 / 移除多少词条，以及每个自定义宏会提取多少条（附示例）。
   * 不保存规则。
   */
  async preview(ctx: ProjectContext, input: unknown) {
    this.requireTwine(ctx.project);
    const r = normalizeTwineConfig(input);
    if (!r.ok) throw fail('VALIDATION_FAILED', { field: 'macros' }, { messageKey: r.error });
    const loaded = await this.load(ctx.project.id);
    const current = configOf(ctx.project);
    const keysOf = (config: TwineConfig) => {
      const out = new Map<string, string>();
      const perMacro = new Map<string, { count: number; samples: string[] }>();
      for (const f of loaded.files) {
        let entries: ReturnType<typeof extractEntries>['entries'];
        try {
          entries = extractEntries(f.path, f.bytes, 'TWINE', { twine: config }).entries;
        } catch {
          continue;
        }
        for (const e of entries) {
          out.set(`${f.path}\u0000${e.key}`, e.original);
          const k = e.context[1]?.k;
          const macro = k === 'ctx.tw.arg' || k === 'ctx.tw.say' || k === 'ctx.tw.prefixed' ? String(e.context[1].p?.macro ?? '') : '';
          if (!macro) continue;
          const m = perMacro.get(macro) ?? { count: 0, samples: [] };
          m.count++;
          if (m.samples.length < PREVIEW_SAMPLES && !m.samples.includes(e.original)) m.samples.push(e.original.length > 120 ? `${e.original.slice(0, 119)}…` : e.original);
          perMacro.set(macro, m);
        }
      }
      return { out, perMacro };
    };
    const before = keysOf(current);
    const after = keysOf(r.value);
    // 与导入时的合并一致：键变化（序号偏移）但原文相同的词条不算新增 / 移除
    const bag = (m: Map<string, string>) => {
      const out = new Map<string, number>();
      for (const [k, v] of m) {
        const id = `${k.split('\u0000')[0]}\u0000${v}`;
        out.set(id, (out.get(id) ?? 0) + 1);
      }
      return out;
    };
    const a = bag(after.out);
    const b = bag(before.out);
    let added = 0;
    let removed = 0;
    for (const [k, n] of a) added += Math.max(0, n - (b.get(k) ?? 0));
    for (const [k, n] of b) removed += Math.max(0, n - (a.get(k) ?? 0));
    return { total: after.out.size, current: before.out.size, added, removed, perMacro: Object.fromEntries(after.perMacro) };
  }
}
