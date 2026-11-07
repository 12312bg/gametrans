import {
  IvarList,
  RBignum,
  RClassRef,
  RData,
  RFloat,
  RHash,
  RMeta,
  RObject,
  RRegexp,
  RString,
  RStruct,
  RSymbol,
  RUserDef,
  RUserMarshal,
  RValue,
  decodeUtf8,
  getMeta,
  setMeta,
} from './types';

export class MarshalError extends Error {}

/** 记录带编码实例变量的符号（'I:'），写回时复原 */
export const symbolIvars = new Map<string, IvarList>();

const latin1 = new TextDecoder('latin1');

/**
 * Ruby Marshal 4.8 读取器。对象表登记顺序与 MRI 的 marshal.c 保持一致，
 * 以便 writer 能复现相同的 '@' 引用索引。
 */
export class MarshalReader {
  private pos = 0;
  private symbols: string[] = [];
  private objects: RValue[] = [];

  constructor(private readonly buf: Uint8Array) {}

  static load(buf: Uint8Array): RValue {
    const r = new MarshalReader(buf);
    const major = r.byte();
    const minor = r.byte();
    if (major !== 4 || minor > 8) throw new MarshalError(`不支持的 Marshal 版本 ${major}.${minor}`);
    return r.object();
  }

  private byte(): number {
    if (this.pos >= this.buf.length) throw new MarshalError('数据意外结束');
    return this.buf[this.pos++];
  }

  private bytes(n: number): Uint8Array {
    if (n < 0 || this.pos + n > this.buf.length) throw new MarshalError('数据意外结束');
    const b = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    // 拷贝一份，避免持有整个文件缓冲区，也便于原地修改
    return b.slice();
  }

  private long(): number {
    let c = this.byte();
    if (c > 127) c -= 256;
    if (c === 0) return 0;
    if (c > 0) {
      if (c > 4) return c - 5;
      let x = 0;
      for (let i = 0; i < c; i++) x += this.byte() * 2 ** (8 * i);
      return x;
    }
    if (c < -4) return c + 5;
    const len = -c;
    let x = -1;
    for (let i = 0; i < len; i++) {
      x &= ~(0xff << (8 * i));
      x |= this.byte() << (8 * i);
    }
    return x;
  }

  private rbytes(): Uint8Array {
    return this.bytes(this.long());
  }

  private symbol(): string {
    const t = this.byte();
    if (t === 0x3a /* : */) return this.symbolReal(false);
    if (t === 0x3b /* ; */) {
      const idx = this.long();
      if (idx >= this.symbols.length) throw new MarshalError(`无效的符号引用 ${idx}`);
      return this.symbols[idx];
    }
    if (t === 0x49 /* I */) {
      const t2 = this.byte();
      if (t2 !== 0x3a) throw new MarshalError('带实例变量的符号格式错误');
      return this.symbolReal(true);
    }
    throw new MarshalError(`期望符号，实际为 0x${t.toString(16)}`);
  }

  private symbolReal(withIvars: boolean): string {
    const raw = this.rbytes();
    const name = decodeUtf8(raw);
    this.symbols.push(name);
    if (withIvars) {
      const n = this.long();
      const ivars: IvarList = [];
      for (let i = 0; i < n; i++) {
        const k = this.symbol();
        ivars.push([k, this.object()]);
      }
      symbolIvars.set(name, ivars);
    }
    return name;
  }

  private entry<T extends RValue>(v: T): T {
    this.objects.push(v);
    return v;
  }

  private readIvars(target: object): void {
    const n = this.long();
    const ivars: IvarList = [];
    for (let i = 0; i < n; i++) {
      const k = this.symbol();
      ivars.push([k, this.object()]);
    }
    const meta: RMeta = getMeta(target) ?? {};
    meta.ivars = ivars;
    setMeta(target, meta);
  }

  object(): RValue {
    return this.object0(null, []);
  }

