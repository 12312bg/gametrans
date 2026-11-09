import { unzipSync } from 'fflate';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { TestUser, activeItem, createUser, expect, openEditor, pickOption, seedProject, test, toast, useAs } from './helpers';

const KEY = 'd41d8cd98f00b204e9800998ecf8427e';
const KEY_BYTES = Buffer.from(KEY, 'hex');
const HEADER = Buffer.from([0x52, 0x50, 0x47, 0x4d, 0x56, 0, 0, 0, 0, 3, 1, 0, 0, 0, 0, 0]);

/** 生成纯色 PNG */
function png(w: number, h: number, rgb: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3).map((_, i) => rgb[i % 3])]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const encrypt = (p: Buffer) => {
  const body = Buffer.from(p);
  for (let i = 0; i < 16; i++) body[i] ^= KEY_BYTES[i];
  return Buffer.concat([HEADER, body]);
};

const PICS: Record<string, Buffer> = {
  'img/pictures/a': png(40, 30, [220, 40, 40]),
  'img/pictures/b': png(30, 40, [40, 180, 60]),
  'img/pictures/c10': png(20, 20, [40, 80, 220]),
  'img/faces/Actor1': png(48, 48, [240, 200, 40]),
};

let root = '';

function writeGame(kind: 'encrypted' | 'plain') {
  const dir = join(__dirname, '../.tmp/fixtures', `tools-${kind}-${Date.now()}`);
  rmSync(dir, { recursive: true, force: true });
  const put = (rel: string, data: Buffer | string) => {
    const p = join(dir, 'game/www', rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, data);
  };
  for (const [rel, data] of Object.entries(PICS)) put(kind === 'encrypted' ? `${rel}.rpgmvp` : `${rel}.png`, kind === 'encrypted' ? encrypt(data) : data);
  if (kind === 'encrypted') {
    put('img/system/Window.png_', encrypt(png(16, 16, [90, 90, 90])));
    put('img/pictures/broken.rpgmvp', Buffer.from('not an encrypted image at all, just text'));
    put('audio/bgm/Theme.ogg', Buffer.from('OggS'));
  } else {
    put('data/System.json', JSON.stringify({ hasEncryptedImages: true, encryptionKey: KEY }));
  }
  return join(dir, 'game');
}

let user: TestUser;

test.beforeAll(async () => {
  user = await createUser('tool', '工具用户');
  root = writeGame('encrypted');
});

