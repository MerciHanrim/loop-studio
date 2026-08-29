import { describe, expect, it } from 'vitest'
import {
  SHARE_MAX_BYTES,
  SHARE_MAX_DECODED_BYTES,
  SHARE_PREFIX,
  ShareError,
  base64urlDecode,
  base64urlEncode,
  decodeShareText,
  encodeShareText,
  fitsShareLink,
  inflateZlibJs,
  readShareFragment,
  utf8Bytes,
  zlibDeflate,
  zlibDeflateFixedJs,
  zlibInflate,
  zlibWrapStored,
} from './share'

// Node 22 (vitest env) has Compression/DecompressionStream, so `zlibDeflate` /
// `zlibInflate` exercise the NATIVE path here. The pure-JS fallback is reached
// directly through `zlibWrapStored` / `inflateZlibJs`. The interop block below
// crosses the two so neither can drift from the other.

const enc = (s: string) => utf8Bytes(s)
const dec = (b: Uint8Array) => new TextDecoder().decode(b)

async function nativeDeflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate-raw')
  const w = cs.writable.getWriter()
  const r = cs.readable.getReader() as ReadableStreamDefaultReader<Uint8Array>
  const chunks: Uint8Array[] = []
  const pump = (async () => {
    for (;;) {
      const { value, done } = await r.read()
      if (done) break
      chunks.push(value)
    }
  })()
  await w.write(bytes as unknown as ArrayBuffer)
  await w.close()
  await pump
  const n = chunks.reduce((a, c) => a + c.length, 0)
  const out = new Uint8Array(n)
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.length
  }
  return out
}

// -- strict base64url (SS U1.4) -------------------------------------------

describe('base64url', () => {
  it('round-trips arbitrary bytes', () => {
    for (const len of [0, 1, 2, 3, 4, 5, 17, 64, 255, 1000]) {
      const b = new Uint8Array(len)
      for (let i = 0; i < len; i++) b[i] = (i * 37 + 11) & 0xff
      expect([...base64urlDecode(base64urlEncode(b))]).toEqual([...b])
    }
  })

  it('emits only the URL-safe alphabet, never padding', () => {
    const b = new Uint8Array(300)
    for (let i = 0; i < b.length; i++) b[i] = i & 0xff
    const s = base64urlEncode(b)
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(s).not.toContain('=')
    expect(s).not.toContain('+')
    expect(s).not.toContain('/')
  })

  it('rejects a standard-base64 char, padding, or whitespace', () => {
    for (const bad of ['aa+a', 'aa/a', 'aaaa=', 'aa a', 'aa\na', 'aaaa\t', 'zzzé']) {
      expect(() => base64urlDecode(bad)).toThrow(ShareError)
      try {
        base64urlDecode(bad)
      } catch (e) {
        expect((e as ShareError).reason).toBe('bad-base64url')
      }
    }
  })

  it('rejects an impossible base64 length (% 4 === 1)', () => {
    expect(() => base64urlDecode('a')).toThrow(ShareError)
    expect(() => base64urlDecode('aaaaa')).toThrow(ShareError)
  })

  it('accepts - and _ as the +// substitutes', () => {
    // 0xfb 0xff 0xbf -> standard "+/+/" ... use bytes that force both - and _
    const b = new Uint8Array([0xff, 0xe0, 0xff, 0x00, 0x3f])
    const s = base64urlEncode(b)
    expect(s).toMatch(/[-_]/)
    expect([...base64urlDecode(s)]).toEqual([...b])
  })
})

// -- zlib wrapper vs raw DEFLATE (SS U12.7) -----------------------------

