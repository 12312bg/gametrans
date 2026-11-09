import { DownloadOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons';
import { Button, Modal, Space, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useT } from '../../../i18n';
import { formatSize } from '../../../utils';
import type { ImageItem } from './collect';
import type { Converter } from './converter';
import { Thumb } from './Thumb';

interface Props {
  conv: Converter;
  items: ImageItem[];
  index: number;
  onIndex: (i: number) => void;
  onDownload: (item: ImageItem) => void;
  onClose: () => void;
}

/** 大图预览：左侧列表快速切换，← → / ↑ ↓ 切换上一张、下一张 */
export function ImagePreview({ conv, items, index, onIndex, onDownload, onClose }: Props) {
  const t = useT();
  const item = items[index];
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const go = (d: number) => onIndex((index + d + items.length) % items.length);

  useEffect(() => {
    setSize(null);
    listRef.current?.querySelector('.preview-entry.active')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') go(-1);
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') go(1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!item) return null;
  return (
    <Modal open onCancel={onClose} footer={null} width="min(1280px, 94vw)" className="image-preview" title={item.outPath} destroyOnHidden>
      <div className="preview-layout">
        <div className="preview-list" ref={listRef}>
          {items.map((it, i) => (
            <div key={it.id} className={`preview-entry${i === index ? ' active' : ''}`} onClick={() => onIndex(i)} title={it.outName}>
              <div className="preview-entry-thumb">
                <Thumb conv={conv} item={it} />
              </div>
              <span className="preview-entry-name">{it.outName}</span>
            </div>
          ))}
        </div>
        <div className="preview-main">
          <div className="preview-stage">
            <Thumb key={item.id} conv={conv} item={item} onSize={(w, h) => setSize({ w, h })} />
          </div>
          <div className="preview-bar">
            <Typography.Text type="secondary" className="small">
              {index + 1} / {items.length}
              {size && ` · ${t('img.preview.size', { w: size.w, h: size.h, size: formatSize(item.file.size) })}`} · {t('img.preview.keys')}
            </Typography.Text>
            <Space>
              <Button icon={<LeftOutlined />} onClick={() => go(-1)} disabled={items.length < 2}>
                {t('img.preview.prev')}
              </Button>
              <Button icon={<RightOutlined />} onClick={() => go(1)} disabled={items.length < 2}>
                {t('img.preview.next')}
              </Button>
              <Button type="primary" icon={<DownloadOutlined />} onClick={() => onDownload(item)}>
                {t('img.preview.download')}
              </Button>
            </Space>
          </div>
        </div>
      </div>
    </Modal>
  );
}
