import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SHARE_MAX_BYTES,
  SHARE_MAX_DECODED_BYTES,
  SHARE_PREFIX,
  ShareError,
  base64urlDecode,
  base64urlEncode,
  classifyFragment,
  decodeShareText,
  encodeShareText,
  fitsShareLink,
  readShareFragment,
  shareCompressionAvailable,
  utf8Bytes,
  zlibDeflate,
  zlibInflate,
} from './share'
import { LEGACY_SHARE_VECTORS } from './shareLegacy.fixture'

// Node (the vitest env) has Compression/DecompressionStream, so `zlibDeflate` /
// `zlibInflate` run the one path there is: the native one. There is no
// bundled fallback since issue #301 decision 1 (SS U1.3); links that the
// removed pure-JS encoders made are pinned as fixed vectors below.

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
  it('native DecompressionStream(deflate) refuses a raw stream', async () => {
    const raw = await nativeDeflateRaw(enc('hello hello hello'))
    await expect(zlibInflate(raw, SHARE_MAX_DECODED_BYTES)).rejects.toBeInstanceOf(ShareError)
  })

  it('garbage and preset-dictionary headers fail as a typed ShareError', async () => {
    await expect(zlibInflate(new Uint8Array([0, 0, 0, 0, 0, 0]), 1000)).rejects.toBeInstanceOf(ShareError)
    await expect(zlibInflate(new Uint8Array([0x78, 0xbb, 1, 2, 3, 4]), 1000)).rejects.toBeInstanceOf(ShareError)
  })

  it('native deflate emits a zlib wrapper, not raw DEFLATE', async () => {
    const w = await zlibDeflate(enc('abc'))
    expect(w[0] & 0x0f).toBe(8) // CM = deflate
    expect(((w[0] << 8) | w[1]) % 31).toBe(0)
    expect(w[1] & 0x20).toBe(0) // no preset dict
  })
})

// -- native round trip (SS U1.3) ---------------------------------------

describe('deflate/inflate round trip', () => {
  const samples = [
    '',
    'a',
    'the quick brown fox jumps over the lazy dog',
    JSON.stringify({ schema: 'loop-studio/graph', version: 1, nodes: [], edges: [] }),
    '{"labels":["голд","金庫","🚀"]}',
    'x'.repeat(20000),
  ]

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
      await zlibInflate(packed, SHARE_MAX_DECODED_BYTES)
    } catch (e) {
      threw = e
    }
    expect(threw).toBeInstanceOf(ShareError)
    expect((threw as ShareError).reason).toBe('inflate-failed')
  })

  it('a 90-node graph fits the 8 KiB cap', async () => {
    const graph = JSON.stringify({
      schema: 'loop-studio/graph',
      version: 1,
      nodes: Array.from({ length: 90 }, (_, i) => ({
        id: `node_${i}`,
        type: i % 3 ? 'pool' : 'source',
        position: { x: (i % 8) * 160, y: Math.floor(i / 8) * 120 },
        data: { kind: i % 3 ? 'pool' : 'source', label: `Node ${i}`, initial: i % 3 ? 5 : 0, capacity: 100 },
      })),
      edges: Array.from({ length: 89 }, (_, i) => ({
        id: `edge_${i}`,
        source: `node_${i}`,
        target: `node_${i + 1}`,
        type: 'loop',
        data: { kind: 'resource', flow: String(1 + (i % 4)) },
      })),
    })
    const { bytes } = await encodeShareText(graph)
    expect(fitsShareLink(bytes)).toBe(true)
  })
})

// -- links the removed pure-JS encoders made (issue #301 decision 1) ------
// The portable build and browsers without CompressionStream used to make `g1`
// links with a bundled LZ77 + fixed-Huffman encoder. Those links are still in
// people's messages and notes: each must keep opening, byte for byte, through
// the native path. The payloads were made by the encoders as they shipped on
// main 938aae3 and are fixed data.

