// Shareable URL - pure codec + validation layer (SEMANTICS-U.md, loop-share/1).
//
// Step 1: no store, no UI. This module owns the wire transport only:
//   - strict base64url (SS U1.4)
//   - zlib-wrapped DEFLATE (RFC 1950), with a Web-native path
//     (Compression/DecompressionStream) and a self-contained fallback so a
//     portable file:// build can both PRODUCE and OPEN a link (SS U1.3). The
//     fallback encoder is a real DEFLATE compressor - LZ77 + fixed Huffman
//     (`zlibDeflateFixedJs`) - so a repetitive graph shrinks on file:// too,
//     not just on https. (`zlibWrapStored` - uncompressed - is kept only as an
//     inflater test vector.)
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
/** hard cap on the base64url payload byte length AFTER `#g1=` (SS U3.1 / U11) */
export const SHARE_MAX_BYTES = 8 * 1024
/** incremental cap on the inflated bytes; abort before JSON.parse (SS U3.2 / U11) */
export const SHARE_MAX_DECODED_BYTES = 1024 * 1024

export type ShareFailure =
  | 'bad-base64url' // non-alphabet char, padding, whitespace, or impossible length
  | 'not-zlib' // missing / invalid RFC 1950 header, or a raw DEFLATE stream
  | 'inflate-failed' // corrupt DEFLATE body, bad checksum, truncated
  | 'decoded-too-large' // inflate output would exceed SHARE_MAX_DECODED_BYTES

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

// -- zlib (RFC 1950) wrapper ----------------------------------------------

function adler32(data: Uint8Array): number {
  let a = 1
  let b = 0
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521
    b = (b + a) % 65521
  }
  return ((b << 16) | a) >>> 0
}

/**
 * A valid RFC 1950 stream built from RFC 1951 *stored* (uncompressed) blocks.
 * NOT used as the encode fallback (that is `zlibDeflateFixedJs`, which actually
 * compresses) - kept only as a decoder test vector: any conformant inflater
 * must read it. Cross-implementation byte differences are expected (SS U1.3 / D2).
 */
export function zlibWrapStored(data: Uint8Array): Uint8Array {
  // Canonical empty zlib stream - `DecompressionStream('deflate')` rejects an
  // empty *stored* block, and accepts this. (A share payload is never empty;
  // this only keeps the codec total.)
  if (data.length === 0) return new Uint8Array([0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01])

  const body: number[] = []
  let off = 0
  do {
    const len = Math.min(0xffff, data.length - off)
    const last = off + len >= data.length ? 1 : 0
    // BFINAL in bit 0, BTYPE=00 -> the header byte is just BFINAL; then
    // LEN (LE u16), NLEN (~LEN, LE u16), then the raw bytes.
    body.push(last, len & 0xff, (len >> 8) & 0xff, ~len & 0xff, (~len >> 8) & 0xff)
    for (let i = 0; i < len; i++) body.push(data[off + i])
    off += len
  } while (off < data.length)

  const adler = adler32(data)
  const out = new Uint8Array(2 + body.length + 4)
  out[0] = 0x78 // CM=8, CINFO=7
  out[1] = 0x01 // FLEVEL=0, FDICT=0, FCHECK makes 0x7801 % 31 === 0
  out.set(body, 2)
  const p = 2 + body.length
  out[p] = (adler >>> 24) & 0xff
  out[p + 1] = (adler >>> 16) & 0xff
  out[p + 2] = (adler >>> 8) & 0xff
  out[p + 3] = adler & 0xff
  return out
}

// -- pure-JS inflate (RFC 1951) ------------------------------------------

// A compact inflate: stored, fixed-Huffman, and dynamic-Huffman blocks, with
// the output length bounded by `maxOut` (checked as the window grows, so a bomb
// never allocates past the cap). Adapted from the well-known "tiny inflate"
// algorithm (public domain).

const LEN_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
  163, 195, 227, 258,
]
const LEN_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
]
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
  3073, 4097, 6145, 8193, 12289, 16385, 24577,
]
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
]
const CLEN_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]

type Huff = { counts: Uint16Array; symbols: Uint16Array }