describe('zlib wrapper distinction', () => {
  it('inflateZlibJs rejects a raw DEFLATE stream as not-zlib', async () => {
    const raw = await nativeDeflateRaw(enc('the quick brown fox'))
    expect(() => inflateZlibJs(raw, SHARE_MAX_DECODED_BYTES)).toThrow(ShareError)
    try {
      inflateZlibJs(raw, SHARE_MAX_DECODED_BYTES)
    } catch (e) {
      expect((e as ShareError).reason).toBe('not-zlib')
    }
  })

  it('inflateZlibJs rejects garbage / preset-dictionary headers as not-zlib', () => {
    expect(() => inflateZlibJs(new Uint8Array([0, 0, 0, 0, 0, 0]), 1000)).toThrow(
      /not-zlib/,
    )
    // 0x78 0x20: FDICT bit set -> % 31 !== 0 anyway, but assert the reason
    expect(() => inflateZlibJs(new Uint8Array([0x78, 0xbb, 1, 2, 3, 4]), 1000)).toThrow(
      /not-zlib/,
    )
  })

  it('native DecompressionStream(deflate) also refuses a raw stream', async () => {
    const raw = await nativeDeflateRaw(enc('hello hello hello'))
    await expect(zlibInflate(raw, SHARE_MAX_DECODED_BYTES)).rejects.toBeInstanceOf(ShareError)
  })

  it('zlibWrapStored produces a valid RFC 1950 header', () => {
    const w = zlibWrapStored(enc('abc'))
    expect(w[0]).toBe(0x78)
    expect(((w[0] << 8) | w[1]) % 31).toBe(0)
    expect(w[1] & 0x20).toBe(0) // no preset dict
  })
})

// -- native <-> pure-JS interop (SS U1.3 / D2 / U12.8) ------------------

describe('deflate/inflate interop', () => {
  const samples = [
    '',
    'a',
    'the quick brown fox jumps over the lazy dog',
    JSON.stringify({ schema: 'loop-studio/graph', version: 1, nodes: [], edges: [] }),
    '{"labels":["голд","金庫","🚀"]}',
    'x'.repeat(20000),
  ]

  it('native deflate -> pure-JS inflate', async () => {
    for (const s of samples) {
      const packed = await zlibDeflate(enc(s)) // native CompressionStream('deflate')
      const back = inflateZlibJs(packed, SHARE_MAX_DECODED_BYTES) // pure JS
      expect(dec(back)).toBe(s)
    }
  })

  it('pure-JS deflate (stored) -> native inflate', async () => {
    for (const s of samples) {
      const packed = zlibWrapStored(enc(s))
      const back = await zlibInflate(packed, SHARE_MAX_DECODED_BYTES) // native DecompressionStream
      expect(dec(back)).toBe(s)
    }
  })

  it('pure-JS deflate -> pure-JS inflate', () => {
    for (const s of samples) {
      const back = inflateZlibJs(zlibWrapStored(enc(s)), SHARE_MAX_DECODED_BYTES)
      expect(dec(back)).toBe(s)
    }
  })

  it('native deflate -> native inflate', async () => {
    for (const s of samples) {
      const back = await zlibInflate(await zlibDeflate(enc(s)), SHARE_MAX_DECODED_BYTES)
      expect(dec(back)).toBe(s)
    }
  })

  it('a corrupt DEFLATE body fails as inflate-failed, not a raw throw', async () => {
    const packed = await zlibDeflate(enc('some content to mangle later on'))
    packed[5] ^= 0xff
    packed[6] ^= 0xff
    let threw: unknown
    try {
      inflateZlibJs(packed, SHARE_MAX_DECODED_BYTES)
    } catch (e) {
      threw = e
    }
    expect(threw).toBeInstanceOf(ShareError)
    expect(['inflate-failed', 'not-zlib']).toContain((threw as ShareError).reason)
  })
})

// -- pure-JS fallback ENCODER really compresses (SS U1.3 / D2) ----------

