export * from './types';
export { MarshalReader, MarshalError } from './reader';
export { MarshalWriter, dump } from './writer';
import { MarshalReader } from './reader';
import type { RValue } from './types';

export function load(buf: Uint8Array): RValue {
  return MarshalReader.load(buf);
}