function buildHuff(lengths: Uint8Array, offset: number, count: number): Huff {
  const counts = new Uint16Array(16)
  const symbols = new Uint16Array(count)
  for (let i = 0; i < count; i++) counts[lengths[offset + i]]++
  counts[0] = 0
  const offs = new Uint16Array(16)
  for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + counts[i - 1]
  for (let i = 0; i < count; i++) {
    const l = lengths[offset + i]
    if (l) symbols[offs[l]++] = i
  }
  return { counts, symbols }
}

class BitReader {
  private buf: Uint8Array
  private pos: number
  private bitBuf = 0
  private bitCnt = 0
  constructor(buf: Uint8Array, start: number) {
    this.buf = buf
    this.pos = start
  }
  bits(n: number): number {
    while (this.bitCnt < n) {
      if (this.pos >= this.buf.length) throw new ShareError('inflate-failed')
      this.bitBuf |= this.buf[this.pos++] << this.bitCnt
      this.bitCnt += 8
    }
    const v = this.bitBuf & ((1 << n) - 1)
    this.bitBuf >>>= n
    this.bitCnt -= n
    return v
  }
  alignByte(): void {
    this.bitBuf = 0
    this.bitCnt = 0
  }
  readBytes(n: number): Uint8Array {
    if (this.pos + n > this.buf.length) throw new ShareError('inflate-failed')
    const out = this.buf.subarray(this.pos, this.pos + n)
    this.pos += n
    return out
  }
  decode(h: Huff): number {
    let code = 0
    let first = 0
    let index = 0
    for (let len = 1; len < 16; len++) {
      code |= this.bits(1)
      const c = h.counts[len]
      if (code - first < c) return h.symbols[index + (code - first)]
      index += c
      first = (first + c) << 1
      code <<= 1
    }
    throw new ShareError('inflate-failed')
  }
}

class Output {
  private chunks: Uint8Array[] = []
  private cur = new Uint8Array(0x8000)
  private curLen = 0
  total = 0
  private max: number
  constructor(max: number) {
    this.max = max
  }
  private push(byte: number) {
    if (this.total + 1 > this.max) throw new ShareError('decoded-too-large')
    if (this.curLen === this.cur.length) {
      this.chunks.push(this.cur)
      this.cur = new Uint8Array(0x8000)
      this.curLen = 0
    }
    this.cur[this.curLen++] = byte
    this.total++
  }
  literal(byte: number) {
    this.push(byte)
  }
  match(dist: number, len: number) {
    if (dist > this.total) throw new ShareError('inflate-failed')
    if (this.total + len > this.max) throw new ShareError('decoded-too-large')
    for (let i = 0; i < len; i++) this.push(this.at(this.total - dist))
  }
  copyRaw(src: Uint8Array) {
    if (this.total + src.length > this.max) throw new ShareError('decoded-too-large')
    for (let i = 0; i < src.length; i++) this.push(src[i])
  }
  private at(idx: number): number {
    // idx is an absolute output index < this.total
    const chunkIdx = Math.floor(idx / 0x8000)
    const inChunk = idx % 0x8000
    if (chunkIdx < this.chunks.length) return this.chunks[chunkIdx][inChunk]
    return this.cur[inChunk]
  }
  finish(): Uint8Array {
    const out = new Uint8Array(this.total)
    let o = 0
    for (const c of this.chunks) {
      out.set(c, o)
      o += c.length
    }
    out.set(this.cur.subarray(0, this.curLen), o)
    return out
  }
}

const FIXED_LIT = (() => {
  const l = new Uint8Array(288)
  l.fill(8, 0, 144)
  l.fill(9, 144, 256)
  l.fill(7, 256, 280)
  l.fill(8, 280, 288)
  return buildHuff(l, 0, 288)
})()
const FIXED_DIST = (() => {
  const l = new Uint8Array(30)
  l.fill(5)
  return buildHuff(l, 0, 30)
})()