// A representative repetitive GraphDoc: repeated keys and structure, the shape
// LZ77 + fixed Huffman is meant to shrink. ~40 nodes / ~40 edges.
function sampleGraph(nodes = 40): string {
  return JSON.stringify({
    schema: 'loop-studio/graph',
    version: 1,
    nodes: Array.from({ length: nodes }, (_, i) => ({
      id: `node_${i}`,
      type: i % 3 ? 'pool' : 'source',
      position: { x: (i % 8) * 160, y: Math.floor(i / 8) * 120 },
      data: { kind: i % 3 ? 'pool' : 'source', label: `Node ${i}`, initial: i % 3 ? 5 : 0, capacity: 100 },
    })),
    edges: Array.from({ length: nodes - 1 }, (_, i) => ({
      id: `edge_${i}`,
      source: `node_${i}`,
      target: `node_${i + 1}`,
      sourceHandle: 'out',
      targetHandle: 'in',
      type: 'loop',
      data: { kind: 'resource', flow: String(1 + (i % 4)) },
    })),
    recommendedRunConfig: { baseSeed: 1, runs: 200, steps: 30, tracked: [] },
  })
}

describe('zlibDeflateFixedJs (pure-JS fallback encoder)', () => {
  it('shrinks a repetitive GraphDoc well below the original', () => {
    const raw = enc(sampleGraph(40))
    const packed = zlibDeflateFixedJs(raw)
    expect(packed.length).toBeLessThan(raw.length * 0.6)
    expect(dec(inflateZlibJs(packed, SHARE_MAX_DECODED_BYTES))).toBe(dec(raw))
  })

  it('also shrinks highly repetitive input dramatically', () => {
    const raw = enc('x'.repeat(20000))
    expect(zlibDeflateFixedJs(raw).length).toBeLessThan(400)
  })

  it('a representative large graph fits 8 KiB via BOTH native and the JS fallback', async () => {
    const graph = sampleGraph(90)
    const jsPayload = base64urlEncode(zlibDeflateFixedJs(enc(graph)))
    const nativePayload = (await encodeShareText(graph)).payload
    expect(jsPayload.length).toBeLessThanOrEqual(SHARE_MAX_BYTES)
    expect(nativePayload.length).toBeLessThanOrEqual(SHARE_MAX_BYTES)
    // sanity: the JS encoder is genuinely compressing, not merely storing
    expect(jsPayload.length).toBeLessThan(enc(graph).length)
  })

  it('JS-made link opens with native inflate; native-made link opens with JS inflate', async () => {
    const graph = sampleGraph(50)
    const raw = enc(graph)

    const jsLink = zlibDeflateFixedJs(raw)
    expect(dec(await zlibInflate(jsLink, SHARE_MAX_DECODED_BYTES))).toBe(graph) // native DecompressionStream

    const nativeLink = await zlibDeflate(raw)
    expect(dec(inflateZlibJs(nativeLink, SHARE_MAX_DECODED_BYTES))).toBe(graph) // pure-JS inflate
  })

  it('JS encoder output is a zlib wrapper, not raw DEFLATE', () => {
    const packed = zlibDeflateFixedJs(enc(sampleGraph(12)))
    expect(packed[0]).toBe(0x78)
    expect(((packed[0] << 8) | packed[1]) % 31).toBe(0)
    expect(packed[1] & 0x20).toBe(0) // FDICT clear
    // it inflates as zlib, and is NOT accepted as a raw stream
    expect(() => inflateZlibJs(packed, SHARE_MAX_DECODED_BYTES)).not.toThrow()
    expect(() => inflateZlibJs(packed.subarray(2), SHARE_MAX_DECODED_BYTES)).toThrow(/not-zlib/)
  })

  it('Hangul + emoji GraphDoc: JS compress -> native inflate is byte-identical', async () => {
    const graph = JSON.stringify({
      schema: 'loop-studio/graph',
      version: 1,
      nodes: [
        { id: 'a', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: '수도꼭지 🚰 광석' } },
        { id: 'b', type: 'pool', position: { x: 200, y: 0 }, data: { kind: 'pool', label: '금고 🏦 инвентарь', initial: 5 } },
      ],
      edges: [{ id: 'e', source: 'a', target: 'b', type: 'loop', data: { kind: 'resource', flow: '2' } }],
    })
    const raw = enc(graph)
    const roundTripped = await zlibInflate(zlibDeflateFixedJs(raw), SHARE_MAX_DECODED_BYTES)
    expect([...roundTripped]).toEqual([...raw]) // exact bytes
    expect(dec(roundTripped)).toBe(graph)
  })

  it('incompressible input may grow, still round-trips, and the cap is judged on the final payload', async () => {
    const rnd = new Uint8Array(4096)
    crypto.getRandomValues(rnd)
    let s = ''
    for (const byte of rnd) s += String.fromCharCode(byte)
    const raw = enc(s)
    const packed = zlibDeflateFixedJs(raw)
    // no correctness requirement on size for random data - only that it works
    expect(dec(inflateZlibJs(packed, SHARE_MAX_DECODED_BYTES))).toBe(s)
    expect(dec(await zlibInflate(packed, SHARE_MAX_DECODED_BYTES))).toBe(s)
    // the size decision is on the base64url payload, whatever compression did
    const payload = base64urlEncode(packed)
    expect(fitsShareLink(payload.length)).toBe(payload.length <= SHARE_MAX_BYTES)
  })

  it('empty and 1-byte inputs still produce a valid stream', async () => {
    for (const s of ['', 'Z']) {
      const packed = zlibDeflateFixedJs(enc(s))
      expect(dec(inflateZlibJs(packed, SHARE_MAX_DECODED_BYTES))).toBe(s)
      expect(dec(await zlibInflate(packed, SHARE_MAX_DECODED_BYTES))).toBe(s)
    }
  })
})

