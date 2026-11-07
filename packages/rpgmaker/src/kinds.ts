import type { EntryCategory } from '@gametrans/shared';

/** 根据文件名识别数据文件类型 */
export function detectKind(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  const stem = base.replace(/\.[^.]+$/, '');
  if (/^plugins$/i.test(stem) && /\.js$/i.test(base)) return 'plugins';
  if (/^Map\d+$/i.test(stem)) return 'map';
  const known: Record<string, string> = {
    actors: 'actors',
    classes: 'classes',
    skills: 'skills',
    items: 'items',
    weapons: 'weapons',
    armors: 'armors',
    enemies: 'enemies',
    states: 'states',
    troops: 'troops',
    commonevents: 'common_events',
    system: 'system',
    scripts: 'scripts',
    mapinfos: 'map_infos',
    tilesets: 'tilesets',
    animations: 'animations',
    areas: 'areas',
  };
  return known[stem.toLowerCase()] ?? 'unknown';
}

export const KIND_LABELS: Record<string, string> = {
  map: '地图',
  actors: '角色',
  classes: '职业',
  skills: '技能',
  items: '物品',
  weapons: '武器',
  armors: '防具',
  enemies: '敌人',
  states: '状态',
  troops: '敌群',
  common_events: '公共事件',
  system: '系统',
  scripts: '脚本',
  plugins: '插件',
  map_infos: '地图信息',
  tilesets: '图块',
  animations: '动画',
  areas: '区域',
  unknown: '其他',
};

export interface FieldSpec {
  /** MV/MZ JSON 字段名 */
  json: string;
  /** RGSS 实例变量名（不含 @） */
  ivar: string;
  label: string;
  category: EntryCategory;
  danger?: boolean;
}

const f = (json: string, ivar: string, label: string, category: EntryCategory, danger = false): FieldSpec => ({
  json,
  ivar,
  label,
  category,
  danger,
});

const NAME = f('name', 'name', '名称', 'name');
const DESC = f('description', 'description', '说明', 'description');
const NOTE = f('note', 'note', '备注', 'note', true);
const msg = (n: number) => f(`message${n}`, `message${n}`, `信息${n}`, 'message');

/** 各数据库文件中需要提取的字段 */
export const DATABASE_FIELDS: Record<string, FieldSpec[]> = {
  actors: [NAME, f('nickname', 'nickname', '称号', 'nickname'), f('profile', 'description', '简介', 'description'), NOTE],
  classes: [NAME, NOTE],
  skills: [NAME, DESC, msg(1), msg(2), NOTE],
  items: [NAME, DESC, NOTE],
  weapons: [NAME, DESC, NOTE],
  armors: [NAME, DESC, NOTE],
  enemies: [NAME, NOTE],
  states: [NAME, msg(1), msg(2), msg(3), msg(4), NOTE],
};
