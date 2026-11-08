import { CheckCircleFilled, CloseCircleFilled, DeleteOutlined, DownloadOutlined, ExportOutlined, LoadingOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Card, Checkbox, Col, Form, Popconfirm, Progress, Row, Select, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { PERMISSIONS, Stage } from '@gametrans/shared';
import { useState } from 'react';
import { api } from '../../api/client';
import { useProject } from '../../api/project';
import type { ExportResultData, FileItem, Job } from '../../api/types';
import { StageDot } from '../../components/Tags';
import { useT } from '../../i18n';
import { issueText, jobErrorText } from '../../i18n/format';
import { errorMessage, formatSize, formatTime, fromNow } from '../../utils';

const EXPORTABLE: Stage[] = ['TRANSLATED', 'QUESTIONED', 'REVIEWED', 'LOCKED'];

interface ExportForm {
  stages: Stage[];
  fileIds: string[];
  includeJson: boolean;
}

export default function ExportsPage() {
  const t = useT();
  const { project, has } = useProject();
  const pid = project.id;
  const qc = useQueryClient();
  const { message } = App.useApp();
  const canCreate = has(PERMISSIONS.CREATE_EXPORT);
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm<ExportForm>();

  const files = useQuery({ queryKey: ['files', pid], queryFn: () => api<FileItem[]>(`/projects/${pid}/files`), enabled: canCreate });
  const exports = useQuery({
    queryKey: ['exports', pid],
    queryFn: () => api<Job<ExportResultData>[]>(`/projects/${pid}/exports`),
    refetchInterval: (q) => (q.state.data?.some((j) => j.status === 'QUEUED' || j.status === 'RUNNING') ? 1500 : false),
  });

  const create = async (v: ExportForm) => {
    setBusy(true);
    try {
      await api(`/projects/${pid}/exports`, {
        method: 'POST',
        body: { stages: v.stages, fileIds: v.fileIds?.length ? v.fileIds : undefined, includeJson: v.includeJson },
      });
      message.success(t('exports.started'));
      qc.invalidateQueries({ queryKey: ['exports', pid] });
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Row gutter={[16, 16]}>
      {canCreate && (
        <Col xs={24} lg={9}>
          <Card variant="borderless" title={t('exports.create')}>
            <Form
              form={form}
              layout="vertical"
              onFinish={create}
              initialValues={{ stages: EXPORTABLE, fileIds: [], includeJson: false }}
            >
              <Form.Item name="stages" label={t('exports.stages')} rules={[{ required: true, message: t('exports.stagesRequired') }]}>
                <Checkbox.Group>
                  <Space direction="vertical">
                    {EXPORTABLE.map((s) => (
                      <Checkbox key={s} value={s}>
                        <Space size={6}>
                          <StageDot stage={s} />
                          {t(`stage.${s}`)}
                        </Space>
                      </Checkbox>
                    ))}
                  </Space>
                </Checkbox.Group>
              </Form.Item>
              <Form.Item name="fileIds" label={t('exports.files')} extra={t('exports.filesHint')}>
                <Select
                  mode="multiple"
                  allowClear
                  placeholder={t('exports.allFiles')}
                  maxTagCount="responsive"
                  options={(files.data ?? []).map((f) => ({ value: f.id, label: f.path }))}
                  optionFilterProp="label"
                />
              </Form.Item>
              <Form.Item name="includeJson" valuePropName="checked">
                <Checkbox>{t('exports.includeJson')}</Checkbox>
              </Form.Item>
              <Button type="primary" htmlType="submit" icon={<ExportOutlined />} loading={busy} block>
                {t('exports.create')}
              </Button>
            </Form>
            <Alert
              style={{ marginTop: 16 }}
              type="info"
              showIcon
              message={t('exports.hint')}
            />
          </Card>
        </Col>
      )}
      <Col xs={24} lg={canCreate ? 15 : 24}>
        <Card variant="borderless" title={t('exports.history')}>
          <Table<Job<ExportResultData>>
            rowKey="id"
            loading={exports.isLoading}
            dataSource={exports.data}
            pagination={false}
            scroll={{ x: 640 }}
            columns={[
              {
                title: t('exports.col.status'),
                width: 140,
                render: (_, j) =>
                  j.status === 'SUCCEEDED' ? (
                    <Space>
                      <CheckCircleFilled style={{ color: '#10b981' }} />
                      {t('exports.succeeded')}
                    </Space>
                  ) : j.status === 'FAILED' ? (
                    <Tooltip title={jobErrorText(j.error, t)}>
                      <Space>
                        <CloseCircleFilled style={{ color: '#ef4444' }} />
                        {t('exports.failed')}
                      </Space>
                    </Tooltip>
                  ) : (
                    <Space>
                      <LoadingOutlined />
                      <Progress percent={j.progress} size="small" style={{ width: 70, margin: 0 }} showInfo={false} />
                    </Space>
                  ),
              },
              {
                title: t('exports.col.content'),
                render: (_, j) => (
                  <div>
                    <Space size={4} wrap>
                      {(j.payload?.stages ?? []).map((s) => (
                        <Tag key={s} bordered={false}>
                          {t(`stage.${s}`)}
                        </Tag>
                      ))}
                      {j.payload?.fileIds?.length ? <Tag bordered={false}>{t('exports.fileCount', { count: j.payload.fileIds.length })}</Tag> : null}
                      {j.payload?.includeJson && <Tag bordered={false}>{t('exports.withJson')}</Tag>}
                    </Space>
                    {j.result && (
                      <div className="muted small" style={{ marginTop: 4 }}>
                        {t('exports.summary', { files: j.result.fileCount, applied: j.result.applied.toLocaleString(), size: formatSize(j.result.size) })}
                        {j.result.errors.length > 0 && (
                          <Tooltip title={j.result.errors.map((e) => `${e.name}: ${issueText(e, t)}`).join('\n')} overlayClassName="pre-wrap">
                            <Typography.Text type="danger">{t('exports.failedFiles', { count: j.result.errors.length })}</Typography.Text>
                          </Tooltip>
                        )}
                      </div>
                    )}
                  </div>
                ),
              },
              {
                title: t('exports.col.created'),
                width: 160,
                render: (_, j) => (
                  <Tooltip title={formatTime(j.createdAt)}>
                    <div>
                      <div>{j.createdBy?.displayName}</div>
                      <div className="muted small">{fromNow(j.createdAt)}</div>
                    </div>
                  </Tooltip>
                ),
              },
              {
                title: '',
                width: 130,
                render: (_, j) => (
                  <Space size={0}>
                    {j.status === 'SUCCEEDED' && (
                      <Button type="link" icon={<DownloadOutlined />} href={`/api/projects/${pid}/exports/${j.id}/download`}>
                        {t('exports.download')}
                      </Button>
                    )}
                    {canCreate && (
                      <Popconfirm
                        title={t('exports.deleteConfirm')}
                        okText={t('common.delete')}
                        okButtonProps={{ danger: true }}
                        onConfirm={async () => {
                          await api(`/projects/${pid}/exports/${j.id}`, { method: 'DELETE' });
                          qc.invalidateQueries({ queryKey: ['exports', pid] });
                        }}
                      >
                        <Button type="text" danger icon={<DeleteOutlined />} />
                      </Popconfirm>
                    )}
                  </Space>
                ),
              },
            ]}
          />
        </Card>
      </Col>
    </Row>
  );
}
