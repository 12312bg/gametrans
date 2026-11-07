import { TranslationOutlined } from '@ant-design/icons';
import { Button, Dropdown, Tooltip } from 'antd';
import { LOCALES, LOCALE_NAMES } from '@gametrans/shared';
import { currentLocale, useT } from '../i18n';
import { useAuth } from '../providers/AuthProvider';

export function LanguageSwitch() {
  const t = useT();
  const { setLanguage } = useAuth();
  const current = currentLocale();
  return (
    <Dropdown
      trigger={['click']}
      menu={{
        selectable: true,
        selectedKeys: [current],
        items: LOCALES.map((l) => ({ key: l, label: LOCALE_NAMES[l], onClick: () => setLanguage(l) })),
      }}
    >
      <Tooltip title={t('common.language')}>
        <Button type="text" shape="circle" icon={<TranslationOutlined />} aria-label="language" />
      </Tooltip>
    </Dropdown>
  );
}
