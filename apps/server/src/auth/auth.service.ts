import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, OnApplicationBootstrap, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
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
  createdAt: true,
} as const;

@Injectable()
export class AuthService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /** 启动时按环境变量创建超级管理员（仅当用户名不存在） */
  async onApplicationBootstrap() {
    const { username, email, password } = config.admin;
    if (!username || !password) return;
    const exists = await this.prisma.user.findUnique({ where: { username } });
    if (exists) return;
    await this.prisma.user.create({
      data: {
        username,
        email: email ?? `${username}@localhost`,
        displayName: username,
        passwordHash: await bcrypt.hash(password, 10),
        isSuperAdmin: true,
      },
    });
    this.logger.log(`已创建超级管理员账号：${username}`);
  }

  async register(dto: RegisterDto) {
    if (!config.allowRegistration) throw new ForbiddenException('本站已关闭公开注册');
    const email = dto.email.toLowerCase();
    const dup = await this.prisma.user.findFirst({
      where: { OR: [{ username: { equals: dto.username, mode: 'insensitive' } }, { email }] },
    });
    if (dup) throw new ConflictException(dup.email === email ? '该邮箱已被注册' : '该用户名已被占用');
    return this.prisma.user.create({
      data: {
        username: dto.username,
        email,
        displayName: dto.displayName?.trim() || dto.username,
        passwordHash: await bcrypt.hash(dto.password, 10),
      },
      select: PUBLIC_USER_SELECT,
    });
  }

  async validate(dto: LoginDto) {
    const login = dto.login.trim();
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ username: { equals: login, mode: 'insensitive' } }, { email: login.toLowerCase() }] },
    });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('用户名或密码错误');
    }
    if (user.isBanned) throw new ForbiddenException('该账号已被封禁');
    return user;
  }

  sign(userId: string): Promise<string> {
    return this.jwt.signAsync({ sub: userId }, { expiresIn: `${config.jwtExpiresDays}d` });
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await bcrypt.compare(oldPassword, user.passwordHash))) throw new BadRequestException('原密码不正确');
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(newPassword, 10) } });
  }

  hash(password: string) {
    return bcrypt.hash(password, 10);
  }
}
