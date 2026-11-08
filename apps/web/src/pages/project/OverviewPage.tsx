import { ArrowRightOutlined, CheckCircleOutlined, EditOutlined, FileTextOutlined, TeamOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Col, Empty, List, Progress, Row, Space, Statistic, Timeline, Typography } from 'antd';
import { PERMISSIONS } from '@gametrans/shared';
import { Link, useNavigate } from 'react-router-dom';
import { api, qs } from '../../api/client';
import { useProject } from '../../api/project';
import type { Activity, Paged, ProjectStats } from '../../api/types';
import { ProgressBar } from '../../components/ProgressBar';
import { STAGE_DOT, UserAvatar } from '../../components/Tags';
import { useT } from '../../i18n';
import { activityText } from '../../i18n/format';
import { fromNow, progressOf } from '../../utils';

export default function OverviewPage() {
  const t = useT();
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
                <Statistic title={t('overview.total')} value={p.total} prefix={<FileTextOutlined />} />
              </Col>
              <Col xs={12} md={6}>
                <Statistic title={t('progress.translated')} value={p.translated} suffix={<span className="stat-suffix">{p.translatedPct}%</span>} valueStyle={{ color: STAGE_DOT.TRANSLATED }} prefix={<EditOutlined />} />
              </Col>
              <Col xs={12} md={6}>
                <Statistic title={t('progress.reviewed')} value={p.reviewed} suffix={<span className="stat-suffix">{p.reviewedPct}%</span>} valueStyle={{ color: STAGE_DOT.REVIEWED }} prefix={<CheckCircleOutlined />} />
              </Col>
              <Col xs={12} md={6}>
                <Statistic title={t('overview.members')} value={project.memberCount} prefix={<TeamOutlined />} />
              </Col>
            </Row>
            <div style={{ marginTop: 20 }}>
              <ProgressBar stats={stats.data?.byStage ?? project.stats} height={12} />
            </div>
            {p.hidden > 0 && (
              <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0, fontSize: 13 }}>
                {t('overview.hiddenNote', { count: p.hidden.toLocaleString() })}
              </Typography.Paragraph>
            )}
            <Space style={{ marginTop: 16 }} wrap>
              <Button type="primary" icon={<ArrowRightOutlined />} onClick={() => nav(`${base}/editor`)}>
                {t(has(PERMISSIONS.TRANSLATE) ? 'overview.startTranslating' : 'overview.browse')}
              </Button>
              {has(PERMISSIONS.TRANSLATE) && p.total > p.translated && (
                <Button onClick={() => nav(`${base}/editor?stage=UNTRANSLATED`)}>{t('overview.onlyUntranslated')}</Button>
              )}
              {has(PERMISSIONS.REVIEW) && (
                <Button onClick={() => nav(`${base}/editor?stage=TRANSLATED,QUESTIONED`)}>{t('overview.toReview')}</Button>
              )}
              {has(PERMISSIONS.MANAGE_FILES) && project.fileCount === 0 && (
                <Button onClick={() => nav(`${base}/files`)}>{t('overview.upload')}</Button>
              )}
            </Space>
          </Card>

          <Card title={t('overview.description')} variant="borderless">
            {project.description ? (
              <Typography.Paragraph className="pre-wrap" style={{ marginBottom: 0 }}>
                {project.description}
              </Typography.Paragraph>
            ) : (
              <Typography.Text type="secondary">{t('common.noDescription')}</Typography.Text>
            )}
          </Card>

          <Card title={t('overview.categories')} variant="borderless" loading={stats.isLoading}>
            {categories.length ? (
              <div className="category-bars">
                {categories.map(([cat, n]) => (
                  <Link key={cat} to={`${base}/editor?category=${cat}`} className="category-bar">
                    <span className="category-name">{t(`category.${cat}`)}</span>
                    <Progress percent={(n / maxCat) * 100} showInfo={false} size="small" strokeColor="#818cf8" />
                    <span className="category-count">{n.toLocaleString()}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('overview.noFiles')} />
            )}
          </Card>
        </Space>
      </Col>

      <Col xs={24} xl={8}>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Card title={t('overview.leaderboard')} variant="borderless" loading={stats.isLoading}>
            {stats.data?.translators.length ? (
              <List
                size="small"
                dataSource={stats.data.translators.slice(0, 8)}
                renderItem={(c, i) => {
                  const reviewed = stats.data!.reviewers.find((r) => r.user?.id === c.user?.id)?.count ?? 0;
                  return (
                    <List.Item>
                      <Space>
                        <span className={`rank rank-${i + 1}`}>{i + 1}</span>
                        <UserAvatar user={c.user} />
                        <span>{c.user?.displayName}</span>
                      </Space>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {t('overview.contrib', { translated: c.count, reviewed })}
                      </Typography.Text>
                    </List.Item>
                  );
                }}
              />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('overview.noContrib')} />
            )}
          </Card>
          <Card title={t('overview.recent')} variant="borderless" extra={<Link to={`${base}/activity`}>{t('overview.all')}</Link>} loading={activity.isLoading}>
            {activity.data?.items.length ? (
              <Timeline
                items={activity.data.items.map((a) => ({
                  children: (
                    <div className="activity-item">
                      <b>{a.user?.displayName ?? t('common.system')}</b> {activityText(a, t)}
                      <div className="muted">{fromNow(a.createdAt)}</div>
                    </div>
                  ),
                }))}
              />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('activity.empty')} />
            )}
          </Card>
          <Card variant="borderless" size="small">
            <Space direction="vertical" size={4} style={{ fontSize: 13 }}>
              <span>
                {t('overview.owner')}
                <UserAvatar user={project.owner} /> {project.owner?.displayName}
              </span>
              <Typography.Text type="secondary">{t('overview.createdAt', { time: fromNow(project.createdAt) })}</Typography.Text>
            </Space>
          </Card>
        </Space>
      </Col>
    </Row>
  );
}
