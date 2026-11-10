import { ErrorCode, errorCodeForStatus } from '@gametrans/shared';
import { currentLocale, t } from '../i18n';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: ErrorCode | 'NETWORK_ERROR',
    public data: unknown,
  ) {
    super(message);
  }
}

let uploadLimitMb: number | undefined;
/** 站点配置加载后记录上传上限，用于代理层返回的 413（没有 JSON 响应体） */
export const setUploadLimit = (mb: number | undefined) => (uploadLimitMb = mb);

/** 服务端已按 Accept-Language 翻译；代理等返回的非 JSON 错误按状态码兜底 */
function toError(data: unknown, status: number): ApiError {
  const body = data as { message?: unknown; code?: ErrorCode } | null;
  const code = body?.code ?? errorCodeForStatus(status);
  const message = typeof body?.message === 'string' ? body.message : t(`error.${code}`, { limit: uploadLimitMb ?? '?' });
  return new ApiError(message, status, code, data);
}

async function parse(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? 'GET',
      credentials: 'include',
      headers: { 'Accept-Language': currentLocale(), ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(t('error.NETWORK_ERROR'), 0, 'NETWORK_ERROR', null);
  }
  const data = await parse(res);
  if (!res.ok) throw toError(data, res.status);
  return data as T;
}

/** 读取二进制内容（预览、对比用） */
export async function apiBlob(path: string): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { credentials: 'include', headers: { 'Accept-Language': currentLocale() } });
  } catch {
    throw new ApiError(t('error.NETWORK_ERROR'), 0, 'NETWORK_ERROR', null);
  }
  if (!res.ok) throw toError(await parse(res), res.status);
  return res.blob();
}

/** 带进度的上传 */
export function upload<T>(path: string, form: FormData, onProgress?: (pct: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api${path}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Accept-Language', currentLocale());
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let data: unknown = xhr.responseText;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        /* 非 JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else reject(toError(data, xhr.status));
    };
    xhr.onerror = () => reject(new ApiError(t('error.NETWORK_ERROR'), 0, 'NETWORK_ERROR', null));
    xhr.send(form);
  });
}

export function qs(params: Record<string, string | number | undefined | null | false>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '' && v !== false) u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
}
