# 单镜像部署：后端 API + 前端静态文件（由后端托管）
FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/rpgmaker/package.json packages/rpgmaker/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

COPY packages packages
COPY apps apps
RUN pnpm --filter @gametrans/server exec prisma generate && pnpm build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production \
    PORT=3000 \
    STORAGE_DIR=/data \
    STATIC_DIR=/app/apps/web/dist
VOLUME /data
EXPOSE 3000
WORKDIR /app/apps/server
# 启动前自动执行数据库迁移
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
