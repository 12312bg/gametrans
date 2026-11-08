export const TOKEN_SCOPES = ['READ', 'WRITE'] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

export const TOKEN_EXPIRY_DAYS = [7, 30, 90, 365] as const;
export const DEFAULT_TOKEN_EXPIRY_DAYS = 90;
export const TOKEN_PREFIX = 'gt_';
export const MAX_TOKENS_PER_USER = 20;
