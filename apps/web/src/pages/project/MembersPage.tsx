import { CheckOutlined, CloseOutlined, LogoutOutlined, UserAddOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Badge, Button, Card, Empty, Form, List, Modal, Popconfirm, Select, Space, Table, Tabs, Typography } from 'antd';
import { PERMISSIONS, PROJECT_ROLES, ProjectRole, ROLE_LABELS, canManageMember } from '@gametrans/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, qs } from '../../api/client';
import { useProject } from '../../api/project';
import type { Invitation, JoinRequest, Member, UserBrief } from '../../api/types';
import { useAuth } from '../../auth';
import { RoleTag, UserAvatar } from '../../components/Tags';
import { errorMessage, fromNow } from '../../utils';

const ROLE_DESC: Record<ProjectRole, string> = {
  OWNER: '拥有全部权限，可转让、删除项目',
  ADMIN: '管理文件、成员、导出、项目设置，可锁定/隐藏词条',
  REVIEWER: '翻译 + 审核定稿、修改已审核词条、维护术语表',
  TRANSLATOR: '翻译未审核的词条、标记疑问',
  VIEWER: '只读浏览，可下载导出包',
};

export default function MembersPage() {
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

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      message.success(ok);
      refresh();
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  const assignable = PROJECT_ROLES.filter((r) => r !== 'OWNER' && canManageMember(project.myRole, isSuper, 'VIEWER', r));

  const invite = async () => {
    const v = await form.validateFields();
    await run(() => api(`/projects/${pid}/invitations`, { method: 'POST', body: v }), '邀请已发送，对方接受后即可加入');
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
          title: '成员',
          render: (_, m) => (
            <Space>
              <UserAvatar user={m.user} size={32} />
              <div>
                <div>
                  <b>{m.user.displayName}</b> {m.userId === user?.id && <Typography.Text type="secondary">（我）</Typography.Text>}
                </div>
                <Typography.Text type="secondary" className="small">
                  @{m.user.username} · {fromNow(m.joinedAt)}加入
                </Typography.Text>
              </div>
            </Space>
          ),
        },
        {
          title: '角色',
          width: 180,
          render: (_, m) =>
            canManage && m.userId !== user?.id && canManageMember(project.myRole, isSuper, m.role) ? (
              <Select<ProjectRole>
                size="small"
                style={{ width: 120 }}
                value={m.role}
                onChange={(role) => run(() => api(`/projects/${pid}/members/${m.userId}`, { method: 'PATCH', body: { role } }), '角色已更新')}
                options={assignable.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
              />
            ) : (
              <RoleTag role={m.role} />
            ),
        },
        { title: '翻译', dataIndex: 'translated', width: 90, sorter: (a, b) => a.translated - b.translated },
        { title: '审核', dataIndex: 'reviewed', width: 90, sorter: (a, b) => a.reviewed - b.reviewed },
        {
          title: '',
          width: 110,
          render: (_, m) =>
            m.role === 'OWNER' ? null : m.userId === user?.id ? (
              <Popconfirm
                title="退出该项目？"
                okText="退出"
                okButtonProps={{ danger: true }}
                onConfirm={() =>
                  run(async () => {
                    await api(`/projects/${pid}/members/${m.userId}`, { method: 'DELETE' });
                    nav('/');
                  }, '已退出项目')
                }
              >
                <Button size="small" type="text" danger icon={<LogoutOutlined />}>
                  退出
                </Button>
              </Popconfirm>
            ) : canManage && canManageMember(project.myRole, isSuper, m.role) ? (
              <Popconfirm
                title={`将 ${m.user.displayName} 移出项目？`}
                description="其已提交的译文会保留。"
                okText="移出"
                okButtonProps={{ danger: true }}
                onConfirm={() => run(() => api(`/projects/${pid}/members/${m.userId}`, { method: 'DELETE' }), '已移出')}
              >
                <Button size="small" type="text" danger>
                  移出
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
      title={`成员（${members.data?.length ?? 0}）`}
      extra={
        canManage && (
          <Button type="primary" icon={<UserAddOutlined />} onClick={() => setInviteOpen(true)}>
            邀请成员
          </Button>
        )
      }
    >
      {canManage ? (
        <Tabs
          items={[
            { key: 'members', label: '成员列表', children: memberTable },
            {
              key: 'requests',
              label: (
                <Space size={6}>
                  加入申请 <Badge count={pendingCount} size="small" />
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
                            options={assignable.map((x) => ({ value: x, label: ROLE_LABELS[x] }))}
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
                                '已批准',
                              )
                            }
                          >
                            批准
                          </Button>
                          <Button
                            size="small"
                            icon={<CloseOutlined />}
                            onClick={() => run(() => api(`/projects/${pid}/join-requests/${r.id}/reject`, { method: 'POST' }), '已拒绝')}
                          >
                            拒绝
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
                        description={<span className="pre-wrap">{r.message || '（未填写申请说明）'}</span>}
                      />
                    </List.Item>
                  )}
                />
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有待处理的申请" />
              ),
            },
            {
              key: 'invitations',
              label: `已发出的邀请${invitations.data?.length ? `（${invitations.data.length}）` : ''}`,
              children: invitations.data?.length ? (
                <List
                  dataSource={invitations.data}
                  renderItem={(inv) => (
                    <List.Item
                      actions={[
                        <Button
                          key="c"
                          size="small"
                          onClick={() => run(() => api(`/projects/${pid}/invitations/${inv.id}`, { method: 'DELETE' }), '已撤回邀请')}
                        >
                          撤回
                        </Button>,
                      ]}
                    >
                      <Space>
                        <UserAvatar user={inv.invitee} />
                        <b>{inv.invitee?.displayName}</b>
                        <RoleTag role={inv.role} />
                        <Typography.Text type="secondary" className="small">
                          由 {inv.inviter?.displayName} 于 {fromNow(inv.createdAt)}邀请
                        </Typography.Text>
                      </Space>
                    </List.Item>
                  )}
                />
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有待接受的邀请" />
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
            <span className="muted small">{ROLE_DESC[r]}</span>
          </div>
        ))}
      </div>

      <Modal title="邀请成员" open={inviteOpen} onCancel={() => setInviteOpen(false)} onOk={invite} okText="发送邀请" destroyOnHidden>
        <Form form={form} layout="vertical" initialValues={{ role: 'TRANSLATOR' }} preserve={false}>
          <Form.Item name="username" label="用户" rules={[{ required: true, message: '请选择或输入用户名' }]}>
            <Select
              showSearch
              placeholder="输入用户名或昵称搜索"
              filterOption={false}
              onSearch={setSearchQ}
              notFoundContent={searchQ ? '没有找到用户' : '输入关键字搜索'}
              options={(userSearch.data ?? []).map((u) => ({ value: u.username, label: `${u.displayName} (@${u.username})` }))}
            />
          </Form.Item>
          <Form.Item name="role" label="角色" rules={[{ required: true }]}>
            <Select
              options={assignable.map((r) => ({
                value: r,
                label: (
                  <span>
                    {ROLE_LABELS[r]} <span className="muted small">— {ROLE_DESC[r]}</span>
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
