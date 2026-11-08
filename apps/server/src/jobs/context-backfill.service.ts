import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { extractEntries } from '@gametrans/rpgmaker';
import { Engine, contextSearchText } from '@gametrans/shared';
import { chunk } from '../common/query';
import { StorageService } from '../common/storage.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 旧版本的词条只有中文位置说明。启动后在后台从已保存的原文件重新提取，补齐结构化位置说明；
 * 原文件缺失时保留旧文本作为兜底显示。
 */
@Injectable()
export class ContextBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ContextBackfillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  onApplicationBootstrap() {
    setImmediate(() => this.run().catch((e) => this.logger.error((e as Error).stack)));
  }

  async run(): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ fileId: string }[]>`SELECT DISTINCT "fileId" FROM "Entry" WHERE "contextData" IS NULL`;
    let updated = 0;
    for (const { fileId } of rows) {
      const file = await this.prisma.file.findUnique({ where: { id: fileId }, include: { project: { select: { engine: true } } } });
      if (!file || !(await this.storage.exists(file.storageKey))) continue;
      let entries: ReturnType<typeof extractEntries>['entries'];
      try {
        entries = extractEntries(file.path, await this.storage.read(file.storageKey), file.project.engine as Engine).entries;
      } catch {
        continue;
      }
      for (const part of chunk(entries, 5000)) {
        updated += await this.prisma.$executeRaw`
          UPDATE "Entry" AS e SET "contextData" = v.c::jsonb, "contextSearch" = v.s
          FROM (
            SELECT unnest(${part.map((x) => x.key)}::text[]) AS k,
                   unnest(${part.map((x) => JSON.stringify(x.context))}::text[]) AS c,
                   unnest(${part.map((x) => contextSearchText(x.context))}::text[]) AS s
          ) AS v
          WHERE e."fileId" = ${fileId} AND e.key = v.k AND e."contextData" IS NULL`;
      }
    }
    if (updated) this.logger.log(`Backfilled structured context for ${updated} entries`);
    return updated;
  }
}
