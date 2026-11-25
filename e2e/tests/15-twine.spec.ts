import { unzipSync, zipSync } from 'fflate';
import { TestUser, btn, createUser, expect, openEditor, parseJobsDrawer, test, toast, useAs } from './helpers';

test.describe.configure({ mode: 'serial' });

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** 合成的 SugarCube 故事：自定义 <<say>> / <<but>> 宏 + 内置链接 */
function storyHtml() {
  const passages = [
    {
      name: 'Start',
      text: [
        'You arrive at the monastery gate.',
        'Welcome, <<print $name>>. The night is cold.',
        '<<say ab "Brother, you came at last.">>',
        '<<say ab "Please, follow me inside.">>',
        '<<say mc "Lead the way.">>',
        '<<but "Enter the hall" Hall>>',
        '<<but "Look around first" Yard>>',
        '<<but "Wait at the gate" Start>>',
        '[[Read the notice|Notice]]',
        '<<met "Abbot Joseph">><<met "Sister Agnes">>',
        '<<if $metList.includes("Abbot Joseph")>>You know him.<</if>>',
        '<<chat "Hello.///He nods.|Come in, quickly.">>',
        '<<chat "Is it late?///She yawns.|It is.">>',
      ].join('\n'),
    },
    { name: 'Hall', text: 'A long, quiet hall.' },
    {
      name: 'Widgets',
      tags: 'widget',
      text: [
        '<<widget say>><<print _args[1]>><</widget>>',
        '<<widget but>><<link _args[0] _args[1]>><</link>><</widget>>',
        '<<widget "met">><<set $metList.pushUnique(_args[0])>><</widget>>',
        '<<widget "chat">><<for _l range _args[0].split("|")>><<print _l.split("///")[0]>><</for>><</widget>>',
      ].join('\n'),
    },
  ];
  return Buffer.from(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Gate</title></head><body>` +
      `<tw-storydata name="Gate" startnode="1" creator="Tweego" ifid="E2E" format="SugarCube" format-version="2.36.1" options="" hidden>` +
      `<script role="script" id="twine-user-script" type="text/twine-javascript">setup.motto = "Ora et labora";</script>` +
      passages.map((p, i) => `<tw-passagedata pid="${i + 1}" name="${p.name}" tags="${p.tags ?? ''}">${esc(p.text)}</tw-passagedata>`).join('') +
      `</tw-storydata></body></html>`,
  );
}

let owner: TestUser;
let pid = '';

test.beforeAll(async () => {
  owner = await createUser('twin', 'Twine 译者');
  const project = await owner.api.ok('POST', '/projects', { name: 'Twine 测试', engine: 'TWINE', sourceLang: 'en', targetLang: 'zh-CN', visibility: 'PRIVATE' });
  pid = project.id;
});

test('上传 zip：只解析故事 HTML，其他 HTML 记为跳过', async () => {
  const zip = Buffer.from(
    zipSync({
      'Gate/index.html': new Uint8Array(storyHtml()),
      'Gate/credits.html': new TextEncoder().encode('<html><body>Credits</body></html>'),
      'Gate/img/gate.png': new Uint8Array([137, 80, 78, 71]),
    }),
  );
  const job = await owner.api.upload(pid, [{ name: 'gate.zip', buffer: zip }]);
  expect(job.result.files.map((f: { path: string }) => f.path)).toEqual(['Gate/index.html']);
  expect(job.result.skipped).toEqual([{ name: 'Gate/credits.html', code: 'TWINE_NOT_STORY' }]);
  // 还没有宏规则：自定义宏的台词不提取，内置链接与正文提取
  await owner.api.findEntry(pid, 'You arrive at the monastery gate.');
  await owner.api.findEntry(pid, 'Read the notice');
  const r = await owner.api.call('GET', `/projects/${pid}/entries?q=${encodeURIComponent('Brother')}&field=original`);
  expect(r.data.items).toHaveLength(0);
});

test('上传后提示待确认的自定义宏；按定义判断用途，确认后保存并重新提取', async ({ page }) => {
  await useAs(page, owner);
  await page.goto(`/projects/${pid}/files`);
  const banner = page.locator('.twine-pending');
  await expect(banner).toContainText('发现 3 个自定义宏可能含有要翻译的文字');
  await btn(banner, '去确认').click();
  await expect(page).toHaveURL(new RegExp(`/projects/${pid}/settings#twine-rules`));

  const card = page.locator('#twine-rules');
  const item = (name: string) => card.locator(`.twine-macro[data-macro="${name}"]`);
  await expect(card.getByText('待确认 3')).toBeVisible();
  // <<say>>：参数 1 被输出（显示文字），参数 0 是说话人代号
  await expect(item('say')).toContainText('按定义判断');
  await expect(item('say').locator('.twine-arg').nth(1)).toContainText('显示文字');
  await expect(item('say').locator('.twine-arg').nth(1)).toContainText('输出：');
  await expect(item('say').getByLabel('say #0').getByText('说话人')).toBeVisible();
  // <<but>>：参数 1 是段落名
  await expect(item('but').locator('.twine-arg').nth(1)).toContainText('逻辑值');
  await expect(item('but').locator('.twine-arg').nth(1)).toContainText('作为段落名');
  // <<chat>>：按 split() 拆分
  await expect(item('chat')).toContainText('按 “///” “|” 拆成多条词条');
  await expect(item('chat')).toContainText('将提取 6 条');
  // <<met>>：存入的变量在别处按字符串查找，是逻辑值，不推荐
  await card.getByText(/^全部 \d+$/).click();
  await expect(item('met')).toContainText('逻辑值');
  await expect(item('met')).toContainText('存入变量，变量在别处按字符串查找');
  await expect(card).toContainText(/保存后共 \d+ 条词条（新增 12 条，移除 0 条）/);

  await btn(card, '保存并重新提取').click();
  await expect(toast(page, '宏规则已保存，已开始重新提取')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/projects/${pid}/files`));
  const drawer = await parseJobsDrawer(page);
  await expect(drawer.locator('.job-result').first()).toContainText(/新增|更新/, { timeout: 30_000 });
  await expect(page.locator('.twine-pending')).toHaveCount(0);

  const rules = await owner.api.ok('GET', `/projects/${pid}/twine/rules`);
  expect(rules.macros).toEqual(
    expect.arrayContaining([
      { name: 'but', args: [0] },
      { name: 'say', args: [1], speaker: 0 },
      { name: 'chat', args: [0], split: ['///', '|'] },
    ]),
  );
  // 没有选择翻译的宏记为「不翻译」，以后不再提示
  expect(rules.ignored).toEqual(['met']);
  await owner.api.findEntry(pid, 'Brother, you came at last.');
  await owner.api.findEntry(pid, 'Enter the hall');
  await owner.api.findEntry(pid, 'He nods.');
  await owner.api.findEntry(pid, 'Come in, quickly.');
  const met = await owner.api.call('GET', `/projects/${pid}/entries?q=${encodeURIComponent('Abbot Joseph')}&field=original`);
  expect(met.data.items).toHaveLength(0);
});

test('编辑器高亮宏、显示说话人，漏掉宏时提示', async ({ page }) => {
  await useAs(page, owner);
  const e = await owner.api.findEntry(pid, 'Welcome, <<print $name>>. The night is cold.');
  await openEditor(page, pid, `entry=${e.id}`);
  await expect(page.locator('.hl-code').filter({ hasText: '<<print $name>>' }).first()).toBeVisible();
  await page.locator('.translation-input').fill('欢迎。夜里很冷。');
  await expect(page.getByText('译文缺少控制符：<<print $name>>')).toBeVisible();
  await page.locator('.translation-input').fill('欢迎，<<print $name>>。夜里很冷。');
  await expect(page.getByText('译文缺少控制符')).toHaveCount(0);

  // 整段视图：同一段落的词条，带说话人
  const scene = await owner.api.ok('GET', `/projects/${pid}/entries/${e.id}/scene`);
  expect(scene.scene.title).toContain('段落「Start」');
  const say = scene.items.find((x: { original: string }) => x.original === 'Brother, you came at last.');
  expect(say.speaker).toEqual({ name: 'ab' });
});

test('导出：写回译文，链接目标与宏结构不变', async () => {
  await owner.api.translate(pid, 'You arrive at the monastery gate.', '你来到修道院门口。');
  await owner.api.translate(pid, 'Brother, you came at last.', '兄弟，你"终于"来了。');
  await owner.api.translate(pid, 'Read the notice', '阅读告示');
  // 漏掉宏的译文在严格模式下被拒绝
  const welcome = await owner.api.findEntry(pid, 'Welcome, <<print $name>>. The night is cold.');
  const strict = await owner.api.ok('POST', `/projects/${pid}/entries/bulk-save`, { strict: true, items: [{ id: welcome.id, translation: '欢迎。', version: welcome.version }] });
  expect(strict.results[0].status).toBe('rejected');

  const job = await owner.api.ok('POST', `/projects/${pid}/exports`, { stages: ['TRANSLATED', 'REVIEWED'] });
  await owner.api.waitJob(pid, job.id);
  const res = await owner.api.ctx.get(`/api/projects/${pid}/exports/${job.id}/download`);
  expect(res.status()).toBe(200);
  const zip = unzipSync(new Uint8Array(await res.body()));
  const html = new TextDecoder().decode(zip['Gate/index.html']);
  expect(html).toContain('你来到修道院门口。');
  expect(html).toContain('&lt;&lt;say ab &quot;兄弟，你\\&quot;终于\\&quot;来了。&quot;&gt;&gt;');
  expect(html).toContain('[[阅读告示|Notice]]');
  expect(html).toContain('setup.motto = "Ora et labora";');
});
