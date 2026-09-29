// FNV-1a 32-bit over normalized text; sync, dependency-free, good enough for a local cache.
export function postKey(author, text) {
  const norm = (author + '\u0000' + text).normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 600);
  let h = 0x811c9dc5;
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