// -- compressor safety net: differential fuzz + explicit boundaries -----
// The hand-rolled LZ77 + fixed-Huffman path is where an off-by-one hides.
// For every input: JS compress -> JS inflate AND JS compress -> native inflate
// must both be byte-identical to the original.

const CAP = 1 << 20

function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s
  }
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((a, p) => a + p.length, 0)
  const out = new Uint8Array(n)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}
function eqBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
async function bothInflate(raw: Uint8Array): Promise<void> {
  const packed = zlibDeflateFixedJs(raw)
  expect(eqBytes(inflateZlibJs(packed, CAP), raw)).toBe(true)
  expect(eqBytes(await zlibInflate(packed, CAP), raw)).toBe(true)
}

describe('zlibDeflateFixedJs - differential fuzz + boundary cases', () => {
  const rnd = lcg(0xc0ffee)
  const randBytes = (n: number): Uint8Array => {
    const a = new Uint8Array(n)
    for (let i = 0; i < n; i++) a[i] = rnd() & 0xff
    return a
  }
  const patterns: Record<string, (n: number) => Uint8Array> = {
    zeros: (n) => new Uint8Array(n),
    random: randBytes,
    lowEntropy: (n) => {
      const a = new Uint8Array(n)
      for (let i = 0; i < n; i++) a[i] = i % 7
      return a
    },
    block13: (n) => {
      const blk = randBytes(13)
      const a = new Uint8Array(n)
      for (let i = 0; i < n; i++) a[i] = blk[i % 13]
      return a
    },
    textish: (n) => {
      const A = '{}[]",: abcdefghij0123\n'
      const a = new Uint8Array(n)
      for (let i = 0; i < n; i++) a[i] = A.charCodeAt((i * 7 + (i >> 4)) % A.length)
      return a
    },
  }
  const sizes = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 15, 16, 17, 31, 32, 33, 63, 64, 65, 127, 128, 129, 255, 256, 257,
    258, 259, 260, 300, 511, 512, 513, 1000, 4095, 4096, 4097,
  ]

  for (const name of Object.keys(patterns)) {
    it(`byte-identical round-trip: ${name} at ${sizes.length} lengths (JS->JS and JS->native)`, async () => {
      for (const n of sizes) await bothInflate(patterns[name](n))
    })
  }

  it('exact match LENGTHS 3 / 257 / 258 / 259 / 400 round-trip', async () => {
    for (const L of [3, 257, 258, 259, 400]) {
      const seg = randBytes(L)
      // seg followed by a different byte in each copy -> the match is exactly L
      await bothInflate(concat(seg, Uint8Array.of(0x00), seg, Uint8Array.of(0x01)))
    }
  })

  it('exact match DISTANCES 1 / 32767 / 32768 round-trip', async () => {
    await bothInflate(concat(Uint8Array.of(0x41), new Uint8Array(600).fill(0x41))) // dist 1
    for (const D of [32767, 32768]) {
      const A = randBytes(D)
      await bothInflate(concat(A, A)) // 2nd copy starts at offset D
    }
  })

  it('the INFLATER accepts a native stream that uses distance 32768', async () => {
    const P = patterns.block13(32768)
    // 2nd P starts at offset 32769; the 1st P starts at offset 1 -> distance 32768
    const raw = concat(Uint8Array.of(0x00), P, P)
    const nativePacked = await zlibDeflate(raw)
    expect(eqBytes(inflateZlibJs(nativePacked, CAP), raw)).toBe(true)
  })

  it('input ending mid-match / at odd byte boundaries round-trips', async () => {
    const base = patterns.textish(777)
    for (const cut of [1, 2, 3, 4, 5, 257, 258, 259, 511, 512, 513, 776, 777]) {
      // the trailing region is a prefix of `base` -> the tail match runs off the end
      await bothInflate(concat(base, base.subarray(0, cut)))
    }
  })

  it('mixed random + repeated regions, many seeds', async () => {
    for (let seed = 1; seed <= 12; seed++) {
      const g = lcg(seed * 2654435761)
      const chunks: Uint8Array[] = []
      const count = 3 + (g() % 6)
      for (let k = 0; k < count; k++) {
        const kind = g() % 3
        const len = 1 + (g() % 900)
        if (kind === 0) {
          const c = new Uint8Array(len)
          for (let i = 0; i < len; i++) c[i] = g() & 0xff
          chunks.push(c)
        } else if (kind === 1) {
          chunks.push(new Uint8Array(len).fill(g() & 0xff))
        } else if (chunks.length) {
          chunks.push(chunks[g() % chunks.length].slice()) // repeat an earlier region
        } else {
          chunks.push(new Uint8Array(len).fill(0x2a))
        }
      }
      await bothInflate(concat(...chunks))
    }
  })
})

