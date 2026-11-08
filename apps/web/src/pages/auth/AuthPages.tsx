import { LockOutlined, MailOutlined, UserOutlined } from '@ant-design/icons';
import { App, Button, Card, Form, Input, Typography } from 'antd';
import { ReactNode, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { LanguageSwitch } from '../../components/LanguageSwitch';
import { Logo } from '../../components/Logo';
import { currentLocale, useT } from '../../i18n';
import { useAuth } from '../../providers/AuthProvider';
import { errorMessage } from '../../utils';

function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  const t = useT();
  return (
    <div className="auth-page">
      <div className="auth-hero">
        <Logo />
        <div className="auth-hero-body">
          <h1>{t('auth.heroTitle')}</h1>
          <p>{t('auth.heroDesc')}</p>
          <ul>
            <li>{t('auth.heroPoint1')}</li>
            <li>{t('auth.heroPoint2')}</li>
            <li>{t('auth.heroPoint3')}</li>
          </ul>
        </div>
        <div className="auth-hero-foot">{t('auth.heroFoot')}</div>
      </div>
      <div className="auth-panel">
        <div className="auth-lang">
          <LanguageSwitch />
        </div>
        <Card className="auth-card" variant="borderless">
          <Typography.Title level={3} style={{ marginBottom: 4 }}>
            {title}
          </Typography.Title>
          <Typography.Paragraph type="secondary">{subtitle}</Typography.Paragraph>
          {children}
        </Card>
      </div>
    </div>
  );
}

/** 登录 / 注册成功后跳回来源页 */
function useAuthSubmit<V>(path: string, successKey: string, toBody: (v: V) => unknown) {
  const t = useT();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { refresh } = useAuth();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const next = params.get('next') || '/';
  const submit = async (v: V) => {
    setLoading(true);
    try {
      await api(path, { method: 'POST', body: toBody(v) });
      await refresh();
      message.success(t(successKey));
      nav(next.startsWith('/') ? next : '/', { replace: true });
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };
  return { submit, loading, next, hasNext: !!params.get('next') };
}

export function LoginPage() {
  const t = useT();
  const { site } = useAuth();
  const { submit, loading, next, hasNext } = useAuthSubmit<{ login: string; password: string }>('/auth/login', 'auth.welcomeBack', (v) => v);

  return (
    <AuthShell title={t('auth.login')} subtitle={t('auth.loginSubtitle')}>
      <Form layout="vertical" size="large" onFinish={submit} requiredMark={false}>
        <Form.Item name="login" rules={[{ required: true, message: t('auth.loginRequired') }]}>
          <Input prefix={<UserOutlined />} placeholder={t('auth.loginPlaceholder')} autoFocus autoComplete="username" />
        </Form.Item>
        <Form.Item name="password" rules={[{ required: true, message: t('auth.passwordRequired') }]}>
          <Input.Password prefix={<LockOutlined />} placeholder={t('auth.password')} autoComplete="current-password" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={loading}>
          {t('auth.login')}
        </Button>
      </Form>
      {site?.allowRegistration !== false && (
        <div className="auth-switch">
          {t('auth.noAccount')}
          <Link to={`/register${hasNext ? `?next=${encodeURIComponent(next)}` : ''}`}>{t('auth.registerNow')}</Link>
        </div>
      )}
    </AuthShell>
  );
}

interface RegisterValues {
  username: string;
  email: string;
  password: string;
  displayName?: string;
}

export function RegisterPage() {
  const t = useT();
  const nav = useNavigate();
  const { site } = useAuth();
  const { submit, loading } = useAuthSubmit<RegisterValues>('/auth/register', 'auth.registered', ({ username, email, password, displayName }) => ({
    username,
    email,
    password,
    displayName: displayName ?? '',
    locale: currentLocale(),
  }));

  if (site && !site.allowRegistration) {
    return (
      <AuthShell title={t('auth.registrationClosed')} subtitle={t('auth.registrationClosedDesc')}>
        <Button block onClick={() => nav('/login')}>
          {t('auth.backToLogin')}
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t('auth.register')} subtitle={t('auth.registerSubtitle')}>
      <Form layout="vertical" size="large" onFinish={submit} requiredMark={false}>
        <Form.Item
          name="username"
          rules={[
            { required: true, message: t('auth.usernameRequired') },
            { pattern: /^[A-Za-z0-9_\-.]{3,32}$/, message: t('auth.usernameRule') },
          ]}
        >
          <Input prefix={<UserOutlined />} placeholder={t('auth.usernamePlaceholder')} autoComplete="username" />
        </Form.Item>
        <Form.Item name="displayName" rules={[{ max: 32 }]}>
          <Input placeholder={t('auth.displayNamePlaceholder')} />
        </Form.Item>
        <Form.Item name="email" rules={[{ required: true, type: 'email', message: t('auth.emailRequired') }]}>
          <Input prefix={<MailOutlined />} placeholder={t('auth.email')} autoComplete="email" />
        </Form.Item>
        <Form.Item name="password" rules={[{ required: true, min: 8, max: 72, message: t('auth.passwordRule') }]}>
          <Input.Password prefix={<LockOutlined />} placeholder={t('auth.passwordPlaceholder')} autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirm"
          dependencies={['password']}
          rules={[
            { required: true, message: t('auth.confirmRequired') },
            ({ getFieldValue }) => ({
              validator: (_, v) => (v === getFieldValue('password') ? Promise.resolve() : Promise.reject(new Error(t('auth.passwordMismatch')))),
            }),
          ]}
        >
          <Input.Password prefix={<LockOutlined />} placeholder={t('auth.confirmPlaceholder')} autoComplete="new-password" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={loading}>
          {t('auth.registerSubmit')}
        </Button>
      </Form>
      <div className="auth-switch">
        {t('auth.hasAccount')}
        <Link to="/login">{t('auth.goLogin')}</Link>
      </div>
    </AuthShell>
  );
}
