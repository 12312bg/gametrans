import { devices } from '@playwright/test';
import { activeItem, btn, createUser, expect, loginApi, openEditor, pageAs, pickOption, seedProject, test, textarea, toast, uid, useAs } from './helpers';

test('深色模式切换并在刷新后保持', async ({ page }) => {
  await page.goto('/');
  const html = page.locator('html');
  const initial = await html.getAttribute('data-theme');
  await page.locator('.app-header').getByRole('button', { name: initial === 'dark' ? 'sun' : 'moon' }).click();
  const flipped = initial === 'dark' ? 'light' : 'dark';
  await expect(html).toHaveAttribute('data-theme', flipped);
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', flipped);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe(flipped === 'dark' ? 'rgb(15, 17, 23)' : 'rgb(245, 246, 250)');
});

test('404 页面与不存在的项目', async ({ page }) => {
  await page.goto('/no/such/page');
  await expect(page.getByText('页面不存在', { exact: true })).toBeVisible();
  await btn(page, '返回首页').click();
  await expect(page).toHaveURL('/');
  await page.goto('/projects/not-a-real-id');
  await expect(page.getByText('项目不存在或无权访问')).toBeVisible();
});

test('首页搜索与引擎筛选', async ({ page }) => {
  const u = await createUser('home');
  const tag = uid('筛选');
  await seedProject(u, { name: `${tag} 甲`, engine: 'RMMV', files: [] });
  await seedProject(u, { name: `${tag} 乙`, engine: 'RMXP', files: [] });
  await useAs(page, u);
  await page.goto('/');
  await expect(page.locator('.project-card')).toHaveCount(2);
  await page.getByPlaceholder('搜索项目名称或简介').fill(`${tag} 乙`);
  await page.getByPlaceholder('搜索项目名称或简介').press('Enter');
  await expect(page.locator('.project-card')).toHaveCount(1);
  await expect(page.locator('.project-card')).toContainText('RM XP');
  await page.getByPlaceholder('搜索项目名称或简介').fill(tag);
  await page.getByPlaceholder('搜索项目名称或简介').press('Enter');
  await expect(page.locator('.project-card')).toHaveCount(2);
  await page.locator('.toolbar .ant-select').click();
  await page.locator('.ant-select-item-option').filter({ hasText: 'RPG Maker MV' }).click();
  await expect(page.locator('.project-card')).toHaveCount(1);
  await expect(page.locator('.project-card')).toContainText(`${tag} 甲`);
  await expect(page).toHaveURL(/engine=RMMV/);
});

test('个人中心：修改资料与密码', async ({ page }) => {
  const u = await createUser('prof', '旧昵称');
  await useAs(page, u);
  await page.goto('/me?tab=profile');
  await page.getByLabel('昵称').fill('新昵称');
  await page.getByLabel('个人简介').fill('喜欢 RPG');
  await btn(page, '保存').click();
  await expect(toast(page, '资料已更新')).toBeVisible();
  await expect(page.locator('.profile-head')).toContainText('新昵称');

  await page.getByRole('tab', { name: '修改密码' }).click();
  await page.getByLabel('原密码').fill('wrong-old-password');
  await page.getByLabel('新密码').fill('another-password');
  await btn(page, '修改密码').click();
  await expect(toast(page, '原密码不正确')).toBeVisible();
  await page.getByLabel('原密码').fill(u.password);
  await btn(page, '修改密码').click();
  await expect(toast(page, '密码已修改')).toBeVisible();
  await loginApi(u.username, 'another-password');
});

test('手机宽度：首页与翻译编辑器无横向滚动且可用', async ({ browser, errors }) => {
  const u = await createUser('mobi');
  const p = await seedProject(u);
  const page = await pageAs(browser, u, errors, { ...devices['iPhone 13'] });
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await page.goto('/');
  await expect(page.locator('.project-card').first()).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
  await openEditor(page, p.id, 'category=dialogue');
  await expect(page.locator('.editor-list')).toBeVisible();
  await expect(textarea(page)).toBeVisible();
  await textarea(page).fill('手机上的译文');
  await btn(page, '保存').click();
  await expect(page.locator('.entry-item.active .entry-item-dst')).toHaveText('手机上的译文');
  expect(await overflow()).toBeLessThanOrEqual(0);
  for (const tab of ['files', 'terms', 'members', 'exports', 'activity', 'settings']) {
    await page.goto(`/projects/${p.id}/${tab}`);
    await page.waitForLoadState('networkidle');
    expect(await overflow(), `${tab} 页面横向溢出`).toBeLessThanOrEqual(0);
  }
  await page.context().close();
});

test('所有项目页面都能正常打开（无 JS 错误）', async ({ page }) => {
  const u = await createUser('tour');
  const p = await seedProject(u);
  await useAs(page, u);
  for (const tab of ['', 'editor', 'files', 'terms', 'members', 'exports', 'activity', 'settings']) {
    await page.goto(`/projects/${p.id}${tab ? `/${tab}` : ''}`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.project-title')).toBeVisible();
    await expect(page.locator('.ant-result-error')).toHaveCount(0);
  }
  await page.goto('/me');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('tab', { name: /项目邀请/ })).toBeVisible();
});

test('翻译页切换每页条数：保持当前词条，刷新后仍生效', async ({ page }) => {
  const u = await createUser('size');
  const p = await seedProject(u);
  await useAs(page, u);
  await openEditor(page, p.id);
  const items = page.locator('.entry-item');
  await expect(page.locator('.list-head')).toContainText('共 32 条');
  await expect(items).toHaveCount(32);

  await items.filter({ hasText: '#25' }).click();
  const original = await page.locator('.original-text').innerText();
  await page.locator('.list-foot .ant-pagination-options .ant-select').click();
  await pickOption(page, '20 条/页');
  // 第 25 条在每页 20 条时位于第 2 页
  await expect(items).toHaveCount(12);
  await expect(activeItem(page)).toContainText('#25');
  await expect(page.locator('.original-text')).toHaveText(original);
  await expect(page).toHaveURL(/size=20/);

  // 记住选择：不带参数重新打开仍是每页 20 条
  await openEditor(page, p.id);
  await expect(items).toHaveCount(20);
  await page.locator('.list-foot .ant-pagination-next').click();
  await expect(items).toHaveCount(12);
  await expect(activeItem(page)).toContainText('#21');
});
