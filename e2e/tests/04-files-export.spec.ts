import { Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FIX,
  TestUser,
  addMember,
  btn,
  createUser,
  label,
  expect,
  openEditor,
  pageAs,
  seedProject,
  stageTag,
  test,
  textarea,
  toast,
  useAs,
} from './helpers';

test.describe.configure({ mode: 'serial' });

let owner: TestUser;
let translator: TestUser;
let viewer: TestUser;
let pid = '';
const GREET = 'こんにちは、旅の人。\n\\C[2]この村\\C[0]へようこそ！';

test.beforeAll(async () => {
  owner = await createUser('fown', '文件管理员');
  translator = await createUser('ftra', '译者');
  viewer = await createUser('fvie', '围观者');
  pid = (await seedProject(owner)).id;
  await addMember(owner, pid, translator, 'TRANSLATOR');
  await addMember(owner, pid, viewer, 'VIEWER');
  await translator.api.translate(pid, GREET, '你好，旅行者。\n欢迎来到\\C[2]这个村子\\C[0]！');
  await translator.api.translate(pid, 'またね', '再见');
  await translator.api.translate(pid, 'はい', '是');
  const thanks = await translator.api.translate(pid, 'ありがとう！', '谢谢！');
  await owner.api.ok('PUT', `/projects/${pid}/entries/${thanks.id}`, { translation: '谢谢！', version: thanks.version, stage: 'REVIEWED' });
});

async function downloadExport(page: Page, expectRows?: number) {
  if (expectRows !== undefined) await expect(page.locator('.ant-table-row')).toHaveCount(expectRows);
  const row = page.locator('.ant-table-row').first();
  await expect(row).toContainText('完成', { timeout: 30_000 });
  const link = row.getByRole('link', { name: label('下载') });
  // 测试用 headless Chromium 无法解析含非 ASCII 字符的 filename*，因此直接校验响应头（RFC 6266）
  const head = await page.request.get((await link.getAttribute('href'))!);
  expect(head.headers()['content-disposition']).toMatch(/^attachment; filename="[\x20-\x7e]+_zh-CN_\d+\.zip"; filename\*=UTF-8''\S+_zh-CN_\d+\.zip$/);
  const [dl] = await Promise.all([page.waitForEvent('download'), link.click()]);
  const zip = unzipSync(new Uint8Array(readFileSync((await dl.path())!)));
  return zip;
}

const mapList = (zip: Record<string, Uint8Array>) => {
  const map = JSON.parse(new TextDecoder().decode(zip['data/Map001.json']));
  return map.events[1].pages as { list: { code: number; parameters: unknown[] }[] }[];
};

test('上传新版本文件：保留译文，原文变化的词条标记为有疑问', async ({ page }) => {
  await useAs(page, owner);
  await page.goto(`/projects/${pid}/files`);
  const modified = readFileSync(join(FIX, 'mz', 'Map001.json'), 'utf8').replace('"またね"', '"また明日ね"');
  const row = page.getByRole('row').filter({ hasText: 'data/Map001.json' });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), row.getByRole('button', { name: 'swap' }).click()]);
  await chooser.setFiles({ name: 'Map001.json', mimeType: 'application/json', buffer: Buffer.from(modified) });
  await expect(toast(page, '已提交 data/Map001.json 的新版本')).toBeVisible();
  const job = page.locator('.job-result').first();
  await expect(job).toContainText('更新 1', { timeout: 30_000 });
  await expect(job).toContainText('原文变更 1');

  await openEditor(page, pid, `q=${encodeURIComponent('また明日ね')}`);
  await expect(stageTag(page)).toHaveText('有疑问');
  await expect(textarea(page)).toHaveValue('再见');
  await page.getByRole('tab', { name: '历史' }).click();
  await expect(page.locator('.history-row').first()).toContainText('原文变更');
  await expect(page.locator('.history-row').first()).toContainText('旧原文：またね');
  // 其他词条的译文不受影响
  expect((await owner.api.findEntry(pid, GREET)).translation).toContain('你好，旅行者。');
});

