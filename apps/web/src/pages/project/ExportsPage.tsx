import { CheckCircleFilled, CloseCircleFilled, DeleteOutlined, DownloadOutlined, ExportOutlined, LoadingOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Card, Checkbox, Col, Form, Popconfirm, Progress, Row, Select, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { PERMISSIONS, STAGE_LABELS, Stage } from '@gametrans/shared';
import { useState } from 'react';
import { api } from '../../api/client';
import { useProject } from '../../api/project';
import type { ExportResultData, FileItem, Job } from '../../api/types';
import { StageDot } from '../../components/Tags';
import { errorMessage, formatSize, formatTime, fromNow } from '../../utils';

const EXPORTABLE: Stage[] = ['TRANSLATED', 'QUESTIONED', 'REVIEWED', 'LOCKED'];

interface ExportForm {
  stages: Stage[];
  fileIds: string[];
  includeJson: boolean;
}

export default function ExportsPage() {
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
      message.success('已开始生成导出包');
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
          <Card variant="borderless" title="生成导出包">
            <Form
              form={form}
              layout="vertical"
              onFinish={create}
              initialValues={{ stages: ['TRANSLATED', 'QUESTIONED', 'REVIEWED', 'LOCKED'], fileIds: [], includeJson: false }}
            >
              <Form.Item name="stages" label="写入哪些状态的译文" rules={[{ required: true, message: '至少选择一种' }]}>
                <Checkbox.Group>
                  <Space direction="vertical">
                    {EXPORTABLE.map((s) => (
                      <Checkbox key={s} value={s}>
                        <Space size={6}>
                          <StageDot stage={s} />
                          {STAGE_LABELS[s]}
                        </Space>
                      </Checkbox>
                    ))}
                  </Space>
                </Checkbox.Group>
              </Form.Item>
              <Form.Item name="fileIds" label="文件范围" extra="留空表示全部文件">
                <Select
                  mode="multiple"
                  allowClear
                  placeholder="全部文件"
                  maxTagCount="responsive"
                  options={(files.data ?? []).map((f) => ({ value: f.id, label: f.path }))}
                  optionFilterProp="label"
                />
              </Form.Item>
              <Form.Item name="includeJson" valuePropName="checked">
                <Checkbox>附带译文 JSON（ParaTranz 兼容格式，便于备份或迁移）</Checkbox>
              </Form.Item>
              <Button type="primary" htmlType="submit" icon={<ExportOutlined />} loading={busy} block>
                生成导出包
              </Button>
            </Form>
            <Alert
              style={{ marginTop: 16 }}
              type="info"
              showIcon
              message="导出包保留游戏目录结构（如 data/、Data/、js/），解压后直接覆盖到游戏根目录即可。未翻译、已隐藏的词条保持原文。"
            />
          </Card>
        </Col>
      )}
      <Col xs={24} lg={canCreate ? 15 : 24}>
        <Card variant="borderless" title="导出记录">
          <Table<Job<ExportResultData>>
            rowKey="id"
            loading={exports.isLoading}
            dataSource={exports.data}
            pagination={false}
            scroll={{ x: 640 }}
            columns={[
              {
                title: '状态',
                width: 140,
                render: (_, j) =>
                  j.status === 'SUCCEEDED' ? (
                    <Space>
                      <CheckCircleFilled style={{ color: '#10b981' }} />
                      完成
                    </Space>
                  ) : j.status === 'FAILED' ? (
                    <Tooltip title={j.error}>
                      <Space>
                        <CloseCircleFilled style={{ color: '#ef4444' }} />
                        失败
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
                title: '内容',
                render: (_, j) => (
                  <div>
                    <Space size={4} wrap>
                      {(j.payload?.stages ?? []).map((s) => (
                        <Tag key={s} bordered={false}>
                          {STAGE_LABELS[s]}
                        </Tag>
                      ))}
                      {j.payload?.fileIds?.length ? <Tag bordered={false}>{j.payload.fileIds.length} 个文件</Tag> : null}
                      {j.payload?.includeJson && <Tag bordered={false}>含 JSON</Tag>}
                    </Space>
                    {j.result && (
                      <div className="muted small" style={{ marginTop: 4 }}>
                        {j.result.fileCount} 个文件 · 写入 {j.result.applied.toLocaleString()} 条译文 · {formatSize(j.result.size)}
                        {j.result.errors.length > 0 && (
                          <Typography.Text type="danger"> · {j.result.errors.length} 个文件失败</Typography.Text>
                        )}
                      </div>
                    )}
                  </div>
                ),
              },
              {
                title: '创建',
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
                        下载
                      </Button>
                    )}
                    {canCreate && (
                      <Popconfirm
                        title="删除这条导出记录？"
                        okText="删除"
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
