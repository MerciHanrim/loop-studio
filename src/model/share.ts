// Shareable URL - pure codec + validation layer (SEMANTICS-U.md, loop-share/1).
//
// Step 1: no store, no UI. This module owns the wire transport only:
//   - strict base64url (SS U1.4)
//   - zlib-wrapped DEFLATE (RFC 1950) through the browser's own
//     Compression Streams, in both directions. There is no bundled fallback:
//     a page without them can neither make nor open a link, and says so
//     (SS U1.3, issue #301 decision 1).
//   - the outbound SHARE_MAX_BYTES check (SS U3.1)
//   - the inbound, INCREMENTAL SHARE_MAX_DECODED_BYTES decompression-bomb guard
//     that aborts before any parse and materialises nothing beyond the cap
//     (SS U3.2)
//
// JSON.parse / deserialize / loadDoc are the boot-apply layer (step 2); they
// never run here. Every failure surfaces as a typed `ShareError` - this module
// never throws an untyped error and never touches app state.

/** fragment key: `g` = graph, `1` = payload format (SS U1.2 / U11) */
export const SHARE_PREFIX = 'g1='
/** fragment key of a PROTECTED link: `p` = protected, `1` = payload format
 *  (SEMANTICS-P.md, loop-share-protected/1). The sealed transport is
 *  `shareProtected.ts`; the key lives here because the fragment grammar has one
 *  classifier (`classifyFragment`), which the boot module also uses. */
export const PROTECTED_SHARE_PREFIX = 'p1='
/** hard cap on the base64url payload byte length AFTER `#g1=` (SS U3.1 / U11) */
export const SHARE_MAX_BYTES = 8 * 1024
/** incremental cap on the inflated bytes; abort before JSON.parse (SS U3.2 / U11) */
export const SHARE_MAX_DECODED_BYTES = 1024 * 1024

export type ShareFailure =
  | 'bad-base64url' // non-alphabet char, padding, whitespace, or impossible length
  | 'not-zlib' // missing / invalid RFC 1950 header, or a raw DEFLATE stream
  | 'inflate-failed' // corrupt DEFLATE body, bad checksum, truncated
  | 'decoded-too-large' // inflate output would exceed SHARE_MAX_DECODED_BYTES
  | 'unavailable' // the page has no Compression Streams (SS U1.3)

export class ShareError extends Error {
  reason: ShareFailure
  constructor(reason: ShareFailure) {
    super(reason)
    this.name = 'ShareError'
    this.reason = reason
  }
}

// -- UTF-8 --------------------------------------------------------------------

export function utf8Bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}
export function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

// -- base64url (strict, SS U1.4) --------------------------------------------

const B64URL_OK = /^[A-Za-z0-9_-]*$/

/** standard base64 -> base64url: `+`->`-`, `/`->`_`, drop `=` padding. */
export function base64urlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Strict decode: only `A-Z a-z 0-9 - _`. Any `+`, `/`, `=`, whitespace, or other
 * character - and any length that base64 can never produce (`% 4 === 1`) -
 * throws `ShareError('bad-base64url')`. Nothing is repaired.
 */
