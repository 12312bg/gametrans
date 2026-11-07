import { readFileSync, readdirSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import { FIX, PASSWORD, TestUser, btn, createUser, expect, seedProject, test, toast, uid, useAs } from './helpers';

/** E2E 服务端把上传上限设为 64 MB（见 scripts/start-server.mjs） */
const LIMIT_MB = 64;
const MB = 1024 * 1024;
const me = async (page: import('@playwright/test').Page) => (await page.request.get('/api/auth/me')).json();

let owner: TestUser;
/** 英文用例单独用一个账号，避免切换语言影响其他用例 */
let enOwner: TestUser;
let pid = '';
let enPid = '';
let dir = '';

test.beforeAll(async () => {
  owner = await createUser('i18n', '负责人');
  enOwner = await createUser('i18n', 'Owner');
  pid = (await seedProject(owner)).id;
  enPid = (await seedProject(enOwner)).id;
  dir = join(__dirname, '../.tmp/fixtures', `big-${Date.now()}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
});

test.afterAll(() => rmSync(dir, { recursive: true, force: true }));

test.describe('English browser', () => {
  test.use({ locale: 'en-US' });

  test('UI, validation and server errors follow the browser language; the choice is saved to the account', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await page.getByPlaceholder('Username / email').fill('nobody-here');
    await page.getByPlaceholder('Password').fill('wrong-password');
    await btn(page, 'Sign in').click();
    await expect(toast(page, 'Invalid username or password')).toBeVisible();

    await page.getByRole('link', { name: 'Sign up' }).click();
    const username = uid('en');
    await page.getByPlaceholder('Username (used to sign in, cannot be changed)').fill(username);
    await page.getByPlaceholder('Email', { exact: true }).fill(`${username}@e2e.test`);
    await page.getByPlaceholder('Password (at least 8 characters)').fill('short');
    await expect(page.getByText('Password must be 8-72 characters')).toBeVisible();
    await page.getByPlaceholder('Password (at least 8 characters)').fill(PASSWORD);
    await page.getByPlaceholder('Confirm password').fill(PASSWORD);
    await btn(page, 'Sign up').click();
    await expect(toast(page, 'Account created')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Explore' })).toBeVisible();
    expect((await me(page)).locale).toBe('en');

    // 切换为中文：界面立即切换，并保存到账号
    await page.getByRole('button', { name: 'Language' }).click();
    await page.getByRole('menuitem', { name: '简体中文' }).click();
    await expect(page.getByRole('link', { name: '项目广场' })).toBeVisible();
    await expect.poll(async () => (await me(page)).locale).toBe('zh-CN');

    // 清掉本地记录后，账号里的语言优先于浏览器语言
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.getByRole('link', { name: '项目广场' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  });

  test('editor renders entry locations in the current language', async ({ page }) => {
    await useAs(page, enOwner);
    await page.goto(`/projects/${enPid}/editor?q=${encodeURIComponent('旅の人')}&field=original`);
    await expect(page.locator('.entry-item')).toHaveCount(1);
    await expect(page.locator('.list-head')).toContainText('1 strings');
    await expect(page.locator('.entry-context')).toContainText('Show Text (face Actor1(0) · speaker リード)');
    await expect(page.locator('.entry-meta .ant-tag').first()).toHaveText('Untranslated');
    await page.locator('.translation-input').fill('Hello, traveller.');
    await expect(page.locator('.qa-item.warning')).toContainText('Missing control codes: \\C[2] \\C[0]');

    // 切换语言后位置说明立即按中文渲染，草稿不丢失
    await page.getByRole('button', { name: 'Language' }).click();
    await page.getByRole('menuitem', { name: '简体中文' }).click();
    await expect(page.locator('.entry-context')).toContainText('显示文章（脸图 Actor1(0) · 说话人 リード）');
    await expect(page.locator('.translation-input')).toHaveValue('Hello, traveller.');
    await page.getByRole('button', { name: '语言' }).click();
    await page.getByRole('menuitem', { name: 'English' }).click();
    await expect(page.locator('.entry-context')).toContainText('Show Text');
  });

  test('missing project shows the localized server message', async ({ page }) => {
    await useAs(page, enOwner);
    await page.goto('/projects/does-not-exist');
    await expect(page.getByText('Project not found or access denied')).toBeVisible();
    await expect(page.getByText('Project not found', { exact: true })).toBeVisible();
  });
});

test('API 错误：统一格式，按 Accept-Language 返回中文或英文', async () => {
  const get = (lang: string) => owner.api.ctx.get('/api/projects/does-not-exist', { headers: { 'Accept-Language': lang } });
  const en = await get('en-US,en;q=0.9');
  expect(en.status()).toBe(404);
  expect(await en.json()).toMatchObject({ statusCode: 404, code: 'PROJECT_NOT_FOUND', message: 'Project not found' });
  expect(await (await get('zh-CN')).json()).toMatchObject({ code: 'PROJECT_NOT_FOUND', message: '项目不存在' });

  const bad = await owner.api.ctx.post('/api/projects', { data: { name: '' }, headers: { 'Accept-Language': 'en' } });
  expect(bad.status()).toBe(400);
  const body = await bad.json();
  expect(body.code).toBe('VALIDATION_FAILED');
  expect(body.message).toMatch(/^[\x20-\x7e]+$/);
});

test('游戏 zip 在浏览器中解压：超过上传上限的压缩包也只上传数据文件', async ({ page }) => {
  // 数据文件 + 一个 80 MB 的音频（不压缩存储），整个压缩包超过 64 MB 上限
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {};
  for (const f of readdirSync(join(FIX, 'mz'))) {
    files[`BigGame/${f === 'plugins.js' ? 'js' : 'data'}/${f}`] = new Uint8Array(readFileSync(join(FIX, 'mz', f)));
  }
  files['BigGame/audio/bgm/Theme.ogg'] = [new Uint8Array(80 * MB), { level: 0 }];
  files['BigGame/img/pictures/a.png'] = new Uint8Array([137, 80, 78, 71]);
  const zipPath = join(dir, 'BigGame.zip');
  writeFileSync(zipPath, zipSync(files));

  const project = await seedProject(owner, { files: [] });
  await useAs(page, owner);
  await page.goto(`/projects/${project.id}/files`);
  await page.locator('.ant-upload-drag input[type=file]').setInputFiles(zipPath);
  await expect(toast(page, '已从 BigGame.zip 中提取 7 个数据文件，跳过 2 个')).toBeVisible();
  await expect(page.locator('.pending-head')).toContainText('待上传 7 个文件');
  await expect(page.locator('.pending-upload')).toContainText('data/Map001.json');

  const sizes: number[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith(`/projects/${project.id}/files`)) sizes.push(r.postDataBuffer()?.length ?? 0);
  });
  await btn(page, '开始上传').click();
  await expect(toast(page, '上传完成，正在后台解析')).toBeVisible();
  await expect(page.locator('.job-result').first()).toContainText('新增文件 7', { timeout: 30_000 });
  expect(sizes).toHaveLength(1);
  expect(sizes[0]).toBeLessThan(2 * MB);
});

test('超过上传上限：浏览器提前提示，服务端返回 413 与 FILE_TOO_LARGE', async ({ page }) => {
  const big = join(dir, 'Map099.json');
  writeFileSync(big, Buffer.alloc((LIMIT_MB + 1) * MB, 0x20));

  await useAs(page, owner);
  await page.goto(`/projects/${pid}/files`);
  await page.locator('.ant-upload-drag input[type=file]').setInputFiles(big);
  await expect(toast(page, `Map099.json: 文件超过 ${LIMIT_MB} MB 的上传上限`)).toBeVisible();
  await expect(toast(page, '选择游戏文件夹')).toBeVisible();
  await expect(page.locator('.pending-upload')).toHaveCount(0);

  // 绕过浏览器直接调接口
  const r = await owner.api.ctx.post(`/api/projects/${pid}/files`, {
    headers: { 'Accept-Language': 'en' },
    multipart: { files: { name: 'Map099.json', mimeType: 'application/json', buffer: readFileSync(big) } },
  });
  expect(r.status()).toBe(413);
  const body = await r.json();
  expect(body).toMatchObject({ code: 'FILE_TOO_LARGE', params: { limit: LIMIT_MB } });
  expect(body.message).toContain(`${LIMIT_MB} MB upload limit`);
});
