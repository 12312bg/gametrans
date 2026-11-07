import { useQuery } from '@tanstack/react-query';
import { Permission, permissionToEdit, Stage } from '@gametrans/shared';
import { useOutletContext } from 'react-router-dom';
import { api } from './client';
import type { ProjectDetail } from './types';

export function useProjectQuery(pid: string | undefined) {
  return useQuery({
    queryKey: ['project', pid],
    queryFn: () => api<ProjectDetail>(`/projects/${pid}`),
    enabled: !!pid,
  });
}

export interface ProjectOutlet {
  project: ProjectDetail;
  has: (p: Permission) => boolean;
  canEditStage: (stage: Stage) => boolean;
}

export function makeOutlet(project: ProjectDetail): ProjectOutlet {
  // 服务端已按角色（含超级管理员、公开访客）计算好权限列表
  const has = (p: Permission) => project.permissions.includes(p);
  return { project, has, canEditStage: (stage) => has(permissionToEdit(stage)) };
}

/** 项目子页面获取当前项目与权限 */
export const useProject = () => useOutletContext<ProjectOutlet>();
