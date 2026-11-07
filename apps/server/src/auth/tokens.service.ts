import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { MAX_TOKENS_PER_USER, TOKEN_PREFIX, TokenScope } from '@gametrans/shared';
import { createHash, randomBytes } from 'node:crypto';
import type { AuthUser } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

const LAST_USED_THROTTLE_MS = 60_000;

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

const TOKEN_SELECT = {
  id: true,
  name: true,
  prefix: true,
  scope: true,
  expiresAt: true,
  lastUsedAt: true,
  createdAt: true,
  project: { select: { id: true, name: true } },
} as const;

@Injectable()
export class TokensService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.apiToken.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, select: TOKEN_SELECT });
  }

  async create(userId: string, dto: { name: string; scope: TokenScope; expiresInDays: number; projectId?: string }) {
    const count = await this.prisma.apiToken.count({ where: { userId } });
    if (count >= MAX_TOKENS_PER_USER) throw new BadRequestException(`每个用户最多 ${MAX_TOKENS_PER_USER} 个令牌，请先删除不用的令牌`);
    if (dto.projectId) {
      // 令牌不继承超级管理员权限，因此只能限定到自己是成员的项目
      const member = await this.prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId: dto.projectId, userId } },
      });
      if (!member) throw new BadRequestException('只能限定到你参与的项目');
    }
    const raw = `${TOKEN_PREFIX}${randomBytes(24).toString('base64url')}`;
    const token = await this.prisma.apiToken.create({
      data: {
        userId,
        name: dto.name.trim(),
        tokenHash: hashToken(raw),
        prefix: raw.slice(0, TOKEN_PREFIX.length + 6),
        scope: dto.scope,
        projectId: dto.projectId ?? null,
        expiresAt: new Date(Date.now() + dto.expiresInDays * 24 * 3600 * 1000),
      },
      select: TOKEN_SELECT,
    });
    // 明文只在创建时返回一次
    return { ...token, token: raw };
  }

  async remove(userId: string, id: string) {
    const res = await this.prisma.apiToken.deleteMany({ where: { id, userId } });
    if (!res.count) throw new NotFoundException('令牌不存在');
  }

  /** 校验 Bearer 令牌，返回对应用户（不含超级管理员权限） */
  async authenticate(raw: string): Promise<AuthUser> {
    if (!raw.startsWith(TOKEN_PREFIX)) throw new UnauthorizedException('令牌无效或已过期');
    const t = await this.prisma.apiToken.findUnique({
      where: { tokenHash: hashToken(raw) },
      include: { user: { select: { id: true, username: true, displayName: true, email: true, isBanned: true } } },
    });
    if (!t || t.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException('令牌无效或已过期');
    if (t.user.isBanned) throw new ForbiddenException('该账号已被封禁');
    if (!t.lastUsedAt || Date.now() - t.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
      this.prisma.apiToken.update({ where: { id: t.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    }
    const { isBanned: _b, ...user } = t.user;
    return {
      ...user,
      isSuperAdmin: false,
      token: { id: t.id, scope: t.scope, projectId: t.projectId, expiresAt: t.expiresAt },
    };
  }
}
