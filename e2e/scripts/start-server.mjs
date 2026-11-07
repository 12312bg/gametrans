// E2E 专用服务：使用独立的测试数据库与存储目录，以生产模式启动（后端托管前端）。
// 只执行非破坏性的 prisma migrate deploy，不清空数据库；各用例使用随机命名的用户与项目互相隔离。
// 需先执行 pnpm build。
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const serverDir = join(root, 'apps/server');
const webDist = join(root, 'apps/web/dist');
const storage = join(root, 'e2e/.tmp/storage');
const port = process.env.E2E_PORT ?? '3100';

for (const p of [join(serverDir, 'dist/main.js'), join(webDist, 'index.html')]) {
  if (!existsSync(p)) {
    console.error(`缺少构建产物 ${p}，请先执行 pnpm build`);
    process.exit(1);
  }
}

const env = {
  ...process.env,
  DATABASE_URL: process.env.E2E_DATABASE_URL ?? 'postgresql://gametrans:gametrans@localhost:5432/gametrans_e2e',
  REDIS_URL: process.env.E2E_REDIS_URL ?? 'redis://localhost:6379/1',
  JWT_SECRET: 'e2e-secret',
  PORT: port,
  STORAGE_DIR: storage,
  STATIC_DIR: webDist,
  ADMIN_USERNAME: 'admin',
  ADMIN_EMAIL: 'admin@e2e.test',
  ADMIN_PASSWORD: 'admin123456',
  ALLOW_REGISTRATION: 'true',
  PROJECT_CREATION: 'everyone',
};

// 存储目录仅供 E2E 使用，每次运行前清空
rmSync(storage, { recursive: true, force: true });
mkdirSync(storage, { recursive: true });
try {
  execSync('npx prisma migrate deploy', { cwd: serverDir, env, stdio: 'inherit' });
} catch {
  console.error(`数据库迁移失败。请确认测试数据库已创建：${env.DATABASE_URL}`);
  process.exit(1);
}

const child = spawn(process.execPath, ['dist/main.js'], { cwd: serverDir, env, stdio: 'inherit' });
const stop = () => child.kill('SIGTERM');
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
child.on('exit', (code) => process.exit(code ?? 0));
