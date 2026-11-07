import { ADMIN, TestUser, addMember, adminUser, btn, confirmDialog, createUser, expect, loginApi, pageAs, pickOption, seedProject, test, toast, uid, useAs } from './helpers';

test.describe.configure({ mode: 'serial' });

let owner: TestUser;
let admin2: TestUser;
let member: TestUser;
let outsider: TestUser;
let pid = '';
const newName = uid('改名后的项目');

test.beforeAll(async () => {
  owner = await createUser('sown', '原所有者');
  admin2 = await createUser('sadm', '副管理员');
  member = await createUser('smem', '普通成员');
  outsider = await createUser('sout', '路人');
  pid = (await seedProject(owner, { files: [] })).id;
  await addMember(owner, pid, admin2, 'ADMIN');
  await addMember(owner, pid, member, 'TRANSLATOR');
});

test('项目设置：改名、设为私有后非成员不可见', async ({ page, browser, errors }) => {
  await useAs(page, owner);
  await page.goto(`/projects/${pid}/settings`);
  await page.getByLabel('项目名称').fill(newName);
  await page.getByRole('radio', { name: '私有' }).check();
  await btn(page, '保存').click();
  await expect(toast(page, '设置已保存')).toBeVisible();
  await expect(page.locator('.project-title')).toHaveText(newName);
  await expect(page.locator('.project-meta')).toContainText('私有');

  const op = await pageAs(browser, outsider, errors);
  await op.goto(`/projects/${pid}`);
  await expect(op.getByText('项目不存在或无权访问')).toBeVisible();
  const pub = await outsider.api.ok('GET', `/projects?scope=public&q=${encodeURIComponent(newName)}`);
  expect(pub.total).toBe(0);
  await op.context().close();

  const mp = await pageAs(browser, member, errors);
  await mp.goto('/');
  await expect(mp.locator('.project-card').filter({ hasText: newName })).toBeVisible();
  await mp.context().close();
});

test('管理员不能管理同级成员，不能授予管理员角色', async ({ page }) => {
  await useAs(page, admin2);
  await page.goto(`/projects/${pid}/members`);
  const ownerRow = page.getByRole('row').filter({ hasText: owner.displayName });
  await expect(ownerRow.locator('.ant-select')).toHaveCount(0);
  const memberRow = page.getByRole('row').filter({ hasText: member.displayName });
  await memberRow.locator('.ant-select').click();
  const options = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option');
  await expect(options).toHaveText(['审核员', '翻译员', '访客']);
  await page.keyboard.press('Escape');
  // 服务端同样拒绝
  const r = await admin2.api.call('PATCH', `/projects/${pid}/members/${(await member.api.ok('GET', '/auth/me')).id}`, { role: 'ADMIN' });
  expect(r.status).toBe(403);
  // 管理员看不到危险操作
  await page.goto(`/projects/${pid}/settings`);
  await expect(page.getByText('危险操作')).toHaveCount(0);
});

test('成员退出项目', async ({ page }) => {
  await useAs(page, member);
  await page.goto(`/projects/${pid}/members`);
  await page.getByRole('row').filter({ hasText: member.displayName }).getByRole('button', { name: /退出/ }).click();
  await btn(page.locator('.ant-popconfirm'), '退出').click();
  await expect(toast(page, '已退出项目')).toBeVisible();
  await expect(page).toHaveURL('/');
  await expect(page.locator('.project-card').filter({ hasText: newName })).toHaveCount(0);
});

