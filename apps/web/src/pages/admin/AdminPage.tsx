import { CrownOutlined, StopOutlined } from '@ant-design/icons';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Card, Col, Input, Modal, Row, Space, Statistic, Switch, Table, Tabs, Tag, Typography } from 'antd';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../../api/client';
import type { AdminUser, Paged, ProjectSummary } from '../../api/types';
import { useT } from '../../i18n';
import { useAuth } from '../../providers/AuthProvider';
import { ProgressBar } from '../../components/ProgressBar';
import { EngineTag, UserAvatar, VisibilityTag } from '../../components/Tags';
import { errorMessage, formatTime, fromNow } from '../../utils';

export default function AdminPage() {
  const t = useT();
  const { user } = useAuth();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pq, setPq] = useState('');
  const [ppage, setPpage] = useState(1);
  const [resetUser, setResetUser] = useState<AdminUser | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const stats = useQuery({ queryKey: ['admin-stats'], queryFn: () => api<Record<string, number>>('/admin/stats') });
  const users = useQuery({
    queryKey: ['admin-users', q, page],
    queryFn: () => api<Paged<AdminUser>>(`/admin/users${qs({ q, page, pageSize: 20 })}`),
    placeholderData: keepPreviousData,
  });
  const projects = useQuery({
    queryKey: ['projects', 'all', pq, '', ppage],
    queryFn: () => api<Paged<ProjectSummary>>(`/projects${qs({ scope: 'all', q: pq, page: ppage, pageSize: 20 })}`),
    placeholderData: keepPreviousData,
  });

  const patch = async (u: AdminUser, body: Partial<Pick<AdminUser, 'isSuperAdmin' | 'isBanned'>>) => {
    try {
      await api(`/admin/users/${u.id}`, { method: 'PATCH', body });
      qc.invalidateQueries({ queryKey: ['admin-users'] });
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  const doReset = async () => {
    if (!resetUser) return;
    try {
      await api(`/admin/users/${resetUser.id}/reset-password`, { method: 'POST', body: { password: newPassword } });
      message.success(t('admin.resetDone', { username: resetUser.username }));
      setResetUser(null);
      setNewPassword('');
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  return (
    <div className="page-container">
      <Typography.Title level={3}>{t('admin.title')}</Typography.Title>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {['users', 'projects', 'files', 'entries'].map((k) => (
          <Col key={k} xs={12} md={6}>
            <Card variant="borderless">
              <Statistic title={t(`admin.stat.${k}`)} value={stats.data?.[k] ?? 0} loading={stats.isLoading} />
            </Card>
          </Col>
        ))}
      </Row>
      <Card variant="borderless">
        <Tabs
          items={[
            {
              key: 'users',
              label: t('admin.tab.users'),
              children: (
                <>
                  <Input.Search
                    allowClear
                    placeholder={t('admin.searchUsers')}
                    style={{ width: 300, marginBottom: 12 }}
                    onSearch={(v) => {
                      setQ(v);
                      setPage(1);
                    }}
                  />
                  <Table<AdminUser>
                    rowKey="id"
                    loading={users.isLoading}
                    dataSource={users.data?.items}
                    scroll={{ x: 820 }}
                    pagination={{ current: page, pageSize: 20, total: users.data?.total, onChange: setPage, showSizeChanger: false }}
                    columns={[
                      {
                        title: t('admin.col.user'),
                        render: (_, u) => (
                          <Space>
                            <UserAvatar user={u} size={32} />
                            <div>
                              <b>{u.displayName}</b>
                              <div className="muted small">@{u.username} · {u.email}</div>
                            </div>
                          </Space>
                        ),
                      },
                      { title: t('admin.col.projects'), width: 90, render: (_, u) => u._count.memberships },
                      { title: t('admin.col.registered'), width: 160, render: (_, u) => formatTime(u.createdAt) },
                      {
                        title: t('admin.col.superAdmin'),
                        width: 110,
                        render: (_, u) => (
                          <Switch
                            size="small"
                            checked={u.isSuperAdmin}
                            disabled={u.id === user?.id}
                            checkedChildren={<CrownOutlined />}
                            onChange={(v) => patch(u, { isSuperAdmin: v })}
                          />
                        ),
                      },
                      {
                        title: t('admin.col.status'),
                        width: 100,
                        render: (_, u) => (u.isBanned ? <Tag color="red" bordered={false}>{t('admin.banned')}</Tag> : <Tag color="green" bordered={false}>{t('admin.active')}</Tag>),
                      },
                      {
                        title: '',
                        width: 180,
                        render: (_, u) =>
                          u.id === user?.id ? null : (
                            <Space size={0}>
                              <Button type="link" size="small" onClick={() => setResetUser(u)}>
                                {t('admin.resetPassword')}
                              </Button>
                              <Button type="link" size="small" danger={!u.isBanned} icon={<StopOutlined />} onClick={() => patch(u, { isBanned: !u.isBanned })}>
                                {t(u.isBanned ? 'admin.unban' : 'admin.ban')}
                              </Button>
                            </Space>
                          ),
                      },
                    ]}
                  />
                </>
              ),
            },
            {
              key: 'projects',
              label: t('admin.tab.projects'),
              children: (
                <>
                  <Input.Search
                    allowClear
                    placeholder={t('admin.searchProjects')}
                    style={{ width: 300, marginBottom: 12 }}
                    onSearch={(v) => {
                      setPq(v);
                      setPpage(1);
                    }}
                  />
                  <Table<ProjectSummary>
                    rowKey="id"
                    loading={projects.isLoading}
                    dataSource={projects.data?.items}
                    scroll={{ x: 820 }}
                    pagination={{ current: ppage, pageSize: 20, total: projects.data?.total, onChange: setPpage, showSizeChanger: false }}
                    columns={[
                      {
                        title: t('admin.col.project'),
                        render: (_, p) => (
                          <div>
                            <Link to={`/projects/${p.id}`}>
                              <b>{p.name}</b>
                            </Link>
                            <div>
                              <EngineTag engine={p.engine} />
                              <VisibilityTag visibility={p.visibility} />
                            </div>
                          </div>
                        ),
                      },
                      { title: t('admin.col.owner'), width: 140, render: (_, p) => p.owner.displayName },
                      { title: t('admin.col.members'), width: 70, render: (_, p) => p._count.members },
                      { title: t('admin.col.progress'), width: 260, render: (_, p) => <ProgressBar stats={p.stats} height={6} /> },
                      { title: t('admin.col.updated'), width: 120, render: (_, p) => fromNow(p.updatedAt) },
                    ]}
                  />
                </>
              ),
            },
          ]}
        />
      </Card>
      <Modal title={t('admin.resetTitle', { username: resetUser?.username ?? '' })} open={!!resetUser} onCancel={() => setResetUser(null)} onOk={doReset} okButtonProps={{ disabled: newPassword.length < 8 }}>
        <Input.Password placeholder={t('admin.newPassword')} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
      </Modal>
    </div>
  );
}
