import { Avatar, Tag, Tooltip } from 'antd';
import { ENGINE_LABELS, Engine, ProjectRole, ROLE_LABELS, STAGE_LABELS, Stage, languageLabel } from '@gametrans/shared';
import { GlobalOutlined, LockOutlined } from '@ant-design/icons';
import type { UserBrief } from '../api/types';
import { colorFor } from '../utils';

const STAGE_TAG_COLOR: Record<Stage, string> = {
  UNTRANSLATED: 'default',
  TRANSLATED: 'blue',
  QUESTIONED: 'orange',
  REVIEWED: 'green',
  LOCKED: 'purple',
  HIDDEN: 'default',
};

export const STAGE_DOT: Record<Stage, string> = {
  UNTRANSLATED: '#c0c4cc',
  TRANSLATED: '#3b82f6',
  QUESTIONED: '#f59e0b',
  REVIEWED: '#10b981',
  LOCKED: '#8b5cf6',
  HIDDEN: '#94a3b8',
};

export function StageTag({ stage }: { stage: Stage }) {
  return (
    <Tag color={STAGE_TAG_COLOR[stage]} bordered={false} style={stage === 'HIDDEN' ? { opacity: 0.7 } : undefined}>
      {STAGE_LABELS[stage]}
    </Tag>
  );
}

export function StageDot({ stage }: { stage: Stage }) {
  return (
    <Tooltip title={STAGE_LABELS[stage]}>
      <span className="stage-dot" style={{ background: STAGE_DOT[stage] }} />
    </Tooltip>
  );
}

const ENGINE_COLORS: Record<Engine, string> = {
  RMXP: 'geekblue',
  RMVX: 'cyan',
  RMVXACE: 'purple',
  RMMV: 'volcano',
  RMMZ: 'magenta',
};

const ENGINE_SHORT: Record<Engine, string> = { RMXP: 'XP', RMVX: 'VX', RMVXACE: 'VX Ace', RMMV: 'MV', RMMZ: 'MZ' };

export function EngineTag({ engine }: { engine: Engine }) {
  return (
    <Tooltip title={ENGINE_LABELS[engine]}>
      <Tag color={ENGINE_COLORS[engine]} bordered={false} style={{ fontWeight: 600 }}>
        RM {ENGINE_SHORT[engine]}
      </Tag>
    </Tooltip>
  );
}

const ROLE_COLORS: Record<ProjectRole, string> = {
  OWNER: 'gold',
  ADMIN: 'red',
  REVIEWER: 'green',
  TRANSLATOR: 'blue',
  VIEWER: 'default',
};

export function RoleTag({ role }: { role: ProjectRole }) {
  return (
    <Tag color={ROLE_COLORS[role]} bordered={false}>
      {ROLE_LABELS[role]}
    </Tag>
  );
}

export function LangPair({ source, target }: { source: string; target: string }) {
  return (
    <span className="lang-pair">
      {languageLabel(source)} <span className="lang-arrow">→</span> {languageLabel(target)}
    </span>
  );
}

export function VisibilityTag({ visibility }: { visibility: 'PUBLIC' | 'PRIVATE' }) {
  return visibility === 'PUBLIC' ? (
    <Tag icon={<GlobalOutlined />} bordered={false}>
      公开
    </Tag>
  ) : (
    <Tag icon={<LockOutlined />} bordered={false} color="default">
      私有
    </Tag>
  );
}

export function UserAvatar({ user, size = 'small' }: { user: UserBrief | null | undefined; size?: 'small' | 'default' | 'large' | number }) {
  if (!user) return <Avatar size={size}>?</Avatar>;
  return (
    <Tooltip title={`${user.displayName} (@${user.username})`}>
      <Avatar size={size} style={{ background: colorFor(user.username), flexShrink: 0 }}>
        {user.displayName.slice(0, 1).toUpperCase()}
      </Avatar>
    </Tooltip>
  );
}
