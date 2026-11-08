import { STAGES, Stage } from '@gametrans/shared';
import type { PrismaService } from '../prisma/prisma.service';

export type StageCounts = Record<Stage, number>;

export const emptyCounts = (): StageCounts => Object.fromEntries(STAGES.map((s) => [s, 0])) as StageCounts;

/** 按 by 字段（项目或文件）分组统计各状态的词条数 */
export async function stageCounts(prisma: PrismaService, by: 'projectId' | 'fileId', where: { projectId: string | { in: string[] } }) {
  const rows = await prisma.entry.groupBy({ by: [by, 'stage'], where, _count: { _all: true } });
  const map = new Map<string, StageCounts>();
  for (const r of rows) {
    const id = (r as unknown as Record<string, string>)[by];
    const c = map.get(id) ?? emptyCounts();
    c[r.stage as Stage] = r._count._all;
    map.set(id, c);
  }
  return map;
}
