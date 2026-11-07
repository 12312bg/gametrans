import { symbolIvars } from './reader';
import {
  IvarList,
  RBignum,
  RClassRef,
  RData,
  RFloat,
  RHash,
  RObject,
  RRegexp,
  RString,
  RStruct,
  RSymbol,
  RUserDef,
  RUserMarshal,
  RValue,
  encodeUtf8,
  getMeta,
} from './types';

class ByteSink {
  private buf = new Uint8Array(1 << 16);
  length = 0;

  private ensure(n: number) {
    if (this.length + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + n) size *= 2;
    const nb = new Uint8Array(size);
    nb.set(this.buf.subarray(0, this.length));
    this.buf = nb;
  }

  byte(b: number) {
    this.ensure(1);
    this.buf[this.length++] = b & 0xff;
  }

  bytes(b: Uint8Array) {
    this.ensure(b.length);
    this.buf.set(b, this.length);
    this.length += b.length;
  }

  result(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

const latin1Bytes = (s: string) => {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
};

/** Fixnum 能用 'i' 表示的范围（与 MRI 64 位一致：31 位有符号） */
const FIXNUM_MIN = -(2 ** 31);
const FIXNUM_MAX = 2 ** 31 - 1;

/**
 * Ruby Marshal 4.8 写入器。对象登记顺序与 MRI 的 w_object 一致：
 * 普通对象在写内容前登记，_dump 型（'u'）在写完后登记。
 */
export class MarshalWriter {
  private out = new ByteSink();
  private symbols = new Map<string, number>();
  private objects = new Map<object, number>();
  private objCount = 0;

  static dump(value: RValue): Uint8Array {
    const w = new MarshalWriter();
    w.out.byte(4);
    w.out.byte(8);
    w.object(value);
    return w.out.result();
  }

  private long(x: number) {
    if (x === 0) {
      this.out.byte(0);
      return;
    }
    if (x > 0 && x < 123) {
      this.out.byte(x + 5);
      return;
    }
    if (x < 0 && x > -124) {
      this.out.byte((x - 5) & 0xff);
      return;
    }
    const tmp: number[] = [];
    let v = x;
    for (let i = 1; i <= 4; i++) {
      tmp.push(v & 0xff);
      v = Math.floor(v / 256);
      if (v === 0) {
        this.out.byte(i);
        break;
      }
      if (v === -1) {
        this.out.byte(-i & 0xff);
        break;
      }
      if (i === 4) throw new Error(`整数超出 w_long 范围: ${x}`);
    }
    for (const b of tmp) this.out.byte(b);
  }

  private rbytes(b: Uint8Array) {
    this.long(b.length);
    this.out.bytes(b);
  }

  private symbol(name: string) {
    const idx = this.symbols.get(name);
    if (idx !== undefined) {
      this.out.byte(0x3b);
      this.long(idx);
      return;
    }
    this.symbols.set(name, this.symbols.size);
    const ivars = symbolIvars.get(name);
    if (ivars && ivars.length) {
      this.out.byte(0x49);
      this.out.byte(0x3a);
      this.rbytes(encodeUtf8(name));
      this.ivarList(ivars);
    } else {
      this.out.byte(0x3a);
      this.rbytes(encodeUtf8(name));
    }
  }

  private ivarList(ivars: IvarList) {
    this.long(ivars.length);
    for (const [k, v] of ivars) {
      this.symbol(k);
      this.object(v);
    }
  }

  private register(obj: object) {
    this.objects.set(obj, this.objCount++);
  }

  private prefix(obj: object): { ivars: IvarList | undefined } {
    const meta = getMeta(obj);
    const ivars = meta?.ivars && meta.ivars.length ? meta.ivars : undefined;
    if (ivars) this.out.byte(0x49);
    if (meta?.extended) {
      for (const m of meta.extended) {
        this.out.byte(0x65);
        this.symbol(m);
      }
    }
    if (meta?.userClass) {
      this.out.byte(0x43);
      this.symbol(meta.userClass);
    }
    return { ivars };
  }

  object(v: RValue): void {
    if (v === null) return this.out.byte(0x30);
    if (v === true) return this.out.byte(0x54);
    if (v === false) return this.out.byte(0x46);
    if (typeof v === 'number') {
      if (!Number.isInteger(v)) {
        // 新写入的浮点数（未包装），按 Float 处理
        return this.object(new RFloat(v));
      }
      if (v >= FIXNUM_MIN && v <= FIXNUM_MAX) {
        this.out.byte(0x69);
        this.long(v);
        return;
      }
      return this.object(new RBignum(BigInt(v)));
    }
    if (v instanceof RSymbol) return this.symbol(v.name);

    const link = this.objects.get(v as object);
    if (link !== undefined) {
      this.out.byte(0x40);
      this.long(link);
      return;
    }

    if (v instanceof RUserDef) {
      // MRI：_dump 对象在写完后才登记
      const { ivars } = this.prefix(v);
      this.out.byte(0x75);
      this.symbol(v.className);
      this.rbytes(v.bytes);
      if (ivars) this.ivarList(ivars);
      this.register(v);
      return;
    }

    if (v instanceof RUserMarshal) {
      this.register(v);
      this.prefix(v);
      this.out.byte(0x55);
      this.symbol(v.className);
      this.object(v.data);
      return;
    }

    this.register(v as object);
    const { ivars } = this.prefix(v as object);

    if (v instanceof RString) {
      this.out.byte(0x22);
      this.rbytes(v.bytes);
    } else if (v instanceof RFloat) {
      this.out.byte(0x66);
      this.rbytes(v.raw && matchesRaw(v) ? v.raw : formatFloat(v.value));
    } else if (v instanceof RBignum) {
      this.out.byte(0x6c);
      this.out.byte(v.value < 0n ? 0x2d : 0x2b);
      let abs = v.value < 0n ? -v.value : v.value;
      const bytes: number[] = [];
      while (abs > 0n) {
        bytes.push(Number(abs & 0xffn));
        abs >>= 8n;
      }
      let shorts = Math.ceil(bytes.length / 2);
      if (v.rawShorts !== undefined && v.rawShorts >= shorts) shorts = v.rawShorts;
      while (bytes.length < shorts * 2) bytes.push(0);
      this.long(shorts);
      for (const b of bytes) this.out.byte(b);
    } else if (Array.isArray(v)) {
      this.out.byte(0x5b);
      this.long(v.length);
      for (const item of v) this.object(item);
    } else if (v instanceof RHash) {
      this.out.byte(v.hasDefault ? 0x7d : 0x7b);
      this.long(v.entries.length);
      for (const [k, val] of v.entries) {
        this.object(k);
        this.object(val);
      }
      if (v.hasDefault) this.object(v.defaultValue);
    } else if (v instanceof RObject) {
      this.out.byte(0x6f);
      this.symbol(v.className);
      this.long(v.ivars.size);
      for (const [k, val] of v.ivars) {
        this.symbol(k);
        this.object(val);
      }
    } else if (v instanceof RStruct) {
      this.out.byte(0x53);
      this.symbol(v.className);
      this.long(v.members.length);
      for (const [k, val] of v.members) {
        this.symbol(k);
        this.object(val);
      }
    } else if (v instanceof RRegexp) {
      this.out.byte(0x2f);
      this.rbytes(v.source);
      this.out.byte(v.options);
    } else if (v instanceof RClassRef) {
      this.out.byte(v.kind.charCodeAt(0));
      this.rbytes(latin1Bytes(v.name));
    } else if (v instanceof RData) {
      this.out.byte(0x64);
      this.symbol(v.className);
      this.object(v.data);
    } else {
      throw new Error(`无法序列化的值: ${String(v)}`);
    }

    if (ivars) this.ivarList(ivars);
  }
}

function matchesRaw(f: RFloat): boolean {
  if (!f.raw) return false;
  let end = f.raw.indexOf(0);
  if (end < 0) end = f.raw.length;
  const s = String.fromCharCode(...f.raw.subarray(0, end));
  const parsed = s === 'inf' ? Infinity : s === '-inf' ? -Infinity : s === 'nan' ? NaN : Number(s);
  return Object.is(parsed, f.value) || (Number.isNaN(parsed) && Number.isNaN(f.value));
}

function formatFloat(v: number): Uint8Array {
  let s: string;
  if (Number.isNaN(v)) s = 'nan';
  else if (v === Infinity) s = 'inf';
  else if (v === -Infinity) s = '-inf';
  else if (Object.is(v, -0)) s = '-0';
  else s = String(v);
  return latin1Bytes(s);
}

export function dump(value: RValue): Uint8Array {
  return MarshalWriter.dump(value);
}
