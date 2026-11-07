import { LockOutlined, MailOutlined, UserOutlined } from '@ant-design/icons';
import { App, Button, Card, Form, Input, Typography } from 'antd';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth';
import { Logo } from '../components/Logo';
import { errorMessage } from '../utils';

function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="auth-page">
      <div className="auth-hero">
        <Logo />
        <div className="auth-hero-body">
          <h1>让游戏跨越语言</h1>
          <p>面向 RPG Maker XP / VX / VX Ace / MV / MZ 的在线本地化协作平台。上传游戏数据，团队在线翻译、审核，一键导出可直接覆盖的游戏文件。</p>
          <ul>
            <li>无损解析 Marshal 与 JSON 数据，保证回写安全</li>
            <li>术语表、翻译记忆、历史版本与回滚</li>
            <li>所有者 / 管理员 / 审核员 / 翻译员 / 访客五级角色</li>
          </ul>
        </div>
        <div className="auth-hero-foot">GameTrans · 游戏本地化协作平台</div>
      </div>
      <div className="auth-panel">
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

export function LoginPage() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { refresh, site } = useAuth();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const next = params.get('next') || '/';

  const onFinish = async (v: { login: string; password: string }) => {
    setLoading(true);
    try {
      await api('/auth/login', { method: 'POST', body: v });
      await refresh();
      message.success('欢迎回来');
      nav(next.startsWith('/') ? next : '/', { replace: true });
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title="登录" subtitle="使用用户名或邮箱登录">
      <Form layout="vertical" size="large" onFinish={onFinish} requiredMark={false}>
        <Form.Item name="login" rules={[{ required: true, message: '请输入用户名或邮箱' }]}>
          <Input prefix={<UserOutlined />} placeholder="用户名 / 邮箱" autoFocus autoComplete="username" />
        </Form.Item>
        <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
          <Input.Password prefix={<LockOutlined />} placeholder="密码" autoComplete="current-password" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={loading}>
          登录
        </Button>
      </Form>
      {site?.allowRegistration !== false && (
        <div className="auth-switch">
          还没有账号？<Link to={`/register${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`}>立即注册</Link>
        </div>
      )}
    </AuthShell>
  );
}

export function RegisterPage() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { refresh, site } = useAuth();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const next = params.get('next') || '/';

  const onFinish = async (v: { username: string; email: string; password: string; displayName?: string }) => {
    setLoading(true);
    try {
      await api('/auth/register', { method: 'POST', body: { ...v, displayName: v.displayName ?? '' } });
      await refresh();
      message.success('注册成功');
      nav(next.startsWith('/') ? next : '/', { replace: true });
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  if (site && !site.allowRegistration) {
    return (
      <AuthShell title="注册已关闭" subtitle="本站目前不开放公开注册，请联系管理员获取账号。">
        <Button block onClick={() => nav('/login')}>
          返回登录
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="创建账号" subtitle="加入社区，参与游戏翻译">
      <Form layout="vertical" size="large" onFinish={onFinish} requiredMark={false}>
        <Form.Item
          name="username"
          rules={[
            { required: true, message: '请输入用户名' },
            { pattern: /^[A-Za-z0-9_\-.]{3,32}$/, message: '3-32 位字母、数字、下划线、连字符或点' },
          ]}
        >
          <Input prefix={<UserOutlined />} placeholder="用户名（登录用，不可修改）" autoComplete="username" />
        </Form.Item>
        <Form.Item name="displayName" rules={[{ max: 32 }]}>
          <Input placeholder="昵称（可选）" />
        </Form.Item>
        <Form.Item name="email" rules={[{ required: true, type: 'email', message: '请输入有效邮箱' }]}>
          <Input prefix={<MailOutlined />} placeholder="邮箱" autoComplete="email" />
        </Form.Item>
        <Form.Item name="password" rules={[{ required: true, min: 8, max: 72, message: '密码长度为 8-72 位' }]}>
          <Input.Password prefix={<LockOutlined />} placeholder="密码（至少 8 位）" autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirm"
          dependencies={['password']}
          rules={[
            { required: true, message: '请再次输入密码' },
            ({ getFieldValue }) => ({
              validator: (_, v) => (v === getFieldValue('password') ? Promise.resolve() : Promise.reject(new Error('两次输入的密码不一致'))),
            }),
          ]}
        >
          <Input.Password prefix={<LockOutlined />} placeholder="确认密码" autoComplete="new-password" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={loading}>
          注册
        </Button>
      </Form>
      <div className="auth-switch">
        已有账号？<Link to="/login">去登录</Link>
      </div>
    </AuthShell>
  );
}
