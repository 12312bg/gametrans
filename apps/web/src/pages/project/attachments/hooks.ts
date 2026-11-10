import { useEffect, useState } from 'react';
import { apiBlob } from '../../../api/client';
import { decryptBlob } from '../../tools/image-crypto/rpgmv';

/** 加载为对象 URL（图片、音频预览），卸载时释放；加密图片先在浏览器中解密 */
export function useObjectUrl(path: string | null, decrypt = false) {
  const [state, setState] = useState<{ url?: string; error?: string }>({});
  useEffect(() => {
    if (!path) return;
    let alive = true;
    let url: string | undefined;
    setState({});
    apiBlob(path)
      .then((b) => (decrypt ? decryptBlob(b) : b))
      .then((b) => {
        url = URL.createObjectURL(b);
        if (alive) setState({ url });
        else URL.revokeObjectURL(url);
      })
      .catch((e: Error) => alive && setState({ error: e.message }));
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path, decrypt]);
  return state;
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

/** 以 UTF-8 文本读取；不是有效 UTF-8 时 text 为 null */
export async function loadText(path: string): Promise<string | null> {
  try {
    return utf8.decode(await (await apiBlob(path)).arrayBuffer());
  } catch (e) {
    if (e instanceof TypeError) return null;
    throw e;
  }
}
