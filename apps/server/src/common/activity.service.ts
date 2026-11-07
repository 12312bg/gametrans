import { Injectable } from '@nestjs/common';
import type { Params } from '@gametrans/shared';
import { PrismaService } from '../prisma/prisma.service';

/** 项目动态：只存类型与参数，查看时按语言渲染（见 i18n 的 activity.*） */
@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async log(projectId: string, userId: string | null | undefined, type: string, params: Params = {}): Promise<void> {
    await this.prisma.activity.create({ data: { projectId, userId: userId ?? null, type, params } });
  }
}
