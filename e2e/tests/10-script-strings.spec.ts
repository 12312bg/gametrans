import { unzipSync } from 'fflate';
import { TestUser, addMember, btn, createUser, expect, openEditor, seedProject, stageTag, test, textarea, toast, useAs } from './helpers';

test.describe.configure({ mode: 'serial' });

let owner: TestUser;
let translator: TestUser;
let pid = '';
const hiddenQuery = (category: string, q?: string) => `stage=HIDDEN&category=${category}${q ? `&q=${encodeURIComponent(q)}&field=original` : ''}`;

test.beforeAll(async () => {
  owner = await createUser('scr', '负责人');
  translator = await createUser('scr', '译者');
  pid = (await seedProject(owner)).id;
  await addMember(owner, pid, translator, 'TRANSLATOR');
});

test('变量 / 开关名称默认隐藏，并提示用途', async ({ page }) => {
  await useAs(page, owner);
  await openEditor(page, pid, hiddenQuery('variable'));
  await expect(page.locator('.entry-item')).toHaveCount(2);
  await expect(page.locator('.original-text')).toHaveText('変数1');
  await expect(page.locator('.entry-context')).toHaveText('系统 · 变量 #1');
  await expect(page.locator('.entry-alert')).toContainText('变量 / 开关名称通常只在编辑器中使用');
});

test('脚本中的同一个值：翻译一处后一键同步到条件分支，导出写回引号内', async ({ page }) => {
  await useAs(page, owner);
  await openEditor(page, pid, hiddenQuery('script', 'Normal'));
  const items = page.locator('.entry-item');
  await expect(items).toHaveCount(2);
  await expect(page.locator('.entry-context')).toContainText('控制变量 #3（脚本） · "Normal"');
  const notice = page.locator('.linked-notice');
  await expect(notice).toContainText('这个字符串还出现在其他 1 处脚本 / 插件中');

  // 取消隐藏后翻译，再同步到条件分支里的比较
  await page.locator('.entry-actions').getByRole('button', { name: 'more' }).click();
  await page.getByRole('menuitem', { name: /取消隐藏/ }).click();
  await expect(stageTag(page)).toHaveText('未翻译');
  await textarea(page).fill('普通');
  await expect(notice.getByRole('button', { name: /同步到其他 1 处/ })).toBeDisabled();
  await page.keyboard.press('Control+s');
  await expect(stageTag(page)).toHaveText('已翻译');
  await expect(notice).toContainText('其中 1 处译文与当前不同');
  await notice.getByRole('button', { name: /同步到其他 1 处/ }).click();
  await expect(toast(page, '已同步 1 处')).toBeVisible();
  await expect(notice).not.toContainText('译文与当前不同');

  await page.getByRole('tab', { name: '相同字符串 (1)' }).click();
  const linked = page.locator('.ctx-row').filter({ hasText: '条件分支（脚本）' });
  await expect(linked).toContainText('普通');
  await linked.click();
  await expect(page.locator('.entry-context')).toContainText('条件分支（脚本） · $gameVariables.value(3) === "Normal"');
  await expect(stageTag(page)).toHaveText('已翻译');
  await page.getByRole('tab', { name: '历史' }).click();
  await expect(page.locator('.history-row').first()).toContainText('同步相同字符串');

  // 导出：只替换引号里的文字，代码不变
  const job = await owner.api.ok('POST', `/projects/${pid}/exports`, { stages: ['TRANSLATED'] });
  await expect.poll(async () => (await owner.api.ok('GET', `/projects/${pid}/jobs/${job.id}`)).status).toBe('SUCCEEDED');
  const zip = unzipSync(new Uint8Array(await (await owner.api.ctx.get(`/api/projects/${pid}/exports/${job.id}/download`)).body()));
  const map = JSON.parse(new TextDecoder().decode(zip['data/Map001.json']));
  const list = map.events[1].pages[0].list as { code: number; parameters: unknown[] }[];
  expect(list.find((c) => c.code === 122)!.parameters[4]).toBe('"普通"');
  expect(list.find((c) => c.code === 111)!.parameters[1]).toBe('$gameVariables.value(3) === "普通"');
});

test('翻译员同步时跳过无权修改的词条', async () => {
  // 事件脚本里的「テキスト」仍是隐藏状态，翻译员看不到
  const { items } = await translator.api.ok('GET', `/projects/${pid}/entries?category=script`);
  expect(items.map((e: { original: string }) => e.original)).toEqual(['Normal', 'Normal']);
  const [assign, cond] = items;
  await owner.api.ok('PUT', `/projects/${pid}/entries/${cond.id}`, { translation: cond.translation, stage: 'LOCKED', version: cond.version });
  await translator.api.ok('PUT', `/projects/${pid}/entries/${assign.id}`, { translation: '一般', version: assign.version });
  expect(await translator.api.ok('POST', `/projects/${pid}/entries/${assign.id}/sync`)).toEqual({ affected: 0, skipped: 1 });
  expect((await owner.api.ok('GET', `/projects/${pid}/entries/${cond.id}`)).translation).toBe('普通');
});

test('重新提取：保留已有译文，任务带「重新提取」标记', async ({ page }) => {
  await useAs(page, owner);
  await page.goto(`/projects/${pid}/files`);
  await btn(page, '重新提取').click();
  await btn(page.locator('.ant-popconfirm'), '确定').click();
  await expect(toast(page, '已开始重新提取')).toBeVisible();
  const job = page.locator('.ant-list-item').filter({ hasText: '重新提取' }).first();
  await expect(job.locator('.job-result')).toContainText('未变化 7', { timeout: 30_000 });
  const { items } = await owner.api.ok('GET', `/projects/${pid}/entries?category=script`);
  expect(items.map((e: { translation: string }) => e.translation)).toEqual(['一般', '普通']);

  // 翻译员没有文件管理权限
  const denied = await translator.api.call('POST', `/projects/${pid}/files/reextract`);
  expect(denied.status).toBe(403);
});

test('普通词条不显示相同字符串提示', async ({ page }) => {
  await useAs(page, owner);
  await openEditor(page, pid, `q=${encodeURIComponent('旅の人')}&field=original`);
  await expect(page.locator('.linked-notice')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: /相同字符串/ })).toHaveCount(0);
});
