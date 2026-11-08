import { DeleteOutlined, DownloadOutlined, EditOutlined, ImportOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Card, Checkbox, Form, Input, Modal, Popconfirm, Space, Switch, Table, Typography } from 'antd';
import { PERMISSIONS } from '@gametrans/shared';
import { useMemo, useState } from 'react';
import { api } from '../../api/client';
import { useProject } from '../../api/project';
import type { Term } from '../../api/types';
import { UserAvatar } from '../../components/Tags';
import { useT } from '../../i18n';
import { errorMessage, fromNow } from '../../utils';

interface TermForm {
  term: string;
  translation: string;
  note?: string;
  caseSensitive?: boolean;
}

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export default function TermsPage() {
  const t = useT();
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
    return (terms.data ?? []).filter((x) => !s || [x.term, x.translation, x.note].some((v) => v.toLowerCase().includes(s)));
  }, [terms.data, search]);

  const openEdit = (x: Term | 'new') => {
    setEditing(x);
    form.setFieldsValue(x === 'new' ? { term: '', translation: '', note: '', caseSensitive: false } : x);
  };

  const submit = async () => {
    const v = await form.validateFields();
    setBusy(true);
    try {
      if (editing === 'new') await api(`/projects/${pid}/terms`, { method: 'POST', body: v });
      else if (editing) await api(`/projects/${pid}/terms/${editing.id}`, { method: 'PATCH', body: v });
      message.success(t('terms.saved'));
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
      message.success(t('terms.imported', r));
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
    const rows = ['term,translation,note', ...(terms.data ?? []).map((x) => [x.term, x.translation, x.note].map(csvCell).join(','))];
    const blob = new Blob([`﻿${rows.join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = t('terms.csvName', { name: project.name });
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Card
      variant="borderless"
      title={t('terms.title', { count: terms.data?.length ?? 0 })}
      extra={
        <Space wrap>
          <Input.Search allowClear placeholder={t('terms.search')} onChange={(e) => setSearch(e.target.value)} style={{ width: 240 }} />
          <Button icon={<DownloadOutlined />} onClick={exportCsv} disabled={!terms.data?.length}>
            {t('terms.exportCsv')}
          </Button>
          {canManage && (
            <>
              <Button icon={<ImportOutlined />} onClick={() => setImportOpen(true)}>
                {t('terms.import')}
              </Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => openEdit('new')}>
                {t('terms.add')}
              </Button>
            </>
          )}
        </Space>
      }
    >
      <Typography.Paragraph type="secondary">
        {t('terms.intro')}
        {!canManage && t('terms.introReadonly')}
      </Typography.Paragraph>
      <Table<Term>
        rowKey="id"
        loading={terms.isLoading}
        dataSource={data}
        pagination={{ pageSize: 50, showSizeChanger: false, hideOnSinglePage: true }}
        scroll={{ x: 700 }}
        columns={[
          {
            title: t('terms.col.term'),
            dataIndex: 'term',
            width: 220,
            render: (v: string, x) => (
              <span className="term-src">
                {v}
                {x.caseSensitive && <Typography.Text type="secondary" className="small">{t('terms.caseSensitiveMark')}</Typography.Text>}
              </span>
            ),
          },
          { title: t('terms.col.translation'), dataIndex: 'translation', width: 220, render: (v: string) => <b>{v}</b> },
          { title: t('terms.col.note'), dataIndex: 'note', render: (v: string) => <span className="pre-wrap">{v}</span> },
          {
            title: t('terms.col.createdBy'),
            width: 160,
            render: (_, x) => (
              <Space size={6}>
                <UserAvatar user={x.createdBy} />
                <Typography.Text type="secondary" className="small">{fromNow(x.updatedAt)}</Typography.Text>
              </Space>
            ),
          },
          ...(canManage
            ? [
                {
                  title: '',
                  width: 96,
                  render: (_: unknown, x: Term) => (
                    <Space size={0}>
                      <Button type="text" icon={<EditOutlined />} onClick={() => openEdit(x)} />
                      <Popconfirm
                        title={t('terms.deleteConfirm')}
                        okButtonProps={{ danger: true }}
                        okText={t('common.delete')}
                        onConfirm={async () => {
                          await api(`/projects/${pid}/terms/${x.id}`, { method: 'DELETE' });
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
        title={t(editing === 'new' ? 'terms.add' : 'terms.edit')}
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={submit}
        confirmLoading={busy}
        okText={t('common.save')}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="term" label={t('terms.term')} rules={[{ required: true, message: t('terms.termRequired') }, { max: 200 }]}>
            <Input placeholder={t('terms.termPlaceholder')} />
          </Form.Item>
          <Form.Item name="translation" label={t('terms.col.translation')} rules={[{ required: true, message: t('terms.translationRequired') }, { max: 500 }]}>
            <Input placeholder={t('terms.translationPlaceholder')} />
          </Form.Item>
          <Form.Item name="note" label={t('terms.col.note')}>
            <Input.TextArea rows={3} maxLength={1000} placeholder={t('terms.notePlaceholder')} />
          </Form.Item>
          <Form.Item name="caseSensitive" label={t('terms.caseSensitive')} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={t('terms.importTitle')} open={importOpen} onCancel={() => setImportOpen(false)} onOk={doImport} confirmLoading={busy} okText={t('terms.importOk')} width={640}>
        <Typography.Paragraph type="secondary">
          {t('terms.importHint')}
        </Typography.Paragraph>
        <Input.TextArea rows={12} value={importText} onChange={(e) => setImportText(e.target.value)} placeholder={t('terms.importExample')} />
        <Checkbox style={{ marginTop: 12 }} checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)}>
          {t('terms.overwrite')}
        </Checkbox>
      </Modal>
    </Card>
  );
}
