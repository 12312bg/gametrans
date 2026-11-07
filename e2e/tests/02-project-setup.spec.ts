import { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIX, TestUser, btn, createUser, expect, loginUI, mzZip, pageAs, pickOption, test, toast, uid } from './helpers';

test.describe.configure({ mode: 'serial' });

let owner: TestUser;
let applicant: TestUser;
let reviewer: TestUser;
let pid = '';
const projectName = uid('星之物语 汉化');

test.beforeAll(async () => {
  owner = await createUser('owner', '项目发起人');
  applicant = await createUser('appl', '申请者');
  reviewer = await createUser('revw', '审核者');
});

async function asOwner(page: Page) {
  await loginUI(page, owner.username, owner.password);
}

test('通过界面创建 MZ 项目', async ({ page }) => {
  await asOwner(page);
  await btn(page, '新建项目').first().click();
  await expect(page).toHaveURL('/projects/new');
  await page.getByLabel('项目名称').fill(projectName);
  await page.locator('.engine-option b', { hasText: /^MZ$/ }).click();
  await page.getByLabel('项目简介').fill('欢迎加入翻译！\n请遵守术语表。');
  await btn(page, '创建项目').click();
  await expect(toast(page, '项目已创建')).toBeVisible();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/files$/);
  pid = page.url().split('/projects/')[1].split('/')[0];
  await expect(page.locator('.project-title')).toHaveText(projectName);
  await expect(page.locator('.project-meta')).toContainText('RM MZ');
  await expect(page.locator('.project-meta')).toContainText('日语');
  await expect(page.locator('.project-meta')).toContainText('简体中文');
  await expect(page.locator('.project-actions')).toContainText('所有者');
});

test('上传游戏目录 zip，后台解析后展示文件与进度', async ({ page }) => {
  await asOwner(page);
  await page.goto(`/projects/${pid}/files`);
  await page.locator('.ant-upload-drag input[type=file]').setInputFiles({ name: 'MyGame.zip', mimeType: 'application/zip', buffer: mzZip() });
  await expect(page.locator('.pending-head')).toContainText('待上传 1 个文件');
  await btn(page, '开始上传').click();
  await expect(toast(page, '上传完成，正在后台解析')).toBeVisible();
  const job = page.locator('.job-result').first();
  await expect(job).toContainText('新增文件 7', { timeout: 30_000 });
  // zip 中的图片、插件源码不是数据文件，解压时直接忽略
  await expect(job).not.toContainText('失败');
  for (const path of ['data/Map001.json', 'data/System.json', 'js/plugins.js']) {
    await expect(page.getByRole('row').filter({ hasText: path })).toBeVisible();
  }
  await expect(page.getByText('文件（7）')).toBeVisible();

  // 再次上传内容相同的单个文件 → 未变化
  const items = readFileSync(join(FIX, 'mz', 'Items.json'));
  await page.locator('.ant-upload-drag input[type=file]').setInputFiles({ name: 'Items.json', mimeType: 'application/json', buffer: items });
  await btn(page, '开始上传').click();
  await expect(page.locator('.job-result').first()).toContainText('未变化 1', { timeout: 30_000 });
});

