import { FileTextOutlined, TeamOutlined } from '@ant-design/icons';
import { Card, Space, Typography } from 'antd';
import { Link } from 'react-router-dom';
import type { ProjectSummary } from '../api/types';
import { fromNow } from '../utils';
import { ProgressBar } from './ProgressBar';
import { EngineTag, LangPair, RoleTag, VisibilityTag } from './Tags';

export function ProjectCard({ p }: { p: ProjectSummary }) {
  return (
    <Link to={`/projects/${p.id}`} className="project-card-link">
      <Card hoverable className="project-card" variant="borderless">
        <div className="project-card-top">
          <Space size={4} wrap>
            <EngineTag engine={p.engine} />
            {p.visibility === 'PRIVATE' && <VisibilityTag visibility={p.visibility} />}
          </Space>
          {p.myRole && <RoleTag role={p.myRole} />}
        </div>
        <Typography.Title level={5} ellipsis={{ rows: 1 }} className="project-card-title">
          {p.name}
        </Typography.Title>
        <Typography.Paragraph type="secondary" ellipsis={{ rows: 2 }} className="project-card-desc">
          {p.description || '暂无简介'}
        </Typography.Paragraph>
        <div className="project-card-lang">
          <LangPair source={p.sourceLang} target={p.targetLang} />
        </div>
        <ProgressBar stats={p.stats} height={6} />
        <div className="project-card-foot">
          <Space size={14}>
            <span>
              <TeamOutlined /> {p._count.members}
            </span>
            <span>
              <FileTextOutlined /> {p._count.files}
            </span>
          </Space>
          <span>{fromNow(p.updatedAt)}更新</span>
        </div>
      </Card>
    </Link>
  );
}
