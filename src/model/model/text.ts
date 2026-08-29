// Shared text normalisation for the loop-model/1 advisory string fields
// (SEMANTICS-M.md §M1.2 unit, §M4.1 resourceType): trim *Unicode White_Space*
// (not JS `String.prototype.trim`, which differs on U+0085 / U+FEFF), NFC, and
// a UTF-8 byte cap applied on a code-point boundary.

// Unicode `White_Space=Yes` (Unicode 15) — the exact set §M1.2 / §M4.1 mean.
const WHITE_SPACE_CODEPOINTS = [
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002,
  0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029,
  0x202f, 0x205f, 0x3000,
]
const WS = new Set(WHITE_SPACE_CODEPOINTS)

const isWs = (cp: number | undefined): boolean => cp != null && WS.has(cp)

export function trimUnicodeWhitespace(s: string): string {
  let start = 0
  let end = s.length
  while (start < end && isWs(s.codePointAt(start))) start += 1
  while (end > start && isWs(s.codePointAt(end - 1))) end -= 1
  return s.slice(start, end)
}

const enc = new TextEncoder()
export const utf8Len = (s: string): number => enc.encode(s).length

/** Truncate to at most `maxBytes` UTF-8 bytes, never splitting a code point. */
export function truncateUtf8(s: string, maxBytes: number): string {
  if (utf8Len(s) <= maxBytes) return s
  let out = ''
  let bytes = 0
  for (const ch of s) {
    const b = enc.encode(ch).length
    if (bytes + b > maxBytes) break
    out += ch
    bytes += b
  }
  return out
}
