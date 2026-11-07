import {
  TM_TEXTS,
  TestUser,
  activeItem,
  addMember,
  btn,
  confirmDialog,
  createUser,
  expect,
  mzZip,
  openEditor,
  pageAs,
  seedProject,
  stageTag,
  test,
  textarea,
  tmCommonEvents,
  toast,
  useAs,
} from './helpers';

test.describe.configure({ mode: 'serial' });

let owner: TestUser;
let reviewer: TestUser;
let translator: TestUser;
let pid = '';
const q = (s: string) => `q=${encodeURIComponent(s)}&field=original`;
const SWORD = '勇者得到了传说之剑！';

test.beforeAll(async () => {
  owner = await createUser('own', '管理者');
  reviewer = await createUser('rev', '审核小王');
  translator = await createUser('tra', '翻译小李');
  const p = await seedProject(owner, { zip: mzZip({ 'data/CommonEvents.json': tmCommonEvents() }) });
  pid = p.id;
  await addMember(owner, pid, reviewer, 'REVIEWER');
  await addMember(owner, pid, translator, 'TRANSLATOR');
});

test('翻译员：控制符检查、Ctrl+Enter 保存并跳到下一条', async ({ page }) => {
  await useAs(page, translator);
  await openEditor(page, pid, q('旅の人'));
  await expect(page.locator('.entry-item')).toHaveCount(1);
  await expect(page.locator('.original-text .hl-code')).toHaveText(['\\C[2]', '\\C[0]']);
  await expect(page.locator('.entry-context')).toContainText('脸图 Actor1(0)');
  await expect(page.locator('.entry-context')).toContainText('说话人 リード');

  await textarea(page).fill('你好，旅行者。\n欢迎来到这个村子！');
  await expect(page.locator('.qa-item.warning')).toContainText('译文缺少控制符：\\C[2] \\C[0]');
  await textarea(page).fill('你好，旅行者。\n欢迎来到\\C[2]这个村子\\C[0]！\n第三行');
  await expect(page.locator('.qa-item.warning')).toHaveCount(0);
  await expect(page.locator('.qa-item.info')).toContainText('译文 3 行，多于原文 2 行');
  await textarea(page).fill('你好，旅行者。\n欢迎来到\\C[2]这个村子\\C[0]！');
  await expect(page.locator('.text-block-head').filter({ hasText: '译文' })).toContainText('未保存');
  await page.keyboard.press('Control+Enter');
  await expect(toast(page, '已经是最后一条了')).toBeVisible();
  await expect(stageTag(page)).toHaveText('已翻译');
  await expect(activeItem(page).locator('.entry-item-dst')).toHaveText('你好，旅行者。 欢迎来到\\C[2]这个村子\\C[0]！'.replace(' ', '\n'));
  const e = await translator.api.findEntry(pid, 'こんにちは、旅の人。\n\\C[2]この村\\C[0]へようこそ！');
  expect(e.stage).toBe('TRANSLATED');
  expect(e.translator.username).toBe(translator.username);
});

