import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async log(projectId: string, userId: string | null | undefined, type: string, message: string): Promise<void> {
    await this.prisma.activity.create({ data: { projectId, userId: userId ?? null, type, message } });
  }
}
