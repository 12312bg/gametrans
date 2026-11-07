import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Button, Col, Empty, Input, Pagination, Row, Segmented, Select, Skeleton } from 'antd';
import { ENGINES, ENGINE_LABELS } from '@gametrans/shared';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, qs } from '../api/client';
import type { Paged, ProjectSummary } from '../api/types';
import { useAuth } from '../auth';
import { ProjectCard } from '../components/ProjectCard';

export default function HomePage() {
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

  return (
    <div>
      <section className="hero">
        <div className="hero-inner">
          <h1>RPG Maker 游戏本地化协作平台</h1>
          <p>支持 XP · VX · VX Ace · MV · MZ。上传数据文件，在线协作翻译与审核，一键导出可直接覆盖的游戏文件。</p>
          <div className="hero-search">
            <Input
              size="large"
              allowClear
              prefix={<SearchOutlined />}
              placeholder="搜索项目名称或简介"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onPressEnter={() => set({ q: search.trim() || undefined })}
            />
            {canCreate && (
              <Button size="large" type="primary" icon={<PlusOutlined />} onClick={() => nav('/projects/new')}>
                新建项目
              </Button>
            )}
          </div>
        </div>
      </section>

      <div className="page-container">
        <div className="toolbar">
          <Segmented
            value={scope}
            onChange={(v) => set({ scope: String(v) })}
            options={[
              ...(user ? [{ label: '我参与的', value: 'mine' }] : []),
              { label: '公开项目', value: 'public' },
              ...(user?.isSuperAdmin ? [{ label: '全部项目', value: 'all' }] : []),
            ]}
          />
          <Select
            allowClear
            placeholder="全部引擎"
            style={{ width: 180 }}
            value={engine || undefined}
            onChange={(v) => set({ engine: v })}
            options={ENGINES.map((e) => ({ label: ENGINE_LABELS[e], value: e }))}
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
            <Empty
              description={scope === 'mine' ? '你还没有参与任何项目' : q ? '没有找到匹配的项目' : '还没有公开项目'}
            >
              {scope === 'mine' && (
                <Button onClick={() => set({ scope: 'public' })}>浏览公开项目</Button>
              )}
              {canCreate && (
                <Button type="primary" style={{ marginLeft: 8 }} onClick={() => nav('/projects/new')}>
                  新建项目
                </Button>
              )}
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
                <Pagination
                  current={page}
                  pageSize={list.data.pageSize}
                  total={list.data.total}
                  onChange={(pg) => set({ page: String(pg) })}
                  showSizeChanger={false}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
