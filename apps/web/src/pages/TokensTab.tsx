import { ApiOutlined, KeyOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Empty, Form, Input, Modal, Popconfirm, Radio, Select, Space, Table, Tag, Typography } from 'antd';
import {
  DEFAULT_TOKEN_EXPIRY_DAYS,
  MAX_TOKENS_PER_USER,
  TOKEN_EXPIRY_DAYS,
  TOKEN_SCOPE_LABELS,
  TokenScope,
} from '@gametrans/shared';
import dayjs from 'dayjs';
import { useState } from 'react';
import { api } from '../api/client';
import type { ApiToken, CreatedApiToken, Paged, ProjectSummary } from '../api/types';
import { errorMessage, formatTime, fromNow } from '../utils';

interface CreateForm {
  name: string;
  scope: TokenScope;
  expiresInDays: number;
  projectId?: string;
}

const SCOPE_DESC: Record<TokenScope, string> = {
  READ: '只能查询与下载（GET 请求），适合同步词条、统计进度',
  WRITE: '可执行你在项目中的角色允许的全部操作，如提交译文、上传文件、生成导出',
};

export default function TokensTab() {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<CreateForm>();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<CreatedApiToken | null>(null);
  const tokens = useQuery({ queryKey: ['my-tokens'], queryFn: () => api<ApiToken[]>('/users/me/tokens') });
  const projects = useQuery({
    queryKey: ['projects', 'mine', 'token-picker'],
    queryFn: () => api<Paged<ProjectSummary>>('/projects?scope=mine&pageSize=100'),
    enabled: open,
  });

  const submit = async () => {
    const v = await form.validateFields();
    setBusy(true);
    try {
      const t = await api<CreatedApiToken>('/users/me/tokens', { method: 'POST', body: v });
      setOpen(false);
      form.resetFields();
      setCreated(t);
      qc.invalidateQueries({ queryKey: ['my-tokens'] });
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (t: ApiToken) => {
    try {
      await api(`/users/me/tokens/${t.id}`, { method: 'DELETE' });
      message.success(`已撤销「${t.name}」`);
      qc.invalidateQueries({ queryKey: ['my-tokens'] });
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  const origin = window.location.origin;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        icon={<ApiOutlined />}
        message="供脚本、CI、机器人调用接口使用"
        description={
          <span>
            请求时添加请求头 <Typography.Text code>Authorization: Bearer 令牌</Typography.Text>。令牌的权限不会超过你在各项目中的角色，且不包含超级管理员权限。
            接口说明见{' '}
            <a href="/api/docs" target="_blank" rel="noreferrer">
              API 文档
            </a>
            。
          </span>
        }
      />
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <Typography.Text type="secondary">
          已创建 {tokens.data?.length ?? 0} / {MAX_TOKENS_PER_USER} 个
        </Typography.Text>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          disabled={(tokens.data?.length ?? 0) >= MAX_TOKENS_PER_USER}
          onClick={() => {
            form.setFieldsValue({ name: '', scope: 'READ', expiresInDays: DEFAULT_TOKEN_EXPIRY_DAYS, projectId: undefined });
            setOpen(true);
          }}
        >
          创建令牌
        </Button>
      </div>
      <Table<ApiToken>
        rowKey="id"
        loading={tokens.isLoading}
        dataSource={tokens.data}
        pagination={false}
        scroll={{ x: 760 }}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有 API 令牌" /> }}
        columns={[
          {
            title: '名称',
            render: (_, t) => (
              <div>
                <b>{t.name}</b>
                <div>
                  <Typography.Text type="secondary" code className="small">
                    {t.prefix}…
                  </Typography.Text>
                </div>
              </div>
            ),
          },
          {
            title: '权限',
            width: 90,
            render: (_, t) => (
              <Tag color={t.scope === 'WRITE' ? 'orange' : 'blue'} bordered={false}>
                {TOKEN_SCOPE_LABELS[t.scope]}
              </Tag>
            ),
          },
          { title: '项目', width: 180, render: (_, t) => (t.project ? t.project.name : <Typography.Text type="secondary">全部参与的项目</Typography.Text>) },
          {
            title: '有效期',
            width: 170,
            render: (_, t) => {
              const expired = dayjs(t.expiresAt).isBefore(dayjs());
              return (
                <div>
                  {expired ? (
                    <Tag color="red" bordered={false}>
                      已过期
                    </Tag>
                  ) : (
                    <span>剩余 {Math.max(1, dayjs(t.expiresAt).diff(dayjs(), 'day'))} 天</span>
                  )}
                  <div className="muted small">{formatTime(t.expiresAt)} 到期</div>
                </div>
              );
            },
          },
          { title: '最近使用', width: 120, render: (_, t) => (t.lastUsedAt ? fromNow(t.lastUsedAt) : <span className="muted">从未使用</span>) },
          {
            title: '',
            width: 80,
            render: (_, t) => (
              <Popconfirm title={`撤销令牌「${t.name}」？`} description="撤销后使用该令牌的脚本会立即失效。" okText="撤销" okButtonProps={{ danger: true }} onConfirm={() => revoke(t)}>
                <Button type="link" danger size="small">
                  撤销
                </Button>
              </Popconfirm>
            ),
          },
        ]}
      />

      <Modal title="创建 API 令牌" open={open} onCancel={() => setOpen(false)} onOk={submit} okText="创建" confirmLoading={busy} destroyOnHidden>
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请填写名称' }, { max: 60 }]}>
            <Input placeholder="用途，例如：机翻脚本、CI 自动导出" />
          </Form.Item>
          <Form.Item name="scope" label="权限" rules={[{ required: true }]}>
            <Radio.Group>
              <Space direction="vertical">
                {(['READ', 'WRITE'] as TokenScope[]).map((s) => (
                  <Radio key={s} value={s}>
                    <b>{TOKEN_SCOPE_LABELS[s]}</b> <span className="muted small">— {SCOPE_DESC[s]}</span>
                  </Radio>
                ))}
              </Space>
            </Radio.Group>
          </Form.Item>
          <Form.Item name="expiresInDays" label="有效期">
            <Select options={TOKEN_EXPIRY_DAYS.map((d) => ({ value: d, label: d === 365 ? '1 年' : `${d} 天` }))} />
          </Form.Item>
          <Form.Item name="projectId" label="限定项目" extra="限定后只能访问该项目的接口；不选表示你参与的全部项目">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="全部参与的项目"
              loading={projects.isLoading}
              options={(projects.data?.items ?? []).map((p) => ({ value: p.id, label: p.name }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={
          <Space>
            <KeyOutlined /> 令牌已创建
          </Space>
        }
        open={!!created}
        onCancel={() => setCreated(null)}
        footer={
          <Button type="primary" onClick={() => setCreated(null)}>
            我已保存
          </Button>
        }
        width={620}
      >
        {created && (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Alert type="warning" showIcon message="令牌只显示这一次，关闭后无法再次查看，请立即复制保存。" />
            <Typography.Paragraph copyable={{ text: created.token, tooltips: ['复制令牌', '已复制'] }} className="token-box">
              {created.token}
            </Typography.Paragraph>
            <Typography.Text type="secondary">试一试：</Typography.Text>
            <Typography.Paragraph copyable className="code-box">
              {`curl -H "Authorization: Bearer ${created.token}" ${origin}/api/auth/me`}
            </Typography.Paragraph>
          </Space>
        )}
      </Modal>
    </Space>
  );
}
