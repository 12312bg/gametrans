import { APIRequestContext, Browser, Page, expect, request, test as base } from '@playwright/test';
import { zipSync } from 'fflate';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const FIX = resolve(__dirname, '../../packages/rpgmaker/test/fixtures');
export const BASE = `http://localhost:${process.env.E2E_PORT ?? '3100'}`;
export const PASSWORD = 'password123';
export const ADMIN = { username: 'admin', password: 'admin123456' };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 按钮名称匹配：AntD 会在两个汉字的按钮文字间插入空格，图标按钮的名称前带有图标的 aria-label。
 */
export function label(text: string): RegExp {
  return new RegExp(`^(?:[a-z][a-z-]*\\s+)?${[...text].map(esc).join('\\s?')}$`);
}

export const btn = (scope: Page | ReturnType<Page['locator']>, text: string) =>
  scope.getByRole('button', { name: label(text) });

let seq = 0;
export const uid = (p: string) => `${p}${Date.now().toString(36).slice(-5)}${(seq++).toString(36)}`;

export class Api {
  constructor(public ctx: APIRequestContext) {}

  async call<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
    const r = await this.ctx.fetch(`/api${path}`, { method, data: body as never });
    const text = await r.text();
    let data: unknown = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* 非 JSON */
    }
    return { status: r.status(), data: data as T };
  }

  async ok<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await this.call<T>(method, path, body);
    if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  }

  async upload(pid: string, files: { name: string; buffer: Buffer; path?: string }[]) {
    const fd = new FormData();
    for (const f of files) fd.append('files', new Blob([new Uint8Array(f.buffer)]), f.name);
    fd.append('paths', JSON.stringify(files.map((f) => f.path ?? f.name)));
    const r = await this.ctx.post(`/api/projects/${pid}/files`, { multipart: fd });
    expect(r.status(), await r.text()).toBe(201);
    const job = await r.json();
    return this.waitJob(pid, job.id);
  }

  async waitJob(pid: string, jobId: string) {
    for (let i = 0; i < 120; i++) {
      const j = await this.ok(`GET`, `/projects/${pid}/jobs/${jobId}`);
      if (j.status === 'SUCCEEDED') return j;
      if (j.status === 'FAILED') throw new Error(`任务失败：${j.error}`);
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('任务超时');
  }

  /** 按原文查找词条（含隐藏） */
  async findEntry(pid: string, original: string, extra = '') {
    const stages = 'UNTRANSLATED,TRANSLATED,QUESTIONED,REVIEWED,LOCKED,HIDDEN';
    const res = await this.ok(
      'GET',
      `/projects/${pid}/entries?q=${encodeURIComponent(original)}&field=original&stage=${stages}&pageSize=100${extra}`,
    );
    const e = res.items.find((x: { original: string }) => x.original === original);
    if (!e) throw new Error(`找不到词条：${original}`);
    return e;
  }

  async translate(pid: string, original: string, translation: string, stage?: string) {
    const e = await this.findEntry(pid, original);
    return this.ok('PUT', `/projects/${pid}/entries/${e.id}`, { translation, version: e.version, stage });
  }
}

export interface TestUser {
  username: string;
  password: string;
  displayName: string;
  api: Api;
}

export async function createUser(prefix = 'user', displayName?: string): Promise<TestUser> {
  const ctx = await request.newContext({ baseURL: BASE });
  const username = uid(prefix);
  const api = new Api(ctx);
  const name = displayName ?? username;
  await api.ok('POST', '/auth/register', { username, email: `${username}@e2e.test`, password: PASSWORD, displayName: name });
  return { username, password: PASSWORD, displayName: name, api };
}

export async function loginApi(username: string, password: string): Promise<TestUser> {
  const ctx = await request.newContext({ baseURL: BASE });
  const api = new Api(ctx);
  const me = await api.ok('POST', '/auth/login', { login: username, password });
  return { username, password, displayName: me.displayName, api };
}

export const adminUser = () => loginApi(ADMIN.username, ADMIN.password);

// ───────── 测试数据 ─────────

const mvDb = (rows: unknown[]) => `[\n${rows.map((r) => JSON.stringify(r)).join(',\n')}\n]`;
const cmd = (code: number, indent: number, parameters: unknown[]) => ({ code, indent, parameters });
const dialogue = (text: string) => [cmd(101, 0, ['', 0, 0, 2, '']), ...text.split('\n').map((l) => cmd(401, 0, [l])), cmd(0, 0, [])];

/** 用于翻译记忆测试的公共事件：1 与 3 完全相同，1 与 2 相似 */
export const TM_TEXTS = ['勇者は伝説の剣を手に入れた！', '勇者は伝説の盾を手に入れた！'];
export function tmCommonEvents(): string {
  return mvDb([
    null,
    { id: 1, list: dialogue(TM_TEXTS[0]), name: '剣', switchId: 1, trigger: 0 },
    { id: 2, list: dialogue(TM_TEXTS[1]), name: '盾', switchId: 1, trigger: 0 },
    { id: 3, list: dialogue(TM_TEXTS[0]), name: '剣2', switchId: 1, trigger: 0 },
  ]);
}

