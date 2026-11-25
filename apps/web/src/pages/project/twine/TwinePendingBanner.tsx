import { Alert, Button } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../../i18n';
import { useTwineAnalysis } from './api';

const storageKey = (pid: string) => `gt.twinePendingDismissed.${pid}`;

/**
 * Twine 项目上传故事后，若发现还没确认的自定义宏（可能含有要翻译的文字），在项目页顶部提示去确认。
 * 关闭后同一组待确认的宏不再提示；出现新的宏时再次提示。
 */
export function TwinePendingBanner({ pid }: { pid: string }) {
  const t = useT();
  const nav = useNavigate();
  const analysis = useTwineAnalysis(pid);
  const pending = analysis.data?.pending ?? [];
  const sig = pending.join(',');
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(storageKey(pid)) ?? '';
    } catch {
      return '';
    }
  });
  if (!pending.length || dismissed === sig) return null;
  const close = () => {
    setDismissed(sig);
    try {
      localStorage.setItem(storageKey(pid), sig);
    } catch {
      // 无法保存时只在本次会话中隐藏
    }
  };
  const names = pending.slice(0, 4).map((n) => `<<${n}>>`).join(' ');
  return (
    <Alert
      className="twine-pending"
      type="info"
      showIcon
      closable
      onClose={close}
      message={t('twine.pendingTitle', { count: pending.length })}
      description={t('twine.pendingDesc', { names: pending.length > 4 ? `${names} …` : names })}
      action={
        <Button size="small" type="primary" onClick={() => nav(`/projects/${pid}/settings#twine-rules`)}>
          {t('twine.pendingGo')}
        </Button>
      }
      style={{ marginBottom: 16 }}
    />
  );
}
