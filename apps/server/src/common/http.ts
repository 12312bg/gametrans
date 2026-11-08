/** 下载用的 Content-Disposition（RFC 6266）：ASCII 兜底文件名 + UTF-8 编码的真实文件名 */
export function attachment(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'download';
  // encodeURIComponent 不编码 ' ( ) * !，RFC 5987 的 attr-char 不允许它们
  const encoded = encodeURIComponent(name).replace(/['()*!]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
