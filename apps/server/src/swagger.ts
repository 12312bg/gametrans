import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { ErrorModel } from './common/api.models';

const DESCRIPTION = `
RPG Maker 本地化协作平台的 REST API。所有接口都在 \`/api\` 下，请求与响应均为 JSON（上传文件使用 \`multipart/form-data\`）。

## 认证

| 方式 | 用法 | 适用场景 |
| --- | --- | --- |
| 网页登录 | \`POST /api/auth/login\` 后由服务器写入 httpOnly Cookie \`gt_token\` | 浏览器 |
| 个人 API 令牌 | 请求头 \`Authorization: Bearer gt_xxxxxxxx\` | 脚本、CI、机器人 |

个人 API 令牌在网页「个人中心 → API 令牌」中创建，明文只显示一次。

- **只读（READ）**：只能发起 GET / HEAD 请求。
- **读写（WRITE）**：可以执行本人在项目中的角色允许的全部操作。
- **项目限定**：创建时可限定到单个项目，之后只能访问 \`/api/projects/{该项目}/…\` 与 \`/api/auth/me\`。
- 令牌**不继承超级管理员权限**；管理令牌、修改密码与资料必须在网页登录后操作。
- 有效期 7 / 30 / 90 / 365 天，可随时在网页中撤销。

## 多语言

错误提示、项目动态、词条位置说明按请求语言返回：\`Accept-Language\` 请求头 → 账号设置的界面语言 → 简体中文。目前支持 \`zh-CN\` 与 \`en\`。

## 错误

出错时返回对应的 HTTP 状态码，响应体格式见 \`ErrorModel\`，例如 \`{"statusCode":403,"code":"FORBIDDEN","message":"没有权限执行此操作"}\`。程序判断请使用稳定的 \`code\`，\`message\` 会随语言变化。

- 400：参数错误（\`VALIDATION_FAILED\`，\`params.field\` 为出错字段）
- 401：未登录，或令牌无效 / 已过期
- 403：没有权限（含只读令牌执行写操作、限定项目的令牌访问其他项目）
- 404：资源不存在（私有项目对非成员也返回 404）
- 409：冲突（如 \`ENTRY_CONFLICT\`：保存词条时 \`version\` 已过期，响应中的 \`current\` 为最新词条）
- 413：\`FILE_TOO_LARGE\`，超过单个文件上传上限（\`params.limit\`，MB，见 \`GET /api/auth/config\`）

## 典型流程

1. \`POST /api/projects/{pid}/files\` 上传数据文件或 zip，返回解析任务。
2. 轮询 \`GET /api/projects/{pid}/jobs/{jid}\`，直到 \`status\` 为 \`SUCCEEDED\`。
3. \`GET /api/projects/{pid}/entries?stage=UNTRANSLATED\` 分页获取待翻译词条。
4. \`PUT /api/projects/{pid}/entries/{eid}\` 提交译文，需带上词条当前的 \`version\`。
5. \`POST /api/projects/{pid}/exports\` 生成导出包，轮询任务完成后通过 \`GET /api/projects/{pid}/exports/{jid}/download\` 下载。
`;

export function buildOpenApi(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('GameTrans API')
    .setDescription(DESCRIPTION)
    .setVersion(process.env.npm_package_version ?? '0.1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'gt_…', description: '个人 API 令牌' }, 'token')
    .addCookieAuth('gt_token', { type: 'apiKey', in: 'cookie', description: '网页登录后的会话 Cookie' }, 'cookie')
    .addSecurityRequirements('token')
    .addSecurityRequirements('cookie')
    // 按使用流程排列分组
    .addTag('认证', '注册、登录、当前用户')
    .addTag('API 令牌', '个人 API 令牌的创建与撤销（仅限网页登录）')
    .addTag('项目', '项目的增删改查、统计与动态')
    .addTag('文件与任务', '上传数据文件、更新原文、查询解析 / 导出任务')
    .addTag('词条', '查询、翻译、审核、批量操作、历史与翻译记忆')
    .addTag('术语表', '项目术语的维护与导入')
    .addTag('导出', '生成并下载可覆盖到游戏目录的导出包')
    .addTag('成员与邀请', '成员角色、加入申请与邀请')
    .addTag('用户', '个人资料与用户搜索')
    .addTag('管理后台', '全站管理（仅超级管理员，网页登录）')
    .build();
  return SwaggerModule.createDocument(app, config, { extraModels: [ErrorModel] });
}

export function setupSwagger(app: INestApplication) {
  const document = buildOpenApi(app);
  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: 'GameTrans API 文档',
    jsonDocumentUrl: 'api/docs/openapi.json',
    swaggerOptions: { persistAuthorization: true, docExpansion: 'none' },
  });
}
