import { request } from '@playwright/test';
import { BASE, TestUser, adminUser, btn, createUser, expect, seedProject, test, toast, useAs } from './helpers';

test.describe.configure({ mode: 'serial' });

let owner: TestUser;
let pid = '';
let otherPid = '';
let readToken = '';

/** 只用 Bearer 令牌（不带 Cookie）调用接口 */
async function withToken(token: string) {
  return request.newContext({ baseURL: BASE, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
}

test.beforeAll(async () => {
  owner = await createUser('apio', '接口用户');
  pid = (await seedProject(owner)).id;
  otherPid = (await seedProject(owner, { files: [] })).id;
});

test('个人中心创建限定项目的只读令牌，明文只显示一次', async ({ page }) => {
  await useAs(page, owner);
  await page.goto('/');
  await page.locator('.header-user').click();
  await page.getByRole('menuitem', { name: /API 令牌/ }).click();
  await expect(page).toHaveURL(/\/me\?tab=tokens/);
  await expect(page.getByText('还没有 API 令牌')).toBeVisible();

  await page.getByRole('button', { name: /创建令牌/ }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('名称').fill('同步脚本');
  await expect(dlg.getByRole('radio', { name: /只读/ })).toBeChecked();
  await dlg.getByLabel('限定项目').click();
  const p = await owner.api.ok('GET', `/projects/${pid}`);
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').filter({ hasText: p.name }).click();
  await btn(dlg, '创建').click();

  const created = page.getByRole('dialog').filter({ hasText: '令牌已创建' });
  await expect(created).toContainText('令牌只显示这一次');
  readToken = (await created.locator('.token-box').innerText()).trim();
  expect(readToken).toMatch(/^gt_[A-Za-z0-9_-]{32}$/);
  await expect(created.locator('.code-box')).toContainText(`Authorization: Bearer ${readToken}`);
  await btn(created, '我已保存').click();

  const row = page.getByRole('row').filter({ hasText: '同步脚本' });
  await expect(row).toContainText('只读');
  await expect(row).toContainText(p.name);
  await expect(row).toContainText('剩余');
  await expect(row).toContainText('从未使用');
  await expect(row).toContainText(readToken.slice(0, 9));
  // 列表与接口都不会再返回明文
  const list = await owner.api.ok('GET', '/users/me/tokens');
  expect(JSON.stringify(list)).not.toContain(readToken);
});

test('只读 + 限定项目令牌：只能读该项目', async () => {
  const api = await withToken(readToken);
  const me = await (await api.get('/api/auth/me')).json();
  expect(me.username).toBe(owner.username);
  expect(me.authMethod).toBe('token');
  expect(me.token.scope).toBe('READ');
  expect(me.token.projectId).toBe(pid);

  const list = await api.get(`/api/projects/${pid}/entries?stage=UNTRANSLATED&pageSize=5`);
  expect(list.status()).toBe(200);
  const entry = (await list.json()).items[0];

  const put = await api.put(`/api/projects/${pid}/entries/${entry.id}`, { data: { translation: 'x', version: entry.version } });
  expect(put.status()).toBe(403);
  expect((await put.json()).message).toBe('只读令牌不能执行写操作');

  const other = await api.get(`/api/projects/${otherPid}`);
  expect(other.status()).toBe(403);
  expect((await other.json()).message).toBe('该令牌仅限用于指定项目');
  expect((await api.get('/api/projects?scope=mine')).status()).toBe(403);
  await api.dispose();

  // 使用后「最近使用」会更新
  const tokens = await owner.api.ok('GET', '/users/me/tokens');
  expect(tokens.find((t: { name: string }) => t.name === '同步脚本').lastUsedAt).toBeTruthy();
});

test('读写令牌：提交译文、生成导出；不能管理令牌和修改密码', async () => {
  const created = await owner.api.ok('POST', '/users/me/tokens', { name: '机翻', scope: 'WRITE', expiresInDays: 7 });
  expect(new Date(created.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(7 * 24 * 3600 * 1000 + 60_000);
  const api = await withToken(created.token);

  const entry = (await (await api.get(`/api/projects/${pid}/entries?stage=UNTRANSLATED&pageSize=1`)).json()).items[0];
  const put = await api.put(`/api/projects/${pid}/entries/${entry.id}`, {
    data: { translation: `[机翻]${entry.original}`, version: entry.version, stage: 'QUESTIONED' },
  });
  expect(put.status()).toBe(200);
  expect((await put.json()).stage).toBe('QUESTIONED');
  // 版本过期 → 409，并返回最新词条
  const stale = await api.put(`/api/projects/${pid}/entries/${entry.id}`, { data: { translation: 'y', version: entry.version } });
  expect(stale.status()).toBe(409);
  expect((await stale.json()).current.translation).toBe(`[机翻]${entry.original}`);

  const exp = await api.post(`/api/projects/${pid}/exports`, { data: { stages: ['TRANSLATED', 'QUESTIONED'] } });
  expect(exp.status()).toBe(201);
  expect((await exp.json()).type).toBe('EXPORT');
  // 也可以访问其他自己参与的项目
  expect((await api.get(`/api/projects/${otherPid}`)).status()).toBe(200);

  const mint = await api.post('/api/users/me/tokens', { data: { name: 'x', scope: 'READ' } });
  expect(mint.status()).toBe(403);
  expect((await mint.json()).message).toContain('不能使用 API 令牌');
  expect((await api.post('/api/users/me/password', { data: { oldPassword: 'password123', newPassword: 'whatever123' } })).status()).toBe(403);
  expect((await api.patch('/api/users/me', { data: { displayName: '被改了' } })).status()).toBe(403);
  await api.dispose();
});

test('超级管理员的令牌不继承超级管理员权限', async () => {
  const admin = await adminUser();
  const t = await admin.api.ok('POST', '/users/me/tokens', { name: '运维', scope: 'WRITE' });
  const api = await withToken(t.token);
  const me = await (await api.get('/api/auth/me')).json();
  expect(me.isSuperAdmin).toBe(false);
  expect((await api.get('/api/admin/users')).status()).toBe(403);
  expect((await api.get('/api/projects?scope=all')).status()).toBe(403);
  // 非成员的私有项目同样不可见
  const priv = await seedProject(owner, { visibility: 'PRIVATE', files: [] });
  expect((await api.get(`/api/projects/${priv.id}`)).status()).toBe(404);
  await api.dispose();
  await admin.api.ok('DELETE', `/users/me/tokens/${t.id}`);
});

test('错误的令牌与请求头', async () => {
  const bad = await withToken('gt_not-a-real-token');
  const r = await bad.get('/api/auth/me');
  expect(r.status()).toBe(401);
  expect((await r.json()).message).toBe('令牌无效或已过期');
  await bad.dispose();
  const raw = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { Authorization: 'Token abc' } });
  expect((await raw.get('/api/projects')).status()).toBe(401);
  await raw.dispose();
  // 有效期只能是 7 / 30 / 90 / 365 天；只能限定到自己参与的项目
  expect((await owner.api.call('POST', '/users/me/tokens', { name: 'x', scope: 'READ', expiresInDays: 3650 })).status).toBe(400);
  const stranger = await createUser('strg');
  expect((await stranger.api.call('POST', '/users/me/tokens', { name: 'x', scope: 'READ', projectId: pid })).status).toBe(400);
});

test('在网页中撤销令牌后立即失效', async ({ page }) => {
  await useAs(page, owner);
  await page.goto('/me?tab=tokens');
  const row = page.getByRole('row').filter({ hasText: '同步脚本' });
  await btn(row, '撤销').click();
  await btn(page.locator('.ant-popconfirm'), '撤销').click();
  await expect(toast(page, '已撤销「同步脚本」')).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: '同步脚本' })).toHaveCount(0);
  const api = await withToken(readToken);
  expect((await api.get('/api/auth/me')).status()).toBe(401);
  await api.dispose();
});

