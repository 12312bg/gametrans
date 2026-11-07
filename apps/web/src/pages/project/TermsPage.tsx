import { DeleteOutlined, DownloadOutlined, EditOutlined, ImportOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Card, Checkbox, Form, Input, Modal, Popconfirm, Space, Switch, Table, Typography } from 'antd';
import { PERMISSIONS } from '@gametrans/shared';
import { useMemo, useState } from 'react';
import { api } from '../../api/client';
import { useProject } from '../../api/project';
import type { Term } from '../../api/types';
import { UserAvatar } from '../../components/Tags';
import { errorMessage, fromNow } from '../../utils';

interface TermForm {
  term: string;
  translation: string;
  note?: string;
  caseSensitive?: boolean;
}

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export default function TermsPage() {
  const { project, has } = useProject();
  const pid = project.id;
  const qc = useQueryClient();
  const { message } = App.useApp();
  const canManage = has(PERMISSIONS.MANAGE_TERMS);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Term | null | 'new'>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm<TermForm>();

  const terms = useQuery({ queryKey: ['terms', pid], queryFn: () => api<Term[]>(`/projects/${pid}/terms`) });
  const data = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (terms.data ?? []).filter(
      (t) => !s || t.term.toLowerCase().includes(s) || t.translation.toLowerCase().includes(s) || t.note.toLowerCase().includes(s),
    );
  }, [terms.data, search]);

  const openEdit = (t: Term | 'new') => {
    setEditing(t);
    form.setFieldsValue(t === 'new' ? { term: '', translation: '', note: '', caseSensitive: false } : t);
  };

  const submit = async () => {
    const v = await form.validateFields();
    setBusy(true);
    try {
      if (editing === 'new') await api(`/projects/${pid}/terms`, { method: 'POST', body: v });
      else if (editing) await api(`/projects/${pid}/terms/${editing.id}`, { method: 'PATCH', body: v });
      message.success('已保存');
      setEditing(null);
      qc.invalidateQueries({ queryKey: ['terms', pid] });
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const doImport = async () => {
    setBusy(true);
    try {
      const r = await api<{ created: number; updated: number; skipped: number }>(`/projects/${pid}/terms/import`, {
        method: 'POST',
        body: { text: importText, overwrite },
      });
      message.success(`导入完成：新增 ${r.created}，更新 ${r.updated}，跳过 ${r.skipped}`);
      setImportOpen(false);
      setImportText('');
      qc.invalidateQueries({ queryKey: ['terms', pid] });
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = () => {
    const rows = ['term,translation,note', ...(terms.data ?? []).map((t) => [t.term, t.translation, t.note].map(csvCell).join(','))];
    const blob = new Blob([`﻿${rows.join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${project.name}-术语表.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Card
      variant="borderless"
      title={`术语表（${terms.data?.length ?? 0}）`}
      extra={
        <Space wrap>
          <Input.Search allowClear placeholder="搜索术语 / 译法 / 备注" onChange={(e) => setSearch(e.target.value)} style={{ width: 240 }} />
          <Button icon={<DownloadOutlined />} onClick={exportCsv} disabled={!terms.data?.length}>
            导出 CSV
          </Button>
          {canManage && (
            <>
              <Button icon={<ImportOutlined />} onClick={() => setImportOpen(true)}>
                批量导入
              </Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => openEdit('new')}>
                添加术语
              </Button>
            </>
          )}
        </Space>
      }
    >
      <Typography.Paragraph type="secondary">
        术语会在翻译编辑器的原文中高亮显示，鼠标悬停即可查看约定译法；译文未使用约定译法时会给出提示。
        {!canManage && ' 术语表由审核员及以上角色维护。'}
      </Typography.Paragraph>
      <Table<Term>
        rowKey="id"
        loading={terms.isLoading}
        dataSource={data}
        pagination={{ pageSize: 50, showSizeChanger: false, hideOnSinglePage: true }}
        scroll={{ x: 700 }}
        columns={[
          { title: '术语', dataIndex: 'term', width: 220, render: (v: string, t) => <span className="term-src">{v}{t.caseSensitive && <Typography.Text type="secondary" className="small"> (区分大小写)</Typography.Text>}</span> },
          { title: '译法', dataIndex: 'translation', width: 220, render: (v: string) => <b>{v}</b> },
          { title: '备注', dataIndex: 'note', render: (v: string) => <span className="pre-wrap">{v}</span> },
          {
            title: '添加者',
            width: 160,
            render: (_, t) => (
              <Space size={6}>
                <UserAvatar user={t.createdBy} />
                <Typography.Text type="secondary" className="small">{fromNow(t.updatedAt)}</Typography.Text>
              </Space>
            ),
          },
          ...(canManage
            ? [
                {
                  title: '',
                  width: 96,
                  render: (_: unknown, t: Term) => (
                    <Space size={0}>
                      <Button type="text" icon={<EditOutlined />} onClick={() => openEdit(t)} />
                      <Popconfirm
                        title="删除该术语？"
                        okButtonProps={{ danger: true }}
                        okText="删除"
                        onConfirm={async () => {
                          await api(`/projects/${pid}/terms/${t.id}`, { method: 'DELETE' });
                          qc.invalidateQueries({ queryKey: ['terms', pid] });
                        }}
                      >
                        <Button type="text" danger icon={<DeleteOutlined />} />
                      </Popconfirm>
                    </Space>
                  ),
                },
              ]
            : []),
        ]}
      />

      <Modal
        title={editing === 'new' ? '添加术语' : '编辑术语'}
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={submit}
        confirmLoading={busy}
        okText="保存"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="term" label="术语（原文）" rules={[{ required: true, message: '请输入术语' }, { max: 200 }]}>
            <Input placeholder="例如：エリック" />
          </Form.Item>
          <Form.Item name="translation" label="译法" rules={[{ required: true, message: '请输入译法' }, { max: 500 }]}>
            <Input placeholder="例如：埃里克" />
          </Form.Item>
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={3} maxLength={1000} placeholder="使用说明、出处等" />
          </Form.Item>
          <Form.Item name="caseSensitive" label="区分大小写" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="批量导入术语" open={importOpen} onCancel={() => setImportOpen(false)} onOk={doImport} confirmLoading={busy} okText="导入" width={640}>
        <Typography.Paragraph type="secondary">
          每行一条，格式为「术语,译法,备注」，也可以用 Tab 分隔（可直接从表格复制）。以 # 开头的行会被忽略。
        </Typography.Paragraph>
        <Input.TextArea rows={12} value={importText} onChange={(e) => setImportText(e.target.value)} placeholder={'エリック,埃里克,主角\nポーション,回复药'} />
        <Checkbox style={{ marginTop: 12 }} checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)}>
          已存在的术语用导入的译法覆盖
        </Checkbox>
      </Modal>
    </Card>
  );
}
