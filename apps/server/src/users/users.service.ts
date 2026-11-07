import { Injectable } from '@nestjs/common';
import { PUBLIC_USER_SELECT } from '../auth/auth.service';
import type { AuthUser } from '../common/decorators';
import { fail } from '../common/errors';
import { escapeLike, pageParams } from '../common/query';
import { PrismaService } from '../prisma/prisma.service';
import { AdminUpdateUserDto, UpdateMeDto } from './users.dto';

const USER_BRIEF = { id: true, username: true, displayName: true } as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async updateMe(userId: string, dto: UpdateMeDto) {
    if (dto.email) {
      dto.email = dto.email.toLowerCase();
      if (await this.prisma.user.findFirst({ where: { email: dto.email, NOT: { id: userId } } })) throw fail('EMAIL_TAKEN');
    }
    return this.prisma.user.update({ where: { id: userId }, data: dto, select: PUBLIC_USER_SELECT });
  }

  search(q: string) {
    const term = escapeLike(q.trim());
    if (!term) return [];
    return this.prisma.user.findMany({
      where: {
        isBanned: false,
        OR: [{ username: { contains: term, mode: 'insensitive' } }, { displayName: { contains: term, mode: 'insensitive' } }],
      },
      select: USER_BRIEF,
      take: 10,
      orderBy: { username: 'asc' },
    });
  }

  async profile(username: string, viewer: AuthUser) {
    const user = await this.prisma.user.findUnique({
      where: { username },
      select: { ...USER_BRIEF, bio: true, createdAt: true },
    });
    if (!user) throw fail('USER_NOT_FOUND');
    const visible = viewer.isSuperAdmin ? {} : { OR: [{ visibility: 'PUBLIC' as const }, { members: { some: { userId: viewer.id } } }] };
    const [memberships, translated, reviewed] = await Promise.all([
      this.prisma.projectMember.findMany({
        where: { userId: user.id, project: visible },
        include: { project: { select: { id: true, name: true, engine: true, targetLang: true } } },
        orderBy: { joinedAt: 'desc' },
      }),
      this.prisma.entry.count({ where: { translatorId: user.id } }),
      this.prisma.entry.count({ where: { reviewerId: user.id } }),
    ]);
    return { ...user, memberships, stats: { translated, reviewed } };
  }

  async stats() {
    const [users, projects, entries, files] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.project.count(),
      this.prisma.entry.count(),
      this.prisma.file.count(),
    ]);
    return { users, projects, entries, files };
  }

  async list(q: string, page?: string, pageSize?: string) {
    const { skip, take, ...p } = pageParams(page, pageSize);
    const like = escapeLike(q.trim());
    const where = like
      ? {
          OR: (['username', 'email', 'displayName'] as const).map((f) => ({ [f]: { contains: like, mode: 'insensitive' as const } })),
        }
      : {};
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: { ...PUBLIC_USER_SELECT, isBanned: true, _count: { select: { memberships: true } } },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total, ...p };
  }

  update(actor: AuthUser, id: string, dto: AdminUpdateUserDto) {
    if (id === actor.id && (dto.isSuperAdmin === false || dto.isBanned)) throw fail('SELF_ADMIN_CHANGE');
    return this.prisma.user.update({ where: { id }, data: dto, select: { ...PUBLIC_USER_SELECT, isBanned: true } });
  }
}
