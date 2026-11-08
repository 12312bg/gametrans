import { unzipSync } from 'fflate';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIX, TestUser, addMember, btn, createUser, expect, mzZip, seedProject, test, toast, useAs } from './helpers';

test.describe.configure({ mode: 'serial' });

let owner: TestUser;
let translator: TestUser;
let pid = '';
let mvPid = '';

const dialogOf = (page: import('@playwright/test').Page) => page.getByRole('dialog').filter({ hasText: '导入前确认变更' });

/** 去掉第 2 页（含「またね」），并把「ありがとう！」改成「どうもありがとう！」 */
function newVersion(): Buffer {
  const map = JSON.parse(readFileSync(join(FIX, 'mz', 'Map001.json'), 'utf8'));
  map.events[1].pages = [map.events[1].pages[0]];
  return Buffer.from(JSON.stringify(map).replace('"ありがとう！"', '"どうもありがとう！"'));
}

async function exportZip(user: TestUser, projectId: string, body: Record<string, unknown>) {
  const job = await user.api.ok('POST', `/projects/${projectId}/exports`, { stages: ['TRANSLATED'], ...body });
  await expect.poll(async () => (await user.api.ok('GET', `/projects/${projectId}/jobs/${job.id}`)).status).toBe('SUCCEEDED');
  return unzipSync(new Uint8Array(await (await user.api.ctx.get(`/api/projects/${projectId}/exports/${job.id}/download`)).body()));
}

test.beforeAll(async () => {
  owner = await createUser('pre', '负责人');
  translator = await createUser('pre', '译者');
  pid = (await seedProject(owner)).id;
  mvPid = (await seedProject(owner, { engine: 'RMMV', zip: mzZip({}, 'Game/www') })).id;
  await addMember(owner, mvPid, translator, 'TRANSLATOR');
  await owner.api.translate(pid, 'またね', '再见');
  await owner.api.translate(pid, 'ありがとう！', '谢谢！');
});

test('上传新版本：预览将删除的已有译文，取消后不变，确认后才导入', async ({ page }) => {
  await useAs(page, owner);
  await page.goto(`/projects/${pid}/files`);
  const input = page.locator('.ant-upload-drag input[type=file]').first();
  await input.setInputFiles({ name: 'Map001.json', mimeType: 'application/json', buffer: newVersion() });
  await btn(page, '开始上传').click();
  const dialog = dialogOf(page);
  await expect(dialog).toContainText('原文变更 1 条', { timeout: 30_000 });
  await expect(dialog).toContainText('删除 1 条');
  await expect(dialog).toContainText('其中 1 条已有译文的词条会被删除');
  await dialog.locator('.ant-table-row-expand-icon').click();
  await dialog.getByRole('tab', { name: '将删除 1' }).click();
  await expect(dialog.locator('.preview-lost')).toContainText('再见');
  await btn(dialog, '取消').click();
  await expect(toast(page, '已取消，本次上传的文件已丢弃')).toBeVisible();
  expect((await owner.api.findEntry(pid, 'またね')).translation).toBe('再见');

  await input.setInputFiles({ name: 'Map001.json', mimeType: 'application/json', buffer: newVersion() });
  await btn(page, '开始上传').click();
  await expect(dialog).toContainText('删除 1 条', { timeout: 30_000 });
  await btn(dialog, '确认导入').click();
  await expect(toast(page, '已确认，正在后台导入')).toBeVisible();
  const job = page.locator('.job-result').first();
  await expect(job).toContainText('移除词条 1', { timeout: 30_000 });
  await expect(job).toContainText('原文变更 1');
  await expect(owner.api.findEntry(pid, 'またね')).rejects.toThrow();
  const changed = await owner.api.findEntry(pid, 'どうもありがとう！');
  expect(changed).toMatchObject({ translation: '谢谢！', stage: 'QUESTIONED' });
});

test('预览接口：确认只能一次，确认后不能取消', async () => {
  const map = readFileSync(join(FIX, 'mz', 'Map001.json'), 'utf8').replace('"またね"', '"またあした"');
  const r = await owner.api.ctx.post(`/api/projects/${mvPid}/files?preview=true`, {
    multipart: { files: { name: 'Map001.json', mimeType: 'application/json', buffer: Buffer.from(map) }, paths: JSON.stringify(['www/data/Map001.json']) },
  });
  expect(r.status()).toBe(201);
  const preview = await r.json();
  await expect.poll(async () => (await owner.api.ok('GET', `/projects/${mvPid}/jobs/${preview.id}`)).status).toBe('SUCCEEDED');
  const { result } = await owner.api.ok('GET', `/projects/${mvPid}/jobs/${preview.id}`);
  expect(result.preview).toBe(true);
  expect(result.files[0]).toMatchObject({ path: 'www/data/Map001.json', status: 'updated', changed: 1, removed: 0 });
  expect(result.files[0].details.changed[0]).toMatchObject({ before: 'またね', after: 'またあした' });
  // 预览不写入
  await owner.api.findEntry(mvPid, 'またね');

  const denied = await translator.api.call('POST', `/projects/${mvPid}/jobs/${preview.id}/apply`);
  expect(denied.status).toBe(403);
  const applied = await owner.api.ok('POST', `/projects/${mvPid}/jobs/${preview.id}/apply`);
  await owner.api.waitJob(mvPid, applied.id);
  await owner.api.findEntry(mvPid, 'またあした');
  for (const [method, path] of [['POST', `/apply`], ['DELETE', '']]) {
    const again = await owner.api.call(method, `/projects/${mvPid}/jobs/${preview.id}${path}`);
    expect(again.status).toBe(409);
    expect(again.data.code).toBe('PREVIEW_UNAVAILABLE');
  }
});

