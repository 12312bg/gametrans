import {
  AppstoreOutlined,
  BookOutlined,
  CloudDownloadOutlined,
  FileTextOutlined,
  HistoryOutlined,
  SettingOutlined,
  TeamOutlined,
  TranslationOutlined,
} from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App, Badge, Button, Input, Menu, Modal, Result, Skeleton, Space, Typography } from 'antd';
import { PERMISSIONS } from '@gametrans/shared';
import { useMemo, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import { makeOutlet, useProjectQuery } from '../api/project';
import { useAuth } from '../auth';
import { EngineTag, LangPair, RoleTag, VisibilityTag } from '../components/Tags';
import { errorMessage } from '../utils';

export function ProjectLayout() {
  const { pid } = useParams();
  const loc = useLocation();
  const nav = useNavigate();
  const { user } = useAuth();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const q = useProjectQuery(pid);
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinMsg, setJoinMsg] = useState('');
  const outlet = useMemo(() => (q.data ? makeOutlet(q.data) : null), [q.data]);

  const join = useMutation({
    mutationFn: () => api(`/projects/${pid}/join-requests`, { method: 'POST', body: { message: joinMsg } }),
    onSuccess: () => {
      message.success('申请已提交，请等待项目管理员审批');
      setJoinOpen(false);
      setJoinMsg('');
      qc.invalidateQueries({ queryKey: ['project', pid] });
    },
    onError: (e) => message.error(errorMessage(e)),
  });
  const cancelJoin = useMutation({
    mutationFn: () => api(`/projects/${pid}/join-requests/mine`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', pid] }),
  });

  if (q.isLoading) {
    return (
      <div className="page-container">
        <Skeleton active paragraph={{ rows: 8 }} />
      </div>
    );
  }
  if (q.error || !q.data || !outlet) {
    const status = q.error instanceof ApiError ? q.error.status : 500;
    return (
      <Result
        status={status === 404 ? '404' : 'error'}
        title={status === 404 ? '项目不存在或无权访问' : '加载失败'}
        subTitle={errorMessage(q.error)}
        extra={<Button onClick={() => nav('/')}>返回首页</Button>}
      />
    );
  }

  const p = q.data;
  const base = `/projects/${p.id}`;
  const section = loc.pathname.slice(base.length).split('/')[1] ?? '';
  const isEditor = section === 'editor';
  const items = [
    { key: '', icon: <AppstoreOutlined />, label: '概览' },
    { key: 'editor', icon: <TranslationOutlined />, label: '翻译' },
    { key: 'files', icon: <FileTextOutlined />, label: '文件' },
    { key: 'terms', icon: <BookOutlined />, label: '术语表' },
    {
      key: 'members',
      icon: <TeamOutlined />,
      label: (
        <Space size={6}>
          成员
          {p.pendingRequests > 0 && <Badge count={p.pendingRequests} size="small" />}
        </Space>
      ),
    },
    ...(outlet.has(PERMISSIONS.DOWNLOAD_EXPORT) ? [{ key: 'exports', icon: <CloudDownloadOutlined />, label: '导出' }] : []),
    { key: 'activity', icon: <HistoryOutlined />, label: '动态' },
    ...(outlet.has(PERMISSIONS.MANAGE_PROJECT) ? [{ key: 'settings', icon: <SettingOutlined />, label: '设置' }] : []),
  ];

  const joinArea = !user ? (
    <Button type="primary" onClick={() => nav(`/login?next=${encodeURIComponent(loc.pathname)}`)}>
      登录后申请加入
    </Button>
  ) : p.myRole ? (
    <RoleTag role={p.myRole} />
  ) : p.myJoinRequest ? (
    <Space>
      <Typography.Text type="secondary">已申请，等待审批</Typography.Text>
      <Button size="small" onClick={() => cancelJoin.mutate()}>
        撤回
      </Button>
    </Space>
  ) : p.visibility === 'PUBLIC' ? (
    <Button type="primary" onClick={() => setJoinOpen(true)}>
      申请加入
    </Button>
  ) : null;

  return (
    <div className={`project-shell${isEditor ? ' editor-mode' : ''}`}>
      <div className="project-header">
        <div className="project-header-inner">
          <div className="project-title-row">
            <div style={{ minWidth: 0 }}>
              <Typography.Title level={4} className="project-title">
                <Link to={base}>{p.name}</Link>
              </Typography.Title>
              <Space size={4} wrap className="project-meta">
                <EngineTag engine={p.engine} />
                <VisibilityTag visibility={p.visibility} />
                <LangPair source={p.sourceLang} target={p.targetLang} />
                {user?.isSuperAdmin && !p.myRole && <Typography.Text type="secondary">（超级管理员视角）</Typography.Text>}
              </Space>
            </div>
            <div className="project-actions">{joinArea}</div>
          </div>
          <Menu
            mode="horizontal"
            className="project-menu"
            selectedKeys={[section]}
            items={items}
            onClick={({ key }) => nav(key ? `${base}/${key}` : base)}
          />
        </div>
      </div>
      <div className={isEditor ? 'editor-container' : 'page-container'}>
        <Outlet context={outlet} />
      </div>
      <Modal
        title={`申请加入「${p.name}」`}
        open={joinOpen}
        onCancel={() => setJoinOpen(false)}
        onOk={() => join.mutate()}
        okText="提交申请"
        confirmLoading={join.isPending}
      >
        <Typography.Paragraph type="secondary">简单介绍一下你自己，例如翻译经验、擅长的语言等，方便管理员审批。</Typography.Paragraph>
        <Input.TextArea rows={4} maxLength={500} showCount value={joinMsg} onChange={(e) => setJoinMsg(e.target.value)} />
      </Modal>
    </div>
  );
}
