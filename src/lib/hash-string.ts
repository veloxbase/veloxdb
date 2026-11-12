/**
 * Cheap non-cryptographic hash for building compact TanStack Query cache keys
 * from long strings (e.g. widget/preview SQL) without bloating the key array.
 */
export function hashString(value: string): string {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (Math.imul(31, hash) + value.charCodeAt(i)) | 0
  }
  return hash.toString(36)
}