export function base64urlDecode(payload: string): Uint8Array {
  if (!B64URL_OK.test(payload) || payload.length % 4 === 1) {
    throw new ShareError('bad-base64url')
  }
  const std = payload.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((payload.length + 3) % 4)
  let bin: string
  try {
    bin = atob(std)
  } catch {
    throw new ShareError('bad-base64url')
  }
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// -- native deflate / inflate (Compression Streams) -----------------------

async function streamThrough(
  ts: CompressionStream | DecompressionStream,
  input: Uint8Array,
  maxOut = Infinity,
): Promise<Uint8Array> {
  const writer = ts.writable.getWriter()
  const reader = ts.readable.getReader() as ReadableStreamDefaultReader<Uint8Array>
  // Fire-and-forget the write side. When a cap breach cancels the reader, the
  // writer promises reject too - that is expected, not the failure we report,
  // so they are swallowed. The read loop is the single source of truth.
  void writer
    // TS lib variance: the stream's chunk type is `BufferSource`; a Uint8Array
    // is a valid chunk at runtime (same cast shape as `sha256Hex`).
    .write(input as unknown as ArrayBuffer)
    .then(() => writer.close())
    .catch(() => {})

  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    total += value.length
    if (total > maxOut) {
      await reader.cancel().catch(() => {})
      throw new ShareError('decoded-too-large')
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.length
  }
  return out
}

/**
 * Can this page make and open share links at all? Both directions use the
 * browser's own `CompressionStream` / `DecompressionStream` ('deflate', the
 * zlib wrapper) and there is no bundled fallback (SS U1.3). Read at call time,
 * not at module load, so a page that lacks them is judged when it acts.
 */
export function shareCompressionAvailable(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined'
}

/** zlib-wrapped DEFLATE through `CompressionStream('deflate')` (SS U1.3).
 *  `ShareError('unavailable')` where the page has no Compression Streams. */
export async function zlibDeflate(bytes: Uint8Array): Promise<Uint8Array> {
  if (!shareCompressionAvailable()) throw new ShareError('unavailable')
  return streamThrough(new CompressionStream('deflate'), bytes)
}

/** Inflate a zlib stream with the output bounded by `maxOut`, through
 *  `DecompressionStream('deflate')`; the cap is enforced as chunks arrive.
 *  Always a typed `ShareError` on failure, `unavailable` where the page has no
 *  Compression Streams. */
export async function zlibInflate(bytes: Uint8Array, maxOut: number): Promise<Uint8Array> {
  if (!shareCompressionAvailable()) throw new ShareError('unavailable')
  try {
    return await streamThrough(new DecompressionStream('deflate'), bytes, maxOut)
  } catch (e) {
    if (e instanceof ShareError) throw e
    throw new ShareError('inflate-failed')
  }
}

// -- top-level codec ----------------------------------------------------

/** `text` (a graph JSON string) -> the base64url fragment payload + its byte
 *  length. base64url is ASCII, so `bytes` is also the character count. */
export async function encodeShareText(text: string): Promise<{ payload: string; bytes: number }> {
  const payload = base64urlEncode(await zlibDeflate(utf8Bytes(text)))
  return { payload, bytes: payload.length }
}

/** SS U3.1 - `true` => build the link; `false` => caller shows the hard reject. */
export function fitsShareLink(bytes: number): boolean {
  return bytes <= SHARE_MAX_BYTES
}

/**
 * Fragment payload -> the decoded UTF-8 string (still un-parsed). Runs strict
 * base64url -> bounded inflate. Throws only `ShareError`; the caller treats any
 * throw as "damaged link, leave the current graph untouched" (SS U5.2).
 */
export async function decodeShareText(payload: string): Promise<string> {
  const compressed = base64urlDecode(payload)
  const raw = await zlibInflate(compressed, SHARE_MAX_DECODED_BYTES)
  return utf8Decode(raw)
}

/**
 * Classify a URL fragment against the Loop Studio Share grammar (SS U5.1 / U6).
 *
 *  - `share`       - `g1=<payload>` : a current share link (payload may be '')
 *  - `unsupported` - `g<n>=...`, n != 1 : a Share link from a newer version
 *  - `malformed`   - starts `g1` but is not `g1=...` : a broken share link
 *  - `foreign`     - anything else (`#section`, `#/route`, `#w1=...`, '') : not
 *                    ours; the caller leaves it in the address bar
 *
 * `unsupported` and `malformed` are Loop Studio's to clean up (warn + strip);
 * `foreign` is left untouched.
 *
 * The protected grammar (SEMANTICS-P.md SS P4) sits beside it:
 *
 *  - `protected`             - `p1=<payload>` : a protected link (payload may be '')
 *  - `protected-unsupported` - `p<n>=...`, n != 1 : a protected link from a newer
 *                              version. Its fragment is KEPT (unlike `g<n>=`), so
 *                              the same address opens after the app updates
 *  - `protected-malformed`   - starts `p1` but is not `p1=...` : a broken protected link
 *
 * A build that predates `p1` classifies all three as `foreign` and leaves them
 * in the address bar; that is what lets a protected link survive an update.
 */
export type FragmentKind =
  | { kind: 'share'; payload: string }
  | { kind: 'unsupported' }
  | { kind: 'malformed' }
  | { kind: 'protected'; payload: string }
  | { kind: 'protected-unsupported' }
  | { kind: 'protected-malformed' }
  | { kind: 'foreign' }

export function classifyFragment(hash: string): FragmentKind {
  const h = hash.startsWith('#') ? hash.slice(1) : hash
  if (h.startsWith(SHARE_PREFIX)) return { kind: 'share', payload: h.slice(SHARE_PREFIX.length) }
  if (/^g\d+=/.test(h)) return { kind: 'unsupported' } // g2=, g10=, ... - a real versioned prefix
  if (/^g1(?![0-9])/.test(h)) return { kind: 'malformed' } // g1, g1x, g1-... (g1= handled above)
  if (h.startsWith(PROTECTED_SHARE_PREFIX)) return { kind: 'protected', payload: h.slice(PROTECTED_SHARE_PREFIX.length) }
  if (/^p\d+=/.test(h)) return { kind: 'protected-unsupported' } // p2=, p10=, ...
  if (/^p1(?![0-9])/.test(h)) return { kind: 'protected-malformed' } // p1, p1x, p1-...
  return { kind: 'foreign' }
}

/** `location.hash` -> the `g1=` payload, or `null` if this is not a current
 *  share link. Thin wrapper over `classifyFragment` (SS U5.1). */
export function readShareFragment(hash: string): string | null {
  const c = classifyFragment(hash)
  return c.kind === 'share' ? c.payload : null
}
