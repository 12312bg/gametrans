import { TranslationOutlined } from '@ant-design/icons';
import { Button, Dropdown } from 'antd';
import { LOCALES, LOCALE_NAMES } from '@gametrans/shared';
import { currentLocale, useT } from '../i18n';
import { useAuth } from '../providers/AuthProvider';

/** 不用 Tooltip：悬停提示会挡住下拉菜单 */
export function LanguageSwitch() {
  const t = useT();
  const { setLanguage } = useAuth();
  return (
    <Dropdown
      trigger={['click']}
      menu={{
        selectable: true,
        selectedKeys: [currentLocale()],
        items: LOCALES.map((l) => ({ key: l, label: LOCALE_NAMES[l], onClick: () => setLanguage(l) })),
      }}
    >
      <Button type="text" shape="circle" icon={<TranslationOutlined />} aria-label={t('common.language')} title={t('common.language')} />
    </Dropdown>
  );
}