test('附件：在锁定的目录树下新建 www/img，检查冲突，上传与覆盖', async ({ page }) => {
  await useAs(page, owner);
  await page.goto(`/projects/${mvPid}/files`);
  const card = page.locator('.attachments-card');
  await expect(card).toContainText('还没有附件');
  await btn(card, '上传附件').click();
  const dialog = page.getByRole('dialog').filter({ hasText: '目标目录' });
  await dialog.locator('.ant-upload-drag input[type=file]').setInputFiles([
    { name: 'Quests.txt', mimeType: 'text/plain', buffer: Buffer.from('クエスト一覧') },
    { name: 'Map001.json', mimeType: 'application/json', buffer: Buffer.from('{}') },
  ]);
  // 选择数据目录 www/data：与数据文件同名的被拦下
  await dialog.locator('.attach-target .ant-select').click();
  await page.locator('.ant-select-tree-title').filter({ hasText: /^\s*data$/ }).click();
  const rows = dialog.locator('.attach-rows .ant-table-row');
  await expect(rows.filter({ hasText: 'www/data/Map001.json' })).toContainText('与数据文件冲突');
  await expect(dialog).toContainText('有 1 个文件的路径不可用');
  await expect(btn(dialog, '上传附件')).toBeDisabled();
  await rows.filter({ hasText: 'Map001.json' }).getByRole('button', { name: 'delete' }).click();

  // 改为 www 下新建 img
  await dialog.locator('.attach-target .ant-select').click();
  await page.locator('.ant-select-tree-title').filter({ hasText: /^\s*www$/ }).click();
  await dialog.getByPlaceholder('例如 img 或 img/quests').fill('img');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('www/img/Quests.txt');
  await expect(rows.first()).toContainText('新增');
  await btn(dialog, '上传附件').click();
  await expect(toast(page, '已上传附件：新增 1 个，覆盖 0 个')).toBeVisible();
  await expect(card.getByRole('row').filter({ hasText: 'www/img/Quests.txt' })).toBeVisible();

  // 同一路径再次上传 → 覆盖
  await btn(card, '上传附件').click();
  await dialog.locator('.ant-upload-drag input[type=file]').setInputFiles({ name: 'Quests.txt', mimeType: 'text/plain', buffer: Buffer.from('任务列表') });
  await dialog.getByPlaceholder('例如 img 或 img/quests').fill('www/img');
  await expect(rows.first()).toContainText('将覆盖');
  await btn(dialog, '上传附件').click();
  await expect(toast(page, '已上传附件：新增 0 个，覆盖 1 个')).toBeVisible();
  await expect(card).toContainText('附件（1）');
});

test('导出：默认包含附件，可取消勾选', async ({ page }) => {
  await owner.api.translate(mvPid, 'またあした', '明天见');
  await useAs(page, owner);
  await page.goto(`/projects/${mvPid}/exports`);
  await expect(page.getByLabel('包含附件（1 个）')).toBeChecked();
  await btn(page, '生成导出包').click();
  const row = page.locator('.ant-table-row').first();
  await expect(row).toContainText('完成', { timeout: 30_000 });
  await expect(row).toContainText('含 1 个附件');

  const withAtt = await exportZip(owner, mvPid, {});
  expect(new TextDecoder().decode(withAtt['www/img/Quests.txt'])).toBe('任务列表');
  expect(new TextDecoder().decode(withAtt['www/data/Map001.json'])).toContain('明天见');
  const without = await exportZip(owner, mvPid, { includeAttachments: false });
  expect(without['www/img/Quests.txt']).toBeUndefined();
});

test('附件接口：路径校验与权限', async () => {
  const post = (user: TestUser, dir: string, name: string) =>
    user.api.ctx.post(`/api/projects/${mvPid}/attachments`, { multipart: { files: { name, mimeType: 'text/plain', buffer: Buffer.from('x') }, dir } });
  const locked = await post(owner, 'WWW/Data', 'map001.json');
  expect(locked.status()).toBe(409);
  expect((await locked.json()).code).toBe('ATTACHMENT_PATH_LOCKED');
  const folder = await post(owner, 'www/img/Quests.txt', 'a.txt');
  expect((await folder.json()).code).toBe('ATTACHMENT_PATH_CONFLICT');
  const invalid = await post(owner, '../outside', 'a.txt');
  expect(invalid.status()).toBe(400);
  expect((await invalid.json()).code).toBe('ATTACHMENT_PATH_INVALID');

  // 翻译员只能看到列表
  const list = await translator.api.ok('GET', `/projects/${mvPid}/attachments`);
  expect(list.map((a: { path: string }) => a.path)).toEqual(['www/img/Quests.txt']);
  expect((await post(translator, 'www/img', 'b.txt')).status()).toBe(403);
  expect((await translator.api.ctx.get(`/api/projects/${mvPid}/attachments/${list[0].id}/download`)).status()).toBe(403);
  expect((await owner.api.ctx.get(`/api/projects/${mvPid}/attachments/${list[0].id}/download`)).status()).toBe(200);
});

test('删除附件', async ({ page }) => {
  await useAs(page, owner);
  await page.goto(`/projects/${mvPid}/files`);
  const card = page.locator('.attachments-card');
  await card.getByRole('row').filter({ hasText: 'www/img/Quests.txt' }).getByRole('button', { name: 'delete' }).click();
  await btn(page.locator('.ant-popconfirm'), '删除').click();
  await expect(toast(page, '已删除附件')).toBeVisible();
  await expect(card).toContainText('还没有附件');
});