// -- outbound cap (SS U3.1) --------------------------------------------

describe('SHARE_MAX_BYTES (outbound, 8 KiB)', () => {
  it('is 8 * 1024 and measured on the base64url payload', () => {
    expect(SHARE_MAX_BYTES).toBe(8 * 1024)
  })

  it('fitsShareLink is an inclusive boundary', () => {
    expect(fitsShareLink(SHARE_MAX_BYTES)).toBe(true)
    expect(fitsShareLink(SHARE_MAX_BYTES + 1)).toBe(false)
    expect(fitsShareLink(0)).toBe(true)
  })

  it('encodeShareText reports the real ASCII payload length; a big graph overflows', async () => {
    const small = await encodeShareText('{"nodes":[],"edges":[]}')
    expect(small.bytes).toBe(small.payload.length)
    expect(fitsShareLink(small.bytes)).toBe(true)

    // genuinely incompressible payload so compression cannot rescue it
    const rnd = new Uint8Array(9000)
    crypto.getRandomValues(rnd)
    let noise = ''
    for (const b of rnd) noise += String.fromCharCode(b)
    const big = await encodeShareText(noise)
    expect(big.bytes).toBe(big.payload.length)
    expect(big.bytes).toBeGreaterThan(SHARE_MAX_BYTES)
    expect(fitsShareLink(big.bytes)).toBe(false)
  })
})

// -- inbound decompression-bomb guard (SS U3.2) -----------------------

