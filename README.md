# GameTrans · RPG Maker 本地化在线协作平台

参考 [ParaTranz](https://paratranz.cn) 的在线游戏本地化协作平台，首批支持 **RPG Maker XP / VX / VX Ace / MV / MZ**。

上传游戏数据（单个文件、整个文件夹或 zip 压缩包），平台自动提取可翻译文本。团队成员在线翻译、审核，最后一键导出可直接覆盖到游戏目录的数据文件。

## 功能

| 模块 | 说明 |
| --- | --- |
| 文件解析 | 无损读写 Ruby Marshal（`.rxdata` / `.rvdata` / `.rvdata2`）与 MV/MZ JSON、`js/plugins.js`；未翻译时导出结果与原文件逐字节一致 |
| 在线翻译 | 词条列表 + 编辑面板；高亮控制符（`\C[2]`、`\N[1]` 等）和术语；提示缺失控制符、行数超出；快捷键；未保存草稿提示；并发编辑冲突处理 |
| 审核流程 | 未翻译 → 已翻译 → 已审核，另有「有疑问 / 已锁定 / 已隐藏」；支持批量审核、锁定、隐藏、清空 |
| 术语表 | 增删改、CSV/TSV 批量导入、导出 CSV；编辑器中自动高亮并提示约定译法 |
| 翻译记忆 | 基于 PostgreSQL `pg_trgm` 的相似原文推荐（支持中日韩）；完全相同原文一键批量填充 |
| 历史与回滚 | 记录每次修改（人、时间、译文、状态），可回滚到任意版本；原文变更也会留痕 |
| 成员与权限 | 五级项目角色 + 站点超级管理员；公开项目可申请加入，管理员审批；邀请成员 |
| 文件更新 | 重新上传新版本时按键名合并：保留已有译文，原文变化的词条标记为「有疑问」 |
| 导出 | 按状态与文件范围生成 zip（保留游戏目录结构），可附带 ParaTranz 兼容的译文 JSON |
| 开放接口 | REST API + Swagger 在线文档；个人 API 令牌（只读 / 读写、可限定项目）供脚本与 CI 调用 |
| 其他 | 进度统计、文本分类、贡献榜、项目动态、管理后台、浅色/深色主题、移动端适配 |

## 技术栈

- **前端**：React 18、Vite 5、TypeScript、Ant Design 5、TanStack Query 5、React Router 6
- **后端**：NestJS 10、Prisma 6、PostgreSQL 16（`pg_trgm`）、BullMQ 5 + Redis（异步解析与导出）
- **解析库**：`packages/rpgmaker`，纯 TypeScript 实现，包括 Ruby Marshal 4.8 读写、RGSS 脚本字符串词法分析和 MV/MZ 数据遍历。它依赖 `fflate`，可在 Node 和浏览器中运行
- **工程**：pnpm workspace monorepo，Docker Compose 部署

## 目录结构

```
gametrans/
├── apps/
│   ├── server/                  # NestJS 后端
│   │   ├── prisma/              #   数据模型 schema.prisma 与迁移
│   │   └── src/
│   │       ├── auth/            #   注册 / 登录（httpOnly Cookie + JWT）
│   │       ├── users/           #   个人资料、用户搜索、超级管理员接口
│   │       ├── projects/        #   项目增删改查、统计、动态、转让
│   │       ├── members/         #   成员、加入申请、邀请
│   │       ├── files/           #   上传、替换、下载原文件、任务查询
│   │       ├── entries/         #   词条查询 / 保存 / 批量 / 历史 / 回滚 / 翻译记忆
│   │       ├── terms/           #   术语表
│   │       ├── exports/         #   导出包
│   │       ├── jobs/            #   BullMQ 任务：解析合并（parse）与导出打包（export）
│   │       └── common/          #   鉴权守卫、项目权限、存储、动态日志
│   └── web/                     # React 前端
│       └── src/
│           ├── api/             #   请求封装与类型
│           ├── layouts/         #   全站布局、项目布局
│           ├── pages/           #   页面（project/ 下为项目内各标签页，admin/ 为管理后台）
│           ├── editor/          #   翻译编辑器组件（高亮、侧栏面板）
│           └── components/      #   通用组件（进度条、标签、头像等）
├── packages/
│   ├── shared/                  # 前后端共享：引擎、角色、权限矩阵、词条状态、控制符检测
│   └── rpgmaker/                # 文本提取与回写库
│       ├── src/marshal/         #   Ruby Marshal 读写（字节级往返）
│       ├── src/rgss/            #   XP/VX/Ace 数据与 Scripts 脚本字符串
│       ├── src/mvmz/            #   MV/MZ JSON 与 plugins.js
│       ├── src/events.ts        #   事件指令遍历（两类引擎共用）
│       └── test/                #   测试与夹具（Ruby 生成的 RGSS 数据、MV/MZ JSON）
├── e2e/                         # Playwright 浏览器端到端测试
├── docs/openapi.json            # OpenAPI 3 接口文档（离线版）
├── docker-compose.yml
└── Dockerfile
```

## 快速开始（Docker）

```bash
cp .env.example .env        # 修改 JWT_SECRET、ADMIN_PASSWORD
docker compose up -d --build
```

启动后访问 http://localhost:3000 ，用 `.env` 里配置的超级管理员账号登录。容器启动时会自动执行数据库迁移。

> 数据保存在 `pgdata`（数据库）、`appdata`（上传文件与导出包）、`redisdata` 三个卷中。

## 本地开发

需要 Node.js ≥ 20、pnpm 10、PostgreSQL 16、Redis 7。

```bash
pnpm install

# 1. 启动数据库（也可以用本机已安装的 PostgreSQL / Redis）
docker compose up -d postgres redis

# 2. 配置后端环境变量
cp apps/server/.env.example apps/server/.env

# 3. 构建共享包、生成 Prisma Client、执行迁移
pnpm build:libs
pnpm --filter @gametrans/server prisma:generate
pnpm db:deploy

# 4. 启动后端（http://localhost:3000/api）和前端（http://localhost:5173）
pnpm dev:server
pnpm dev:web
```

前端开发服务器会把 `/api` 代理到 `http://localhost:3000`，可用环境变量 `API_PROXY` 修改。

> 修改 `packages/shared` 或 `packages/rpgmaker` 后需要重新执行 `pnpm build:libs`，后端才能加载到新代码。前端直接引用 `shared` 的源码，不需要重新构建。

### 常用命令

| 命令 | 说明 |
| --- | --- |
| `pnpm test` | 运行解析库测试（Marshal 往返、提取、回写、路径识别） |
| `pnpm test:e2e` | 构建后运行浏览器端到端测试（见下文） |
| `pnpm typecheck` | 全部包类型检查 |
| `pnpm build` | 构建全部包 |
| `pnpm db:migrate` | 修改 `schema.prisma` 后生成新迁移 |
| `pnpm --filter @gametrans/rpgmaker fixtures` | 用 Ruby 重新生成 RGSS 测试数据（需要安装 Ruby） |

### 端到端测试

`e2e/` 是基于 Playwright 的浏览器测试，以生产模式启动服务（后端托管构建后的前端）。测试覆盖：

- 注册与登录、项目创建与上传（zip / 文件夹 / 单文件）
- 加入申请与邀请、各角色的权限边界
- 翻译编辑器：快捷键、控制符检查、翻译记忆、术语、批量操作、锁定、历史回滚、并发冲突、上下文跳转
- 文件更新与导出校验、XP/VX/Ace 数据回写（若本机装有 Ruby，会用 Ruby 加载校验）
- 项目设置、转让与删除、管理后台、深色模式、手机布局
- 个人 API 令牌（只读 / 读写、项目限定、不继承超级管理员、撤销）与 Swagger 文档

每个用例都会断言页面没有 JS 异常和控制台错误。

```bash
# 需要本机运行 PostgreSQL 与 Redis（同本地开发），首次运行前创建测试库
createdb -O gametrans gametrans_e2e      # 或在 psql 中 CREATE DATABASE gametrans_e2e OWNER gametrans;
pnpm test:e2e
```

测试使用独立的数据库 `gametrans_e2e`（需预先创建，启动时自动执行 `prisma migrate deploy`）、Redis 1 号库和 `e2e/.tmp/` 存储目录，不会影响开发数据。数据库不会被清空，各用例使用随机命名的用户和项目互相隔离。以下变量可以覆盖默认值：

| 变量 | 默认值 |
| --- | --- |
| `E2E_DATABASE_URL` | `postgresql://gametrans:gametrans@localhost:5432/gametrans_e2e` |
| `E2E_REDIS_URL` | `redis://localhost:6379/1` |
| `E2E_PORT` | `3100` |

测试报告位于 `e2e/.tmp/report`，可用 `pnpm --filter @gametrans/e2e report` 打开。

## 环境变量（后端）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | — | PostgreSQL 连接串。数据库的 `LC_CTYPE` 需要是 UTF-8（如 `C.UTF-8`），否则翻译记忆无法匹配中日韩文本 |
| `REDIS_URL` | `redis://localhost:6379` | BullMQ 使用的 Redis |
| `JWT_SECRET` | — | 登录凭证签名密钥，生产环境必须修改 |
| `PORT` | `3000` | 监听端口 |
| `STORAGE_DIR` | `./storage` | 上传文件、导出包的存放目录 |
| `STATIC_DIR` | — | 设置后由后端托管构建好的前端（Docker 镜像中已设置） |
| `ADMIN_USERNAME` / `ADMIN_EMAIL` / `ADMIN_PASSWORD` | — | 启动时若该用户名不存在，则创建超级管理员 |
| `ALLOW_REGISTRATION` | `true` | 是否开放公开注册 |
| `PROJECT_CREATION` | `everyone` | `everyone`：任何登录用户可创建项目；`superadmin`：仅超级管理员 |
| `UPLOAD_LIMIT_MB` | `512` | 单个上传文件大小上限 |
| `COOKIE_SECURE` | `false` | 通过 HTTPS 访问时设为 `true` |
| `JOB_CONCURRENCY` | `1` | 后台任务并发数 |
| `API_DOCS` | `true` | 是否开放在线 API 文档 `/api/docs` |

## API 使用

所有接口都在 `/api` 下，默认端口为 `3000`（`PORT` 可改）。用 Docker 部署时，前端与 API 共用同一端口。

| 地址 | 说明 |
| --- | --- |
| `/api/docs` | Swagger UI 在线文档，可点击「Authorize」填入令牌后直接调试 |
| `/api/docs/openapi.json` | OpenAPI 3 文档，可用于生成各语言客户端 |
| `docs/openapi.json` | 仓库内的离线版，接口变更后执行 `pnpm --filter @gametrans/server build && pnpm --filter @gametrans/server openapi:export` 重新生成（不需要数据库） |

### 认证

- **网页登录**：`POST /api/auth/login` 后服务器写入 httpOnly Cookie `gt_token`，供浏览器使用。
- **个人 API 令牌**：供脚本、CI、机器人使用。在网页右上角头像 →「API 令牌」中创建，请求时带上 `Authorization: Bearer gt_xxxxxxxx`。

| 令牌规则 | 说明 |
| --- | --- |
| 权限范围 | **只读**：只能发 GET / HEAD 请求；**读写**：可执行本人角色允许的全部操作。都不会超过本人在项目中的角色 |
| 项目限定 | 可选限定到单个项目，之后只能访问 `/api/projects/{该项目}/…` 和 `/api/auth/me` |
| 超级管理员 | 令牌**不继承**超级管理员权限；管理后台、管理令牌、修改密码与资料只能网页登录后操作 |
| 有效期 | 7 / 30 / 90 / 365 天（默认 90 天），可随时撤销；每人最多 20 个 |
| 存储 | 服务端只保存 SHA-256 哈希，明文只在创建时显示一次 |

### 错误格式

出错时返回对应 HTTP 状态码与 `{"statusCode":403,"message":"没有权限执行此操作","error":"Forbidden"}`（参数校验失败时 `message` 为数组）：

- 401：未登录，或令牌无效 / 已过期
- 403：没有权限，包括只读令牌发起写操作、限定项目的令牌访问其他项目
- 404：资源不存在，私有项目对非成员也返回 404
- 409：保存词条时 `version` 已过期，响应中的 `current` 为最新词条

### 示例：用 curl 走完整流程

```bash
API=http://localhost:3000/api
TOKEN=gt_xxxxxxxx                     # 读写令牌
PID=项目ID                             # 项目 URL /projects/<PID> 中的 ID
H="Authorization: Bearer $TOKEN"

# 1. 上传游戏目录 zip（也可以上传多个 data/*.json、Data/*.rvdata2 文件），返回解析任务
curl -H "$H" -F "files=@MyGame.zip" $API/projects/$PID/files

# 2. 轮询任务，直到 status 为 SUCCEEDED
curl -H "$H" $API/projects/$PID/jobs/<任务ID>

# 3. 获取未翻译的对话（可按 fileId / stage / category / q 筛选，分页 page / pageSize）
curl -H "$H" "$API/projects/$PID/entries?stage=UNTRANSLATED&category=dialogue&pageSize=100"

# 4. 提交译文：必须带上词条当前的 version（乐观锁）；不传 stage 时自动设为「已翻译」
curl -H "$H" -H "Content-Type: application/json" -X PUT \
  -d '{"translation":"你好，旅行者。","version":0}' $API/projects/$PID/entries/<词条ID>

# 5. 生成导出包（需要管理员及以上），任务完成后下载
curl -H "$H" -H "Content-Type: application/json" -X POST \
  -d '{"stages":["TRANSLATED","REVIEWED","LOCKED"]}' $API/projects/$PID/exports
curl -H "$H" -o export.zip $API/projects/$PID/exports/<任务ID>/download
```

### 示例：批量提交机翻（Python）

```python
import requests

API, PID = "http://localhost:3000/api", "项目ID"
s = requests.Session()
s.headers["Authorization"] = "Bearer gt_xxxxxxxx"

def machine_translate(text: str) -> str:
    return text  # 替换为你的机器翻译调用，注意保留 \C[2] 等控制符

done = set()
while True:
    # 提交后的词条会从「未翻译」结果中消失，所以每次都取第 1 页，直到没有新词条
    r = s.get(f"{API}/projects/{PID}/entries",
              params={"stage": "UNTRANSLATED", "pageSize": 200}).json()
    todo = [e for e in r["items"] if e["id"] not in done]
    if not todo:
        break
    for e in todo:
        done.add(e["id"])
        res = s.put(f"{API}/projects/{PID}/entries/{e['id']}",
                    json={"translation": machine_translate(e["original"]),
                          "stage": "QUESTIONED",      # 标记为「有疑问」，留给人工校对
                          "version": e["version"]})
        if res.status_code == 409:                    # 期间被他人修改，跳过
            continue
        res.raise_for_status()
```

## 角色与权限

权限按角色固定，作用于整个项目。规则集中定义在 `packages/shared/src/index.ts`，前后端共用。

| 权限 | 访客 | 翻译员 | 审核员 | 管理员 | 所有者 |
| --- | :-: | :-: | :-: | :-: | :-: |
| 浏览词条、文件、术语表、统计 | ✓ | ✓ | ✓ | ✓ | ✓ |
| 下载导出包 | ✓ | ✓ | ✓ | ✓ | ✓ |
| 翻译未审核词条、标记有疑问、回滚 | | ✓ | ✓ | ✓ | ✓ |
| 审核 / 取消审核、修改已审核词条、翻译记忆批量填充 | | | ✓ | ✓ | ✓ |
| 维护术语表 | | | ✓ | ✓ | ✓ |
| 锁定 / 隐藏词条、修改已锁定词条 | | | | ✓ | ✓ |
| 上传 / 更新 / 删除文件、下载原文件 | | | | ✓ | ✓ |
| 创建导出 | | | | ✓ | ✓ |
| 审批申请、邀请成员、调整角色、移除成员 * | | | | ✓ | ✓ |
| 修改项目设置 | | | | ✓ | ✓ |
| 转让、删除项目 | | | | | ✓ |

\* 管理员只能管理比自己低的角色，也只能授予比自己低的角色。所有者只能通过「转让」变更。

- **站点超级管理员**：拥有所有项目的全部权限，并可在管理后台封禁用户、重置密码、设置其他超级管理员。
- **公开项目**：任何人（包括未登录）都可浏览；登录用户可申请加入，管理员审批时指定角色。
- **私有项目**：仅成员可见，只能通过邀请加入。

## 词条状态

| 状态 | 说明 |
| --- | --- |
| 未翻译 | 新提取的词条 |
| 已翻译 | 翻译员提交了译文 |
| 有疑问 | 翻译员或审核员标记待讨论；重新上传时原文有变化的词条也会进入此状态 |
| 已审核 | 审核员定稿，翻译员不能再修改 |
| 已锁定 | 管理员锁定，只有管理员能修改 |
| 已隐藏 | 不需要翻译的词条，不计入进度，导出时保持原文。脚本、插件参数、备注默认处于此状态 |

## RPG Maker 支持说明

| 引擎 | 上传文件 | 提取内容 |
| --- | --- | --- |
| XP | `Data/*.rxdata` | 对话（101 首行 + 401 续行）、选项、更改名称、数据库名称与说明、`System` 的 `@words`、脚本字符串 |
| VX | `Data/*.rvdata` | 对话、选项、数据库（含技能 / 状态信息）、`System` 的 `@terms`、脚本字符串 |
| VX Ace | `Data/*.rvdata2` | 以上内容，外加滚动文章、称号 / 简介、地图显示名、`@terms`（基本 / 能力 / 装备 / 指令）、Note、脚本字符串（如 `Vocab` 模块） |
| MV / MZ | `data/*.json`、`js/plugins.js` | 对话（MZ 含姓名框）、选项、滚动文章、数据库、`System.json` 用语与信息、地图显示名、Note、插件指令（356/357）、插件参数（递归展开嵌套 JSON） |

- **对话合并**：连续的「显示文章」行合并为一个词条。译文行数变化时，导出会自动增加或删除续行指令。选项的译文会同步写入对应的「选择时」分支。
- **危险文本默认隐藏**：脚本（事件脚本、Scripts 中的字符串字面量）、插件指令和参数、Note 备注译错可能导致游戏报错，因此默认隐藏。管理员可以在翻译页筛选「已隐藏」，逐条或批量取消隐藏后再翻译。脚本译文中未转义的引号会自动转义。
- **不提取**：注释（108/408）、编辑器专用名称（MapInfos、开关和变量名、事件名）、文件名类参数。
- **加密归档**：`.rgssad` / `.rgss2a` / `.rgss3a` 需要先解包成 `Data/` 目录再上传。MV/MZ 的加密只针对图片和音频，不影响 `data/*.json`。
- **导出使用**：解压导出包后覆盖到游戏根目录。如果游戏使用加密归档，需要删除或改名归档文件，让游戏读取散装的 `Data/` 文件。

## 已知限制与后续计划

- 尚未接入机器翻译，后续可在编辑器侧栏增加 OpenAI 兼容接口、DeepL 等。
- 暂未提供词条评论和讨论、实时在线状态（WebSocket）。
- 文件存储目前为本地磁盘（`STORAGE_DIR`），如需对象存储可扩展 `StorageService`。
- 后台任务默认单并发，适合单实例部署。
