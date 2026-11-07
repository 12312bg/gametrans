import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Button, Col, Empty, Input, Pagination, Row, Segmented, Select, Skeleton } from 'antd';
import { ENGINES, ENGINE_NAMES } from '@gametrans/shared';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, qs } from '../../api/client';
import type { Paged, ProjectSummary } from '../../api/types';
import { ProjectCard } from '../../components/ProjectCard';
import { useT } from '../../i18n';
import { useAuth } from '../../providers/AuthProvider';

export default function HomePage() {
  const t = useT();
  const { user, site } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const scope = params.get('scope') ?? (user ? 'mine' : 'public');
  const q = params.get('q') ?? '';
  const engine = params.get('engine') ?? '';
  const page = Number(params.get('page') ?? 1);
  const [search, setSearch] = useState(q);

  const set = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  const list = useQuery({
    queryKey: ['projects', scope, q, engine, page],
    queryFn: () => api<Paged<ProjectSummary>>(`/projects${qs({ scope, q, engine, page, pageSize: 12 })}`),
    placeholderData: keepPreviousData,
  });

  const canCreate = user && (site?.projectCreation !== 'superadmin' || user.isSuperAdmin);
  const createBtn = (props: { size?: 'large'; style?: React.CSSProperties }) =>
    canCreate && (
      <Button type="primary" icon={<PlusOutlined />} onClick={() => nav('/projects/new')} {...props}>
        {t('nav.newProject')}
      </Button>
    );

  return (
    <div>
      <section className="hero">
        <div className="hero-inner">
          <h1>{t('home.heroTitle')}</h1>
          <p>{t('home.heroDesc')}</p>
          <div className="hero-search">
            <Input
              size="large"
              allowClear
              prefix={<SearchOutlined />}
              placeholder={t('home.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onPressEnter={() => set({ q: search.trim() || undefined })}
            />
            {createBtn({ size: 'large' })}
          </div>
        </div>
      </section>

      <div className="page-container">
        <div className="toolbar">
          <Segmented
            value={scope}
            onChange={(v) => set({ scope: String(v) })}
            options={[
              ...(user ? [{ label: t('home.scope.mine'), value: 'mine' }] : []),
              { label: t('home.scope.public'), value: 'public' },
              ...(user?.isSuperAdmin ? [{ label: t('home.scope.all'), value: 'all' }] : []),
            ]}
          />
          <Select
            allowClear
            placeholder={t('home.allEngines')}
            style={{ width: 180 }}
            value={engine || undefined}
            onChange={(v) => set({ engine: v })}
            options={ENGINES.map((e) => ({ label: ENGINE_NAMES[e], value: e }))}
          />
        </div>

        {list.isLoading ? (
          <Row gutter={[16, 16]}>
            {Array.from({ length: 6 }).map((_, i) => (
              <Col key={i} xs={24} sm={12} lg={8} xl={6}>
                <Skeleton.Node active style={{ width: '100%', height: 220 }} />
              </Col>
            ))}
          </Row>
        ) : !list.data?.items.length ? (
          <div className="empty-block">
            <Empty description={t(scope === 'mine' ? 'home.emptyMine' : q ? 'home.emptySearch' : 'home.emptyPublic')}>
              {scope === 'mine' && <Button onClick={() => set({ scope: 'public' })}>{t('home.browsePublic')}</Button>}
              {createBtn({ style: { marginLeft: 8 } })}
            </Empty>
          </div>
        ) : (
          <>
            <Row gutter={[16, 16]}>
              {list.data.items.map((p) => (
                <Col key={p.id} xs={24} sm={12} lg={8} xl={6}>
                  <ProjectCard p={p} />
                </Col>
              ))}
            </Row>
            {list.data.total > list.data.pageSize && (
              <div className="pager">
                <Pagination current={page} pageSize={list.data.pageSize} total={list.data.total} onChange={(pg) => set({ page: String(pg) })} showSizeChanger={false} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
