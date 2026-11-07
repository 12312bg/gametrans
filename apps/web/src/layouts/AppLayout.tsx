import {
  BulbOutlined,
  CrownOutlined,
  LogoutOutlined,
  MailOutlined,
  MoonOutlined,
  PlusOutlined,
  SunOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Badge, Button, Dropdown, Layout, Space, Tooltip } from 'antd';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { Logo } from '../components/Logo';
import { UserAvatar } from '../components/Tags';
import { useThemeMode } from '../theme';

export function AppLayout() {
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
                项目广场
              </Link>
            </nav>
          </Space>
          <Space size={10} align="center">
            <Tooltip title={mode === 'dark' ? '切换到浅色' : '切换到深色'}>
              <Button type="text" shape="circle" icon={mode === 'dark' ? <SunOutlined /> : <MoonOutlined />} onClick={toggle} />
            </Tooltip>
            {user ? (
              <>
                {canCreate && (
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => nav('/projects/new')} className="hide-mobile">
                    新建项目
                  </Button>
                )}
                <Tooltip title="项目邀请">
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
                      { key: 'me', icon: <UserOutlined />, label: '个人中心', onClick: () => nav('/me') },
                      ...(canCreate ? [{ key: 'new', icon: <PlusOutlined />, label: '新建项目', onClick: () => nav('/projects/new') }] : []),
                      ...(user.isSuperAdmin ? [{ key: 'admin', icon: <CrownOutlined />, label: '管理后台', onClick: () => nav('/admin') }] : []),
                      { type: 'divider' },
                      {
                        key: 'logout',
                        icon: <LogoutOutlined />,
                        label: '退出登录',
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
                  登录
                </Button>
                {site?.allowRegistration !== false && (
                  <Button type="primary" icon={<BulbOutlined />} onClick={() => nav('/register')}>
                    注册
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
