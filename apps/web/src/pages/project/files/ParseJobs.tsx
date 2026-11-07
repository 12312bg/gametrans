import { CheckCircleFilled, CloseCircleFilled, LoadingOutlined } from '@ant-design/icons';
import { Card, Collapse, List, Progress, Space, Tag, Typography } from 'antd';
import type { Job, ParseResultData } from '../../../api/types';
import { useT } from '../../../i18n';
import { issueText, jobErrorText } from '../../../i18n/format';
import { fromNow } from '../../../utils';

function JobResult({ job }: { job: Job<ParseResultData> }) {
  const t = useT();
  const r = job.result;
  if (job.status === 'FAILED') return <Typography.Text type="danger">{jobErrorText(job.error, t)}</Typography.Text>;
  if (!r) return null;
  const count = (status: string) => r.files.filter((f) => f.status === status).length;
  const sum = (k: 'added' | 'changed' | 'removed') => r.files.reduce((n, f) => n + f[k], 0);
  const unchanged = count('unchanged');
  const changed = sum('changed');
  const removed = sum('removed');
  const problems = [...r.errors.map((x) => ({ x, err: true })), ...r.skipped.map((x) => ({ x, err: false }))];
  return (
    <div className="job-result">
      <Space size={[12, 4]} wrap>
        <span>{t('jobs.created', { count: count('created') })}</span>
        <span>{t('jobs.updated', { count: count('updated') })}</span>
        {unchanged > 0 && <span>{t('jobs.unchanged', { count: unchanged })}</span>}
        <span>{t('jobs.added', { count: sum('added').toLocaleString() })}</span>
        {changed > 0 && (
          <Tag color="orange" bordered={false}>
            {t('jobs.changed', { count: changed })}
          </Tag>
        )}
        {removed > 0 && <span>{t('jobs.removed', { count: removed })}</span>}
      </Space>
      {problems.length > 0 && (
        <Collapse
          ghost
          size="small"
          items={[
            {
              key: 's',
              label: <Typography.Text type="secondary">{t('jobs.skippedFailed', { skipped: r.skipped.length, failed: r.errors.length })}</Typography.Text>,
              children: (
                <List
                  size="small"
                  dataSource={problems}
                  renderItem={({ x, err }) => (
                    <List.Item>
                      <Typography.Text type={err ? 'danger' : 'secondary'}>
                        {x.name}: {issueText(x, t)}
                      </Typography.Text>
                    </List.Item>
                  )}
                />
              ),
            },
          ]}
        />
      )}
    </div>
  );
}

export function ParseJobs({ jobs }: { jobs: Job<ParseResultData>[] }) {
  const t = useT();
  return (
    <Card variant="borderless" title={t('jobs.title')}>
      <List
        size="small"
        dataSource={jobs.slice(0, 5)}
        renderItem={(j) => (
          <List.Item>
            <div style={{ width: '100%' }}>
              <Space>
                {j.status === 'SUCCEEDED' ? (
                  <CheckCircleFilled style={{ color: '#10b981' }} />
                ) : j.status === 'FAILED' ? (
                  <CloseCircleFilled style={{ color: '#ef4444' }} />
                ) : (
                  <LoadingOutlined />
                )}
                <span>{j.createdBy?.displayName}</span>
                <Typography.Text type="secondary">{fromNow(j.createdAt)}</Typography.Text>
                {(j.status === 'RUNNING' || j.status === 'QUEUED') && <Progress percent={j.progress} size="small" style={{ width: 160, margin: 0 }} />}
              </Space>
              <JobResult job={j} />
            </div>
          </List.Item>
        )}
      />
    </Card>
  );
}
