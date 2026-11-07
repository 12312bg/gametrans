/**
 * Ruby Marshal 4.8 的 JS 对象模型。
 *
 * 设计目标：load → dump 字节级一致（未修改时）。
 * - Fixnum 用 JS number；Float / Bignum 包装成对象以保留引用身份与原始字节。
 * - Ruby Array 直接用 JS 数组（引用身份即对象身份）；数组上的少见元数据放在 WeakMap 中。
 * - 字符串保留原始字节与实例变量（如编码标记 E）。
 */

export type RValue =
  | null
  | boolean
  | number
  | RSymbol
  | RString
  | RFloat
  | RBignum
  | RValue[]
  | RHash
  | RObject
  | RUserDef
  | RUserMarshal
  | RStruct
  | RRegexp
  | RClassRef
  | RData;

export type IvarList = [string, RValue][];

/** 附加在复合对象上的元数据：实例变量（'I'）、extend 的模块（'e'）、用户子类（'C'） */
export interface RMeta {
  ivars?: IvarList;
  extended?: string[];
  userClass?: string;
}

const arrayMeta = new WeakMap<object, RMeta>();

export function getMeta(obj: object): RMeta | undefined {
  if (Array.isArray(obj)) return arrayMeta.get(obj);
  return (obj as { meta?: RMeta }).meta;
}

export function setMeta(obj: object, meta: RMeta): void {
  if (Array.isArray(obj)) arrayMeta.set(obj, meta);
  else (obj as { meta?: RMeta }).meta = meta;
}

export class RSymbol {
  private static table = new Map<string, RSymbol>();
  private constructor(public readonly name: string) {}
  static of(name: string): RSymbol {
    let s = RSymbol.table.get(name);
    if (!s) {
      s = new RSymbol(name);
      RSymbol.table.set(name, s);
    }
    return s;
  }
  toString(): string {
    return `:${this.name}`;
  }
}

const utf8Decoder = new TextDecoder('utf-8');
const utf8Encoder = new TextEncoder();

export function decodeUtf8(bytes: Uint8Array): string {
  return utf8Decoder.decode(bytes);
}

export function encodeUtf8(text: string): Uint8Array {
  return utf8Encoder.encode(text);
}

export class RString {
  meta?: RMeta;
  constructor(public bytes: Uint8Array) {}

  static fromText(text: string, ivars?: IvarList): RString {
    const s = new RString(encodeUtf8(text));
    if (ivars && ivars.length) s.meta = { ivars: ivars.map(([k, v]) => [k, v]) };
    return s;
  }

  /** RGSS 中的字符串均为 UTF-8 */
  get text(): string {
    return decodeUtf8(this.bytes);
  }

  set text(value: string) {
    this.bytes = encodeUtf8(value);
  }

  /** 复制一份同编码标记的新字符串 */
  cloneWithText(text: string): RString {
    return RString.fromText(text, this.meta?.ivars);
  }
}

export class RFloat {
  meta?: RMeta;
  /** raw：原始序列化字节（未修改时原样写回） */
  constructor(
    public value: number,
    public raw?: Uint8Array,
  ) {}
}

export class RBignum {
  meta?: RMeta;
  constructor(
    public value: bigint,
    /** 原始的 short 数（未修改时原样写回长度） */
    public rawShorts?: number,
  ) {}
}

export class RHash {
  meta?: RMeta;
  constructor(
    public entries: [RValue, RValue][] = [],
    public hasDefault = false,
    public defaultValue: RValue = null,
  ) {}

  get(key: RValue): RValue | undefined {
    for (const [k, v] of this.entries) if (rEquals(k, key)) return v;
    return undefined;
  }
}

export class RObject {
  meta?: RMeta;
  constructor(
    public className: string,
    public ivars: Map<string, RValue> = new Map(),
  ) {}

  /** 读取实例变量，name 可带或不带 @ */
  get(name: string): RValue | undefined {
    return this.ivars.get(name.startsWith('@') ? name : `@${name}`);
  }

  set(name: string, value: RValue): void {
    this.ivars.set(name.startsWith('@') ? name : `@${name}`, value);
  }
}

/** 'u'：类定义了 _dump/_load，如 RGSS 的 Table/Color/Tone */
export class RUserDef {
  meta?: RMeta;
  constructor(
    public className: string,
    public bytes: Uint8Array,
  ) {}
}

/** 'U'：类定义了 marshal_dump/marshal_load */
export class RUserMarshal {
  meta?: RMeta;
  constructor(
    public className: string,
    public data: RValue,
  ) {}
}

export class RStruct {
  meta?: RMeta;
  constructor(
    public className: string,
    public members: [string, RValue][],
  ) {}
}

export class RRegexp {
  meta?: RMeta;
  constructor(
    public source: Uint8Array,
    public options: number,
  ) {}
}

/** 'c' 类 / 'm' 模块 / 'M' 旧式模块引用 */
export class RClassRef {
  meta?: RMeta;
  constructor(
    public kind: 'c' | 'm' | 'M',
    public name: string,
  ) {}
}

/** 'd'：T_DATA 对象 */
export class RData {
  meta?: RMeta;
  constructor(
    public className: string,
    public data: RValue,
  ) {}
}

export function rEquals(a: RValue, b: RValue): boolean {
  if (a === b) return true;
  if (a instanceof RString && b instanceof RString) {
    if (a.bytes.length !== b.bytes.length) return false;
    for (let i = 0; i < a.bytes.length; i++) if (a.bytes[i] !== b.bytes[i]) return false;
    return true;
  }
  if (a instanceof RFloat && b instanceof RFloat) return a.value === b.value;
  if (a instanceof RBignum && b instanceof RBignum) return a.value === b.value;
  return false;
}

// ───────────── 便捷访问 ─────────────

export function isRObject(v: unknown, className?: string): v is RObject {
  return v instanceof RObject && (className === undefined || v.className === className);
}

/** 取字符串文本；非字符串返回 undefined */
export function strOf(v: RValue | undefined): string | undefined {
  return v instanceof RString ? v.text : undefined;
}

export function numOf(v: RValue | undefined): number | undefined {
  if (typeof v === 'number') return v;
  if (v instanceof RFloat) return v.value;
  if (v instanceof RBignum) return Number(v.value);
  return undefined;
}
