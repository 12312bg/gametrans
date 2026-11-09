import { WarningOutlined } from '@ant-design/icons';
import { Spin, Tooltip } from 'antd';
import { useEffect, useState } from 'react';
import { useT } from '../../../i18n';
import type { ImageItem } from './collect';
import type { Converter } from './converter';

/** 解析图片地址；转换失败时显示原因 */
export function useImageUrl(conv: Converter, item: ImageItem | undefined) {
  const [state, setState] = useState<{ url?: string; error?: string }>({});
  useEffect(() => {
    if (!item) return;
    let alive = true;
    setState({});
    conv.url(item).then(
      (url) => alive && setState({ url }),
      (e: Error) => alive && setState({ error: e.message }),
    );
    return () => {
      alive = false;
    };
  }, [conv, item]);
  return state;
}

export function Thumb({ conv, item, onSize }: { conv: Converter; item: ImageItem; onSize?: (w: number, h: number) => void }) {
  const t = useT();
  const { url, error } = useImageUrl(conv, item);
  if (error) {
    return (
      <Tooltip title={t(`img.error.${error}`)}>
        <div className="thumb-error">
          <WarningOutlined />
        </div>
      </Tooltip>
    );
  }
  if (!url) return <Spin size="small" />;
  return <img src={url} alt={item.outName} loading="lazy" draggable={false} onLoad={(e) => onSize?.(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)} />;
}