describe('links made by the removed pure-JS encoders', () => {
  it('has the vectors it is meant to have', () => {
    expect(LEGACY_SHARE_VECTORS.map((v) => v.encoder)).toEqual(['fixed', 'fixed', 'fixed', 'fixed', 'fixed', 'stored', 'fixed'])
  })

  for (const v of LEGACY_SHARE_VECTORS) {
    it(`opens through the native inflater: ${v.name}`, async () => {
      expect(base64urlDecode(v.payload)[0]).toBe(0x78) // a zlib wrapper
      expect(await decodeShareText(v.payload)).toBe(v.text)
    })
  }
})

// -- no Compression Streams: no link either way (SS U1.3) ----------------

describe('a page without Compression Streams', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is detected when asked, not when the module loaded', () => {
    expect(shareCompressionAvailable()).toBe(true)
    vi.stubGlobal('DecompressionStream', undefined)
    expect(shareCompressionAvailable()).toBe(false)
    vi.unstubAllGlobals()
    vi.stubGlobal('CompressionStream', undefined)
    expect(shareCompressionAvailable()).toBe(false)
  })

  it('cannot encode: a typed ShareError, unavailable', async () => {
    vi.stubGlobal('CompressionStream', undefined)
    await expect(encodeShareText('{"nodes":[],"edges":[]}')).rejects.toMatchObject({ name: 'ShareError', reason: 'unavailable' })
  })

  it('cannot decode, even a well-formed link: a typed ShareError, unavailable', async () => {
    const { payload } = await encodeShareText('{"nodes":[],"edges":[]}')
    vi.stubGlobal('DecompressionStream', undefined)
    await expect(decodeShareText(payload)).rejects.toMatchObject({ name: 'ShareError', reason: 'unavailable' })
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

describe('classifyFragment (SS U5.1 / U6)', () => {
  it('g1=<payload> ⇒ share (payload may be empty), # optional', () => {
    expect(classifyFragment('#g1=AbC-_')).toEqual({ kind: 'share', payload: 'AbC-_' })
    expect(classifyFragment('g1=')).toEqual({ kind: 'share', payload: '' })
  })

  it('g<n>=... with n ≠ 1 ⇒ unsupported (a newer Share version)', () => {
    for (const h of ['#g2=abc', 'g3=', '#g10=zzz', '#g99=AAAA']) {
      expect(classifyFragment(h).kind).toBe('unsupported')
    }
  })

  it('starts g1 but is not g1=... ⇒ malformed', () => {
    for (const h of ['#g1', 'g1', '#g1x', '#g1-abc', '#g1/']) {
      expect(classifyFragment(h).kind).toBe('malformed')
    }
  })

  it('anything else ⇒ foreign (left in the address bar)', () => {
    for (const h of ['', '#', '#section-2', '#/a/route', '#w1=abc', '#gg=1', '#g=1', '#g=', '#graph', '#p=1', '#p', '#pp1=abc', '#P1=abc', '#p2', '#page']) {
      expect(classifyFragment(h).kind).toBe('foreign')
    }
  })
})

describe('classifyFragment - the protected grammar (SEMANTICS-P.md SS P4)', () => {
  it('p1=<payload> ⇒ protected (payload may be empty), # optional', () => {
    expect(classifyFragment('#p1=AbC-_')).toEqual({ kind: 'protected', payload: 'AbC-_' })
    expect(classifyFragment('p1=')).toEqual({ kind: 'protected', payload: '' })
  })

  it('p<n>=... with n ≠ 1 ⇒ protected-unsupported (a newer protected version)', () => {
    for (const h of ['#p2=abc', 'p3=', '#p10=zzz', '#p99=AAAA']) {
      expect(classifyFragment(h).kind).toBe('protected-unsupported')
    }
  })

  it('starts p1 but is not p1=... ⇒ protected-malformed', () => {
    for (const h of ['#p1', 'p1', '#p1x', '#p1-abc', '#p1/']) {
      expect(classifyFragment(h).kind).toBe('protected-malformed')
    }
  })

  it('the plain grammar is untouched by it', () => {
    expect(classifyFragment('#g1=AbC').kind).toBe('share')
    expect(classifyFragment('#g2=AbC').kind).toBe('unsupported')
    expect(classifyFragment('#g1x').kind).toBe('malformed')
    expect(readShareFragment('#p1=AbC')).toBeNull()
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
