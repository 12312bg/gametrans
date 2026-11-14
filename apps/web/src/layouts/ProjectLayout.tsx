import { AppstoreOutlined, BookOutlined, CloudDownloadOutlined, FieldTimeOutlined, FileTextOutlined, HistoryOutlined, PaperClipOutlined, SettingOutlined, TeamOutlined, TranslationOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App, Badge, Button, Input, Menu, Modal, Result, Skeleton, Space, Typography } from 'antd';
import { PERMISSIONS } from '@gametrans/shared';
import { useMemo, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import { makeOutlet, useProjectQuery } from '../api/project';
import { RealtimeProvider } from '../api/realtime';
import { OnlineMembers } from '../components/OnlineMembers';
import { EngineTag, LangPair, RoleTag, VisibilityTag } from '../components/Tags';
import { useT } from '../i18n';
import { useAuth } from '../providers/AuthProvider';
import { errorMessage } from '../utils';

export function ProjectLayout() {
  const t = useT();
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
      message.success(t('project.joinSent'));
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
        title={t(status === 404 ? 'project.notFound' : 'common.loadFailed')}
        subTitle={errorMessage(q.error)}
        extra={<Button onClick={() => nav('/')}>{t('common.backHome')}</Button>}
      />
    );
  }

  const p = q.data;
  const base = `/projects/${p.id}`;
  const section = loc.pathname.slice(base.length).split('/')[1] ?? '';
  const isEditor = section === 'editor';
  const items = [
    { key: '', icon: <AppstoreOutlined />, label: t('project.tab.overview') },
    { key: 'editor', icon: <TranslationOutlined />, label: t('project.tab.editor') },
    { key: 'files', icon: <FileTextOutlined />, label: t('project.tab.files') },
    { key: 'attachments', icon: <PaperClipOutlined />, label: t('project.tab.attachments') },
    { key: 'terms', icon: <BookOutlined />, label: t('project.tab.terms') },
    {
      key: 'members',
      icon: <TeamOutlined />,
      label: (
        <Space size={6}>
          {t('project.tab.members')}
          {p.pendingRequests > 0 && <Badge count={p.pendingRequests} size="small" />}
        </Space>
      ),
    },
    ...(outlet.has(PERMISSIONS.DOWNLOAD_EXPORT) ? [{ key: 'exports', icon: <CloudDownloadOutlined />, label: t('project.tab.exports') }] : []),
    { key: 'history', icon: <HistoryOutlined />, label: t('project.tab.history') },
    { key: 'activity', icon: <FieldTimeOutlined />, label: t('project.tab.activity') },
    ...(outlet.has(PERMISSIONS.MANAGE_PROJECT) ? [{ key: 'settings', icon: <SettingOutlined />, label: t('project.tab.settings') }] : []),
  ];

  const joinArea = !user ? (
    <Button type="primary" onClick={() => nav(`/login?next=${encodeURIComponent(loc.pathname)}`)}>
      {t('project.loginToJoin')}
    </Button>
  ) : p.myRole ? (
    <RoleTag role={p.myRole} />
  ) : p.myJoinRequest ? (
    <Space>
      <Typography.Text type="secondary">{t('project.joinPending')}</Typography.Text>
      <Button size="small" onClick={() => cancelJoin.mutate()}>
        {t('project.joinWithdraw')}
      </Button>
    </Space>
  ) : p.visibility === 'PUBLIC' ? (
    <Button type="primary" onClick={() => setJoinOpen(true)}>
      {t('project.join')}
    </Button>
  ) : null;

  return (
    <RealtimeProvider pid={p.id}>
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
                {user?.isSuperAdmin && !p.myRole && <Typography.Text type="secondary">{t('project.superAdminView')}</Typography.Text>}
              </Space>
            </div>
            <div className="project-actions">
              <OnlineMembers />
              {joinArea}
            </div>
          </div>
          <Menu mode="horizontal" className="project-menu" selectedKeys={[section]} items={items} onClick={({ key }) => nav(key ? `${base}/${key}` : base)} />
        </div>
      </div>
      <div className={isEditor ? 'editor-container' : 'page-container'}>
        <Outlet context={outlet} />
      </div>
      <Modal
        title={t('project.joinTitle', { name: p.name })}
        open={joinOpen}
        onCancel={() => setJoinOpen(false)}
        onOk={() => join.mutate()}
        okText={t('project.joinSubmit')}
        confirmLoading={join.isPending}
      >
        <Typography.Paragraph type="secondary">{t('project.joinHint')}</Typography.Paragraph>
        <Input.TextArea rows={4} maxLength={500} showCount value={joinMsg} onChange={(e) => setJoinMsg(e.target.value)} />
      </Modal>
    </div>
    </RealtimeProvider>
  );
}
