import './env';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { config } from './config';

async function bootstrap() {
  mkdirSync(join(config.storageDir, 'tmp'), { recursive: true });
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: true });
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '20mb' });
  app.set('trust proxy', 1);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      stopAtFirstError: true,
    }),
  );
  app.enableShutdownHooks();
  await app.listen(config.port);
  Logger.log(`GameTrans 服务已启动：http://localhost:${config.port}/api`, 'Bootstrap');
}

bootstrap();
