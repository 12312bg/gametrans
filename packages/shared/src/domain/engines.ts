export const ENGINES = ['RMXP', 'RMVX', 'RMVXACE', 'RMMV', 'RMMZ'] as const;
export type Engine = (typeof ENGINES)[number];

/** 产品名不做翻译 */
export const ENGINE_NAMES: Record<Engine, string> = {
  RMXP: 'RPG Maker XP',
  RMVX: 'RPG Maker VX',
  RMVXACE: 'RPG Maker VX Ace',
  RMMV: 'RPG Maker MV',
  RMMZ: 'RPG Maker MZ',
};

export const ENGINE_EXTENSIONS: Record<Engine, string[]> = {
  RMXP: ['.rxdata'],
  RMVX: ['.rvdata'],
  RMVXACE: ['.rvdata2'],
  RMMV: ['.json', '.js'],
  RMMZ: ['.json', '.js'],
};

export function isRgssEngine(engine: Engine): boolean {
  return engine === 'RMXP' || engine === 'RMVX' || engine === 'RMVXACE';
}

const RGSS_DATA = /(^|\/)data\/[^/]+\.(rxdata|rvdata|rvdata2)$/i;
const MV_DATA = /(^|\/)data\/[^/]+\.json$/i;
const MV_PLUGINS = /(^|\/)js\/plugins\.js$/i;

/**
 * 判断压缩包 / 文件夹中的路径是否为该引擎可翻译的数据文件。
 * 是则返回相对游戏根目录的路径（如 data/Map001.json、www/data/…、Data/Map001.rvdata2），否则返回 null。
 */
export function normalizeGamePath(rawPath: string, engine: Engine): string | null {
  const path = rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (path.split('/').some((seg) => seg === '..' || seg.startsWith('__MACOSX'))) return null;
  const base = path.split('/').pop() ?? '';
  if (base.startsWith('.')) return null;

  if (isRgssEngine(engine)) {
    if (!base.toLowerCase().endsWith(ENGINE_EXTENSIONS[engine][0])) return null;
    const m = RGSS_DATA.exec(path);
    if (m) return path.slice(m.index + m[1].length).replace(/^data\//i, 'Data/');
    return path.includes('/') ? null : `Data/${base}`;
  }

  for (const [re, dir] of [
    [MV_DATA, 'data'],
    [MV_PLUGINS, 'js'],
  ] as const) {
    const m = re.exec(path);
    if (!m) continue;
    const www = new RegExp(`(^|/)www/${dir}/`, 'i').test(path) ? 'www/' : '';
    return www + path.slice(m.index + m[1].length);
  }
  if (!path.includes('/')) {
    if (/\.json$/i.test(base)) return `data/${base}`;
    if (/^plugins\.js$/i.test(base)) return `js/${base}`;
  }
  return null;
}