test('Swagger 文档与 OpenAPI JSON', async ({ page }) => {
  const res = await page.request.get('/api/docs/openapi.json');
  expect(res.status()).toBe(200);
  const doc = await res.json();
  expect(doc.info.title).toBe('GameTrans API');
  expect(Object.keys(doc.components.securitySchemes).sort()).toEqual(['cookie', 'token']);
  const ops = Object.values(doc.paths as Record<string, Record<string, { summary?: string; tags?: string[] }>>).flatMap((m) => Object.values(m));
  expect(ops.length).toBeGreaterThanOrEqual(60);
  expect(ops.filter((o) => !o.summary)).toEqual([]);
  expect(ops.every((o) => o.tags?.length)).toBe(true);
  expect(doc.paths['/api/projects/{pid}/entries/{eid}'].put.requestBody.content['application/json'].schema.$ref).toContain('UpdateEntryDto');
  expect(doc.components.schemas.UpdateEntryDto.required).toEqual(['translation', 'version']);

  await page.goto('/api/docs');
  await expect(page.locator('.swagger-ui .info .title')).toContainText('GameTrans API');
  await page.locator('.opblock-tag', { hasText: '词条' }).first().click();
  await expect(page.locator('.opblock-summary-path', { hasText: '/api/projects/{pid}/entries' }).first()).toBeVisible();
  // 「Authorize」按钮可以填入 Bearer 令牌
  await expect(page.getByRole('button', { name: /Authorize/ })).toBeVisible();
});
