import { Injectable } from '@nestjs/common';
import { analyzeTwineMacros } from '@gametrans/rpgmaker';
import { DEFAULT_TWINE_MACROS, ParserConfig, TwineConfig, normalizeTwineConfig } from '@gametrans/shared';
import { Prisma, Project } from '@prisma/client';
import { ActivityService } from '../common/activity.service';
import { ProjectContext } from '../common/access.service';
import { fail } from '../common/errors';
import { StorageService } from '../common/storage.service';
import { PrismaService } from '../prisma/prisma.service';

/** 分析时最多读取的文件数（故事通常只有一两个 HTML） */
const MAX_ANALYZE_FILES = 50;

@Injectable()
export class TwineService {
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
    const config = (ctx.project.parserConfig as ParserConfig | null)?.twine;
    return { builtin: DEFAULT_TWINE_MACROS, macros: config?.macros ?? [] };
  }

  async saveRules(ctx: ProjectContext, input: unknown) {
    this.requireTwine(ctx.project);
    const r = normalizeTwineConfig(input);
    if (!r.ok) throw fail('VALIDATION_FAILED', { field: 'macros' }, { messageKey: r.error });
    const prev = (ctx.project.parserConfig as ParserConfig | null) ?? {};
    const twine: TwineConfig = r.value;
    const parserConfig: ParserConfig = { ...prev, twine };
    await this.prisma.project.update({ where: { id: ctx.project.id }, data: { parserConfig: parserConfig as unknown as Prisma.InputJsonValue } });
    await this.activity.log(ctx.project.id, ctx.user?.id, 'project.twineRules', { count: twine.macros.length });
    return { builtin: DEFAULT_TWINE_MACROS, macros: twine.macros };
  }

  /** 统计项目中所有故事文件的自定义宏，推荐提取规则 */
  async analyze(ctx: ProjectContext) {
    this.requireTwine(ctx.project);
    const files = await this.prisma.file.findMany({ where: { projectId: ctx.project.id }, orderBy: { path: 'asc' }, take: MAX_ANALYZE_FILES, select: { path: true, storageKey: true } });
    const loaded: { path: string; bytes: Uint8Array }[] = [];
    for (const f of files) {
      if (await this.storage.exists(f.storageKey)) loaded.push({ path: f.path, bytes: await this.storage.read(f.storageKey) });
    }
    return { files: loaded.length, macros: analyzeTwineMacros(loaded) };
  }
}
