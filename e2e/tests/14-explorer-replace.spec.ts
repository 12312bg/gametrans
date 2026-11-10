import { unzipSync } from 'fflate';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIX, TestUser, addMember, btn, createUser, expect, mzZip, openEditor, seedProject, test, toast, useAs } from './helpers';

test.describe.configure({ mode: 'serial' });

let owner: TestUser;
let reviewer: TestUser;
let pid = '';
const shot = (name: string) => join(__dirname, `../.tmp/results/${name}.png`);
const tile = (page: import('@playwright/test').Page, path: string) => page.locator(`[data-path="${path}"]`);

async function uploadAttachment(user: TestUser, dir: string, name: string, body: string | Buffer) {
  const r = await user.api.ctx.post(`/api/projects/${pid}/attachments`, { multipart: { files: { name, mimeType: 'application/octet-stream', buffer: Buffer.from(body) }, dir } });
  expect(r.status(), await r.text()).toBe(201);
}

async function exportZip(body: Record<string, unknown> = {}) {
  const job = await owner.api.ok('POST', `/projects/${pid}/exports`, { stages: ['TRANSLATED', 'REVIEWED'], ...body });
  const done = await owner.api.waitJob(pid, job.id);
  return { zip: unzipSync(new Uint8Array(await (await owner.api.ctx.get(`/api/projects/${pid}/exports/${job.id}/download`)).body())), result: done.result };
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test.beforeAll(async () => {
  owner = await createUser('exp', '负责人');
  reviewer = await createUser('exp', '审核');
  pid = (await seedProject(owner, { engine: 'RMMV', zip: mzZip({}, 'Game/www') })).id;
  await addMember(owner, pid, reviewer, 'REVIEWER');
  await uploadAttachment(owner, 'www/img', 'Quests.txt', 'Quest List\r\nFind the cat\r\n');
  await uploadAttachment(owner, 'www/img/pictures', 'Logo.png', PNG);
});

test('附件标签页：文件夹视图，数据文件灰色锁定，可隐藏', async ({ page }) => {
  await useAs(page, owner);
  await page.goto(`/projects/${pid}`);
  await page.getByRole('menuitem', { name: /附件/ }).click();
  await expect(page).toHaveURL(/\/attachments$/);
  await page.locator('.tool-tree').getByText('www').click();
  const main = page.locator('.tool-main');
  await expect(main.locator('.folder-tile .tile-name')).toHaveText(['data', 'img', 'js']);
  await expect(main.locator('.folder-tile.locked .tile-name')).toHaveText(['data', 'js']);
  await main.locator('.folder-tile').filter({ hasText: 'data' }).click();
  await expect(tile(page, 'www/data/Map001.json')).toHaveClass(/is-data/);
  await expect(tile(page, 'www/data/Map001.json').locator('.tile-check')).toHaveCount(0);
  await page.screenshot({ path: shot('explorer-data') });

  await page.getByRole('switch', { name: '显示数据文件' }).click();
  await expect(page.locator('.tool-tree')).not.toContainText('data');
  await page.locator('.tool-tree').getByText('pictures').click();
  await expect(tile(page, 'www/img/pictures/Logo.png').locator('img')).toBeVisible();
  await page.getByRole('switch', { name: '显示数据文件' }).click();
});

test('文本附件：预览、预编辑（原件不变）、左右分栏对比，导出时生效', async ({ page }) => {
  await useAs(page, owner);
  await page.goto(`/projects/${pid}/attachments`);
  await page.locator('.tool-tree').getByText('img').first().click();
  await tile(page, 'www/img/Quests.txt').click();
  const viewer = page.locator('.file-viewer');
  await expect(viewer.locator('.cm-content')).toContainText('Find the cat');

  await viewer.getByRole('tab', { name: '预编辑' }).click();
  const editor = viewer.locator('.ant-tabs-tabpane-active .cm-content');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('任务列表\n找到猫\n');
  await expect(viewer).toContainText('有未保存的修改');
  await btn(viewer, '保存预编辑').click();
  await expect(toast(page, '已保存预编辑')).toBeVisible();
  await expect(viewer.locator('.ant-modal-title')).toContainText('已预编辑');

  await viewer.getByRole('tab', { name: '对比' }).click();
  await expect(viewer.locator('.diff-stats')).toContainText('+2 −2 行');
  await expect(viewer.locator('.cm-mergeView .cm-changedLine').first()).toBeVisible();
  await page.screenshot({ path: shot('explorer-diff') });
  await viewer.getByText('行内').click();
  await expect(viewer.locator('.cm-deletedChunk').first()).toBeVisible();
  await page.keyboard.press('Escape');

  // 原件不变；导出包中是预编辑后的内容，并保留原件的 CRLF 换行
  const atts = await owner.api.ok('GET', `/projects/${pid}/attachments`);
  const quests = atts.find((a: { path: string }) => a.path === 'www/img/Quests.txt');
  const original = await owner.api.ctx.get(`/api/projects/${pid}/attachments/${quests.id}/download?version=original`);
  expect(await original.text()).toBe('Quest List\r\nFind the cat\r\n');
  const { zip } = await exportZip();
  expect(new TextDecoder().decode(zip['www/img/Quests.txt'])).toBe('任务列表\r\n找到猫\r\n');
});

test('覆盖有预编辑的附件：查看差异，选择保留预编辑', async ({ page }) => {
  await useAs(page, owner);
  await page.goto(`/projects/${pid}/attachments`);
  await page.locator('.tool-tree').getByText('img').first().click();
  await btn(page.locator('.explorer .tool-bar'), '上传').click();
  const dialog = page.getByRole('dialog').filter({ hasText: '目标目录' });
  await dialog.locator('.ant-upload-drag input[type=file]').setInputFiles({ name: 'Quests.txt', mimeType: 'text/plain', buffer: Buffer.from('Quest List\r\nFind the dog\r\n') });
  await btn(dialog, '上传附件').click();
  const review = page.getByRole('dialog').filter({ hasText: '覆盖同名附件前确认变更' });
  await expect(review).toContainText('以下 1 个附件将被新文件覆盖');
  await review.locator('.ant-collapse-header').click();
  await expect(review.locator('.cm-mergeView')).toBeVisible();
  await expect(review.locator('.cm-mergeView')).toContainText('Find the dog');
  await review.getByRole('checkbox', { name: '保留预编辑' }).check();
  await page.screenshot({ path: shot('explorer-overwrite') });
  await btn(review, '确认覆盖并上传').click();
  await expect(toast(page, '覆盖 1 个')).toBeVisible();

  const atts = await owner.api.ok('GET', `/projects/${pid}/attachments`);
  const quests = atts.find((a: { path: string }) => a.path === 'www/img/Quests.txt');
  expect(quests.editedAt).not.toBeNull();
  expect(await (await owner.api.ctx.get(`/api/projects/${pid}/attachments/${quests.id}/download?version=original`)).text()).toContain('Find the dog');
});

test('数据文件预编辑：只能改未提取的内容，导出时先应用预编辑再写入译文', async ({ page }) => {
  await owner.api.translate(pid, 'またね', '再见');
  await useAs(page, owner);
  await page.goto(`/projects/${pid}/attachments`);
  await page.locator('.tool-tree').getByText('data').click();
  await tile(page, 'www/data/Map001.json').click();
  const viewer = page.locator('.file-viewer');
  await viewer.getByRole('tab', { name: '预编辑' }).click();
  const editor = viewer.locator('.ant-tabs-tabpane-active .cm-content');
  await expect(editor).toContainText('"battleback1Name": ""');

  // CodeMirror 只渲染可见的行：定位到具体行，在行尾的引号前修改
  const editValue = async (line: string, erase: number, insert: string) => {
    await editor.locator('.cm-line').filter({ hasText: line }).click();
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    for (let i = 0; i < erase; i++) await page.keyboard.press('Backspace');
    await page.keyboard.insertText(insert);
  };
  // 改动已提取的词条会被拦下
  await editValue('"displayName": "はじまりの村"', 6, '新手村');
  await btn(viewer, '保存预编辑').click();
  await expect(viewer.locator('.touched-list')).toContainText('displayName');
  await btn(viewer, '放弃未保存的修改').click();

  await editValue('"battleback1Name": ""', 0, 'Grass');
  await btn(viewer, '保存预编辑').click();
  await expect(toast(page, '已保存预编辑')).toBeVisible();
  await viewer.getByRole('tab', { name: '对比' }).click();
  await expect(viewer.locator('.diff-stats')).toContainText('1 处改动');
  await page.keyboard.press('Escape');
  await expect(tile(page, 'www/data/Map001.json')).toContainText('已预编辑');

  const { zip } = await exportZip();
  const map = JSON.parse(new TextDecoder().decode(zip['www/data/Map001.json']));
  expect(map.battleback1Name).toBe('Grass');
  expect(JSON.stringify(map)).toContain('再见');
});

test('plugins.js 预编辑新增插件：保存后对比可见改动，键顺序不变，导出生效', async ({ page }) => {
  const files: { id: string; path: string }[] = await owner.api.ok('GET', `/projects/${pid}/files`);
  const plugins = files.find((f) => f.path === 'www/js/plugins.js')!;
  const editUrl = `/projects/${pid}/files/${plugins.id}/edit`;
  const { original } = await owner.api.ok('GET', editUrl);
  // 整个 $plugins 数组被替换，补丁中的旧值是对象数组：存储时不能重排键，否则会被当成冲突
  const added = { name: 'AddedPlugin', status: true, description: '新插件', parameters: { Enabled: 'true', Speed: '5' } };
  const saved = await owner.api.ok('PUT', editUrl, { content: JSON.stringify([...JSON.parse(original), added], null, 2) });
  expect(saved.conflicts).toBe(0);
  expect(saved.edited).toContain(JSON.stringify(added));
  expect((await owner.api.ok('GET', editUrl)).edited).toContain(JSON.stringify(added));

  await useAs(page, owner);
  await page.goto(`/projects/${pid}/attachments`);
  await page.locator('.tool-tree').getByText('js').click();
  await tile(page, 'www/js/plugins.js').click();
  const viewer = page.locator('.file-viewer');
  await viewer.getByRole('tab', { name: '对比' }).click();
  await expect(viewer.locator('.diff-stats')).toContainText('1 处改动');
  await expect(viewer.locator('.viewer-conflicts')).toHaveCount(0);
  await page.keyboard.press('Escape');

  const { zip } = await exportZip();
  const out = new TextDecoder().decode(zip['www/js/plugins.js']);
  expect(out).toContain(`,\n${JSON.stringify(added)}\n]`);

  // 上传新版本后原值对不上：预编辑不生效，查看器给出提示
  const next = readFileSync(join(FIX, 'mz', 'plugins.js'), 'utf8').replace('"Visible":"true"', '"Visible":"false"');
  const r = await owner.api.ctx.post(`/api/projects/${pid}/files`, {
    multipart: { files: { name: 'plugins.js', mimeType: 'text/javascript', buffer: Buffer.from(next) }, paths: JSON.stringify(['www/js/plugins.js']) },
  });
  expect(r.status(), await r.text()).toBe(201);
  await owner.api.waitJob(pid, (await r.json()).id);
  expect((await owner.api.ok('GET', editUrl)).conflicts).toBe(1);
  await page.reload();
  await page.locator('.tool-tree').getByText('js').click();
  await tile(page, 'www/js/plugins.js').click();
  await expect(viewer.locator('.viewer-conflicts')).toContainText('有 1 处预编辑与当前原文件对不上');
});

test('多选删除附件；数据文件不能删除或改名', async ({ page }) => {
  await uploadAttachment(owner, 'www/img/pictures', 'Extra.txt', 'x');
  await useAs(page, owner);
  await page.goto(`/projects/${pid}/attachments`);
  await page.locator('.tool-tree').getByText('pictures').click();
  await tile(page, 'www/img/pictures/Logo.png').locator('.tile-check').click();
  await tile(page, 'www/img/pictures/Extra.txt').locator('.tile-check').click();
  await btn(page.locator('.explorer .tool-bar'), '删除选中（2）').click();
  await btn(page.locator('.ant-popconfirm'), '删除').click();
  await expect(toast(page, '已删除 2 个附件')).toBeVisible();

  await page.locator('.tool-tree').getByText('data').click();
  const data = tile(page, 'www/data/Map001.json');
  await data.hover();
  await data.locator('.tile-more').click();
  await expect(page.getByRole('menuitem', { name: /重命名/ })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: /删除/ })).toHaveCount(0);
});

