import { GlobalOutlined, LockOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App, Button, Card, Form, Input, Radio, Select, Space, Typography } from 'antd';
import { ENGINES, ENGINE_EXTENSIONS, ENGINE_NAMES, Engine } from '@gametrans/shared';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import type { ProjectSummary } from '../../api/types';
import { useT } from '../../i18n';
import { langOptions } from '../../i18n/format';
import { errorMessage } from '../../utils';

const ENGINE_HINT: Record<Engine, string> = {
  RMXP: 'Data/*.rxdata (RGSS1)',
  RMVX: 'Data/*.rvdata (RGSS2)',
  RMVXACE: 'Data/*.rvdata2 (RGSS3)',
  RMMV: 'data/*.json + js/plugins.js',
  RMMZ: 'data/*.json + js/plugins.js',
};

interface FormValues {
  name: string;
  description?: string;
  engine: Engine;
  sourceLang: string;
  targetLang: string;
  visibility: 'PUBLIC' | 'PRIVATE';
}

export default function CreateProjectPage() {
  const t = useT();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const create = useMutation({
    mutationFn: (v: FormValues) => api<ProjectSummary>('/projects', { method: 'POST', body: v }),
    onSuccess: (p) => {
      message.success(t('create.created'));
      qc.invalidateQueries({ queryKey: ['projects'] });
      nav(`/projects/${p.id}/files`);
    },
    onError: (e) => message.error(errorMessage(e)),
  });
  const languages = langOptions(t);

  return (
    <div className="page-container narrow">
      <Typography.Title level={3}>{t('create.title')}</Typography.Title>
      <Typography.Paragraph type="secondary">{t('create.desc')}</Typography.Paragraph>
      <Card variant="borderless">
        <Form
          form={form}
          layout="vertical"
          requiredMark="optional"
          initialValues={{ engine: 'RMMZ', sourceLang: 'ja', targetLang: 'zh-CN', visibility: 'PUBLIC' }}
          onFinish={(v) => create.mutate(v)}
        >
          <Form.Item name="name" label={t('create.name')} rules={[{ required: true, message: t('create.nameRequired') }, { max: 80 }]}>
            <Input placeholder={t('create.namePlaceholder')} />
          </Form.Item>
          <Form.Item name="engine" label={t('create.engine')} rules={[{ required: true }]}>
            <Radio.Group className="engine-picker">
              {ENGINES.map((e) => (
                <Radio.Button key={e} value={e}>
                  <div className="engine-option">
                    <b>{ENGINE_NAMES[e].replace('RPG Maker ', '')}</b>
                    <span>{ENGINE_HINT[e]}</span>
                  </div>
                </Radio.Button>
              ))}
            </Radio.Group>
          </Form.Item>
          <Space size={16} wrap style={{ width: '100%' }} className="lang-row">
            <Form.Item name="sourceLang" label={t('create.sourceLang')} rules={[{ required: true }]} style={{ minWidth: 220 }}>
              <Select options={languages} showSearch optionFilterProp="label" />
            </Form.Item>
            <Form.Item
              name="targetLang"
              label={t('create.targetLang')}
              dependencies={['sourceLang']}
              style={{ minWidth: 220 }}
              rules={[
                { required: true },
                ({ getFieldValue }) => ({
                  validator: (_, v) => (v !== getFieldValue('sourceLang') ? Promise.resolve() : Promise.reject(new Error(t('create.sameLang')))),
                }),
              ]}
            >
              <Select options={languages} showSearch optionFilterProp="label" />
            </Form.Item>
          </Space>
          <Form.Item name="visibility" label={t('create.visibility')}>
            <Radio.Group>
              <Radio value="PUBLIC">
                <GlobalOutlined /> {t('create.public')}
              </Radio>
              <Radio value="PRIVATE">
                <LockOutlined /> {t('create.private')}
              </Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item name="description" label={t('create.description')}>
            <Input.TextArea rows={4} maxLength={5000} showCount placeholder={t('create.descPlaceholder')} />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(a, b) => a.engine !== b.engine}>
            {() => (
              <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
                {t('create.supported', { exts: ENGINE_EXTENSIONS[form.getFieldValue('engine') as Engine]?.join(', ') })}
              </Typography.Paragraph>
            )}
          </Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={create.isPending}>
              {t('create.submit')}
            </Button>
            <Button onClick={() => nav(-1)}>{t('common.cancel')}</Button>
          </Space>
        </Form>
      </Card>
    </div>
  );
}
