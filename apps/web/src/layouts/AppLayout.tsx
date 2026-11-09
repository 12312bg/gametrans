import { ApiOutlined, BulbOutlined, CrownOutlined, LogoutOutlined, MailOutlined, MoonOutlined, PlusOutlined, SunOutlined, UserOutlined } from '@ant-design/icons';
import { Badge, Button, Dropdown, Layout, Space, Tooltip } from 'antd';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { Logo } from '../components/Logo';
import { UserAvatar } from '../components/Tags';
import { useT } from '../i18n';
import { useAuth } from '../providers/AuthProvider';
import { useThemeMode } from '../providers/ThemeProvider';

export function AppLayout() {
  const t = useT();
  const { user, logout, site } = useAuth();
  const { mode, toggle } = useThemeMode();
  const nav = useNavigate();
  const loc = useLocation();
  const canCreate = user && (site?.projectCreation !== 'superadmin' || user.isSuperAdmin);
  const inEditor = /\/projects\/[^/]+\/editor/.test(loc.pathname);

  return (
    <Layout className={`app-layout${inEditor ? ' is-editor' : ''}`}>
      <Layout.Header className="app-header">
        <div className="app-header-inner">
          <Space size={28} align="center">
            <Logo />
            <nav className="top-nav">
              <Link to="/" className={loc.pathname === '/' ? 'active' : ''}>
                {t('nav.explore')}
              </Link>
              {user && (
                <Link to="/tools" className={loc.pathname.startsWith('/tools') ? 'active' : ''}>
                  {t('nav.tools')}
                </Link>
              )}
            </nav>
          </Space>
          <Space size={10} align="center">
            <LanguageSwitch />
            <Tooltip title={t(mode === 'dark' ? 'theme.toLight' : 'theme.toDark')}>
              <Button type="text" shape="circle" icon={mode === 'dark' ? <SunOutlined /> : <MoonOutlined />} onClick={toggle} />
            </Tooltip>
            {user ? (
              <>
                {canCreate && (
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => nav('/projects/new')} className="hide-mobile">
                    {t('nav.newProject')}
                  </Button>
                )}
                <Tooltip title={t('nav.invitations')}>
                  <Badge count={user.pendingInvitations} size="small">
                    <Button type="text" shape="circle" icon={<MailOutlined />} onClick={() => nav('/me?tab=invitations')} />
                  </Badge>
                </Tooltip>
                <Dropdown
                  trigger={['click']}
                  menu={{
                    items: [
                      { key: 'name', label: <div className="menu-user"><b>{user.displayName}</b><span>@{user.username}</span></div>, disabled: true },
                      { type: 'divider' },
                      { key: 'me', icon: <UserOutlined />, label: t('nav.profile'), onClick: () => nav('/me') },
                      ...(canCreate ? [{ key: 'new', icon: <PlusOutlined />, label: t('nav.newProject'), onClick: () => nav('/projects/new') }] : []),
                      ...(user.isSuperAdmin ? [{ key: 'admin', icon: <CrownOutlined />, label: t('nav.admin'), onClick: () => nav('/admin') }] : []),
                      { key: 'tokens', icon: <ApiOutlined />, label: t('nav.tokens'), onClick: () => nav('/me?tab=tokens') },
                      { key: 'docs', icon: <ApiOutlined />, label: <a href="/api/docs" target="_blank" rel="noreferrer">{t('nav.apiDocs')}</a> },
                      { type: 'divider' },
                      {
                        key: 'logout',
                        icon: <LogoutOutlined />,
                        label: t('nav.logout'),
                        onClick: async () => {
                          await logout();
                          nav('/');
                        },
                      },
                    ],
                  }}
                >
                  <span className="header-user">
                    <UserAvatar user={user} size={32} />
                  </span>
                </Dropdown>
              </>
            ) : (
              <>
                <Button type="text" onClick={() => nav(`/login?next=${encodeURIComponent(loc.pathname)}`)}>
                  {t('nav.login')}
                </Button>
                {site?.allowRegistration !== false && (
                  <Button type="primary" icon={<BulbOutlined />} onClick={() => nav('/register')}>
                    {t('nav.register')}
                  </Button>
                )}
              </>
            )}
          </Space>
        </div>
      </Layout.Header>
      <Layout.Content className="app-content">
        <Outlet />
      </Layout.Content>
    </Layout>
  );
}
