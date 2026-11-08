import yauzl from 'yauzl';

/** 单个数据文件解压后的上限，防止压缩炸弹 */
const MAX_ENTRY_BYTES = 512 * 1024 * 1024;

/**
 * 流式读取磁盘上的 zip：根据中央目录逐个条目处理，只解压 pick 返回目标路径的条目，
 * 不会把整个压缩包读进内存。返回 目标路径 → 内容。
 */
export function readZip(path: string, pick: (name: string) => string | null): Promise<Map<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    // decodeStrings: false —— 自行解码文件名，避免 yauzl 遇到非法路径时中止整个压缩包
    yauzl.open(path, { lazyEntries: true, autoClose: true, decodeStrings: false }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('zip open failed'));
      const out = new Map<string, Uint8Array>();
      zip.on('error', reject);
      zip.on('end', () => resolve(out));
      zip.on('entry', (entry: yauzl.Entry) => {
        const raw = entry.fileName as unknown as Buffer;
        const name = raw.toString(entry.generalPurposeBitFlag & 0x800 ? 'utf8' : 'latin1');
        const target = name.endsWith('/') ? null : pick(name);
        if (!target || entry.uncompressedSize > MAX_ENTRY_BYTES) return zip.readEntry();
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return reject(e ?? new Error('zip read failed'));
          const chunks: Buffer[] = [];
          stream.on('data', (c: Buffer) => chunks.push(c));
          stream.on('error', reject);
          stream.on('end', () => {
            out.set(target, new Uint8Array(Buffer.concat(chunks)));
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}
