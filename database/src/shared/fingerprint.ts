import { createHash } from 'node:crypto';

function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
}
/** sha256 hex of the canonical (key-sorted) JSON form of a request. */
export const requestFingerprint = (v: unknown): string => createHash('sha256').update(canonical(v)).digest('hex');