test('批量替换译文：预览高亮，审核员可用，状态不变，可回滚', async ({ page }) => {
  await owner.api.translate(pid, 'ありがとう！', '谢谢你，Lucy！', 'REVIEWED');
  await useAs(page, reviewer);
  await openEditor(page, pid);
  await page.getByRole('button', { name: /替换/ }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: '批量替换译文' });
  await dialog.getByLabel('查找').fill('lucy');
  await dialog.getByLabel('替换为').fill('露西');
  await btn(dialog, '预览').click();
  await expect(dialog).toContainText('将替换 1 条译文中的 1 处');
  await expect(dialog.locator('mark.diff-del')).toHaveText('Lucy');
  await expect(dialog.locator('mark.diff-ins')).toHaveText('露西');
  await page.screenshot({ path: shot('replace-preview') });
  await dialog.getByLabel('区分大小写').check();
  await btn(dialog, '预览').click();
  await expect(dialog).toContainText('没有可替换的译文');
  await dialog.getByLabel('区分大小写').uncheck();
  await btn(dialog, '预览').click();
  await btn(dialog, '全部替换（1 条）').click();
  await expect(toast(page, '已替换 1 条译文')).toBeVisible();

  const e = await owner.api.findEntry(pid, 'ありがとう！');
  expect(e).toMatchObject({ translation: '谢谢你，露西！', stage: 'REVIEWED' });
  const history = await owner.api.ok('GET', `/projects/${pid}/entries/${e.id}/history`);
  expect(history[0]).toMatchObject({ action: 'REPLACE', note: 'lucy → 露西' });

  // 翻译员不能用；无效正则返回错误码
  const translator = await createUser('exp');
  await addMember(owner, pid, translator, 'TRANSLATOR');
  expect((await translator.api.call('POST', `/projects/${pid}/entries/replace`, { find: 'a', replace: 'b', dryRun: true })).status).toBe(403);
  const bad = await reviewer.api.call('POST', `/projects/${pid}/entries/replace`, { find: '(', replace: '', regex: true, dryRun: true });
  expect(bad.data.code).toBe('REPLACE_INVALID_PATTERN');
});