describe('SHARE_MAX_DECODED_BYTES (inbound, 1 MiB, incremental)', () => {
  it('is 1 MiB', () => {
    expect(SHARE_MAX_DECODED_BYTES).toBe(1024 * 1024)
  })

  it('native path: a highly compressible 2 MiB payload aborts at the cap', async () => {
    const bomb = await zlibDeflate(new Uint8Array(2 * 1024 * 1024)) // ~2 KB -> 2 MiB
    let threw: unknown
    try {
      await zlibInflate(bomb, SHARE_MAX_DECODED_BYTES)
    } catch (e) {
      threw = e
    }
    expect(threw).toBeInstanceOf(ShareError)
    expect((threw as ShareError).reason).toBe('decoded-too-large')
  })

  it('pure-JS path: output is bounded and never fully built', () => {
    const stored = zlibWrapStored(new Uint8Array(500)) // 500 zero bytes, stored
    let threw: unknown
    try {
      inflateZlibJs(stored, 100) // tiny cap
    } catch (e) {
      threw = e
    }
    expect(threw).toBeInstanceOf(ShareError)
    expect((threw as ShareError).reason).toBe('decoded-too-large')
  })

  it('decodeShareText rejects a bomb with a typed error and returns nothing', async () => {
    const bomb = await zlibDeflate(new Uint8Array(3 * 1024 * 1024))
    const payload = base64urlEncode(bomb)
    await expect(decodeShareText(payload)).rejects.toMatchObject({
      name: 'ShareError',
      reason: 'decoded-too-large',
    })
  })

  it('a legitimate payload just under the cap still decodes', async () => {
    const s = 'y'.repeat(900 * 1024)
    const back = await decodeShareText(base64urlEncode(await zlibDeflate(enc(s))))
    expect(back.length).toBe(s.length)
    expect(back).toBe(s)
  })
})

// -- fragment parsing + end-to-end (SS U5.1) --------------------------

describe('readShareFragment', () => {
  it('extracts the g1= payload, with or without a leading #', () => {
    expect(readShareFragment('#g1=abcDEF-_')).toBe('abcDEF-_')
    expect(readShareFragment('g1=abcDEF')).toBe('abcDEF')
    expect(readShareFragment('g1=')).toBe('')
  })

  it('returns null for a non-share fragment', () => {
    expect(readShareFragment('')).toBeNull()
    expect(readShareFragment('#')).toBeNull()
    expect(readShareFragment('#/some/route')).toBeNull()
    expect(readShareFragment('#section-2')).toBeNull()
    expect(readShareFragment('#g2=abc')).toBeNull()
    expect(readShareFragment('#w1=abc')).toBeNull()
  })

  it('SHARE_PREFIX is g1=', () => {
    expect(SHARE_PREFIX).toBe('g1=')
  })
})

describe('encodeShareText / decodeShareText round-trip', () => {
  it('preserves a realistic graph document string exactly', async () => {
    const graph = JSON.stringify({
      schema: 'loop-studio/graph',
      version: 1,
      nodes: [
        { id: 'a', type: 'source', position: { x: 1, y: 2 }, data: { kind: 'source', label: '🔥 Faucet' } },
        { id: 'b', type: 'pool', position: { x: 3, y: 4 }, data: { kind: 'pool', label: '금', initial: 5 } },
      ],
      edges: [{ id: 'e', source: 'a', target: 'b', type: 'loop', data: { kind: 'resource', flow: '2' } }],
      recommendedRunConfig: { runs: 200, steps: 30 },
    })
    const { payload } = await encodeShareText(graph)
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(await decodeShareText(payload)).toBe(graph)
  })

  it('a truncated payload fails as a typed ShareError', async () => {
    const { payload } = await encodeShareText('{"nodes":[],"edges":[]}')
    const chopped = payload.slice(0, Math.max(4, payload.length - 6))
    await expect(decodeShareText(chopped)).rejects.toBeInstanceOf(ShareError)
  })
})
