import { CloudUploadOutlined, FileZipOutlined, FolderOpenOutlined } from '@ant-design/icons';
import { Alert, App, Button, Card, Progress, Space, Typography, Upload } from 'antd';
import { ENGINE_EXTENSIONS, isRgssEngine, normalizeGamePath } from '@gametrans/shared';
import { useRef, useState } from 'react';
import { upload } from '../../../api/client';
import type { Job } from '../../../api/types';
import { useProject } from '../../../api/project';
import { useT } from '../../../i18n';
import { useAuth } from '../../../providers/AuthProvider';
import { errorMessage, formatSize } from '../../../utils';
import { PickedFile, ZipError, extractGameZip } from './zip';

const SHOWN = 50;
const relPath = (f: File) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
const isZip = (f: File) => f.name.toLowerCase().endsWith('.zip');

interface Props {
  /** 项目中已有的数据文件路径；上传中包含它们时先预览变更 */
  existingPaths: Set<string>;
  onUploaded: () => void;
  onPreview: (jobId: string) => void;
}

export function UploadCard({ existingPaths, onUploaded, onPreview }: Props) {
  const t = useT();
  const { project } = useProject();
  const { site } = useAuth();
  const { message } = App.useApp();
  const [pending, setPending] = useState<PickedFile[]>([]);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [extracting, setExtracting] = useState<{ name: string; pct: number } | null>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const engine = project.engine;
  const exts = ENGINE_EXTENSIONS[engine];
  const limit = site?.uploadLimitMb;

  const tooLarge = (f: File) => {
    if (!limit || f.size <= limit * 1024 * 1024) return false;
    message.error(`${f.name}: ${t('error.FILE_TOO_LARGE', { limit })}`);
    return true;
  };

  const addPicked = (picked: PickedFile[]) =>
    setPending((p) => {
      const map = new Map(p.map((x) => [x.path, x]));
      for (const x of picked) map.set(x.path, x);
      return [...map.values()];
    });

  const addZip = async (zip: File) => {
    setExtracting({ name: zip.name, pct: 0 });
    try {
      const { files, skipped } = await extractGameZip(zip, engine, (pct) => setExtracting({ name: zip.name, pct }));
      if (!files.length) message.warning(`${zip.name}: ${t('issue.ZIP_NO_DATA')}`);
      else message.success(t('upload.extracted', { name: zip.name, count: files.length, skipped }));
      addPicked(files.filter((x) => !tooLarge(x.file)));
    } catch (e) {
      const code = e instanceof ZipError ? e.code : 'ZIP_INVALID';
      message.error(code === 'ZIP_UNSUPPORTED' ? t('upload.zipUnsupported', { name: zip.name }) : `${zip.name}: ${t('issue.ZIP_INVALID')}`);
    } finally {
      setExtracting(null);
    }
  };

  const addFiles = async (list: File[]) => {
    const picked: PickedFile[] = [];
    const zips: File[] = [];
    for (const f of list) {
      if (isZip(f)) {
        zips.push(f);
        continue;
      }
      const path = normalizeGamePath(relPath(f), engine);
      if (path && !tooLarge(f)) picked.push({ file: f, path });
    }
    const ignored = list.length - picked.length - zips.length;
    if (ignored > 0) message.info(t('upload.ignored', { count: ignored }));
    addPicked(picked);
    for (const z of zips) await addZip(z);
  };

  const submit = async () => {
    if (!pending.length) return;
    const form = new FormData();
    for (const p of pending) form.append('files', p.file, p.file.name);
    form.append('paths', JSON.stringify(pending.map((p) => p.path)));
    const preview = pending.some((p) => existingPaths.has(p.path));
    setUploadPct(0);
    try {
      const job = await upload<Job>(`/projects/${project.id}/files${preview ? '?preview=true' : ''}`, form, setUploadPct);
      setPending([]);
      if (preview) {
        onPreview(job.id);
      } else {
        message.success(t('upload.done'));
        onUploaded();
      }
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setUploadPct(null);
    }
  };

  const busy = uploadPct !== null || extracting !== null;
  const totalSize = pending.reduce((n, p) => n + p.file.size, 0);

  return (
    <Card variant="borderless" title={t('upload.title')}>
      <Upload.Dragger
        multiple
        accept={[...exts, '.zip'].join(',')}
        showUploadList={false}
        disabled={busy}
        beforeUpload={(f, list) => {
          if (f === list[0]) void addFiles(list as unknown as File[]);
          return false;
        }}
      >
        <p className="ant-upload-drag-icon">
          <CloudUploadOutlined />
        </p>
        <p className="ant-upload-text">{t('upload.drop')}</p>
        <p className="ant-upload-hint">
          <FileZipOutlined /> {t('upload.hint', { exts: exts.join(' / ') })}
          {t(isRgssEngine(engine) ? 'upload.hintRgss' : 'upload.hintMv')}
        </p>
      </Upload.Dragger>
      <Space style={{ marginTop: 12 }} wrap>
        <Button icon={<FolderOpenOutlined />} onClick={() => folderInput.current?.click()} disabled={busy}>
          {t('upload.pickFolder')}
        </Button>
        <Typography.Text type="secondary" className="small">
          {t('upload.pickFolderHint')}
        </Typography.Text>
        <input
          ref={folderInput}
          type="file"
          style={{ display: 'none' }}
          multiple
          {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
          onChange={(e) => {
            void addFiles(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
      </Space>
      {extracting && (
        <div className="zip-progress">
          <Typography.Text type="secondary">{t('upload.extracting', { name: extracting.name })}</Typography.Text>
          <Progress percent={extracting.pct} size="small" />
        </div>
      )}
      {pending.length > 0 && (
        <div className="pending-upload">
          <div className="pending-head">
            <span>{t('upload.pending', { count: pending.length, size: formatSize(totalSize) })}</span>
            <Space>
              <Button size="small" onClick={() => setPending([])} disabled={busy}>
                {t('upload.clear')}
              </Button>
              <Button size="small" type="primary" onClick={submit} loading={uploadPct !== null} disabled={extracting !== null}>
                {t('upload.start')}
              </Button>
            </Space>
          </div>
          {uploadPct !== null && <Progress percent={uploadPct} size="small" />}
          <Upload
            fileList={pending.slice(0, SHOWN).map((p) => ({ uid: p.path, name: p.path, size: p.file.size, status: 'done' }))}
            onRemove={(f) => setPending((p) => p.filter((x) => x.path !== f.uid))}
            showUploadList={{ showRemoveIcon: uploadPct === null }}
          />
          {pending.length > SHOWN && <Typography.Text type="secondary">{t('upload.more', { count: pending.length - SHOWN })}</Typography.Text>}
        </div>
      )}
      <Alert style={{ marginTop: 12 }} type="info" showIcon message={t('upload.notice')} />
    </Card>
  );
}
