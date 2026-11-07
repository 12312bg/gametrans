import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Card, Form, Input, Modal, Radio, Select, Space, Typography } from 'antd';
import { ENGINE_NAMES, PERMISSIONS } from '@gametrans/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useProject } from '../../api/project';
import type { Member } from '../../api/types';
import { useT } from '../../i18n';
import { langOptions } from '../../i18n/format';
import { errorMessage } from '../../utils';

interface SettingsForm {
  name: string;
  description: string;
  sourceLang: string;
  targetLang: string;
  visibility: 'PUBLIC' | 'PRIVATE';
}

export default function SettingsPage() {
  const t = useT();
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
  const languages = langOptions(t);

  if (!has(PERMISSIONS.MANAGE_PROJECT)) {
    return <Typography.Text type="secondary">{t('settings.adminOnly')}</Typography.Text>;
  }

  const save = async (v: SettingsForm) => {
    setSaving(true);
    try {
      await api(`/projects/${pid}`, { method: 'PATCH', body: v });
      message.success(t('settings.saved'));
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
      message.success(t('settings.transferred'));
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
      message.success(t('settings.deleted'));
      qc.invalidateQueries({ queryKey: ['projects'] });
      nav('/');
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%', maxWidth: 820 }}>
      <Card variant="borderless" title={t('settings.basic')}>
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
          <Form.Item name="name" label={t('create.name')} rules={[{ required: true }, { max: 80 }]}>
            <Input />
          </Form.Item>
          <Form.Item label={t('settings.engine')}>
            <Typography.Text>{ENGINE_NAMES[project.engine]}</Typography.Text>
            <Typography.Text type="secondary" className="small">
              {t('settings.engineFixed')}
            </Typography.Text>
          </Form.Item>
          <Space size={16} wrap>
            <Form.Item name="sourceLang" label={t('create.sourceLang')} style={{ minWidth: 220 }}>
              <Select options={languages} showSearch optionFilterProp="label" />
            </Form.Item>
            <Form.Item name="targetLang" label={t('create.targetLang')} style={{ minWidth: 220 }}>
              <Select options={languages} showSearch optionFilterProp="label" />
            </Form.Item>
          </Space>
          <Form.Item name="visibility" label={t('create.visibility')}>
            <Radio.Group>
              <Radio value="PUBLIC">{t('visibility.PUBLIC')}</Radio>
              <Radio value="PRIVATE">{t('visibility.PRIVATE')}</Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item name="description" label={t('create.description')}>
            <Input.TextArea rows={6} maxLength={5000} showCount />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={saving}>
            {t('common.save')}
          </Button>
        </Form>
      </Card>

      {canOwn && (
        <Card variant="borderless" title={<span style={{ color: '#ef4444' }}>{t('settings.danger')}</span>} className="danger-card">
          <div className="danger-row">
            <div>
              <b>{t('settings.transfer')}</b>
              <div className="muted small">{t('settings.transferDesc')}</div>
            </div>
            <Button onClick={() => setTransferOpen(true)}>{t('settings.transferBtn')}</Button>
          </div>
          <div className="danger-row">
            <div>
              <b>{t('settings.delete')}</b>
              <div className="muted small">{t('settings.deleteDesc')}</div>
            </div>
            <Button danger onClick={() => setDeleteOpen(true)}>
              {t('settings.delete')}
            </Button>
          </div>
        </Card>
      )}

      <Modal title={t('settings.transfer')} open={transferOpen} onCancel={() => setTransferOpen(false)} onOk={() => modal.confirm({ title: t('settings.transferConfirm'), content: t('settings.transferConfirmDesc'), onOk: transfer })} okButtonProps={{ disabled: !transferTo }}>
        <Select
          style={{ width: '100%' }}
          placeholder={t('settings.newOwner')}
          value={transferTo}
          onChange={setTransferTo}
          options={(members.data ?? []).filter((m) => m.role !== 'OWNER').map((m) => ({ value: m.userId, label: `${m.user.displayName} (@${m.user.username})` }))}
        />
      </Modal>

      <Modal
        title={t('settings.delete')}
        open={deleteOpen}
        onCancel={() => setDeleteOpen(false)}
        onOk={remove}
        okText={t('settings.deleteForever')}
        okButtonProps={{ danger: true, disabled: deleteName !== project.name }}
      >
        <Typography.Paragraph>
          {t('settings.deletePrompt', { name: project.name })}
        </Typography.Paragraph>
        <Input value={deleteName} onChange={(e) => setDeleteName(e.target.value)} />
      </Modal>
    </Space>
  );
}