test('翻译记忆：相似推荐「使用」、Alt+1 快捷键、草稿保留', async ({ page }) => {
  await useAs(page, translator);
  await openEditor(page, pid, 'category=dialogue&file=');
  await expect(page.locator('.list-head')).toContainText('共 7 条');
  await expect(activeItem(page)).toContainText(TM_TEXTS[0]);
  await textarea(page).fill(SWORD);
  await page.keyboard.press('Control+Enter');
  // 自动跳到下一条（盾），翻译记忆推荐「剑」的译文
  await expect(activeItem(page)).toContainText(TM_TEXTS[1]);
  const tm = page.locator('.tm-row').first();
  await expect(tm).toContainText(SWORD);
  await expect(tm.locator('.ant-tag')).toHaveText(/\d+%/);
  await btn(page.locator('.side-tabs'), '使用').first().click();
  await expect(textarea(page)).toHaveValue(SWORD);
  await textarea(page).fill('勇者得到了传说之盾！');
  await page.keyboard.press('Control+Enter');

  // 第三条与第一条完全相同：100% 推荐，Alt+1 直接填入
  await expect(activeItem(page)).toContainText(TM_TEXTS[0]);
  await expect(page.locator('.tm-row').first().locator('.ant-tag')).toHaveText('100%');
  await page.keyboard.press('Alt+Digit1');
  await expect(textarea(page)).toHaveValue(SWORD);
  // 切走再切回，草稿仍在，列表有未保存标记
  await page.keyboard.press('Alt+ArrowDown');
  await expect(activeItem(page)).toContainText('旅の人');
  await expect(page.locator('.entry-item').nth(2).locator('.dirty-dot')).toBeVisible();
  await page.keyboard.press('Alt+ArrowUp');
  await expect(textarea(page)).toHaveValue(SWORD);
  // 还原草稿（留给后面的记忆填充）
  await textarea(page).fill('');
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
});

test('翻译员：Alt+C 复制原文、Ctrl+S 保存、标记有疑问', async ({ page }) => {
  await useAs(page, translator);
  await openEditor(page, pid, q('ありがとう！'));
  await textarea(page).click();
  await page.keyboard.press('Alt+KeyC');
  await expect(textarea(page)).toHaveValue('ありがとう！');
  await textarea(page).fill('谢谢！');
  await page.keyboard.press('Control+KeyS');
  await expect(stageTag(page)).toHaveText('已翻译');
  await expect(activeItem(page).locator('.entry-item-dst')).toHaveText('谢谢！');
  await btn(page, '有疑问').click();
  await expect(stageTag(page)).toHaveText('有疑问');
  await expect(btn(page, '取消疑问')).toBeVisible();
});

test('审核员：审核通过后翻译员不能再修改', async ({ page, browser, errors }) => {
  await useAs(page, reviewer);
  await openEditor(page, pid, q('旅の人'));
  await btn(page, '审核通过').click();
  await expect(stageTag(page)).toHaveText('已审核');
  await expect(btn(page, '取消审核')).toBeVisible();
  await expect(page.locator('.entry-credit')).toContainText('审核');

  // Ctrl+Shift+Enter：审核并跳到下一条
  await openEditor(page, pid, q('勇者は伝説の剣を手に入れた！'));
  await expect(page.locator('.entry-item')).toHaveCount(2);
  await page.keyboard.press('Control+Shift+Enter');
  await expect(page.locator('.entry-item').first().locator('.stage-dot')).toHaveCSS('background-color', 'rgb(16, 185, 129)');
  await expect(page.locator('.entry-item').nth(1)).toHaveClass(/active/);

  const tp = await pageAs(browser, translator, errors);
  await openEditor(tp, pid, q('旅の人'));
  await expect(stageTag(tp)).toHaveText('已审核');
  await expect(textarea(tp)).toBeDisabled();
  await expect(tp.getByText('该词条已审核，只有审核员及以上可以修改')).toBeVisible();
  await expect(btn(tp, '审核通过')).toHaveCount(0);
  await expect(tp.getByRole('button', { name: /批量/ })).toHaveCount(0);
  await expect(tp.getByRole('button', { name: /记忆填充/ })).toHaveCount(0);
  await tp.context().close();
});