function inflateBlockDynamic(br: BitReader): { lit: Huff; dist: Huff } {
  const hlit = br.bits(5) + 257
  const hdist = br.bits(5) + 1
  const hclen = br.bits(4) + 4
  const clen = new Uint8Array(19)
  for (let i = 0; i < hclen; i++) clen[CLEN_ORDER[i]] = br.bits(3)
  const clHuff = buildHuff(clen, 0, 19)
  const lengths = new Uint8Array(hlit + hdist)
  let n = 0
  while (n < hlit + hdist) {
    const sym = br.decode(clHuff)
    if (sym < 16) {
      lengths[n++] = sym
    } else if (sym === 16) {
      const prev = n > 0 ? lengths[n - 1] : 0
      let r = br.bits(2) + 3
      while (r-- && n < lengths.length) lengths[n++] = prev
    } else if (sym === 17) {
      let r = br.bits(3) + 3
      while (r-- && n < lengths.length) lengths[n++] = 0
    } else {
      let r = br.bits(7) + 11
      while (r-- && n < lengths.length) lengths[n++] = 0
    }
  }
  return {
    lit: buildHuff(lengths, 0, hlit),
    dist: buildHuff(lengths, hlit, hdist),
  }
}

function inflateHuffBlock(br: BitReader, out: Output, lit: Huff, dist: Huff): void {
  for (;;) {
    const sym = br.decode(lit)
    if (sym === 256) return
    if (sym < 256) {
      out.literal(sym)
      continue
    }
    const li = sym - 257
    if (li >= LEN_BASE.length) throw new ShareError('inflate-failed')
    const len = LEN_BASE[li] + br.bits(LEN_EXTRA[li])
    const ds = br.decode(dist)
    if (ds >= DIST_BASE.length) throw new ShareError('inflate-failed')
    const d = DIST_BASE[ds] + br.bits(DIST_EXTRA[ds])
    out.match(d, len)
  }
}

/** RFC 1951 raw DEFLATE -> bytes, output length bounded by `maxOut`. */
export function inflateRawJs(data: Uint8Array, start: number, maxOut: number): Uint8Array {
  const br = new BitReader(data, start)
  const out = new Output(maxOut)
  let final = 0
  do {
    final = br.bits(1)
    const type = br.bits(2)
    if (type === 0) {
      br.alignByte()
      const lenBytes = br.readBytes(4)
      const len = lenBytes[0] | (lenBytes[1] << 8)
      const nlen = lenBytes[2] | (lenBytes[3] << 8)
      if ((len ^ 0xffff) !== nlen) throw new ShareError('inflate-failed')
      out.copyRaw(br.readBytes(len))
    } else if (type === 1) {
      inflateHuffBlock(br, out, FIXED_LIT, FIXED_DIST)
    } else if (type === 2) {
      const { lit, dist } = inflateBlockDynamic(br)
      inflateHuffBlock(br, out, lit, dist)
    } else {
      throw new ShareError('inflate-failed')
    }
  } while (!final)
  return out.finish()
}

/**
 * RFC 1950 wrapper check + `inflateRawJs` + Adler-32 verify. Rejects a raw
 * DEFLATE stream (no zlib header) and a preset-dictionary stream with
 * `ShareError('not-zlib')` (SS U12.7).
 */
export function inflateZlibJs(data: Uint8Array, maxOut: number): Uint8Array {
  if (data.length < 6) throw new ShareError('not-zlib')
  const cmf = data[0]
  const flg = data[1]
  const cm = cmf & 0x0f
  const cinfo = cmf >> 4
  if (cm !== 8 || cinfo > 7 || ((cmf << 8) | flg) % 31 !== 0 || (flg & 0x20) !== 0) {
    throw new ShareError('not-zlib')
  }
  const body = inflateRawJs(data, 2, maxOut)
  const want =
    ((data[data.length - 4] << 24) |
      (data[data.length - 3] << 16) |
      (data[data.length - 2] << 8) |
      data[data.length - 1]) >>>
    0
  if (adler32(body) !== want) throw new ShareError('inflate-failed')
  return body
}

// -- pure-JS deflate (RFC 1951, LZ77 + fixed Huffman) ------------------

