// 导出 OpenAPI 文档：node dist/openapi.js <输出路径>
// 以 preview 模式创建应用，不实例化服务，因此不需要数据库与 Redis。
import './env';
import { NestFactory } from '@nestjs/core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { AppModule } from './app.module';
import { buildOpenApi } from './swagger';

async function main() {
  const out = resolve(process.argv[2] ?? 'openapi.json');
  const app = await NestFactory.create(AppModule, { preview: true, logger: false, abortOnError: false });
  app.setGlobalPrefix('api');
  const doc = buildOpenApi(app);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`已写入 ${out}（${Object.keys(doc.paths).length} 个路径）`);
  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
