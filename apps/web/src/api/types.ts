import type { ContextPart, Engine, EntryCategory, Issue, JobStatus, Params, Permission, ProjectRole, Stage } from '@gametrans/shared';

export interface UserBrief {
  id: string;
  username: string;
  displayName: string;
}

export interface Me extends UserBrief {
  email: string;
  bio: string;
  isSuperAdmin: boolean;
  locale: string | null;
  createdAt: string;
  pendingInvitations: number;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export type StageCounts = Record<Stage, number>;

export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  engine: Engine;
  sourceLang: string;
  targetLang: string;
  visibility: 'PUBLIC' | 'PRIVATE';
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  owner: UserBrief;
  myRole: ProjectRole | null;
  stats: StageCounts;
  _count: { members: number; files: number };
}

export interface ProjectDetail extends Omit<ProjectSummary, '_count'> {
  permissions: Permission[];
  memberCount: number;
  fileCount: number;
  pendingRequests: number;
  myJoinRequest: JoinRequest | null;
}

export interface FileItem {
  id: string;
  projectId: string;
  path: string;
  kind: string;
  format: string;
  size: number;
  sha256: string;
  /** 旧数据为中文字符串 */
  warnings: (Issue | string)[];
  createdAt: string;
  updatedAt: string;
  stats: StageCounts;
}

export interface Entry {
  id: string;
  fileId: string;
  key: string;
  original: string;
  translation: string;
  /** 结构化位置说明，旧数据为 null */
  contextData: ContextPart[] | null;
  /** 服务端按请求语言渲染的位置说明 */
  contextText: string;
  category: EntryCategory;
  danger: boolean;
  stage: Stage;
  version: number;
  sortOrder: number;
  updatedAt: string;
  file: { path: string };
  translator: UserBrief | null;
  reviewer: UserBrief | null;
}

export interface HistoryItem {
  id: string;
  action: string;
  translation: string;
  stage: Stage;
  note: string;
  createdAt: string;
  user: UserBrief | null;
}

export interface Suggestion {
  id: string;
  original: string;
  translation: string;
  stage: Stage;
  path: string;
  score: number;
}

export interface Neighbor {
  id: string;
  original: string;
  translation: string;
  stage: Stage;
  category: EntryCategory;
  sortOrder: number;
}

export interface Term {
  id: string;
  term: string;
  translation: string;
  note: string;
  caseSensitive: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: UserBrief | null;
}

export interface Member {
  projectId: string;
  userId: string;
  role: ProjectRole;
  joinedAt: string;
  user: UserBrief;
  translated: number;
  reviewed: number;
}

export interface JoinRequest {
  id: string;
  projectId: string;
  userId: string;
  message: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELED';
  createdAt: string;
  user?: UserBrief;
  handledBy?: UserBrief | null;
}

export interface Invitation {
  id: string;
  projectId: string;
  role: ProjectRole;
  status: string;
  createdAt: string;
  invitee?: UserBrief;
  inviter?: UserBrief;
  project?: { id: string; name: string; engine: Engine; sourceLang: string; targetLang: string };
}

/** 旧版任务结果只有中文 reason / message */
export type ResultIssue = Partial<Issue> & { name: string; reason?: string; message?: string };

export interface ParseResultData {
  files: { path: string; status: 'created' | 'updated' | 'unchanged'; total: number; added: number; changed: number; removed: number }[];
  skipped: ResultIssue[];
  errors: ResultIssue[];
}

export interface ExportResultData {
  fileName: string;
  size: number;
  fileCount: number;
  applied: number;
  errors: ResultIssue[];
}

export interface Job<R = unknown> {
  id: string;
  type: 'PARSE' | 'EXPORT';
  status: JobStatus;
  progress: number;
  result: R | null;
  error: string | null;
  payload?: { stages?: Stage[]; fileIds?: string[]; includeJson?: boolean };
  createdAt: string;
  startedAt?: string | null;
  finishedAt: string | null;
  createdBy?: UserBrief | null;
}

export interface ProjectStats {
  byStage: StageCounts;
  byCategory: Record<string, number>;
  translators: { user?: UserBrief; count: number }[];
  reviewers: { user?: UserBrief; count: number }[];
}

export interface Activity {
  id: string;
  type: string;
  params: Params | null;
  message: string;
  createdAt: string;
  user: UserBrief | null;
}

export interface AdminUser extends UserBrief {
  email: string;
  bio: string;
  isSuperAdmin: boolean;
  isBanned: boolean;
  createdAt: string;
  _count: { memberships: number };
}

export interface SiteConfig {
  allowRegistration: boolean;
  projectCreation: 'everyone' | 'superadmin';
  uploadLimitMb: number;
}

export interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  scope: 'READ' | 'WRITE';
  expiresAt: string;
  lastUsedAt: string | null;
  createdAt: string;
  project: { id: string; name: string } | null;
}

export interface CreatedApiToken extends ApiToken {
  token: string;
}
