import { Zip, ZipPassThrough } from 'fflate';

/** 触发浏览器下载 */
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** 打包下载：PNG / 加密图片本身已压缩，原样存储；按块读取以降低内存峰值 */
export async function downloadZip(entries: { path: string; blob: () => Promise<Blob> }[], name: string, onProgress?: (pct: number) => void) {
  const chunks: Uint8Array[] = [];
  const zip = new Zip();
  const done = new Promise<void>((resolve, reject) => {
    zip.ondata = (err, chunk, final) => {
      if (err) return reject(err);
      chunks.push(chunk);
      if (final) resolve();
    };
  });
  for (const [i, e] of entries.entries()) {
    const f = new ZipPassThrough(e.path);
    zip.add(f);
    const reader = (await e.blob()).stream().getReader();
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      f.push(value);
    }
    f.push(new Uint8Array(0), true);
    onProgress?.(Math.round(((i + 1) / entries.length) * 100));
  }
  zip.end();
  await done;
  downloadBlob(new Blob(chunks as BlobPart[], { type: 'application/zip' }), name);
}
