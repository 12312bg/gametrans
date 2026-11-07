import { extractEntries } from '@gametrans/rpgmaker';
import { unzipSync, zipSync } from 'fflate';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FIX,
  TestUser,
  btn,
  createUser,
  label,
  expect,
  openEditor,
  rgssFile,
  seedProject,
  stageTag,
  test,
  textarea,
  toast,
  useAs,
} from './helpers';

test.describe.configure({ mode: 'serial' });

let owner: TestUser;
let acePid = '';

function hasRuby(): boolean {
  try {
    execFileSync('ruby', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

test.beforeAll(async () => {
  owner = await createUser('rgss', 'RGSS 管理员');
  acePid = (await seedProject(owner, { engine: 'RMVXACE', files: [] })).id;
});

test('VX Ace：选择游戏文件夹上传，自动过滤非数据文件', async ({ page }) => {
  // 注意：用例输出目录名含中文，Chromium 对非 ASCII 路径的目录上传会卡住，因此放在 ASCII 路径下
  const dir = join(__dirname, '../.tmp/fixtures', `ace-game-${Date.now()}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'Game/Data'), { recursive: true });
  mkdirSync(join(dir, 'Game/Graphics/Pictures'), { recursive: true });
  for (const n of ['Map001', 'Scripts', 'System', 'Actors', 'CommonEvents']) {
    writeFileSync(join(dir, `Game/Data/${n}.rvdata2`), rgssFile(`${n}.rvdata2`));
  }
  writeFileSync(join(dir, 'Game/Game.ini'), '[Game]\nTitle=Test\n');
  writeFileSync(join(dir, 'Game/Graphics/Pictures/a.png'), Buffer.from([137, 80, 78, 71]));

  await useAs(page, owner);
  await page.goto(`/projects/${acePid}/files`);
  await expect(page.locator('.ant-upload-hint')).toContainText('.rvdata2');
  await page.locator('input[webkitdirectory]').setInputFiles(dir);
  await expect(toast(page, '已忽略 2 个不支持的文件')).toBeVisible();
  await expect(page.locator('.pending-head')).toContainText('待上传 5 个文件');
  await btn(page, '开始上传').click();
  await expect(page.locator('.job-result').first()).toContainText('新增文件 5', { timeout: 30_000 });
  for (const n of ['Map001', 'Scripts', 'System']) {
    await expect(page.getByRole('row').filter({ hasText: `Data/${n}.rvdata2` })).toBeVisible();
  }
});

test('VX Ace：放出脚本文本并翻译，对话增加行数，导出后可被 Ruby 读取', async ({ page }, info) => {
  await useAs(page, owner);
  // 脚本字符串默认隐藏
  await openEditor(page, acePid, `stage=HIDDEN&category=script&q=${encodeURIComponent('購入する')}`);
  await expect(page.locator('.entry-context')).toContainText('脚本 #0「Vocab」 · 第6行');
  await page.locator('.entry-actions').getByRole('button', { name: 'more' }).click();
  await page.getByRole('menuitem', { name: /取消隐藏/ }).click();
  await expect(stageTag(page)).toHaveText('未翻译');
  await textarea(page).fill('购买"道具"');
  await page.keyboard.press('Control+KeyS');
  await expect(stageTag(page)).toHaveText('已翻译');

  await openEditor(page, acePid, `q=${encodeURIComponent('旅の人')}`);
  await expect(page.locator('.entry-context')).toContainText('脸图 Actor1(0)');
  await textarea(page).fill('你好，\n旅行者。\n欢迎来到\\C[2]这个村子\\C[0]！');
  await page.keyboard.press('Control+KeyS');
  await expect(stageTag(page)).toHaveText('已翻译');

  await openEditor(page, acePid, 'category=system');
  await expect(page.locator('.list-head')).toContainText('共 18 条');

  await page.goto(`/projects/${acePid}/exports`);
  await btn(page, '生成导出包').click();
  const row = page.locator('.ant-table-row').first();
  await expect(row).toContainText('完成', { timeout: 30_000 });
  const [dl] = await Promise.all([page.waitForEvent('download'), row.getByRole('link', { name: label('下载') }).click()]);
  const zip = unzipSync(new Uint8Array(readFileSync((await dl.path())!)));
  expect(Object.keys(zip).sort()).toEqual([
    'Data/Actors.rvdata2',
    'Data/CommonEvents.rvdata2',
    'Data/Map001.rvdata2',
    'Data/Scripts.rvdata2',
    'Data/System.rvdata2',
  ]);
  const scripts = extractEntries('Data/Scripts.rvdata2', zip['Data/Scripts.rvdata2'], 'RMVXACE').entries;
  expect(scripts.map((e) => e.original)).toContain('购买\\"道具\\"');
  const map = extractEntries('Data/Map001.rvdata2', zip['Data/Map001.rvdata2'], 'RMVXACE').entries;
  expect(map.find((e) => e.category === 'dialogue')!.original).toBe('你好，\n旅行者。\n欢迎来到\\C[2]这个村子\\C[0]！');
  // 未翻译的文件与原文件字节一致
  expect(Buffer.from(zip['Data/System.rvdata2']).equals(rgssFile('System.rvdata2'))).toBe(true);

  if (!hasRuby()) {
    info.annotations.push({ type: 'skip-ruby', description: '未安装 Ruby，跳过 Ruby 加载校验' });
    return;
  }
  const out = info.outputPath('export');
  mkdirSync(join(out, 'Data'), { recursive: true });
  for (const [k, v] of Object.entries(zip)) writeFileSync(join(out, k), v);
  const verify = join(FIX, 'verify.rb');
  const text = execFileSync('ruby', [verify, join(out, 'Data/Map001.rvdata2')], { encoding: 'utf8' });
  expect(text).toContain('旅行者。');
  const code = execFileSync(
    'ruby',
    [
      '-rzlib',
      '-e',
      'Marshal.load(File.binread(ARGV[0])).each { |_, _, c| RubyVM::InstructionSequence.compile(Zlib::Inflate.inflate(c).force_encoding("UTF-8")) }; puts "ok"',
      join(out, 'Data/Scripts.rvdata2'),
    ],
    { encoding: 'utf8' },
  );
  expect(code.trim()).toBe('ok');
});

test('XP：单文件上传，拒绝其他引擎的文件；XP 的「显示文章」首行在 101 指令中', async ({ page }) => {
  const xp = await seedProject(owner, { engine: 'RMXP', files: [] });
  await useAs(page, owner);
  await page.goto(`/projects/${xp.id}/files`);
  const input = page.locator('.ant-upload-drag input[type=file]');
  await input.setInputFiles({ name: 'Map001.rvdata2', mimeType: 'application/octet-stream', buffer: rgssFile('Map001.rvdata2') });
  await expect(toast(page, '已忽略 1 个不支持的文件')).toBeVisible();
  await input.setInputFiles([
    { name: 'Map001.rxdata', mimeType: 'application/octet-stream', buffer: rgssFile('Map001.rxdata') },
    { name: 'CommonEvents.rxdata', mimeType: 'application/octet-stream', buffer: rgssFile('CommonEvents.rxdata') },
  ]);
  await expect(page.locator('.pending-head')).toContainText('待上传 2 个文件');
  await btn(page, '开始上传').click();
  await expect(page.locator('.job-result').first()).toContainText('新增文件 2', { timeout: 30_000 });
  await openEditor(page, xp.id, 'category=dialogue');
  await expect(page.locator('.original-text')).toHaveText('共通イベントの台詞');
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page.locator('.original-text')).toHaveText('こんにちは、旅の人。この村へようこそ！'.replace('。', '。\n'));
  await expect(page.locator('.entry-context')).not.toContainText('脸图');
  // XP 对话框最多 4 行
  await textarea(page).fill('一\n二\n三\n四\n五');
  await expect(page.locator('.qa-item.warning')).toContainText('XP 的对话框最多显示 4 行');
  await textarea(page).fill('');
});

test('VX：zip 中小写 data 目录也能识别', async () => {
  const zip = Buffer.from(
    zipSync({
      'MyGame/data/Actors.rvdata': new Uint8Array(rgssFile('Actors.rvdata')),
      'MyGame/data/System.rvdata': new Uint8Array(rgssFile('System.rvdata')),
      'MyGame/Game.exe': new Uint8Array([77, 90]),
    }),
  );
  const vx = await seedProject(owner, { engine: 'RMVX', zip });
  const files = await owner.api.ok('GET', `/projects/${vx.id}/files`);
  expect(files.map((f: { path: string }) => f.path).sort()).toEqual(['Data/Actors.rvdata', 'Data/System.rvdata']);
  const sys = await owner.api.ok('GET', `/projects/${vx.id}/entries?q=${encodeURIComponent('ニューゲーム')}`);
  expect(sys.items[0].key).toBe('terms/new_game');
});
