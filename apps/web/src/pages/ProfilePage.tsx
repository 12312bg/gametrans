import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Card, Empty, Form, Input, List, Space, Tabs, Typography } from 'antd';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import type { Invitation } from '../api/types';
import { useAuth } from '../auth';
import { EngineTag, LangPair, RoleTag, UserAvatar } from '../components/Tags';
import { errorMessage, formatTime, fromNow } from '../utils';
import TokensTab from './TokensTab';

export default function ProfilePage() {
  const { user, refresh } = useAuth();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [saving, setSaving] = useState(false);
  const tab = params.get('tab') ?? 'invitations';
  const invitations = useQuery({ queryKey: ['my-invitations'], queryFn: () => api<Invitation[]>('/invitations') });
  if (!user) return null;

  const respond = async (inv: Invitation, action: 'accept' | 'decline') => {
    try {
      await api(`/invitations/${inv.id}/${action}`, { method: 'POST' });
      message.success(action === 'accept' ? '已加入项目' : '已拒绝邀请');
      qc.invalidateQueries({ queryKey: ['my-invitations'] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      await refresh();
      if (action === 'accept') nav(`/projects/${inv.projectId}`);
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  const saveProfile = async (v: { displayName: string; email: string; bio: string }) => {
    setSaving(true);
    try {
      await api('/users/me', { method: 'PATCH', body: v });
      await refresh();
      message.success('资料已更新');
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async (v: { oldPassword: string; newPassword: string }) => {
    setSaving(true);
    try {
      await api('/users/me/password', { method: 'POST', body: v });
      message.success('密码已修改');
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-container narrow">
      <Card variant="borderless" className="profile-head">
        <Space size={16}>
          <UserAvatar user={user} size={64} />
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>
              {user.displayName}
            </Typography.Title>
            <Typography.Text type="secondary">
              @{user.username} · {formatTime(user.createdAt)} 加入{user.isSuperAdmin ? ' · 超级管理员' : ''}
            </Typography.Text>
          </div>
        </Space>
      </Card>
      <Card variant="borderless" style={{ marginTop: 16 }}>
        <Tabs
          activeKey={tab}
          onChange={(k) => setParams({ tab: k }, { replace: true })}
          items={[
            {
              key: 'invitations',
              label: `项目邀请${invitations.data?.length ? `（${invitations.data.length}）` : ''}`,
              children: invitations.data?.length ? (
                <List
                  dataSource={invitations.data}
                  renderItem={(inv) => (
                    <List.Item
                      actions={[
                        <Button key="a" type="primary" size="small" onClick={() => respond(inv, 'accept')}>
                          接受
                        </Button>,
                        <Button key="d" size="small" onClick={() => respond(inv, 'decline')}>
                          拒绝
                        </Button>,
                      ]}
                    >
                      <List.Item.Meta
                        title={
                          <Space wrap>
                            <b>{inv.project?.name}</b>
                            {inv.project && <EngineTag engine={inv.project.engine} />}
                            {inv.project && <LangPair source={inv.project.sourceLang} target={inv.project.targetLang} />}
                          </Space>
                        }
                        description={
                          <Space wrap>
                            {inv.inviter?.displayName} 邀请你以 <RoleTag role={inv.role} /> 身份加入 · {fromNow(inv.createdAt)}
                          </Space>
                        }
                      />
                    </List.Item>
                  )}
                />
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有待处理的邀请" />
              ),
            },
            {
              key: 'profile',
              label: '个人资料',
              children: (
                <Form layout="vertical" initialValues={{ displayName: user.displayName, email: user.email, bio: user.bio }} onFinish={saveProfile} style={{ maxWidth: 480 }}>
                  <Form.Item label="用户名">
                    <Input value={user.username} disabled />
                  </Form.Item>
                  <Form.Item name="displayName" label="昵称" rules={[{ required: true }, { max: 32 }]}>
                    <Input />
                  </Form.Item>
                  <Form.Item name="email" label="邮箱" rules={[{ required: true, type: 'email' }]}>
                    <Input />
                  </Form.Item>
                  <Form.Item name="bio" label="个人简介">
                    <Input.TextArea rows={4} maxLength={500} showCount />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" loading={saving}>
                    保存
                  </Button>
                </Form>
              ),
            },
            { key: 'tokens', label: 'API 令牌', children: <TokensTab /> },
            {
              key: 'password',
              label: '修改密码',
              children: (
                <Form layout="vertical" onFinish={changePassword} style={{ maxWidth: 400 }}>
                  <Form.Item name="oldPassword" label="原密码" rules={[{ required: true }]}>
                    <Input.Password autoComplete="current-password" />
                  </Form.Item>
                  <Form.Item name="newPassword" label="新密码" rules={[{ required: true, min: 8, max: 72, message: '密码长度为 8-72 位' }]}>
                    <Input.Password autoComplete="new-password" />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" loading={saving}>
                    修改密码
                  </Button>
                </Form>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
