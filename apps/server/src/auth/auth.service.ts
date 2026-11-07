import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { fail } from '../common/errors';
import { config } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto, RegisterDto } from './auth.dto';

export const PUBLIC_USER_SELECT = {
  id: true,
  username: true,
  displayName: true,
  email: true,
  bio: true,
  isSuperAdmin: true,
  locale: true,
  createdAt: true,
} as const;

const hash = (password: string) => bcrypt.hash(password, 10);

@Injectable()
export class AuthService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /** 按环境变量创建超级管理员（仅当用户名不存在） */
  async onApplicationBootstrap() {
    const { username, email, password } = config.admin;
    if (!username || !password || (await this.prisma.user.findUnique({ where: { username } }))) return;
    await this.prisma.user.create({
      data: { username, email: email ?? `${username}@localhost`, displayName: username, passwordHash: await hash(password), isSuperAdmin: true },
    });
    this.logger.log(`Created superadmin: ${username}`);
  }

  async register(dto: RegisterDto) {
    if (!config.allowRegistration) throw fail('REGISTRATION_CLOSED');
    const email = dto.email.toLowerCase();
    const dup = await this.prisma.user.findFirst({
      where: { OR: [{ username: { equals: dto.username, mode: 'insensitive' } }, { email }] },
    });
    if (dup) throw fail(dup.email === email ? 'EMAIL_TAKEN' : 'USERNAME_TAKEN');
    return this.prisma.user.create({
      data: {
        username: dto.username,
        email,
        displayName: dto.displayName?.trim() || dto.username,
        passwordHash: await hash(dto.password),
        locale: dto.locale ?? null,
      },
      select: PUBLIC_USER_SELECT,
    });
  }

  async validate(dto: LoginDto) {
    const login = dto.login.trim();
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ username: { equals: login, mode: 'insensitive' } }, { email: login.toLowerCase() }] },
    });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) throw fail('INVALID_CREDENTIALS');
    if (user.isBanned) throw fail('ACCOUNT_BANNED');
    return user;
  }

  sign(userId: string): Promise<string> {
    return this.jwt.signAsync({ sub: userId }, { expiresIn: `${config.jwtExpiresDays}d` });
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await bcrypt.compare(oldPassword, user.passwordHash))) throw fail('WRONG_PASSWORD');
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await hash(newPassword) } });
  }

  async resetPassword(userId: string, password: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await hash(password) } });
  }
}
