import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Card, Divider, Empty, Form, Input, List, Select, Space, Tabs, Typography } from 'antd';
import { LOCALES, LOCALE_NAMES, Locale } from '@gametrans/shared';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { Invitation } from '../../api/types';
import { EngineTag, LangPair, RoleTag, UserAvatar } from '../../components/Tags';
import { currentLocale, useT } from '../../i18n';
import { useAuth } from '../../providers/AuthProvider';
import { errorMessage, formatTime, fromNow } from '../../utils';
import TokensTab from './TokensTab';

export default function ProfilePage() {
  const t = useT();
  const { user, refresh, setLanguage } = useAuth();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [saving, setSaving] = useState(false);
  const tab = params.get('tab') ?? 'invitations';
  const invitations = useQuery({ queryKey: ['my-invitations'], queryFn: () => api<Invitation[]>('/invitations') });
  if (!user) return null;

  const run = async (fn: () => Promise<unknown>, successKey: string) => {
    setSaving(true);
    try {
      await fn();
      message.success(t(successKey));
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const respond = async (inv: Invitation, action: 'accept' | 'decline') => {
    try {
      await api(`/invitations/${inv.id}/${action}`, { method: 'POST' });
      message.success(t(action === 'accept' ? 'profile.accepted' : 'profile.declined'));
      qc.invalidateQueries({ queryKey: ['my-invitations'] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      await refresh();
      if (action === 'accept') nav(`/projects/${inv.projectId}`);
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  const count = invitations.data?.length ?? 0;

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
              @{user.username} · {t('profile.joined', { date: formatTime(user.createdAt) })}
              {user.isSuperAdmin && ` · ${t('profile.superAdmin')}`}
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
              label: count ? t('profile.tab.invitationsCount', { count }) : t('profile.tab.invitations'),
              children: count ? (
                <List
                  dataSource={invitations.data}
                  renderItem={(inv) => (
                    <List.Item
                      actions={[
                        <Button key="a" type="primary" size="small" onClick={() => respond(inv, 'accept')}>
                          {t('profile.accept')}
                        </Button>,
                        <Button key="d" size="small" onClick={() => respond(inv, 'decline')}>
                          {t('profile.decline')}
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
                            {t('profile.invitedBy', { name: inv.inviter?.displayName ?? '' })} <RoleTag role={inv.role} /> {t('profile.invitedAs')} · {fromNow(inv.createdAt)}
                          </Space>
                        }
                      />
                    </List.Item>
                  )}
                />
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('profile.noInvitations')} />
              ),
            },
            {
              key: 'profile',
              label: t('profile.tab.profile'),
              children: (
                <div style={{ maxWidth: 480 }}>
                  <Form
                    layout="vertical"
                    initialValues={{ displayName: user.displayName, email: user.email, bio: user.bio }}
                    onFinish={(v) => run(async () => (await api('/users/me', { method: 'PATCH', body: v }), refresh()), 'profile.saved')}
                  >
                    <Form.Item label={t('profile.username')}>
                      <Input value={user.username} disabled />
                    </Form.Item>
                    <Form.Item name="displayName" label={t('profile.displayName')} rules={[{ required: true }, { max: 32 }]}>
                      <Input />
                    </Form.Item>
                    <Form.Item name="email" label={t('profile.email')} rules={[{ required: true, type: 'email' }]}>
                      <Input />
                    </Form.Item>
                    <Form.Item name="bio" label={t('profile.bio')}>
                      <Input.TextArea rows={4} maxLength={500} showCount />
                    </Form.Item>
                    <Button type="primary" htmlType="submit" loading={saving}>
                      {t('common.save')}
                    </Button>
                  </Form>
                  <Divider />
                  <Form layout="vertical">
                    <Form.Item label={t('profile.language')} extra={t('profile.languageHint')}>
                      <Select<Locale>
                        value={currentLocale()}
                        onChange={setLanguage}
                        options={LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l] }))}
                        style={{ maxWidth: 240 }}
                      />
                    </Form.Item>
                  </Form>
                </div>
              ),
            },
            { key: 'tokens', label: t('profile.tab.tokens'), children: <TokensTab /> },
            {
              key: 'password',
              label: t('profile.tab.password'),
              children: (
                <Form layout="vertical" onFinish={(v) => run(() => api('/users/me/password', { method: 'POST', body: v }), 'profile.passwordChanged')} style={{ maxWidth: 400 }}>
                  <Form.Item name="oldPassword" label={t('profile.oldPassword')} rules={[{ required: true }]}>
                    <Input.Password autoComplete="current-password" />
                  </Form.Item>
                  <Form.Item name="newPassword" label={t('profile.newPassword')} rules={[{ required: true, min: 8, max: 72, message: t('auth.passwordRule') }]}>
                    <Input.Password autoComplete="new-password" />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" loading={saving}>
                    {t('profile.tab.password')}
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
