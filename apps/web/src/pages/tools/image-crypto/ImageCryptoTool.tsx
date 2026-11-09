import { ClearOutlined, CloudDownloadOutlined, FileImageOutlined, FolderFilled, FolderOpenOutlined, InboxOutlined, KeyOutlined } from '@ant-design/icons';
import { Alert, App, Breadcrumb, Button, Card, Checkbox, Empty, Input, Pagination, Progress, Segmented, Select, Space, Tree, Typography } from 'antd';
import type { DataNode } from 'antd/es/tree';
import { DragEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../../../i18n';
import { formatSize } from '../../../utils';
import { FolderNode, ImageItem, PickedFile, buildTree, dirOf, filesFromDrop, filesFromInput, findFolder, imagesUnder } from './collect';
import { Converter, Mode } from './converter';
import { ImagePreview } from './ImagePreview';
import { EncryptedExt, decryptedName, encryptedName, isEncryptedName, isPngName, keyFromEncryptedFile, keyFromSystemJson, keyToHex, parseKey } from './rpgmv';
import { Thumb } from './Thumb';
import { downloadBlob, downloadZip } from './zip';

const PAGE = 120;
/** 目录树根节点的 key（空字符串在 Tree 中不可靠） */
const ROOT_KEY = '/';
const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

interface Detected {
  hex: string;
  source: 'system' | 'image';
  path: string;
}

/** 从所选文件中找密钥：优先 System.json，其次任意一张加密图片 */
async function detectKey(files: PickedFile[]): Promise<Detected | null> {
  for (const f of files.filter((x) => baseName(x.path).toLowerCase() === 'system.json')) {
    const key = keyFromSystemJson(await f.file.text());
    if (key) return { hex: keyToHex(key), source: 'system', path: f.path };
  }
  for (const f of files.filter((x) => isEncryptedName(x.path)).slice(0, 20)) {
    const key = await keyFromEncryptedFile(f.file);
    if (key) return { hex: keyToHex(key), source: 'image', path: f.path };
  }
  return null;
}

function toTreeData(node: FolderNode, t: ReturnType<typeof useT>): DataNode[] {
  const conv = (n: FolderNode): DataNode => ({
    key: n.path || ROOT_KEY,
    title: (
      <span className="folder-title">
        {n.name || t('img.all')} <span className="muted small">{n.total}</span>
      </span>
    ),
    children: n.children.map(conv),
  });
  return [conv(node)];
}

export function ImageCryptoTool() {
  const t = useT();
  const { message } = App.useApp();
  const [mode, setMode] = useState<Mode>('decrypt');
  const [picked, setPicked] = useState<PickedFile[]>([]);
  const [detected, setDetected] = useState<Detected | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [outExt, setOutExt] = useState<EncryptedExt>('.rpgmvp');
  const [dir, setDir] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<number | null>(null);
  const [zipPct, setZipPct] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const folderInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const typedKey = keyInput.trim() ? parseKey(keyInput) : null;
  const key = keyInput.trim() ? typedKey : detected ? parseKey(detected.hex) : null;
  const conv = useMemo(() => new Converter(mode, key), [mode, key && keyToHex(key)]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => conv.dispose(), [conv]);

  const accept = mode === 'decrypt' ? isEncryptedName : isPngName;
  const items = useMemo<ImageItem[]>(
    () =>
      picked
        .filter((p) => accept(p.path))
        .map((p) => {
          const d = dirOf(p.path);
          const outName = mode === 'decrypt' ? decryptedName(baseName(p.path)) : encryptedName(baseName(p.path), outExt);
          return { id: p.path, path: p.path, outName, outPath: d ? `${d}/${outName}` : outName, dir: d, file: p.file };
        }),
    [picked, mode, outExt], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const tree = useMemo(() => buildTree(items), [items]);
  const folder = findFolder(tree, dir);
  const folderImages = folder.images;
  const shown = folderImages.slice((page - 1) * PAGE, page * PAGE);

  useEffect(() => {
    setSelected(new Set());
    setPreview(null);
  }, [items]);
  useEffect(() => setPage(1), [dir, items]);

  const add = async (files: PickedFile[]) => {
    if (!files.length) return;
    const ignored = files.filter((f) => !isEncryptedName(f.path) && !isPngName(f.path) && baseName(f.path).toLowerCase() !== 'system.json').length;
    if (ignored) message.info(t('img.ignored', { count: ignored }));
    const all = [...new Map([...picked, ...files].map((f) => [f.path, f])).values()];
    setPicked(all);
    const d = await detectKey(all);
    setDetected(d);
    if (d?.source === 'image' && d.path.toLowerCase().endsWith('.png_')) setOutExt('.png_');
    // 选中单个顶层文件夹时直接进入
    const tops = new Set(all.filter((f) => accept(f.path)).map((f) => f.path.split('/')[0]));
    setDir(tops.size === 1 && all.some((f) => f.path.includes('/')) ? [...tops][0] : '');
  };

  const clear = () => {
    setPicked([]);
    setDetected(null);
    setDir('');
  };

  const toggle = (ids: string[], on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const download = async (list: ImageItem[]) => {
    if (mode === 'encrypt' && !key) return void message.error(t('img.keyMissing'));
    const ok: ImageItem[] = [];
    for (const it of list) {
      try {
        await conv.output(it);
        ok.push(it);
      } catch {
        /* 无法转换的文件跳过 */
      }
    }
    if (ok.length < list.length) message.warning(t('img.skipped', { count: list.length - ok.length }));
    if (!ok.length) return;
    if (ok.length === 1 && list.length === 1) return downloadBlob(await conv.output(ok[0]), ok[0].outName);
    setZipPct(0);
    try {
      const root = tree.children.length === 1 && !tree.images.length ? tree.children[0].name : 'images';
      await downloadZip(
        ok.map((it) => ({ path: it.outPath, blob: () => conv.output(it) })),
        `${root}_${mode === 'decrypt' ? 'png' : outExt.replace('.', '')}.zip`,
        setZipPct,
      );
      message.success(t('img.zipDone', { count: ok.length }));
    } finally {
      setZipPct(null);
    }
  };

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    await add(await filesFromDrop(e.dataTransfer));
  };

  const under = imagesUnder(folder);
  const allChecked = under.length > 0 && under.every((i) => selected.has(i.id));
  const crumbs = dir ? dir.split('/') : [];

  return (
    <div
      className={`image-tool${dragging ? ' dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <Card variant="borderless" className="tool-bar">
        <Space wrap size={12}>
          <Segmented<Mode>
            value={mode}
            onChange={setMode}
            options={[
              { value: 'decrypt', label: t('img.mode.decrypt') },
              { value: 'encrypt', label: t('img.mode.encrypt') },
            ]}
          />
          <Button icon={<FolderOpenOutlined />} type="primary" onClick={() => folderInput.current?.click()}>
            {t('img.pickFolder')}
          </Button>
          <Button icon={<FileImageOutlined />} onClick={() => fileInput.current?.click()}>
            {t('img.pickFiles')}
          </Button>
          {picked.length > 0 && (
            <Button icon={<ClearOutlined />} onClick={clear}>
              {t('img.clear')}
            </Button>
          )}
        </Space>
        {mode === 'encrypt' && (
          <Space wrap size={12} className="tool-key">
            <Input
              prefix={<KeyOutlined />}
              allowClear
              style={{ width: 380 }}
              placeholder={detected ? detected.hex : t('img.keyPlaceholder')}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              status={keyInput.trim() && !typedKey ? 'error' : undefined}
              aria-label={t('img.key')}
            />
            <Select<EncryptedExt>
              value={outExt}
              onChange={setOutExt}
              style={{ width: 160 }}
              aria-label={t('img.outExt')}
              options={[
                { value: '.rpgmvp', label: t('img.outExt.rpgmvp') },
                { value: '.png_', label: t('img.outExt.png_') },
              ]}
            />
            <Typography.Text type={keyInput.trim() && !typedKey ? 'danger' : 'secondary'} className="small">
              {keyInput.trim()
                ? !typedKey && t('img.keyInvalid')
                : detected && t(detected.source === 'system' ? 'img.keyFromSystem' : 'img.keyFromImage', { path: detected.path })}
            </Typography.Text>
          </Space>
        )}
        {mode === 'encrypt' && items.length > 0 && !key && <Alert type="warning" showIcon style={{ marginTop: 12 }} message={t('img.keyMissing')} />}
        {mode === 'decrypt' && detected && (
          <Typography.Paragraph type="secondary" className="small" style={{ margin: '12px 0 0' }} copyable={{ text: detected.hex }}>
            {t('img.keyDetected', { key: detected.hex })}
          </Typography.Paragraph>
        )}
        <input ref={folderInput} type="file" multiple hidden {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} onChange={(e) => (void add(filesFromInput(e.target.files ?? [])), (e.target.value = ''))} />
        <input ref={fileInput} type="file" multiple hidden accept={mode === 'decrypt' ? '.rpgmvp,.png_' : '.png'} onChange={(e) => (void add(filesFromInput(e.target.files ?? [])), (e.target.value = ''))} />
      </Card>

      {!items.length ? (
        <Card variant="borderless" className="tool-drop" onClick={() => folderInput.current?.click()}>
          <Empty image={<InboxOutlined className="tool-drop-icon" />} description={<span className="tool-drop-text">{t('img.drop')}</span>}>
            <Typography.Text type="secondary">{t(mode === 'decrypt' ? 'img.dropHint.decrypt' : 'img.dropHint.encrypt')}</Typography.Text>
          </Empty>
        </Card>
      ) : (
        <div className="tool-split">
          <Card variant="borderless" className="tool-tree" size="small">
            <Tree.DirectoryTree
              key={items.length}
              treeData={toTreeData(tree, t)}
              selectedKeys={[dir || ROOT_KEY]}
              defaultExpandAll
              expandAction={false}
              onSelect={(keys) => {
                if (keys.length) setDir(keys[0] === ROOT_KEY ? '' : String(keys[0]));
              }}
            />
          </Card>
          <Card
            variant="borderless"
            className="tool-main"
            size="small"
            title={
              <Breadcrumb
                items={[
                  { title: <a onClick={() => setDir('')}>{t('img.all')}</a> },
                  ...crumbs.map((c, i) => {
                    const path = crumbs.slice(0, i + 1).join('/');
                    return { title: i === crumbs.length - 1 ? c : <a onClick={() => setDir(path)}>{c}</a> };
                  }),
                ]}
              />
            }
            extra={
              <Space wrap size={8}>
                <Checkbox checked={allChecked} indeterminate={!allChecked && under.some((i) => selected.has(i.id))} onChange={(e) => toggle(under.map((i) => i.id), e.target.checked)}>
                  {t('img.selectAll')}
                </Checkbox>
                <Typography.Text type="secondary">{t('img.selected', { count: selected.size })}</Typography.Text>
                <Button type="primary" icon={<CloudDownloadOutlined />} disabled={!selected.size || zipPct !== null} onClick={() => download(items.filter((i) => selected.has(i.id)))}>
                  {t('img.downloadSelected')}
                </Button>
                <Button icon={<CloudDownloadOutlined />} disabled={zipPct !== null} onClick={() => download(items)}>
                  {t('img.downloadAll', { count: items.length })}
                </Button>
              </Space>
            }
          >
            {zipPct !== null && <Progress percent={zipPct} size="small" format={(p) => `${t('img.zipping')} ${p}%`} />}
            <div className="img-grid">
              {folder.children.map((c) => {
                const ids = imagesUnder(c).map((i) => i.id);
                const all = ids.every((id) => selected.has(id));
                return (
                  <div key={c.path} className="img-tile folder-tile" onClick={() => setDir(c.path)}>
                    <Checkbox
                      className="tile-check"
                      checked={all}
                      indeterminate={!all && ids.some((id) => selected.has(id))}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => toggle(ids, e.target.checked)}
                    />
                    <div className="tile-thumb">
                      <FolderFilled className="folder-icon" />
                    </div>
                    <div className="tile-name" title={c.name}>
                      {c.name}
                    </div>
                    <div className="tile-meta">{t('img.folderCount', { count: c.total })}</div>
                  </div>
                );
              })}
              {shown.map((it, i) => (
                <div key={it.id} className={`img-tile${selected.has(it.id) ? ' checked' : ''}`} onClick={() => setPreview((page - 1) * PAGE + i)}>
                  <Checkbox className="tile-check" checked={selected.has(it.id)} onClick={(e) => e.stopPropagation()} onChange={(e) => toggle([it.id], e.target.checked)} />
                  <div className="tile-thumb">
                    <Thumb conv={conv} item={it} />
                  </div>
                  <div className="tile-name" title={it.outName}>
                    {it.outName}
                  </div>
                  <div className="tile-meta">{formatSize(it.file.size)}</div>
                </div>
              ))}
            </div>
            {!folder.children.length && !folderImages.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('img.emptyFolder')} />}
            {folderImages.length > PAGE && (
              <div className="pager">
                <Pagination current={page} pageSize={PAGE} total={folderImages.length} onChange={setPage} showSizeChanger={false} size="small" />
              </div>
            )}
          </Card>
        </div>
      )}

      {preview !== null && folderImages[preview] && (
        <ImagePreview conv={conv} items={folderImages} index={preview} onIndex={setPreview} onDownload={(it) => void download([it])} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}
