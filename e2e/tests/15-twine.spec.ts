import { unzipSync, zipSync } from 'fflate';
import { TestUser, btn, confirmDialog, createUser, expect, openEditor, parseJobsDrawer, test, toast, useAs } from './helpers';

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
      ].join('\n'),
    },
    { name: 'Hall', text: 'A long, quiet hall.' },
    { name: 'Widgets', tags: 'widget', text: '<<widget say>><<print _args[1]>><</widget>>\n<<widget but>><<link _args[0] _args[1]>><</link>><</widget>>' },
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

test('设置页分析自定义宏、采用推荐并重新提取', async ({ page }) => {
  await useAs(page, owner);
  await page.goto(`/projects/${pid}/settings`);
  const card = page.locator('.ant-card').filter({ hasText: 'Twine 宏规则' });
  await expect(card).toContainText('还没有自定义规则');
  await expect(card).toContainText('<<link>>');
  await btn(card, '分析故事').click();
  await expect(card).toContainText('分析了 1 个文件中的 2 个自定义宏，其中 2 个像是带显示文字');
  const sayRow = card.locator('.twine-analysis .ant-table-row').filter({ hasText: '<<say>>' });
  await expect(sayRow).toContainText('已定义');
  await expect(sayRow).toContainText('文字参数 1 · 说话人 0');
  await btn(card, '采用全部推荐').click();
  await expect(card.getByLabel('宏', { exact: true })).toHaveCount(2);
  await btn(card, '保存').click();
  const dlg = confirmDialog(page);
  await expect(dlg).toContainText('宏规则已保存');
  await btn(dlg, '重新提取').click();
  await expect(toast(page, '已开始重新提取')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/projects/${pid}/files`));
  const drawer = await parseJobsDrawer(page);
  await expect(drawer.locator('.job-result').first()).toContainText(/新增|更新/, { timeout: 30_000 });

  const rules = await owner.api.ok('GET', `/projects/${pid}/twine/rules`);
  expect(rules.macros).toEqual([
    { name: 'but', args: [0] },
    { name: 'say', args: [1], speaker: 0 },
  ]);
  await owner.api.findEntry(pid, 'Brother, you came at last.');
  await owner.api.findEntry(pid, 'Enter the hall');
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