  /**
   * @param ivarHolder 不为 null 时表示外层是 'I'，需要读取实例变量
   * @param extended   外层 'e' 传入的模块列表
   */
  private object0(ivarHolder: { pending: boolean } | null, extended: string[]): RValue {
    const type = this.byte();
    switch (type) {
      case 0x30: // '0'
        return null;
      case 0x54: // 'T'
        return true;
      case 0x46: // 'F'
        return false;
      case 0x69: // 'i'
        return this.long();
      case 0x3a: {
        // ':'
        const withIvars = !!ivarHolder?.pending;
        if (ivarHolder) ivarHolder.pending = false;
        return RSymbol.of(this.symbolReal(withIvars));
      }
      case 0x3b: {
        // ';'
        const idx = this.long();
        if (idx >= this.symbols.length) throw new MarshalError(`无效的符号引用 ${idx}`);
        return RSymbol.of(this.symbols[idx]);
      }
      case 0x40: {
        // '@'
        const idx = this.long();
        if (idx >= this.objects.length) throw new MarshalError(`无效的对象引用 ${idx}`);
        return this.objects[idx];
      }
      case 0x49: {
        // 'I'
        const holder = { pending: true };
        const v = this.object0(holder, extended);
        if (holder.pending) {
          if (v === null || typeof v !== 'object') throw new MarshalError('无法为立即值附加实例变量');
          this.readIvars(v as object);
        }
        return v;
      }
      case 0x65: {
        // 'e'
        const mod = this.symbol();
        return this.object0(ivarHolder, [...extended, mod]);
      }
      case 0x43: {
        // 'C'
        const klass = this.symbol();
        const v = this.object0(ivarHolder, extended);
        if (v === null || typeof v !== 'object') throw new MarshalError('用户子类包装了立即值');
        const meta = getMeta(v as object) ?? {};
        meta.userClass = klass;
        setMeta(v as object, meta);
        return v;
      }
      case 0x22: {
        // '"'
        const s = this.entry(new RString(this.rbytes()));
        this.applyExtended(s, extended);
        return s;
      }
      case 0x66: {
        // 'f'
        const raw = this.rbytes();
        const f = this.entry(new RFloat(parseRubyFloat(raw), raw));
        return f;
      }
      case 0x6c: {
        // 'l'
        const sign = this.byte();
        const shorts = this.long();
        const data = this.bytes(shorts * 2);
        let v = 0n;
        for (let i = data.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(data[i]);
        if (sign === 0x2d /* - */) v = -v;
        return this.entry(new RBignum(v, shorts));
      }
      case 0x5b: {
        // '['
        const n = this.long();
        const arr: RValue[] = [];
        this.entry(arr);
        this.applyExtended(arr, extended);
        for (let i = 0; i < n; i++) arr.push(this.object());
        return arr;
      }
      case 0x7b: // '{'
      case 0x7d: {
        // '}'
        const n = this.long();
        const h = this.entry(new RHash());
        this.applyExtended(h, extended);
        for (let i = 0; i < n; i++) {
          const k = this.object();
          const v = this.object();
          h.entries.push([k, v]);
        }
        if (type === 0x7d) {
          h.hasDefault = true;
          h.defaultValue = this.object();
        }
        return h;
      }
      case 0x6f: {
        // 'o'
        const klass = this.symbol();
        const o = this.entry(new RObject(klass));
        this.applyExtended(o, extended);
        const n = this.long();
        for (let i = 0; i < n; i++) {
          const k = this.symbol();
          o.ivars.set(k, this.object());
        }
        return o;
      }
      case 0x75: {
        // 'u'
        const klass = this.symbol();
        const data = this.rbytes();
        const u = new RUserDef(klass, data);
        if (ivarHolder?.pending) {
          ivarHolder.pending = false;
          this.readIvars(u);
        }
        this.entry(u);
        this.applyExtended(u, extended);
        return u;
      }
      case 0x55: {
        // 'U'
        const klass = this.symbol();
        const u = this.entry(new RUserMarshal(klass, null));
        this.applyExtended(u, extended);
        u.data = this.object();
        return u;
      }
      case 0x53: {
        // 'S'
        const klass = this.symbol();
        const s = this.entry(new RStruct(klass, []));
        this.applyExtended(s, extended);
        const n = this.long();
        for (let i = 0; i < n; i++) {
          const k = this.symbol();
          s.members.push([k, this.object()]);
        }
        return s;
      }
      case 0x2f: {
        // '/'
        const src = this.rbytes();
        const opts = this.byte();
        const r = this.entry(new RRegexp(src, opts));
        this.applyExtended(r, extended);
        return r;
      }
      case 0x63: // 'c'
      case 0x6d: // 'm'
      case 0x4d: {
        // 'M'
        const name = latin1.decode(this.rbytes());
        const kind = type === 0x63 ? 'c' : type === 0x6d ? 'm' : 'M';
        return this.entry(new RClassRef(kind, name));
      }
      case 0x64: {
        // 'd'
        const klass = this.symbol();
        const d = this.entry(new RData(klass, null));
        d.data = this.object();
        return d;
      }
      default:
        throw new MarshalError(`未知的 Marshal 类型 0x${type.toString(16)} @ ${this.pos - 1}`);
    }
  }

  private applyExtended(obj: object, extended: string[]): void {
    if (!extended.length) return;
    const meta = getMeta(obj) ?? {};
    meta.extended = extended;
    setMeta(obj, meta);
  }
}

/** 解析 Ruby Float 的序列化文本（1.8 可能在 NUL 后附带尾数字节） */
export function parseRubyFloat(raw: Uint8Array): number {
  let end = raw.indexOf(0);
  if (end < 0) end = raw.length;
  const s = latin1.decode(raw.subarray(0, end));
  if (s === 'inf') return Infinity;
  if (s === '-inf') return -Infinity;
  if (s === 'nan') return NaN;
  return Number(s);
}
