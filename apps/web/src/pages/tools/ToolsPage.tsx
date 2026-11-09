import { Tabs, Typography } from 'antd';
import { useT } from '../../i18n';
import { ImageCryptoTool } from './image-crypto/ImageCryptoTool';

export default function ToolsPage() {
  const t = useT();
  return (
    <div className="page-container tools-page">
      <Typography.Title level={3} style={{ marginBottom: 4 }}>
        {t('tools.title')}
      </Typography.Title>
      <Typography.Paragraph type="secondary">{t('tools.desc')}</Typography.Paragraph>
      <Tabs items={[{ key: 'images', label: t('tools.tab.images'), children: <ImageCryptoTool /> }]} />
    </div>
  );
}
