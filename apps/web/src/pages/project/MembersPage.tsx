import { CheckOutlined, CloseOutlined, LogoutOutlined, UserAddOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Badge, Button, Card, Empty, Form, List, Modal, Popconfirm, Select, Space, Table, Tabs, Typography } from 'antd';
import { PERMISSIONS, PROJECT_ROLES, ProjectRole, canManageMember } from '@gametrans/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, qs } from '../../api/client';
import { useProject } from '../../api/project';
import type { Invitation, JoinRequest, Member, UserBrief } from '../../api/types';
import { RoleTag, UserAvatar } from '../../components/Tags';
import { useT } from '../../i18n';
import { useAuth } from '../../providers/AuthProvider';
import { errorMessage, fromNow } from '../../utils';

export default function MembersPage() {
  const t = useT();
  const { project, has } = useProject();
  const pid = project.id;
  const { user } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const canManage = has(PERMISSIONS.MANAGE_MEMBERS);
  const isSuper = !!user?.isSuperAdmin;
  const [inviteOpen, setInviteOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [reqRoles, setReqRoles] = useState<Record<string, ProjectRole>>({});
  const [form] = Form.useForm<{ username: string; role: ProjectRole }>();

  const members = useQuery({ queryKey: ['members', pid], queryFn: () => api<Member[]>(`/projects/${pid}/members`) });
  const requests = useQuery({
    queryKey: ['join-requests', pid],
    queryFn: () => api<JoinRequest[]>(`/projects/${pid}/join-requests`),
    enabled: canManage,
  });
  const invitations = useQuery({
    queryKey: ['invitations', pid],
    queryFn: () => api<Invitation[]>(`/projects/${pid}/invitations`),
    enabled: canManage,
  });
  const userSearch = useQuery({
    queryKey: ['user-search', searchQ],
    queryFn: () => api<UserBrief[]>(`/users/search${qs({ q: searchQ })}`),
    enabled: inviteOpen && searchQ.trim().length > 0,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['members', pid] });
    qc.invalidateQueries({ queryKey: ['join-requests', pid] });
    qc.invalidateQueries({ queryKey: ['invitations', pid] });
    qc.invalidateQueries({ queryKey: ['project', pid] });
  };

  const run = async (fn: () => Promise<unknown>, okKey: string) => {
    try {
      await fn();
      message.success(t(okKey));
      refresh();
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  const assignable = PROJECT_ROLES.filter((r) => r !== 'OWNER' && canManageMember(project.myRole, isSuper, 'VIEWER', r));

  const invite = async () => {
    const v = await form.validateFields();
    await run(() => api(`/projects/${pid}/invitations`, { method: 'POST', body: v }), 'members.inviteSent');
    setInviteOpen(false);
    form.resetFields();
  };

  const pendingCount = requests.data?.length ?? 0;

  const memberTable = (
    <Table<Member>
      rowKey="userId"
      loading={members.isLoading}
      dataSource={members.data}
      pagination={false}
      scroll={{ x: 640 }}
      columns={[
        {
          title: t('members.col.member'),
          render: (_, m) => (
            <Space>
              <UserAvatar user={m.user} size={32} />
              <div>
                <div>
                  <b>{m.user.displayName}</b> {m.userId === user?.id && <Typography.Text type="secondary">{t('common.me')}</Typography.Text>}
                </div>
                <Typography.Text type="secondary" className="small">
                  @{m.user.username} · {t('members.joined', { time: fromNow(m.joinedAt) })}
                </Typography.Text>
              </div>
            </Space>
          ),
        },
        {
          title: t('members.col.role'),
          width: 180,
          render: (_, m) =>
            canManage && m.userId !== user?.id && canManageMember(project.myRole, isSuper, m.role) ? (
              <Select<ProjectRole>
                size="small"
                style={{ width: 120 }}
                value={m.role}
                onChange={(role) => run(() => api(`/projects/${pid}/members/${m.userId}`, { method: 'PATCH', body: { role } }), 'members.roleUpdated')}
                options={assignable.map((r) => ({ value: r, label: t(`role.${r}`) }))}
              />
            ) : (
              <RoleTag role={m.role} />
            ),
        },
        { title: t('members.col.translated'), dataIndex: 'translated', width: 90, sorter: (a, b) => a.translated - b.translated },
        { title: t('members.col.reviewed'), dataIndex: 'reviewed', width: 90, sorter: (a, b) => a.reviewed - b.reviewed },
        {
          title: '',
          width: 110,
          render: (_, m) =>
            m.role === 'OWNER' ? null : m.userId === user?.id ? (
              <Popconfirm
                title={t('members.leaveConfirm')}
                okText={t('members.leave')}
                okButtonProps={{ danger: true }}
                onConfirm={() =>
                  run(async () => {
                    await api(`/projects/${pid}/members/${m.userId}`, { method: 'DELETE' });
                    nav('/');
                  }, 'members.left')
                }
              >
                <Button size="small" type="text" danger icon={<LogoutOutlined />}>
                  {t('members.leave')}
                </Button>
              </Popconfirm>
            ) : canManage && canManageMember(project.myRole, isSuper, m.role) ? (
              <Popconfirm
                title={t('members.removeConfirm', { name: m.user.displayName })}
                description={t('members.removeDesc')}
                okText={t('members.remove')}
                okButtonProps={{ danger: true }}
                onConfirm={() => run(() => api(`/projects/${pid}/members/${m.userId}`, { method: 'DELETE' }), 'members.removed')}
              >
                <Button size="small" type="text" danger>
                  {t('members.remove')}
                </Button>
              </Popconfirm>
            ) : null,
        },
      ]}
    />
  );

  return (
    <Card
      variant="borderless"
      title={t('members.title', { count: members.data?.length ?? 0 })}
      extra={
        canManage && (
          <Button type="primary" icon={<UserAddOutlined />} onClick={() => setInviteOpen(true)}>
            {t('members.invite')}
          </Button>
        )
      }
    >
      {canManage ? (
        <Tabs
          items={[
            { key: 'members', label: t('members.tab.list'), children: memberTable },
            {
              key: 'requests',
              label: (
                <Space size={6}>
                  {t('members.tab.requests')} <Badge count={pendingCount} size="small" />
                </Space>
              ),
              children: requests.data?.length ? (
                <List
                  dataSource={requests.data}
                  renderItem={(r) => (
                    <List.Item
                      actions={[
                        <Space key="a" wrap>
                          <Select<ProjectRole>
                            size="small"
                            value={reqRoles[r.id] ?? 'TRANSLATOR'}
                            style={{ width: 110 }}
                            options={assignable.map((x) => ({ value: x, label: t(`role.${x}`) }))}
                            onChange={(v) => setReqRoles((m) => ({ ...m, [r.id]: v }))}
                          />
                          <Button
                            size="small"
                            type="primary"
                            icon={<CheckOutlined />}
                            onClick={() =>
                              run(
                                () =>
                                  api(`/projects/${pid}/join-requests/${r.id}/approve`, {
                                    method: 'POST',
                                    body: { role: reqRoles[r.id] ?? 'TRANSLATOR' },
                                  }),
                                'members.approved',
                              )
                            }
                          >
                            {t('members.approve')}
                          </Button>
                          <Button
                            size="small"
                            icon={<CloseOutlined />}
                            onClick={() => run(() => api(`/projects/${pid}/join-requests/${r.id}/reject`, { method: 'POST' }), 'members.rejected')}
                          >
                            {t('members.reject')}
                          </Button>
                        </Space>,
                      ]}
                    >
                      <List.Item.Meta
                        avatar={<UserAvatar user={r.user} size={36} />}
                        title={
                          <Space>
                            {r.user?.displayName}
                            <Typography.Text type="secondary" className="small">
                              @{r.user?.username} · {fromNow(r.createdAt)}
                            </Typography.Text>
                          </Space>
                        }
                        description={<span className="pre-wrap">{r.message || t('members.noMessage')}</span>}
                      />
                    </List.Item>
                  )}
                />
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('members.noRequests')} />
              ),
            },
            {
              key: 'invitations',
              label: invitations.data?.length ? t('members.tab.invitationsCount', { count: invitations.data.length }) : t('members.tab.invitations'),
              children: invitations.data?.length ? (
                <List
                  dataSource={invitations.data}
                  renderItem={(inv) => (
                    <List.Item
                      actions={[
                        <Button
                          key="c"
                          size="small"
                          onClick={() => run(() => api(`/projects/${pid}/invitations/${inv.id}`, { method: 'DELETE' }), 'members.withdrawn')}
                        >
                          {t('members.withdraw')}
                        </Button>,
                      ]}
                    >
                      <Space>
                        <UserAvatar user={inv.invitee} />
                        <b>{inv.invitee?.displayName}</b>
                        <RoleTag role={inv.role} />
                        <Typography.Text type="secondary" className="small">
                          {t('members.invitedBy', { name: inv.inviter?.displayName ?? '', time: fromNow(inv.createdAt) })}
                        </Typography.Text>
                      </Space>
                    </List.Item>
                  )}
                />
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('members.noInvitations')} />
              ),
            },
          ]}
        />
      ) : (
        memberTable
      )}

      <div className="role-legend">
        {PROJECT_ROLES.map((r) => (
          <div key={r}>
            <RoleTag role={r} />
            <span className="muted small">{t(`roleDesc.${r}`)}</span>
          </div>
        ))}
      </div>

      <Modal title={t('members.invite')} open={inviteOpen} onCancel={() => setInviteOpen(false)} onOk={invite} okText={t('members.sendInvite')} destroyOnHidden>
        <Form form={form} layout="vertical" initialValues={{ role: 'TRANSLATOR' }} preserve={false}>
          <Form.Item name="username" label={t('members.user')} rules={[{ required: true, message: t('members.userRequired') }]}>
            <Select
              showSearch
              placeholder={t('members.userSearch')}
              filterOption={false}
              onSearch={setSearchQ}
              notFoundContent={t(searchQ ? 'members.userNotFound' : 'members.typeToSearch')}
              options={(userSearch.data ?? []).map((u) => ({ value: u.username, label: `${u.displayName} (@${u.username})` }))}
            />
          </Form.Item>
          <Form.Item name="role" label={t('members.col.role')} rules={[{ required: true }]}>
            <Select
              options={assignable.map((r) => ({
                value: r,
                label: (
                  <span>
                    {t(`role.${r}`)} <span className="muted small">— {t(`roleDesc.${r}`)}</span>
                  </span>
                ),
              }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
