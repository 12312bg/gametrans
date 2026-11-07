import { CrownOutlined, StopOutlined } from '@ant-design/icons';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Card, Col, Input, Modal, Row, Space, Statistic, Switch, Table, Tabs, Tag, Typography } from 'antd';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../../api/client';
import type { AdminUser, Paged, ProjectSummary } from '../../api/types';
import { useAuth } from '../../auth';
import { ProgressBar } from '../../components/ProgressBar';
import { EngineTag, UserAvatar, VisibilityTag } from '../../components/Tags';
import { errorMessage, formatTime, fromNow } from '../../utils';

export default function AdminPage() {
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
      message.success(`已重置 ${resetUser.username} 的密码`);
      setResetUser(null);
      setNewPassword('');
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  return (
    <div className="page-container">
      <Typography.Title level={3}>管理后台</Typography.Title>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {[
          ['users', '用户'],
          ['projects', '项目'],
          ['files', '文件'],
          ['entries', '词条'],
        ].map(([k, label]) => (
          <Col key={k} xs={12} md={6}>
            <Card variant="borderless">
              <Statistic title={label} value={stats.data?.[k] ?? 0} loading={stats.isLoading} />
            </Card>
          </Col>
        ))}
      </Row>
      <Card variant="borderless">
        <Tabs
          items={[
            {
              key: 'users',
              label: '用户管理',
              children: (
                <>
                  <Input.Search
                    allowClear
                    placeholder="搜索用户名 / 邮箱 / 昵称"
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
                        title: '用户',
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
                      { title: '项目数', width: 90, render: (_, u) => u._count.memberships },
                      { title: '注册时间', width: 160, render: (_, u) => formatTime(u.createdAt) },
                      {
                        title: '超级管理员',
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
                        title: '状态',
                        width: 100,
                        render: (_, u) => (u.isBanned ? <Tag color="red" bordered={false}>已封禁</Tag> : <Tag color="green" bordered={false}>正常</Tag>),
                      },
                      {
                        title: '',
                        width: 180,
                        render: (_, u) =>
                          u.id === user?.id ? null : (
                            <Space size={0}>
                              <Button type="link" size="small" onClick={() => setResetUser(u)}>
                                重置密码
                              </Button>
                              <Button type="link" size="small" danger={!u.isBanned} icon={<StopOutlined />} onClick={() => patch(u, { isBanned: !u.isBanned })}>
                                {u.isBanned ? '解封' : '封禁'}
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
              label: '全部项目',
              children: (
                <>
                  <Input.Search
                    allowClear
                    placeholder="搜索项目"
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
                        title: '项目',
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
                      { title: '所有者', width: 140, render: (_, p) => p.owner.displayName },
                      { title: '成员', width: 70, render: (_, p) => p._count.members },
                      { title: '进度', width: 260, render: (_, p) => <ProgressBar stats={p.stats} height={6} /> },
                      { title: '更新', width: 120, render: (_, p) => fromNow(p.updatedAt) },
                    ]}
                  />
                </>
              ),
            },
          ]}
        />
      </Card>
      <Modal title={`重置 ${resetUser?.username ?? ''} 的密码`} open={!!resetUser} onCancel={() => setResetUser(null)} onOk={doReset} okButtonProps={{ disabled: newPassword.length < 8 }}>
        <Input.Password placeholder="新密码（至少 8 位）" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
      </Modal>
    </div>
  );
}
