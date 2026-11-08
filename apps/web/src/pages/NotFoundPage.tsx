import { Button, Result } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useT } from '../i18n';

export default function NotFoundPage() {
  const t = useT();
  const nav = useNavigate();
  return (
    <Result
      status="404"
      title={t('notFound.title')}
      subTitle={t('notFound.desc')}
      extra={<Button type="primary" onClick={() => nav('/')}>{t('common.backHome')}</Button>}
    />
  );
}