test('工具箱：递归解密文件夹，多级目录浏览，预览切换', async ({ page }) => {
  await useAs(page, user);
  await page.goto('/');
  await page.getByRole('link', { name: '工具箱' }).click();
  await expect(page).toHaveURL(/\/tools$/);
  await page.locator('.image-tool input[webkitdirectory]').setInputFiles(root);
  await expect(toast(page, '已忽略 1 个其他文件')).toBeVisible();
  await expect(page.getByText(`检测到加密密钥 ${KEY}`)).toBeVisible();

  // 只有一个顶层目录时直接进入；目录树与面包屑同步
  const main = page.locator('.tool-main');
  await expect(main.locator('.ant-breadcrumb')).toHaveText('全部/game');
  await main.locator('.folder-tile').filter({ hasText: 'www' }).click();
  await main.locator('.folder-tile').filter({ hasText: 'img' }).click();
  await expect(main.locator('.folder-tile .tile-name')).toHaveText(['faces', 'pictures', 'system']);
  await page.locator('.tool-tree').getByText('pictures').click();
  await expect(main.locator('.ant-breadcrumb')).toHaveText('全部/game/www/img/pictures');
  const tiles = main.locator('.img-tile:not(.folder-tile)');
  await expect(tiles.locator('.tile-name')).toHaveText(['a.png', 'b.png', 'broken.png', 'c10.png']);
  await expect(tiles.filter({ hasText: 'broken.png' }).locator('.thumb-error')).toBeVisible();
  await expect.poll(() => tiles.first().locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(40);

  await tiles.filter({ hasText: 'a.png' }).click();
  const preview = page.locator('.image-preview');
  await expect(preview.locator('.ant-modal-title')).toHaveText('game/www/img/pictures/a.png');
  await expect(preview).toContainText('40 × 30 像素');
  await expect(preview.locator('.preview-entry')).toHaveCount(4);
  await page.keyboard.press('ArrowRight');
  await expect(preview.locator('.ant-modal-title')).toHaveText('game/www/img/pictures/b.png');
  await expect(preview).toContainText('30 × 40 像素');
  await preview.locator('.preview-entry').filter({ hasText: 'c10.png' }).click();
  await expect(preview.locator('.ant-modal-title')).toHaveText('game/www/img/pictures/c10.png');
  await expect(preview.locator('.preview-entry.active')).toContainText('c10.png');
  await page.screenshot({ path: join(__dirname, '../.tmp/results/tools-preview.png') });
  await page.keyboard.press('Escape');
});

test('工具箱：批量选中并按原目录结构打包下载', async ({ page }) => {
  await useAs(page, user);
  await page.goto('/tools');
  await page.locator('.image-tool input[webkitdirectory]').setInputFiles(root);
  const main = page.locator('.tool-main');
  await page.locator('.tool-tree').getByText('img').click();
  // 选中整个 faces 目录 + pictures 中的 b.png
  await main.locator('.folder-tile').filter({ hasText: 'faces' }).locator('.tile-check').click();
  await main.locator('.folder-tile').filter({ hasText: 'pictures' }).click();
  await main.locator('.img-tile').filter({ hasText: 'b.png' }).locator('.tile-check').click();
  await expect(main).toContainText('已选 2 张');
  await expect(main.locator('.img-tile').filter({ hasText: 'b.png' }).locator('.tile-check input')).toBeChecked();
  await expect(main.locator('.img-tile').filter({ hasText: 'a.png' }).locator('.tile-check input')).not.toBeChecked();
  await page.screenshot({ path: join(__dirname, '../.tmp/results/tools-grid.png') });
  const [dl] = await Promise.all([page.waitForEvent('download'), main.getByRole('button', { name: /下载选中/ }).click()]);
  expect(dl.suggestedFilename()).toBe('game_png.zip');
  const zip = unzipSync(new Uint8Array(readFileSync((await dl.path())!)));
  expect(Object.keys(zip).sort()).toEqual(['game/www/img/faces/Actor1.png', 'game/www/img/pictures/b.png']);
  expect(Buffer.from(zip['game/www/img/pictures/b.png']).equals(PICS['img/pictures/b'])).toBe(true);
  expect(Buffer.from(zip['game/www/img/faces/Actor1.png']).equals(PICS['img/faces/Actor1'])).toBe(true);

  // 下载全部：损坏的文件跳过，MZ 的 .png_ 一并解密
  const [all] = await Promise.all([page.waitForEvent('download'), main.getByRole('button', { name: /下载全部 6 张/ }).click()]);
  await expect(toast(page, '1 个文件无法转换，已跳过')).toBeVisible();
  const allZip = unzipSync(new Uint8Array(readFileSync((await all.path())!)));
  expect(Object.keys(allZip)).toHaveLength(5);
  expect(allZip['game/www/img/system/Window.png']).toBeDefined();
});

test('工具箱：png 加密回 rpgmvp / png_，密钥取自 System.json', async ({ page }) => {
  await useAs(page, user);
  await page.goto('/tools');
  await page.getByText('加密：png → rpgmvp / png_').click();
  await page.getByLabel('加密密钥').fill('12345');
  await expect(page.getByText('密钥应为 32 位十六进制字符')).toBeVisible();
  await page.getByLabel('加密密钥').fill('');
  await page.locator('.image-tool input[webkitdirectory]').setInputFiles(writeGame('plain'));
  await expect(page.getByText('已从 game/www/data/System.json 读取密钥')).toBeVisible();
  const main = page.locator('.tool-main');
  const [dl] = await Promise.all([page.waitForEvent('download'), main.getByRole('button', { name: /下载全部 4 张/ }).click()]);
  expect(dl.suggestedFilename()).toBe('game_rpgmvp.zip');
  const zip = unzipSync(new Uint8Array(readFileSync((await dl.path())!)));
  for (const [rel, data] of Object.entries(PICS)) expect(Buffer.from(zip[`game/www/${rel}.rpgmvp`]).equals(encrypt(data)), rel).toBe(true);

  await page.locator('.tool-key .ant-select').click();
  await pickOption(page, '.png_（MZ）');
  await page.locator('.tool-tree').getByText('faces').click();
  await expect(main.locator('.tile-name')).toHaveText(['Actor1.png_']);
});

test('翻译页：点击词条的文件名只看该文件，并停在当前词条', async ({ page }) => {
  const owner = await createUser('jump');
  const p = await seedProject(owner);
  await useAs(page, owner);
  await openEditor(page, p.id, `q=${encodeURIComponent('ありがとう')}&field=original`);
  await expect(page.locator('.entry-item')).toHaveCount(1);
  await page.locator('.entry-meta .entry-file').click();
  await expect(page).toHaveURL(/file=/);
  await expect(page).not.toHaveURL(/q=/);
  await expect(page.locator('.ant-select-selection-item').first()).toContainText('data/Map001.json');
  await expect(page.locator('.original-text')).toHaveText('ありがとう！');
  await expect(activeItem(page)).toContainText('ありがとう！');
  expect(await page.locator('.entry-item').count()).toBeGreaterThan(1);
});
