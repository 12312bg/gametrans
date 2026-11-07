import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Card, Form, Input, Modal, Radio, Select, Space, Typography } from 'antd';
import { ENGINE_LABELS, LANGUAGES, PERMISSIONS } from '@gametrans/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useProject } from '../../api/project';
import type { Member } from '../../api/types';
import { errorMessage } from '../../utils';

interface SettingsForm {
  name: string;
  description: string;
  sourceLang: string;
  targetLang: string;
  visibility: 'PUBLIC' | 'PRIVATE';
}

export default function SettingsPage() {
  const { project, has } = useProject();
  const pid = project.id;
  const nav = useNavigate();
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const [saving, setSaving] = useState(false);
  const [transferTo, setTransferTo] = useState<string>();
  const [transferOpen, setTransferOpen] = useState(false);
  const [deleteName, setDeleteName] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const canOwn = has(PERMISSIONS.DELETE_PROJECT);
  const members = useQuery({ queryKey: ['members', pid], queryFn: () => api<Member[]>(`/projects/${pid}/members`), enabled: canOwn });
  const langOptions = LANGUAGES.map((l) => ({ label: `${l.label}（${l.code}）`, value: l.code }));

  if (!has(PERMISSIONS.MANAGE_PROJECT)) {
    return <Typography.Text type="secondary">只有项目管理员可以修改设置。</Typography.Text>;
  }

  const save = async (v: SettingsForm) => {
    setSaving(true);
    try {
      await api(`/projects/${pid}`, { method: 'PATCH', body: v });
      message.success('设置已保存');
      qc.invalidateQueries({ queryKey: ['project', pid] });
      qc.invalidateQueries({ queryKey: ['projects'] });
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const transfer = async () => {
    if (!transferTo) return;
    try {
      await api(`/projects/${pid}/transfer`, { method: 'POST', body: { userId: transferTo } });
      message.success('项目已转让，你的角色已变为管理员');
      setTransferOpen(false);
      qc.invalidateQueries({ queryKey: ['project', pid] });
      qc.invalidateQueries({ queryKey: ['members', pid] });
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  const remove = async () => {
    try {
      await api(`/projects/${pid}`, { method: 'DELETE' });
      message.success('项目已删除');
      qc.invalidateQueries({ queryKey: ['projects'] });
      nav('/');
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%', maxWidth: 820 }}>
      <Card variant="borderless" title="基本信息">
        <Form<SettingsForm>
          layout="vertical"
          initialValues={{
            name: project.name,
            description: project.description,
            sourceLang: project.sourceLang,
            targetLang: project.targetLang,
            visibility: project.visibility,
          }}
          onFinish={save}
        >
          <Form.Item name="name" label="项目名称" rules={[{ required: true }, { max: 80 }]}>
            <Input />
          </Form.Item>
          <Form.Item label="引擎">
            <Typography.Text>{ENGINE_LABELS[project.engine]}</Typography.Text>
            <Typography.Text type="secondary" className="small">
              （创建后不可更改）
            </Typography.Text>
          </Form.Item>
          <Space size={16} wrap>
            <Form.Item name="sourceLang" label="源语言" style={{ minWidth: 220 }}>
              <Select options={langOptions} showSearch optionFilterProp="label" />
            </Form.Item>
            <Form.Item name="targetLang" label="目标语言" style={{ minWidth: 220 }}>
              <Select options={langOptions} showSearch optionFilterProp="label" />
            </Form.Item>
          </Space>
          <Form.Item name="visibility" label="可见性">
            <Radio.Group>
              <Radio value="PUBLIC">公开</Radio>
              <Radio value="PRIVATE">私有</Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item name="description" label="项目简介">
            <Input.TextArea rows={6} maxLength={5000} showCount />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={saving}>
            保存
          </Button>
        </Form>
      </Card>

      {canOwn && (
        <Card variant="borderless" title={<span style={{ color: '#ef4444' }}>危险操作</span>} className="danger-card">
          <div className="danger-row">
            <div>
              <b>转让项目</b>
              <div className="muted small">把所有者身份转让给另一名成员，你将变为管理员。</div>
            </div>
            <Button onClick={() => setTransferOpen(true)}>转让</Button>
          </div>
          <div className="danger-row">
            <div>
              <b>删除项目</b>
              <div className="muted small">删除所有文件、词条、译文、术语与历史记录，无法恢复。</div>
            </div>
            <Button danger onClick={() => setDeleteOpen(true)}>
              删除项目
            </Button>
          </div>
        </Card>
      )}

      <Modal title="转让项目" open={transferOpen} onCancel={() => setTransferOpen(false)} onOk={() => modal.confirm({ title: '确认转让？', content: '转让后你将无法删除项目。', onOk: transfer })} okButtonProps={{ disabled: !transferTo }}>
        <Select
          style={{ width: '100%' }}
          placeholder="选择新的所有者"
          value={transferTo}
          onChange={setTransferTo}
          options={(members.data ?? []).filter((m) => m.role !== 'OWNER').map((m) => ({ value: m.userId, label: `${m.user.displayName} (@${m.user.username})` }))}
        />
      </Modal>

      <Modal
        title="删除项目"
        open={deleteOpen}
        onCancel={() => setDeleteOpen(false)}
        onOk={remove}
        okText="永久删除"
        okButtonProps={{ danger: true, disabled: deleteName !== project.name }}
      >
        <Typography.Paragraph>
          请输入项目名称 <Typography.Text code>{project.name}</Typography.Text> 以确认删除。
        </Typography.Paragraph>
        <Input value={deleteName} onChange={(e) => setDeleteName(e.target.value)} />
      </Modal>
    </Space>
  );
}
