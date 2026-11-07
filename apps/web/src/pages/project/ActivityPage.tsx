import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Card, Empty, Pagination, Space, Timeline, Tooltip, Typography } from 'antd';
import { useState } from 'react';
import { api, qs } from '../../api/client';
import { useProject } from '../../api/project';
import type { Activity, Paged } from '../../api/types';
import { UserAvatar } from '../../components/Tags';
import { formatTime, fromNow } from '../../utils';

export default function ActivityPage() {
  const { project } = useProject();
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['activity', project.id, page],
    queryFn: () => api<Paged<Activity>>(`/projects/${project.id}/activity${qs({ page, pageSize: 30 })}`),
    placeholderData: keepPreviousData,
  });
  return (
    <Card variant="borderless" title="项目动态" loading={q.isLoading}>
      {q.data?.items.length ? (
        <>
          <Timeline
            items={q.data.items.map((a) => ({
              children: (
                <Space align="start">
                  <UserAvatar user={a.user} />
                  <div>
                    <div>
                      <b>{a.user?.displayName ?? '系统'}</b> {a.message}
                    </div>
                    <Tooltip title={formatTime(a.createdAt)}>
                      <Typography.Text type="secondary" className="small">
                        {fromNow(a.createdAt)}
                      </Typography.Text>
                    </Tooltip>
                  </div>
                </Space>
              ),
            }))}
          />
          {q.data.total > q.data.pageSize && (
            <Pagination current={page} pageSize={q.data.pageSize} total={q.data.total} onChange={setPage} showSizeChanger={false} />
          )}
        </>
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无动态" />
      )}
    </Card>
  );
}
