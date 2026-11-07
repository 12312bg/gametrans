import { ADMIN, btn, createUser, expect, loginUI, test, toast, uid } from './helpers';

test.describe('账号', () => {
  test('注册：表单校验、重复用户名、成功后自动登录', async ({ page }) => {
    const existing = await createUser('dup');
    const username = uid('reg');
    await page.goto('/register');
    await page.getByPlaceholder('用户名（登录用，不可修改）').fill('a');
    await page.getByPlaceholder('邮箱').fill('not-an-email');
    await page.getByPlaceholder('密码（至少 8 位）').fill('short');
    await page.getByPlaceholder('确认密码').fill('other');
    await btn(page, '注册').click();
    await expect(page.getByText('3-32 位字母、数字、下划线、连字符或点')).toBeVisible();
    await expect(page.getByText('请输入有效邮箱')).toBeVisible();
    await expect(page.getByText('密码长度为 8-72 位')).toBeVisible();
    await expect(page.getByText('两次输入的密码不一致')).toBeVisible();

    // 服务端校验：用户名已被占用
    await page.getByPlaceholder('用户名（登录用，不可修改）').fill(existing.username);
    await page.getByPlaceholder('邮箱').fill(`${username}@e2e.test`);
    await page.getByPlaceholder('密码（至少 8 位）').fill('password123');
    await page.getByPlaceholder('确认密码').fill('password123');
    await btn(page, '注册').click();
    await expect(toast(page, '该用户名已被占用')).toBeVisible();

    await page.getByPlaceholder('用户名（登录用，不可修改）').fill(username);
    await page.getByPlaceholder('昵称（可选）').fill('新来的译者');
    await btn(page, '注册').click();
    await expect(toast(page, '注册成功')).toBeVisible();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { name: 'RPG Maker 游戏本地化协作平台' })).toBeVisible();
    await expect(page.getByText('你还没有参与任何项目')).toBeVisible();
  });

  test('登录 / 退出 / 错误密码 / 登录后回跳', async ({ page }) => {
    const u = await createUser('login', '登录测试');
    await page.goto('/login');
    await page.getByPlaceholder('用户名 / 邮箱').fill(u.username);
    await page.getByPlaceholder('密码').fill('wrong-password');
    await btn(page, '登录').click();
    await expect(toast(page, '用户名或密码错误')).toBeVisible();

    await page.getByPlaceholder('用户名 / 邮箱').fill(`${u.username}@e2e.test`);
    await page.getByPlaceholder('密码').fill(u.password);
    await btn(page, '登录').click();
    await expect(toast(page, '欢迎回来')).toBeVisible();

    await page.locator('.header-user').click();
    await page.getByRole('menuitem', { name: /退出登录/ }).click();
    await expect(btn(page, '登录')).toBeVisible();

    // 未登录访问需要登录的页面 → 跳到登录页，登录后回到原页面
    await page.goto('/projects/new');
    await expect(page).toHaveURL(/\/login\?next=%2Fprojects%2Fnew/);
    await page.getByPlaceholder('用户名 / 邮箱').fill(u.username);
    await page.getByPlaceholder('密码').fill(u.password);
    await btn(page, '登录').click();
    await expect(page).toHaveURL('/projects/new');
    await expect(page.getByRole('heading', { name: '新建翻译项目' })).toBeVisible();
  });

  test('普通用户没有管理后台入口，超级管理员有', async ({ page }) => {
    const u = await createUser('plain');
    await loginUI(page, u.username, u.password);
    await page.locator('.header-user').click();
    await expect(page.getByRole('menuitem', { name: /个人中心/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /管理后台/ })).toHaveCount(0);
    await page.goto('/admin');
    await expect(page).toHaveURL('/');

    await page.context().clearCookies();
    await loginUI(page, ADMIN.username, ADMIN.password);
    await page.locator('.header-user').click();
    await page.getByRole('menuitem', { name: /管理后台/ }).click();
    await expect(page.getByRole('heading', { name: '管理后台' })).toBeVisible();
  });
});