test('导出：默认状态 + 附带 JSON，译文正确写回', async ({ page }) => {
  await useAs(page, owner);
  await page.goto(`/projects/${pid}/exports`);
  await page.getByLabel(/附带译文 JSON/).check();
  await btn(page, '生成导出包').click();
  await expect(toast(page, '已开始生成导出包')).toBeVisible();
  const zip = await downloadExport(page, 1);
  await expect(page.locator('.ant-table-row').first()).toContainText('含 JSON');
  expect(Object.keys(zip).sort()).toEqual(
    expect.arrayContaining(['data/Map001.json', 'data/System.json', 'js/plugins.js', 'translations/data/Map001.json.json']),
  );
  const pages = mapList(zip);
  const lines = pages[0].list.filter((c) => c.code === 401).map((c) => c.parameters[0]);
  expect(lines.slice(0, 2)).toEqual(['你好，旅行者。', '欢迎来到\\C[2]这个村子\\C[0]！']);
  expect(pages[0].list.find((c) => c.code === 102)!.parameters[0]).toEqual(['是', 'いいえ']);
  expect(pages[0].list.find((c) => c.code === 402)!.parameters[1]).toBe('是');
  expect(pages[1].list.find((c) => c.code === 401)!.parameters[0]).toBe('再见'); // 「有疑问」也默认写入
  const json = JSON.parse(new TextDecoder().decode(zip['translations/data/Map001.json.json']));
  expect(json.find((e: { original: string }) => e.original === 'ありがとう！').stage).toBe('REVIEWED');
});

test('导出：只写入已审核的译文', async ({ page }) => {
  await useAs(page, owner);
  await page.goto(`/projects/${pid}/exports`);
  for (const s of ['已翻译', '有疑问', '已锁定']) await page.getByRole('checkbox', { name: s }).uncheck();
  await expect(page.locator('.ant-table-row')).toHaveCount(1);
  await btn(page, '生成导出包').click();
  const zip = await downloadExport(page, 2);
  const pages = mapList(zip);
  const lines = pages[0].list.filter((c) => c.code === 401).map((c) => c.parameters[0]);
  expect(lines).toContain('こんにちは、旅の人。');
  expect(lines).toContain('谢谢！');
  expect(Object.keys(zip).some((k) => k.startsWith('translations/'))).toBe(false);
});

test('访客可下载导出包但不能创建；翻译员看不到文件管理操作', async ({ browser, errors }) => {
  const vp = await pageAs(browser, viewer, errors);
  await vp.goto(`/projects/${pid}/exports`);
  await expect(vp.getByText('导出记录')).toBeVisible();
  await expect(btn(vp, '生成导出包')).toHaveCount(0);
  const zip = await downloadExport(vp);
  expect(zip['data/Map001.json']).toBeTruthy();
  await vp.context().close();

  const tp = await pageAs(browser, translator, errors);
  await tp.goto(`/projects/${pid}/files`);
  await expect(tp.getByText('文件（7）')).toBeVisible();
  await expect(tp.locator('.ant-upload-drag')).toHaveCount(0);
  await expect(tp.getByRole('button', { name: 'delete' })).toHaveCount(0);
  await expect(tp.getByRole('button', { name: 'swap' })).toHaveCount(0);
  await expect(tp.getByRole('menuitem', { name: /设置/ })).toHaveCount(0);
  // 文件名可点击进入该文件的词条
  await tp.getByText('data/Actors.json').click();
  await expect(tp).toHaveURL(/\/editor\?file=/);
  await expect(tp.locator('.list-head')).toContainText('共 3 条');
  await tp.context().close();
});

test('下载原文件、删除文件与导出记录', async ({ page }) => {
  await useAs(page, owner);
  await page.goto(`/projects/${pid}/files`);
  const mapRow = page.getByRole('row').filter({ hasText: 'data/Map001.json' });
  const [dl] = await Promise.all([page.waitForEvent('download'), mapRow.getByRole('link', { name: 'download' }).click()]);
  expect(readFileSync((await dl.path())!, 'utf8')).toContain('また明日ね');

  const row = page.getByRole('row').filter({ hasText: 'data/Troops.json' });
  await row.getByRole('button', { name: 'delete' }).click();
  await btn(page.locator('.ant-popconfirm'), '删除').click();
  await expect(toast(page, '已删除')).toBeVisible();
  await expect(page.getByText('文件（6）')).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'data/Troops.json' })).toHaveCount(0);

  await page.goto(`/projects/${pid}/exports`);
  const before = await page.locator('.ant-table-row').count();
  await page.locator('.ant-table-row').first().getByRole('button', { name: 'delete' }).click();
  await btn(page.locator('.ant-popconfirm'), '删除').click();
  await expect(page.locator('.ant-table-row')).toHaveCount(before - 1);
});