test('术语表：审核员添加，编辑器高亮、提示并可插入；翻译员只读', async ({ page, browser, errors }) => {
  await useAs(page, reviewer);
  await page.goto(`/projects/${pid}/terms`);
  await btn(page, '添加术语').click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('术语（原文）').fill('リード');
  await dlg.getByLabel('译法').fill('里德');
  await dlg.getByLabel('备注').fill('主角');
  await btn(dlg, '保存').click();
  await expect(toast(page, '已保存')).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'リード' })).toContainText('里德');
  // 重复术语
  await btn(page, '添加术语').click();
  await dlg.getByLabel('术语（原文）').fill('リード');
  await dlg.getByLabel('译法').fill('别的');
  await btn(dlg, '保存').click();
  await expect(toast(page, '该术语已存在')).toBeVisible();
  await page.keyboard.press('Escape');

  // 批量导入
  await btn(page, '批量导入').click();
  await page.getByRole('dialog').locator('textarea').fill('# 注释\nポーション,回复药\nはじまりの村\t起始之村\t地名');
  await btn(page.getByRole('dialog'), '导入').click();
  await expect(toast(page, '导入完成：新增 2')).toBeVisible();
  await expect(page.getByText('术语表（3）')).toBeVisible();

  const tp = await pageAs(browser, translator, errors);
  await tp.goto(`/projects/${pid}/terms`);
  await expect(tp.getByText('术语表由审核员及以上角色维护')).toBeVisible();
  await expect(btn(tp, '添加术语')).toHaveCount(0);

  await openEditor(tp, pid, `${q('リード')}&category=name`);
  await expect(tp.locator('.original-text .hl-term')).toHaveText('リード');
  await tp.locator('.original-text .hl-term').hover();
  await expect(tp.locator('.ant-tooltip').filter({ hasText: '里德' })).toBeVisible();
  await textarea(tp).fill('Reed');
  await expect(tp.locator('.qa-item')).toContainText('术语「リード」建议译为「里德」');
  await textarea(tp).fill('');
  await tp.getByRole('tab', { name: '术语 (1)' }).click();
  await btn(tp.locator('.side-tabs'), '插入').click();
  await expect(textarea(tp)).toHaveValue('里德');
  await tp.keyboard.press('Control+KeyS');
  await expect(stageTag(tp)).toHaveText('已翻译');
  await tp.context().close();
});

test('审核员：翻译记忆批量填充完全相同的原文', async ({ page }) => {
  await useAs(page, reviewer);
  await openEditor(page, pid);
  await page.getByRole('button', { name: /记忆填充/ }).click();
  await btn(confirmDialog(page), '开始填充').click();
  // 公共事件 #3（与 #1 相同）+ 地图中的「リード」（姓名框、更改名称）
  await expect(toast(page, '已填充 3 条词条')).toBeVisible();
  const ce3 = (await reviewer.api.ok('GET', `/projects/${pid}/entries?${q(TM_TEXTS[0])}`)).items;
  expect(ce3.map((e: { translation: string }) => e.translation)).toEqual([SWORD, SWORD]);
});

test('管理员：批量取消隐藏、锁定、对全部筛选结果批量审核', async ({ page, browser, errors }) => {
  await useAs(page, owner);
  await openEditor(page, pid, 'stage=HIDDEN');
  const total = Number((await page.locator('.list-head b').innerText()).replace(/,/g, ''));
  expect(total).toBeGreaterThan(5);
  await expect(page.locator('.entry-item').filter({ hasText: '脚本' }).first()).toBeVisible();
  await expect(page.locator('.entry-alert')).toBeVisible();
  await page.getByRole('button', { name: /批量/ }).click();
  await page.getByText('全选本页').click();
  await expect(page.getByText(`已选 ${total} 条`)).toBeVisible();
  await page.getByRole('button', { name: /对选中项/ }).click();
  await page.getByRole('menuitem', { name: '取消隐藏' }).click();
  await btn(confirmDialog(page), '确定').click();
  await expect(toast(page, `已处理 ${total} 条词条`)).toBeVisible();
  await expect(page.getByText('没有符合条件的词条')).toBeVisible();

  // 锁定单条
  await openEditor(page, pid, q('ありがとう！'));
  await page.locator('.entry-actions').getByRole('button', { name: 'more' }).click();
  await page.getByRole('menuitem', { name: /锁定/ }).click();
  await expect(stageTag(page)).toHaveText('已锁定');
  const tp = await pageAs(browser, translator, errors);
  await openEditor(tp, pid, q('ありがとう！'));
  await expect(textarea(tp)).toBeDisabled();
  await expect(tp.getByText('该词条已锁定，只有管理员可以修改')).toBeVisible();
  await tp.context().close();

  // 对全部「已翻译」筛选结果批量审核
  await openEditor(page, pid, 'stage=TRANSLATED');
  const translated = Number(await page.locator('.list-head b').innerText());
  expect(translated).toBeGreaterThan(0);
  await page.getByRole('button', { name: /批量/ }).click();
  await page.getByRole('button', { name: /对全部 \d+ 条筛选结果/ }).click();
  await page.getByRole('menuitem', { name: '审核通过' }).click();
  await btn(confirmDialog(page), '确定').click();
  await expect(toast(page, `已处理 ${translated} 条词条`)).toBeVisible();
  await expect(page.getByText('没有符合条件的词条')).toBeVisible();
});