test('转让项目，新所有者删除项目', async ({ page, browser, errors }) => {
  await useAs(page, owner);
  await page.goto(`/projects/${pid}/settings`);
  await btn(page, '转让').click();
  const dlg = page.getByRole('dialog');
  await dlg.locator('.ant-select').click();
  await pickOption(page, admin2.displayName);
  await btn(dlg, '确定').click();
  await btn(confirmDialog(page), '确定').click();
  await expect(toast(page, '项目已转让')).toBeVisible();
  await expect(page.locator('.project-actions')).toContainText('管理员');
  await expect(page.getByText('危险操作')).toHaveCount(0);

  const np = await pageAs(browser, admin2, errors);
  await np.goto(`/projects/${pid}/settings`);
  await expect(np.locator('.project-actions')).toContainText('所有者');
  await btn(np, '删除项目').click();
  const del = np.getByRole('dialog');
  await expect(btn(del, '永久删除')).toBeDisabled();
  await del.locator('input').fill(newName);
  await btn(del, '永久删除').click();
  await expect(toast(np, '项目已删除')).toBeVisible();
  await expect(np).toHaveURL('/');
  expect((await admin2.api.call('GET', `/projects/${pid}`)).status).toBe(404);
  await np.context().close();
});

test('管理后台：封禁 / 解封、重置密码、授予超级管理员', async ({ page, browser, errors }) => {
  const victim = await createUser('vict', '被管理的用户');
  const vp = await pageAs(browser, victim, errors);
  await vp.goto('/');
  await expect(vp.locator('.header-user')).toBeVisible();

  const adm = await adminUser();
  await useAs(page, adm);
  await page.goto('/admin');
  await page.getByPlaceholder('搜索用户名 / 邮箱 / 昵称').fill(victim.username);
  await page.getByPlaceholder('搜索用户名 / 邮箱 / 昵称').press('Enter');
  const row = page.getByRole('row').filter({ hasText: victim.username });
  await expect(row).toContainText('正常');
  await row.getByRole('button', { name: /封禁/ }).click();
  await expect(row).toContainText('已封禁');

  // 已登录的会话立即失效，且无法再次登录
  await vp.reload();
  await expect(btn(vp, '登录')).toBeVisible();
  const r = await (await createUser('tmp')).api.call('POST', '/auth/login', { login: victim.username, password: victim.password });
  expect(r.status).toBe(403);
  expect(r.data.message).toBe('该账号已被封禁');

  await row.getByRole('button', { name: /解封/ }).click();
  await expect(row).toContainText('正常');
  await row.getByRole('button', { name: /重置密码/ }).click();
  await page.getByRole('dialog').getByPlaceholder('新密码（至少 8 位）').fill('newpassword456');
  await btn(page.getByRole('dialog'), '确定').click();
  await expect(toast(page, `已重置 ${victim.username} 的密码`)).toBeVisible();
  expect((await (await createUser('tmp')).api.call('POST', '/auth/login', { login: victim.username, password: victim.password })).status).toBe(401);
  const relogged = await loginApi(victim.username, 'newpassword456');

  await row.getByRole('switch').click();
  await expect(row.getByRole('switch')).toBeChecked();
  const vp2 = await pageAs(browser, relogged, errors);
  await vp2.goto('/');
  await vp2.locator('.header-user').click();
  await expect(vp2.getByRole('menuitem', { name: /管理后台/ })).toBeVisible();
  // 自己不能取消自己的超级管理员
  const selfRow = page.getByRole('row').filter({ hasText: `@${ADMIN.username} ·` });
  await page.getByPlaceholder('搜索用户名 / 邮箱 / 昵称').fill(ADMIN.username);
  await page.getByPlaceholder('搜索用户名 / 邮箱 / 昵称').press('Enter');
  await expect(selfRow.getByRole('switch')).toBeDisabled();
  await vp.context().close();
  await vp2.context().close();
});

test('超级管理员可查看并进入全部项目（含私有）', async ({ page }) => {
  const other = await createUser('priv');
  const name = uid('别人的私有项目');
  const p = await seedProject(other, { name, visibility: 'PRIVATE', files: [] });
  await useAs(page, await adminUser());
  await page.goto('/?scope=all');
  await page.locator('.project-card').filter({ hasText: name }).click();
  await expect(page).toHaveURL(`/projects/${p.id}`);
  await expect(page.getByText('（超级管理员视角）')).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /设置/ })).toBeVisible();
});
