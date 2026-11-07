import { GlobalOutlined, LockOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App, Button, Card, Form, Input, Radio, Select, Space, Typography } from 'antd';
import { ENGINES, ENGINE_EXTENSIONS, ENGINE_LABELS, Engine, LANGUAGES } from '@gametrans/shared';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { ProjectSummary } from '../api/types';
import { errorMessage } from '../utils';

const ENGINE_HINT: Record<Engine, string> = {
  RMXP: 'Data/*.rxdata（RGSS1）',
  RMVX: 'Data/*.rvdata（RGSS2）',
  RMVXACE: 'Data/*.rvdata2（RGSS3）',
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
  const nav = useNavigate();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const create = useMutation({
    mutationFn: (v: FormValues) => api<ProjectSummary>('/projects', { method: 'POST', body: v }),
    onSuccess: (p) => {
      message.success('项目已创建，接下来上传游戏数据文件');
      qc.invalidateQueries({ queryKey: ['projects'] });
      nav(`/projects/${p.id}/files`);
    },
    onError: (e) => message.error(errorMessage(e)),
  });
  const langOptions = LANGUAGES.map((l) => ({ label: `${l.label}（${l.code}）`, value: l.code }));

  return (
    <div className="page-container narrow">
      <Typography.Title level={3}>新建翻译项目</Typography.Title>
      <Typography.Paragraph type="secondary">每个项目对应一款游戏的一种目标语言。创建后即可上传游戏数据文件。</Typography.Paragraph>
      <Card variant="borderless">
        <Form
          form={form}
          layout="vertical"
          requiredMark="optional"
          initialValues={{ engine: 'RMMZ', sourceLang: 'ja', targetLang: 'zh-CN', visibility: 'PUBLIC' }}
          onFinish={(v) => create.mutate(v)}
        >
          <Form.Item name="name" label="项目名称" rules={[{ required: true, message: '请输入项目名称' }, { max: 80 }]}>
            <Input placeholder="例如：某某物语 简体中文汉化" />
          </Form.Item>
          <Form.Item name="engine" label="游戏引擎" rules={[{ required: true }]}>
            <Radio.Group className="engine-picker">
              {ENGINES.map((e) => (
                <Radio.Button key={e} value={e}>
                  <div className="engine-option">
                    <b>{ENGINE_LABELS[e].replace('RPG Maker ', '')}</b>
                    <span>{ENGINE_HINT[e]}</span>
                  </div>
                </Radio.Button>
              ))}
            </Radio.Group>
          </Form.Item>
          <Space size={16} wrap style={{ width: '100%' }} className="lang-row">
            <Form.Item name="sourceLang" label="源语言" rules={[{ required: true }]} style={{ minWidth: 220 }}>
              <Select options={langOptions} showSearch optionFilterProp="label" />
            </Form.Item>
            <Form.Item
              name="targetLang"
              label="目标语言"
              dependencies={['sourceLang']}
              style={{ minWidth: 220 }}
              rules={[
                { required: true },
                ({ getFieldValue }) => ({
                  validator: (_, v) => (v !== getFieldValue('sourceLang') ? Promise.resolve() : Promise.reject(new Error('不能与源语言相同'))),
                }),
              ]}
            >
              <Select options={langOptions} showSearch optionFilterProp="label" />
            </Form.Item>
          </Space>
          <Form.Item name="visibility" label="可见性">
            <Radio.Group>
              <Radio value="PUBLIC">
                <GlobalOutlined /> 公开 — 所有人可浏览，可申请加入
              </Radio>
              <Radio value="PRIVATE">
                <LockOutlined /> 私有 — 仅成员可见，只能通过邀请加入
              </Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item name="description" label="项目简介">
            <Input.TextArea rows={4} maxLength={5000} showCount placeholder="介绍游戏、翻译规范、参与方式等" />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(a, b) => a.engine !== b.engine}>
            {() => (
              <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
                支持的文件：{ENGINE_EXTENSIONS[form.getFieldValue('engine') as Engine]?.join('、')}，也可以直接上传整个游戏目录的 zip 压缩包。
              </Typography.Paragraph>
            )}
          </Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={create.isPending}>
              创建项目
            </Button>
            <Button onClick={() => nav(-1)}>取消</Button>
          </Space>
        </Form>
      </Card>
    </div>
  );
}