test('历史记录与回滚', async ({ page }) => {
  await useAs(page, translator);
  await openEditor(page, pid, q('スライムが現れた！'));
  await textarea(page).fill('史莱姆出现了！');
  await page.keyboard.press('Control+KeyS');
  await expect(stageTag(page)).toHaveText('已翻译');
  await textarea(page).fill('史莱姆们出现了！');
  await page.keyboard.press('Control+KeyS');
  await expect(activeItem(page).locator('.entry-item-dst')).toHaveText('史莱姆们出现了！');
  await page.getByRole('tab', { name: '历史' }).click();
  const rows = page.locator('.history-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('史莱姆们出现了！');
  await expect(rows.first()).toContainText('翻译小李');
  await page.locator('.side-tabs .ant-list-item').nth(1).getByRole('button', { name: /回滚/ }).click();
  await btn(page.locator('.ant-popconfirm'), '回滚').click();
  await expect(toast(page, '已回滚')).toBeVisible();
  await expect(textarea(page)).toHaveValue('史莱姆出现了！');
  await expect(rows.first()).toContainText('回滚');
});

test('并发编辑冲突：覆盖或采用对方版本', async ({ page, browser, errors }) => {
  await useAs(page, translator);
  const rp = await pageAs(browser, reviewer, errors);
  await openEditor(page, pid, q('またね'));
  await openEditor(rp, pid, q('またね'));

  await textarea(rp).fill('审核员的版本');
  await rp.keyboard.press('Control+KeyS');
  await expect(stageTag(rp)).toHaveText('已翻译');

  await textarea(page).fill('翻译员的版本');
  await page.keyboard.press('Control+KeyS');
  const modal = confirmDialog(page);
  await expect(modal).toContainText('该词条已被其他成员修改');
  await expect(modal).toContainText('审核员的版本');
  await expect(modal).toContainText('翻译员的版本');
  await btn(modal, '用我的覆盖').click();
  await expect(activeItem(page).locator('.entry-item-dst')).toHaveText('翻译员的版本');
  expect((await translator.api.findEntry(pid, 'またね')).translation).toBe('翻译员的版本');

  // 审核员此时持有旧版本，再次保存 → 选择采用对方版本
  await textarea(rp).fill('再改一次');
  await rp.keyboard.press('Control+KeyS');
  await btn(confirmDialog(rp), '使用对方版本').click();
  await expect(textarea(rp)).toHaveValue('翻译员的版本');
  await rp.context().close();
});

test('上下文面板：显示前后词条并可跳转', async ({ page }) => {
  await useAs(page, translator);
  await openEditor(page, pid, q('ありがとう！'));
  await page.getByRole('tab', { name: '上下文' }).click();
  const ctx = page.locator('.ctx-row');
  await expect(ctx.filter({ hasText: 'はい' }).first()).toBeVisible();
  await expect(page.locator('.ctx-row.current')).toContainText('ありがとう！');
  await ctx.filter({ hasText: '遠い昔……' }).click();
  await expect(page.locator('.original-text')).toHaveText('遠い昔……');
  await expect(page).toHaveURL(/entry=/);
});
