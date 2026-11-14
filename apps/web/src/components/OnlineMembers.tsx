import { Avatar, Badge, Tooltip } from 'antd';
import { useRealtime } from '../api/realtime';
import { useT } from '../i18n';
import { UserAvatar } from './Tags';

/** 项目页头部：当前在线的成员 */
export function OnlineMembers() {
  const t = useT();
  const { connected, presence } = useRealtime();
  if (!connected || !presence.length) return null;
  return (
    <div className="online-members">
      <Tooltip title={t('realtime.online', { count: presence.length })}>
        <Badge status="success" />
      </Tooltip>
      <Avatar.Group size="small" max={{ count: 5 }}>
        {presence.map((p) => (
          <UserAvatar key={p.user.id} user={p.user} />
        ))}
      </Avatar.Group>
    </div>
  );
}