// The encode fallback for portable file:// and any browser without
// CompressionStream. One BFINAL fixed-Huffman block: LZ77 hash-chain matching
// feeds the RFC 1951 fixed literal/length + distance code tables, so repetitive
// data (JSON keys, repeated structure) genuinely shrinks. Not byte-identical to
// `CompressionStream('deflate')` - that is allowed (SS U1.3 / D2) - but it is a
// valid zlib stream every conformant inflater reads.

const MIN_MATCH = 3
const MAX_MATCH = 258
const DEFLATE_WSIZE = 32768
const HASH_SIZE = 1 << 15
const MAX_CHAIN = 128

function rev(code: number, n: number): number {
  let r = 0
  for (let k = 0; k < n; k++) {
    r = (r << 1) | (code & 1)
    code >>= 1
  }
  return r
}

// fixed literal/length codes (RFC 1951 3.2.6), pre-reversed for LSB-first output
const FIX_LIT_CODE = new Uint16Array(288)
const FIX_LIT_LEN = new Uint8Array(288)
for (let s = 0; s < 288; s++) {
  let n: number
  let c: number
  if (s < 144) {
    n = 8
    c = 0x30 + s
  } else if (s < 256) {
    n = 9
    c = 0x190 + (s - 144)
  } else if (s < 280) {
    n = 7
    c = s - 256
  } else {
    n = 8
    c = 0xc0 + (s - 280)
  }
  FIX_LIT_LEN[s] = n
  FIX_LIT_CODE[s] = rev(c, n)
}
const FIX_DIST_CODE = new Uint16Array(30)
for (let d = 0; d < 30; d++) FIX_DIST_CODE[d] = rev(d, 5)

// length 3..258 -> code index 0..28 (symbol = 257 + index)
const LEN_CODE = new Uint16Array(259)
{
  let code = 0
  for (let l = 3; l <= 258; l++) {
    if (code < 28 && l >= LEN_BASE[code + 1]) code++
    LEN_CODE[l] = code
  }
}
// distance 1..32768 -> code index 0..29
const DIST_CODE = new Uint8Array(DEFLATE_WSIZE + 1)
{
  let code = 0
  for (let d = 1; d <= DEFLATE_WSIZE; d++) {
    if (code < 29 && d >= DIST_BASE[code + 1]) code++
    DIST_CODE[d] = code
  }
}

class BitWriter {
  bytes: number[] = []
  private buf = 0
  private cnt = 0
  /** `code`'s low `n` bits, LSB first (Huffman codes must be pre-reversed). */
  write(code: number, n: number): void {
    this.buf |= (code & ((1 << n) - 1)) << this.cnt
    this.cnt += n
    while (this.cnt >= 8) {
      this.bytes.push(this.buf & 0xff)
      this.buf >>>= 8
      this.cnt -= 8
    }
  }
  finish(): number[] {
    if (this.cnt > 0) {
      this.bytes.push(this.buf & 0xff)
      this.buf = 0
      this.cnt = 0
    }
    return this.bytes
  }
}

function hash3(a: number, b: number, c: number): number {
  return ((a << 10) ^ (b << 5) ^ c) & (HASH_SIZE - 1)
}

