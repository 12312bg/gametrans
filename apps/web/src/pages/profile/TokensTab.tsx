import { ApiOutlined, KeyOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Empty, Form, Input, Modal, Popconfirm, Radio, Select, Space, Table, Tag, Typography } from 'antd';
import { DEFAULT_TOKEN_EXPIRY_DAYS, MAX_TOKENS_PER_USER, TOKEN_EXPIRY_DAYS, TOKEN_SCOPES, TokenScope } from '@gametrans/shared';
import dayjs from 'dayjs';
import { useState } from 'react';
import { api } from '../../api/client';
import type { ApiToken, CreatedApiToken, Paged, ProjectSummary } from '../../api/types';
import { useT } from '../../i18n';
import { errorMessage, formatTime, fromNow } from '../../utils';

interface CreateForm {
  name: string;
  scope: TokenScope;
  expiresInDays: number;
  projectId?: string;
}

export default function TokensTab() {
  const t = useT();
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
      const token = await api<CreatedApiToken>('/users/me/tokens', { method: 'POST', body: v });
      setOpen(false);
      form.resetFields();
      setCreated(token);
      qc.invalidateQueries({ queryKey: ['my-tokens'] });
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (token: ApiToken) => {
    try {
      await api(`/users/me/tokens/${token.id}`, { method: 'DELETE' });
      message.success(t('tokens.revoked', { name: token.name }));
      qc.invalidateQueries({ queryKey: ['my-tokens'] });
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  const total = tokens.data?.length ?? 0;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        icon={<ApiOutlined />}
        message={t('tokens.introTitle')}
        description={
          <span>
            {t('tokens.introBefore')} <Typography.Text code>{t('tokens.introHeader')}</Typography.Text> {t('tokens.introAfter')}{' '}
            <a href="/api/docs" target="_blank" rel="noreferrer">
              {t('nav.apiDocs')}
            </a>
            {t('tokens.introEnd')}
          </span>
        }
      />
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <Typography.Text type="secondary">{t('tokens.count', { count: total, max: MAX_TOKENS_PER_USER })}</Typography.Text>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          disabled={total >= MAX_TOKENS_PER_USER}
          onClick={() => {
            form.setFieldsValue({ name: '', scope: 'READ', expiresInDays: DEFAULT_TOKEN_EXPIRY_DAYS, projectId: undefined });
            setOpen(true);
          }}
        >
          {t('tokens.create')}
        </Button>
      </div>
      <Table<ApiToken>
        rowKey="id"
        loading={tokens.isLoading}
        dataSource={tokens.data}
        pagination={false}
        scroll={{ x: 760 }}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('tokens.empty')} /> }}
        columns={[
          {
            title: t('tokens.name'),
            render: (_, r) => (
              <div>
                <b>{r.name}</b>
                <div>
                  <Typography.Text type="secondary" code className="small">
                    {r.prefix}…
                  </Typography.Text>
                </div>
              </div>
            ),
          },
          {
            title: t('tokens.scope'),
            width: 110,
            render: (_, r) => (
              <Tag color={r.scope === 'WRITE' ? 'orange' : 'blue'} bordered={false}>
                {t(`tokenScope.${r.scope}`)}
              </Tag>
            ),
          },
          { title: t('tokens.project'), width: 180, render: (_, r) => r.project?.name ?? <Typography.Text type="secondary">{t('tokens.allProjects')}</Typography.Text> },
          {
            title: t('tokens.expiry'),
            width: 170,
            render: (_, r) => (
              <div>
                {dayjs(r.expiresAt).isBefore(dayjs()) ? (
                  <Tag color="red" bordered={false}>
                    {t('tokens.expired')}
                  </Tag>
                ) : (
                  <span>{t('tokens.daysLeft', { days: Math.max(1, dayjs(r.expiresAt).diff(dayjs(), 'day')) })}</span>
                )}
                <div className="muted small">{t('tokens.expiresAt', { time: formatTime(r.expiresAt) })}</div>
              </div>
            ),
          },
          { title: t('tokens.lastUsed'), width: 120, render: (_, r) => (r.lastUsedAt ? fromNow(r.lastUsedAt) : <span className="muted">{t('tokens.neverUsed')}</span>) },
          {
            title: '',
            width: 80,
            render: (_, r) => (
              <Popconfirm
                title={t('tokens.revokeConfirm', { name: r.name })}
                description={t('tokens.revokeDesc')}
                okText={t('tokens.revoke')}
                okButtonProps={{ danger: true }}
                onConfirm={() => revoke(r)}
              >
                <Button type="link" danger size="small">
                  {t('tokens.revoke')}
                </Button>
              </Popconfirm>
            ),
          },
        ]}
      />

      <Modal title={t('tokens.createTitle')} open={open} onCancel={() => setOpen(false)} onOk={submit} okText={t('tokens.createOk')} confirmLoading={busy} destroyOnHidden>
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="name" label={t('tokens.name')} rules={[{ required: true, message: t('tokens.nameRequired') }, { max: 60 }]}>
            <Input placeholder={t('tokens.namePlaceholder')} />
          </Form.Item>
          <Form.Item name="scope" label={t('tokens.scope')} rules={[{ required: true }]}>
            <Radio.Group>
              <Space direction="vertical">
                {TOKEN_SCOPES.map((s) => (
                  <Radio key={s} value={s}>
                    <b>{t(`tokenScope.${s}`)}</b> <span className="muted small">— {t(`tokens.scopeDesc.${s}`)}</span>
                  </Radio>
                ))}
              </Space>
            </Radio.Group>
          </Form.Item>
          <Form.Item name="expiresInDays" label={t('tokens.expiry')}>
            <Select options={TOKEN_EXPIRY_DAYS.map((d) => ({ value: d, label: d === 365 ? t('tokens.oneYear') : t('tokens.days', { days: d }) }))} />
          </Form.Item>
          <Form.Item name="projectId" label={t('tokens.limitProject')} extra={t('tokens.limitProjectHint')}>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder={t('tokens.allProjects')}
              loading={projects.isLoading}
              options={(projects.data?.items ?? []).map((p) => ({ value: p.id, label: p.name }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={
          <Space>
            <KeyOutlined /> {t('tokens.createdTitle')}
          </Space>
        }
        open={!!created}
        onCancel={() => setCreated(null)}
        footer={
          <Button type="primary" onClick={() => setCreated(null)}>
            {t('tokens.saved')}
          </Button>
        }
        width={620}
      >
        {created && (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Alert type="warning" showIcon message={t('tokens.showOnce')} />
            <Typography.Paragraph copyable={{ text: created.token, tooltips: [t('tokens.copy'), t('tokens.copied')] }} className="token-box">
              {created.token}
            </Typography.Paragraph>
            <Typography.Text type="secondary">{t('tokens.tryIt')}</Typography.Text>
            <Typography.Paragraph copyable className="code-box">
              {`curl -H "Authorization: Bearer ${created.token}" ${window.location.origin}/api/auth/me`}
            </Typography.Paragraph>
          </Space>
        )}
      </Modal>
    </Space>
  );
}
