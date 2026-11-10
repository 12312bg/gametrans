import { TestUser, btn, confirmDialog, createUser, expect, openEditor, seedProject, stageTag, test, textarea, toast, useAs } from './helpers';

test.describe.configure({ mode: 'serial' });

let owner: TestUser;
let pid = '';

test.beforeAll(async () => {
  owner = await createUser('cmt', '负责人');
  pid = (await seedProject(owner)).id;
});

test('注释逐行提取并注明标签块；按位置搜索后批量放出', async ({ page }) => {
  await useAs(page, owner);
  await openEditor(page, pid, 'stage=HIDDEN&category=comment');
  await expect(page.locator('.entry-item')).toHaveCount(4);
  await page.locator('.entry-item').filter({ hasText: 'Select your travel destination!' }).click();
  await expect(page.locator('.entry-context')).toHaveText('公共事件 #2「Return Home」 · 注释 · 标签 <Help Description> · 第2行');
  await expect(page.locator('.entry-alert')).toContainText('事件注释通常是开发者备注');

  // 只放出公共事件菜单用到的标签块：按位置搜索标签名
  await openEditor(page, pid, `stage=HIDDEN&category=comment&q=${encodeURIComponent('Help Description')}&field=context`);
  await expect(page.locator('.entry-item')).toHaveCount(1);
  await page.getByRole('button', { name: /批量/ }).click();
  await page.getByRole('button', { name: /对全部 1 条筛选结果/ }).click();
  await page.getByRole('menuitem', { name: '取消隐藏' }).click();
  await btn(confirmDialog(page), '确定').click();
  await expect(toast(page, '已处理 1 条词条')).toBeVisible();

  await openEditor(page, pid, 'category=comment');
  await expect(page.locator('.entry-item')).toHaveCount(1);
  await textarea(page).fill('请选择目的地！');
  await page.keyboard.press('Control+s');
  await expect(stageTag(page)).toHaveText('已翻译');
});

test('公共事件名默认隐藏', async ({ page }) => {
  await useAs(page, owner);
  await openEditor(page, pid, 'stage=HIDDEN&category=eventName');
  await expect(page.locator('.entry-item .entry-item-src')).toHaveText(['共通', 'Return Home']);
  await page.locator('.entry-item').filter({ hasText: 'Return Home' }).click();
  await expect(page.locator('.entry-alert')).toContainText('公共事件菜单类插件会把它显示为菜单项');
});

test('MapInfos 的地图名默认隐藏，位置说明带上级地图', async ({ page }) => {
  const files: { path: string }[] = await owner.api.ok('GET', `/projects/${pid}/files`);
  const path = files.find((f) => f.path.endsWith('Map001.json'))!.path.replace(/Map001\.json$/, 'MapInfos.json');
  const info = (id: number, name: string, parentId: number) => ({ id, expanded: false, name, order: id, parentId, scrollX: 0, scrollY: 0 });
  const body = JSON.stringify([null, info(1, 'West District', 0), info(2, 'Diner', 1)]);
  const r = await owner.api.ctx.post(`/api/projects/${pid}/files`, {
    multipart: { files: { name: 'MapInfos.json', mimeType: 'application/json', buffer: Buffer.from(body) }, paths: JSON.stringify([path]) },
  });
  expect(r.status(), await r.text()).toBe(201);
  const job = await owner.api.waitJob(pid, (await r.json()).id);
  expect(job.result.files[0]).toMatchObject({ path, status: 'created', total: 2 });

  await useAs(page, owner);
  await openEditor(page, pid, 'stage=HIDDEN&category=mapName');
  await expect(page.locator('.entry-item .entry-item-src')).toHaveText(['West District', 'Diner']);
  await page.locator('.entry-item').filter({ hasText: 'Diner' }).click();
  await expect(page.locator('.entry-context')).toHaveText('地图 #2 · 位于 West District');
  await expect(page.locator('.entry-alert')).toContainText('编辑器地图树（MapInfos）里的地图名');
});

test('名字框中的名字可以翻译：不报缺少控制符，术语照常提示', async ({ page }) => {
  await owner.api.ok('POST', `/projects/${pid}/terms`, { term: 'Lucy', translation: '露西' });
  await useAs(page, owner);
  await openEditor(page, pid, `q=${encodeURIComponent('Lucy')}&field=original`);
  await expect(page.locator('.original-text .hl-code')).toHaveText(['\\n<', '>', '\\n[1]']);
  await expect(page.locator('.original-text .hl-term')).toHaveText('Lucy');

  await textarea(page).fill('\\n<Lucy>\\n[1]～♥️');
  await expect(page.locator('.qa-item.warning')).toHaveCount(0);
  await expect(page.locator('.qa-item.info')).toContainText('术语「Lucy」建议译为「露西」');
  await textarea(page).fill('\\n<露西>\\n[1]～♥️');
  await expect(page.locator('.qa-item')).toHaveCount(0);
  await textarea(page).fill('露西～♥️');
  await expect(page.locator('.qa-item.warning')).toContainText('译文缺少控制符：\\n<Lucy> \\n[1]');
});

test('备注与注释：翻译了标签名会提示', async ({ page }) => {
  await useAs(page, owner);
  await openEditor(page, pid, `stage=HIDDEN&category=note&q=${encodeURIComponent('<Help:薬>')}&field=original`);
  await textarea(page).fill('<帮助:药>');
  await expect(page.locator('.qa-item.warning')).toContainText('译文缺少标签：<Help>');
  await textarea(page).fill('<Help:药>');
  await expect(page.locator('.qa-item.warning')).toHaveCount(0);
});