/** 把 MV/MZ 测试数据打包为游戏目录结构的 zip */
export function mzZip(overrides: Record<string, string | Buffer> = {}, root = 'MyGame'): Buffer {
  const dir = join(FIX, 'mz');
  const files: Record<string, Uint8Array> = {};
  for (const f of readdirSync(dir)) {
    const rel = f === 'plugins.js' ? `js/${f}` : `data/${f}`;
    files[`${root}/${rel}`] = new Uint8Array(readFileSync(join(dir, f)));
  }
  for (const [rel, v] of Object.entries(overrides)) {
    files[`${root}/${rel}`] = typeof v === 'string' ? new TextEncoder().encode(v) : new Uint8Array(v);
  }
  files[`${root}/img/pictures/dummy.png`] = new Uint8Array([137, 80, 78, 71]);
  files[`${root}/js/plugins/Foo.js`] = new TextEncoder().encode('// plugin');
  return Buffer.from(zipSync(files));
}

export const rgssFile = (name: string) => readFileSync(join(FIX, 'rgss', name));

export async function seedProject(
  owner: TestUser,
  opts: { name?: string; engine?: string; visibility?: string; zip?: Buffer; files?: { name: string; buffer: Buffer; path?: string }[] } = {},
) {
  const project = await owner.api.ok('POST', '/projects', {
    name: opts.name ?? uid('项目'),
    engine: opts.engine ?? 'RMMZ',
    sourceLang: 'ja',
    targetLang: 'zh-CN',
    visibility: opts.visibility ?? 'PUBLIC',
    description: '端到端测试项目',
  });
  const files = opts.files ?? [{ name: 'game.zip', buffer: opts.zip ?? mzZip() }];
  if (files.length) await owner.api.upload(project.id, files);
  return project as { id: string; name: string };
}

/** 通过邀请把用户加入项目 */
export async function addMember(owner: TestUser, pid: string, user: TestUser, role: string) {
  const inv = await owner.api.ok('POST', `/projects/${pid}/invitations`, { username: user.username, role });
  await user.api.ok('POST', `/invitations/${inv.id}/accept`);
}

// ───────── 浏览器 ─────────

export function track(page: Page, errors: string[]) {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    // 预期中的 4xx 接口响应会让浏览器打印 Failed to load resource，忽略之
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
}

/** 每个用例自动收集页面异常与控制台错误，结束时断言为空 */
export const test = base.extend<{ errors: string[] }>({
  errors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      track(page, errors);
      await use(errors);
      expect(errors, '页面不应出现 JS 异常或控制台错误').toEqual([]);
    },
    { auto: true },
  ],
});

/** 以某个用户身份打开新的浏览器页面（复用 API 登录态） */
export async function pageAs(browser: Browser, user: TestUser | null, errors: string[], options: Parameters<Browser['newContext']>[0] = {}) {
  const ctx = await browser.newContext({
    baseURL: BASE,
    locale: 'zh-CN',
    viewport: { width: 1440, height: 900 },
    ...options,
    storageState: user ? await user.api.ctx.storageState() : undefined,
  });
  const page = await ctx.newPage();
  track(page, errors);
  return page;
}

export async function loginUI(page: Page, login: string, password: string) {
  await page.goto('/login');
  await page.getByPlaceholder('用户名 / 邮箱').fill(login);
  await page.getByPlaceholder('密码').fill(password);
  await btn(page, '登录').click();
  await expect(page).not.toHaveURL(/\/login/);
}

export const toast = (page: Page, text: string | RegExp) => page.locator('.ant-message-notice-content').filter({ hasText: text });

/** 在可见的下拉中点击选项 */
export async function pickOption(page: Page, text: string | RegExp) {
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').filter({ hasText: text }).first().click();
}

export const confirmDialog = (page: Page) => page.locator('.ant-modal-confirm').last();

/** 打开编辑器并等待列表加载 */
export async function openEditor(page: Page, pid: string, query = '') {
  await page.goto(`/projects/${pid}/editor${query ? `?${query}` : ''}`);
  await expect(page.locator('.list-head')).toContainText('共');
  await expect(page.locator('.list-scroll .center-spin')).toHaveCount(0);
}

export { expect };

/** 让默认 page 使用某个用户的登录态 */
export async function useAs(page: Page, user: TestUser) {
  const state = await user.api.ctx.storageState();
  await page.context().clearCookies();
  await page.context().addCookies(state.cookies);
}

export const activeItem = (page: Page) => page.locator('.entry-item.active');
export const stageTag = (page: Page) => page.locator('.entry-meta .ant-tag').first();
export const textarea = (page: Page) => page.locator('.translation-input');