/** RFC 1951 stream: one final fixed-Huffman block. */
function deflateFixed(data: Uint8Array): number[] {
  const bw = new BitWriter()
  bw.write(1, 1) // BFINAL = 1
  bw.write(1, 2) // BTYPE = 01 (fixed Huffman)

  const n = data.length
  const head = new Int32Array(HASH_SIZE).fill(-1)
  const prev = new Int32Array(DEFLATE_WSIZE).fill(-1)

  const insert = (pos: number): void => {
    if (pos + MIN_MATCH > n) return
    const h = hash3(data[pos], data[pos + 1], data[pos + 2])
    prev[pos & (DEFLATE_WSIZE - 1)] = head[h]
    head[h] = pos
  }
  const emitLiteral = (byte: number): void => {
    bw.write(FIX_LIT_CODE[byte], FIX_LIT_LEN[byte])
  }
  const emitMatch = (len: number, dist: number): void => {
    const lc = LEN_CODE[len]
    const sym = 257 + lc
    bw.write(FIX_LIT_CODE[sym], FIX_LIT_LEN[sym])
    if (LEN_EXTRA[lc]) bw.write(len - LEN_BASE[lc], LEN_EXTRA[lc])
    const dc = DIST_CODE[dist]
    bw.write(FIX_DIST_CODE[dc], 5)
    if (DIST_EXTRA[dc]) bw.write(dist - DIST_BASE[dc], DIST_EXTRA[dc])
  }

  let i = 0
  while (i < n) {
    let bestLen = 0
    let bestDist = 0
    if (i + MIN_MATCH <= n) {
      const h = hash3(data[i], data[i + 1], data[i + 2])
      let cand = head[h]
      let chain = MAX_CHAIN
      const limit = i - DEFLATE_WSIZE
      const maxl = Math.min(MAX_MATCH, n - i)
      while (cand >= 0 && cand > limit && chain-- > 0) {
        if (data[cand + bestLen] === data[i + bestLen]) {
          let l = 0
          while (l < maxl && data[cand + l] === data[i + l]) l++
          if (l > bestLen) {
            bestLen = l
            bestDist = i - cand
            if (l >= maxl) break
          }
        }
        cand = prev[cand & (DEFLATE_WSIZE - 1)]
      }
    }
    if (bestLen >= MIN_MATCH) {
      emitMatch(bestLen, bestDist)
      const end = i + bestLen
      while (i < end) {
        insert(i)
        i++
      }
    } else {
      emitLiteral(data[i])
      insert(i)
      i++
    }
  }
  bw.write(FIX_LIT_CODE[256], FIX_LIT_LEN[256]) // end of block
  return bw.finish()
}

/** zlib-wrapped (RFC 1950) fixed-Huffman DEFLATE of `data`. */
export function zlibDeflateFixedJs(data: Uint8Array): Uint8Array {
  const body = deflateFixed(data)
  const adler = adler32(data)
  const out = new Uint8Array(2 + body.length + 4)
  out[0] = 0x78 // CM=8, CINFO=7
  out[1] = 0x9c // FLEVEL=2, FDICT=0; 0x789c % 31 === 0
  out.set(body, 2)
  const p = 2 + body.length
  out[p] = (adler >>> 24) & 0xff
  out[p + 1] = (adler >>> 16) & 0xff
  out[p + 2] = (adler >>> 8) & 0xff
  out[p + 3] = adler & 0xff
  return out
}

// -- native-or-fallback deflate / inflate --------------------------------

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

const hasCompressionStream = typeof CompressionStream !== 'undefined'
const hasDecompressionStream = typeof DecompressionStream !== 'undefined'

/** zlib-wrapped DEFLATE: `CompressionStream('deflate')` when present, else the
 *  self-contained LZ77 + fixed-Huffman compressor (SS U1.3). */
export async function zlibDeflate(bytes: Uint8Array): Promise<Uint8Array> {
  if (hasCompressionStream) return streamThrough(new CompressionStream('deflate'), bytes)
  return zlibDeflateFixedJs(bytes)
}

/** Inflate a zlib stream with the output bounded by `maxOut`. Native
 *  `DecompressionStream` when present (incremental cap enforced as chunks
 *  arrive), else `inflateZlibJs`. Always a typed `ShareError` on failure. */
export async function zlibInflate(bytes: Uint8Array, maxOut: number): Promise<Uint8Array> {
  if (hasDecompressionStream) {
    try {
      return await streamThrough(new DecompressionStream('deflate'), bytes, maxOut)
    } catch (e) {
      if (e instanceof ShareError) throw e
      throw new ShareError('inflate-failed')
    }
  }
  return inflateZlibJs(bytes, maxOut)
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

/** `location.hash` -> the `g1=` payload, or `null` if this is not a share link
 *  (SS U5.1). A leading `#` is optional. */
export function readShareFragment(hash: string): string | null {
  const h = hash.startsWith('#') ? hash.slice(1) : hash
  return h.startsWith(SHARE_PREFIX) ? h.slice(SHARE_PREFIX.length) : null
}