test('概览页：统计、进度与隐藏提示', async ({ page }) => {
  await asOwner(page);
  await page.goto(`/projects/${pid}`);
  await expect(page.locator('.ant-statistic').filter({ hasText: '词条总数' })).toContainText('32');
  await expect(page.getByText('另有 11 条已隐藏词条', { exact: false })).toBeVisible();
  await expect(page.getByText('欢迎加入翻译！')).toBeVisible();
  await expect(page.locator('.category-bar').filter({ hasText: '对话' })).toContainText('5');
  await expect(page.locator('.activity-item').first()).toContainText('上传文件');
  // 分类条可跳到编辑器筛选
  await page.locator('.category-bar').filter({ hasText: '选项' }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${pid}/editor\\?category=choice`));
  await expect(page.locator('.list-head')).toContainText('共 2 条');
});

test('未登录访客：可浏览公开项目但只读', async ({ browser, errors }) => {
  const page = await pageAs(browser, null, errors);
  await page.goto(`/projects/${pid}`);
  await expect(btn(page, '登录后申请加入')).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /设置/ })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: /导出/ })).toHaveCount(0);
  await page.getByRole('menuitem', { name: /翻译/ }).click();
  await expect(page.locator('.translation-input')).toBeDisabled();
  await expect(page.getByText('你没有翻译权限，只能浏览').first()).toBeVisible();
  await page.goto(`/projects/${pid}/files`);
  await expect(page.locator('.ant-upload-drag')).toHaveCount(0);
  await page.context().close();
});

test('申请加入 → 管理员批准为翻译员', async ({ browser, page, errors }) => {
  const ap = await pageAs(browser, applicant, errors);
  await ap.goto('/?scope=public');
  await ap.getByText(projectName).click();
  await btn(ap, '申请加入').click();
  await ap.getByRole('dialog').locator('textarea').fill('我有三年日译中经验');
  await btn(ap, '提交申请').click();
  await expect(toast(ap, '申请已提交')).toBeVisible();
  await expect(ap.getByText('已申请，等待审批')).toBeVisible();

  await asOwner(page);
  await page.goto(`/projects/${pid}/members`);
  await expect(page.locator('.project-menu .ant-badge')).toContainText('1');
  await page.getByRole('tab', { name: /加入申请/ }).click();
  const item = page.locator('.ant-list-item').filter({ hasText: applicant.displayName });
  await expect(item).toContainText('我有三年日译中经验');
  await btn(item, '批准').click();
  await expect(toast(page, '已批准')).toBeVisible();
  await page.getByRole('tab', { name: '成员列表' }).click();
  await expect(page.getByRole('row').filter({ hasText: applicant.displayName })).toContainText('翻译员');

  await ap.reload();
  await expect(ap.locator('.project-actions')).toContainText('翻译员');
  await ap.context().close();
});

test('邀请成员 → 对方在个人中心接受', async ({ browser, page, errors }) => {
  await asOwner(page);
  await page.goto(`/projects/${pid}/members`);
  await btn(page, '邀请成员').click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('.ant-select').first().click();
  await page.keyboard.type(reviewer.username);
  await pickOption(page, `@${reviewer.username}`);
  await dialog.locator('.ant-select').nth(1).click();
  await pickOption(page, '审核员');
  await btn(dialog, '发送邀请').click();
  await expect(toast(page, '邀请已发送')).toBeVisible();
  await page.getByRole('tab', { name: /已发出的邀请/ }).click();
  await expect(page.locator('.ant-list-item').filter({ hasText: reviewer.displayName })).toContainText('审核员');

  const rp = await pageAs(browser, reviewer, errors);
  await rp.goto('/');
  await expect(rp.locator('.app-header .ant-badge')).toContainText('1');
  await rp.locator('.app-header').getByRole('button', { name: 'mail' }).click();
  await expect(rp).toHaveURL(/\/me\?tab=invitations/);
  const inv = rp.locator('.ant-list-item').filter({ hasText: projectName });
  await expect(inv).toContainText('审核员');
  await btn(inv, '接受').click();
  await expect(toast(rp, '已加入项目')).toBeVisible();
  await expect(rp).toHaveURL(`/projects/${pid}`);
  await expect(rp.locator('.project-actions')).toContainText('审核员');
  await rp.context().close();
});

test('调整成员角色：翻译员 → 访客后不能翻译', async ({ browser, page, errors }) => {
  await asOwner(page);
  await page.goto(`/projects/${pid}/members`);
  const row = page.getByRole('row').filter({ hasText: applicant.displayName });
  await row.locator('.ant-select').click();
  await pickOption(page, '访客');
  await expect(toast(page, '角色已更新')).toBeVisible();

  const ap = await pageAs(browser, applicant, errors);
  await ap.goto(`/projects/${pid}/editor`);
  await expect(ap.locator('.translation-input')).toBeDisabled();
  await expect(ap.getByRole('menuitem', { name: /导出/ })).toBeVisible();

  await row.locator('.ant-select').click();
  await pickOption(page, '翻译员');
  await expect(toast(page, '角色已更新')).toBeVisible();
  await ap.reload();
  await expect(ap.locator('.translation-input')).toBeEnabled();
  await ap.context().close();
});
