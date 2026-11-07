import type { EntryCategory } from '@gametrans/shared';

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

export interface FieldSpec {
  /** MV/MZ 字段名，同时作为位置说明 ctx.field.<json> */
  json: string;
  /** RGSS 实例变量名（不含 @） */
  ivar: string;
  category: EntryCategory;
  danger?: boolean;
}

const f = (json: string, ivar: string, category: EntryCategory, danger = false): FieldSpec => ({ json, ivar, category, danger });
const NAME = f('name', 'name', 'name');
const DESC = f('description', 'description', 'description');
const NOTE = f('note', 'note', 'note', true);
const msg = (n: number) => f(`message${n}`, `message${n}`, 'message');

export const DATABASE_FIELDS: Record<string, FieldSpec[]> = {
  actors: [NAME, f('nickname', 'nickname', 'nickname'), f('profile', 'description', 'description'), NOTE],
  classes: [NAME, NOTE],
  skills: [NAME, DESC, msg(1), msg(2), NOTE],
  items: [NAME, DESC, NOTE],
  weapons: [NAME, DESC, NOTE],
  armors: [NAME, DESC, NOTE],
  enemies: [NAME, NOTE],
  states: [NAME, msg(1), msg(2), msg(3), msg(4), NOTE],
};
