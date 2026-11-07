import { resolve } from 'node:path';

const bool = (v: string | undefined, def: boolean) => (v === undefined ? def : v === 'true' || v === '1');

export const config = {
  port: Number(process.env.PORT ?? 3000),
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  jwtExpiresDays: Number(process.env.JWT_EXPIRES_DAYS ?? 14),
  storageDir: resolve(process.env.STORAGE_DIR ?? './storage'),
  staticDir: process.env.STATIC_DIR ? resolve(process.env.STATIC_DIR) : undefined,
  uploadLimitMb: Number(process.env.UPLOAD_LIMIT_MB ?? 512),
  cookieSecure: bool(process.env.COOKIE_SECURE, false),
  allowRegistration: bool(process.env.ALLOW_REGISTRATION, true),
  /** everyone：任何登录用户都可创建项目；superadmin：仅超级管理员 */
  projectCreation: (process.env.PROJECT_CREATION ?? 'everyone') as 'everyone' | 'superadmin',
  admin: {
    username: process.env.ADMIN_USERNAME,
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  },
};

export const AUTH_COOKIE = 'gt_token';
