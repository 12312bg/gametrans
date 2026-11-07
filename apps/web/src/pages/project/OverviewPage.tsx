import { ArrowRightOutlined, CheckCircleOutlined, EditOutlined, FileTextOutlined, TeamOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Col, Empty, List, Progress, Row, Space, Statistic, Timeline, Typography } from 'antd';
import { CATEGORY_LABELS, EntryCategory, PERMISSIONS } from '@gametrans/shared';
import { Link, useNavigate } from 'react-router-dom';
import { api, qs } from '../../api/client';
import { useProject } from '../../api/project';
import type { Activity, Paged, ProjectStats } from '../../api/types';
import { ProgressBar } from '../../components/ProgressBar';
import { STAGE_DOT, UserAvatar } from '../../components/Tags';
import { fromNow, progressOf } from '../../utils';

export default function OverviewPage() {
  const { project, has } = useProject();
  const nav = useNavigate();
  const stats = useQuery({ queryKey: ['stats', project.id], queryFn: () => api<ProjectStats>(`/projects/${project.id}/stats`) });
  const activity = useQuery({
    queryKey: ['activity', project.id, 1],
    queryFn: () => api<Paged<Activity>>(`/projects/${project.id}/activity${qs({ pageSize: 8 })}`),
  });
  const p = progressOf(stats.data?.byStage ?? project.stats);
  const base = `/projects/${project.id}`;

  const categories = Object.entries(stats.data?.byCategory ?? {}).sort((a, b) => b[1] - a[1]);
  const maxCat = Math.max(1, ...categories.map(([, n]) => n));

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} xl={16}>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Card variant="borderless">
            <Row gutter={[16, 16]}>
              <Col xs={12} md={6}>
                <Statistic title="词条总数" value={p.total} prefix={<FileTextOutlined />} />
              </Col>
              <Col xs={12} md={6}>
                <Statistic title="已翻译" value={p.translated} suffix={<span className="stat-suffix">{p.translatedPct}%</span>} valueStyle={{ color: STAGE_DOT.TRANSLATED }} prefix={<EditOutlined />} />
              </Col>
              <Col xs={12} md={6}>
                <Statistic title="已审核" value={p.reviewed} suffix={<span className="stat-suffix">{p.reviewedPct}%</span>} valueStyle={{ color: STAGE_DOT.REVIEWED }} prefix={<CheckCircleOutlined />} />
              </Col>
              <Col xs={12} md={6}>
                <Statistic title="成员" value={project.memberCount} prefix={<TeamOutlined />} />
              </Col>
            </Row>
            <div style={{ marginTop: 20 }}>
              <ProgressBar stats={stats.data?.byStage ?? project.stats} height={12} />
            </div>
            {p.hidden > 0 && (
              <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0, fontSize: 13 }}>
                另有 {p.hidden.toLocaleString()} 条已隐藏词条（脚本、插件参数、备注等危险文本）未计入进度，管理员可在翻译页筛选「已隐藏」后按需放出。
              </Typography.Paragraph>
            )}
            <Space style={{ marginTop: 16 }} wrap>
              <Button type="primary" icon={<ArrowRightOutlined />} onClick={() => nav(`${base}/editor`)}>
                {has(PERMISSIONS.TRANSLATE) ? '开始翻译' : '浏览词条'}
              </Button>
              {has(PERMISSIONS.TRANSLATE) && p.total > p.translated && (
                <Button onClick={() => nav(`${base}/editor?stage=UNTRANSLATED`)}>只看未翻译</Button>
              )}
              {has(PERMISSIONS.REVIEW) && (
                <Button onClick={() => nav(`${base}/editor?stage=TRANSLATED,QUESTIONED`)}>待审核</Button>
              )}
              {has(PERMISSIONS.MANAGE_FILES) && project.fileCount === 0 && (
                <Button onClick={() => nav(`${base}/files`)}>上传文件</Button>
              )}
            </Space>
          </Card>

          <Card title="项目简介" variant="borderless">
            {project.description ? (
              <Typography.Paragraph className="pre-wrap" style={{ marginBottom: 0 }}>
                {project.description}
              </Typography.Paragraph>
            ) : (
              <Typography.Text type="secondary">暂无简介</Typography.Text>
            )}
          </Card>

          <Card title="文本分类" variant="borderless" loading={stats.isLoading}>
            {categories.length ? (
              <div className="category-bars">
                {categories.map(([cat, n]) => (
                  <Link key={cat} to={`${base}/editor?category=${cat}`} className="category-bar">
                    <span className="category-name">{CATEGORY_LABELS[cat as EntryCategory] ?? cat}</span>
                    <Progress percent={(n / maxCat) * 100} showInfo={false} size="small" strokeColor="#818cf8" />
                    <span className="category-count">{n.toLocaleString()}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有上传文件" />
            )}
          </Card>
        </Space>
      </Col>

      <Col xs={24} xl={8}>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Card title="贡献榜" variant="borderless" loading={stats.isLoading}>
            {stats.data?.translators.length ? (
              <List
                size="small"
                dataSource={stats.data.translators.slice(0, 8)}
                renderItem={(t, i) => {
                  const reviewed = stats.data!.reviewers.find((r) => r.user?.id === t.user?.id)?.count ?? 0;
                  return (
                    <List.Item>
                      <Space>
                        <span className={`rank rank-${i + 1}`}>{i + 1}</span>
                        <UserAvatar user={t.user} />
                        <span>{t.user?.displayName}</span>
                      </Space>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        翻译 {t.count} · 审核 {reviewed}
                      </Typography.Text>
                    </List.Item>
                  );
                }}
              />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有人提交译文" />
            )}
          </Card>
          <Card title="最近动态" variant="borderless" extra={<Link to={`${base}/activity`}>全部</Link>} loading={activity.isLoading}>
            {activity.data?.items.length ? (
              <Timeline
                items={activity.data.items.map((a) => ({
                  children: (
                    <div className="activity-item">
                      <b>{a.user?.displayName ?? '系统'}</b> {a.message}
                      <div className="muted">{fromNow(a.createdAt)}</div>
                    </div>
                  ),
                }))}
              />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无动态" />
            )}
          </Card>
          <Card variant="borderless" size="small">
            <Space direction="vertical" size={4} style={{ fontSize: 13 }}>
              <span>
                所有者：<UserAvatar user={project.owner} /> {project.owner?.displayName}
              </span>
              <Typography.Text type="secondary">创建于 {fromNow(project.createdAt)}</Typography.Text>
            </Space>
          </Card>
        </Space>
      </Col>
    </Row>
  );
}
