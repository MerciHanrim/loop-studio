import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from './types'
import {
  WORKSPACE_MAX_BYTES,
  WORKSPACE_SCHEMA,
  WORKSPACE_VERSION,
  canonicalGraphString,
  semanticDigest,
  sha256Hex,
  sha256Js,
  stableStringify,
  utf8ByteLength,
  utf8Bytes,
} from './workspace'

// SEMANTICS-W.md loop-workspace/1 — Slice A: pure foundation only.
// The digest's Web-Crypto and pure-JS paths must agree, and only engine-relevant
// graph fields may move it.

/** reference SHA-256 via Web Crypto (available under vitest/node) */
async function subtleHex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer)
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

describe('constants', () => {
  it('are the values pinned in §W11', () => {
    expect(WORKSPACE_SCHEMA).toBe('loop-workspace/1')
    expect(WORKSPACE_VERSION).toBe(1)
    expect(WORKSPACE_MAX_BYTES).toBe(8 * 1024 * 1024)
  })
})

// ── SHA-256 — pure JS vs standard vectors and vs Web Crypto ───────────────
describe('sha256Js — FIPS 180-4', () => {
  const hex = (s: string) => sha256Js(utf8Bytes(s))

  it('matches the published SHA-256 test vectors', () => {
    expect(hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    )
    expect(hex('The quick brown fox jumps over the lazy dog')).toBe(
      'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592',
    )
  })

  it('handles block-boundary lengths (55 / 56 / 63 / 64 / 1000 bytes)', async () => {
    for (const n of [0, 1, 55, 56, 63, 64, 65, 127, 128, 1000]) {
      const bytes = new Uint8Array(n)
      for (let i = 0; i < n; i++) bytes[i] = (i * 37 + 11) & 0xff
      const viaSubtle = await sha256Hex(bytes) // uses Web Crypto under vitest/node
      expect(sha256Js(bytes)).toBe(viaSubtle)
    }
  })

  it('agrees with Web Crypto on random inputs', async () => {
    for (let t = 0; t < 40; t++) {
      const len = Math.floor(Math.random() * 300)
      const bytes = new Uint8Array(len)
      crypto.getRandomValues(bytes)
      expect(sha256Js(bytes)).toBe(await subtleHex(bytes))
    }
  })

  it('agrees with Web Crypto on non-ASCII UTF-8 (Hangul, emoji, supplementary plane)', async () => {
    // Workspace JSON embeds user node/edge labels and the portable file:// path
    // relies on sha256Js, so multi-byte input must match Web Crypto exactly.
    // \u{} escapes keep this source plain-text (no astral literals).
    const HANGUL = '광석 저장고' //  "gwangseok jeojanggo"
    const KANJI = '鉱石' //  "kou seki"
    const strings = [
      HANGUL,
      `Ore Stock · ${HANGUL} · ${KANJI}`,
      `완제품 \u{1F9E9}\u{1F3ED} ≥ 5`, //  emoji + >= 5
      `\u{1D11E} \u{1D7DB} \u{1D54F} U+1D11E / U+1D7DB / U+1D54F`, //  musical / math astral
      `\u{1F1F0}\u{1F1F7}\u{1F1FA}\u{1F1F8}`, //  regional-indicator flag pairs
      'a'.repeat(70) + '한글' + '\u{1F9E9}'.repeat(20), //  70 ASCII + Hangul + 20 emoji
      ' ߿ࠀ￿', //  2- and 3-byte boundary code points
    ]
    for (const s of strings) {
      const bytes = utf8Bytes(s)
      expect(sha256Js(bytes), `mismatch on ${JSON.stringify(s)}`).toBe(await subtleHex(bytes))
    }
  })
})

describe('utf8ByteLength', () => {
  it('counts UTF-8 bytes, not code units', () => {
    expect(utf8ByteLength('abc')).toBe(3)
    expect(utf8ByteLength('é')).toBe(2)
    expect(utf8ByteLength('≥ 5')).toBe(5) // ≥ is 3 bytes + space + 5
    expect(utf8ByteLength('🧩')).toBe(4)
  })
})

// ── stableStringify — canonical form ─────────────────────────────────────
describe('stableStringify', () => {
  it('sorts object keys and drops whitespace, recursively', () => {
    expect(stableStringify({ b: 1, a: [{ y: 2, x: 1 }] })).toBe('{"a":[{"x":1,"y":2}],"b":1}')
  })
  it('key insertion order does not change the output', () => {
    const a = stableStringify({ one: 1, two: { z: 3, a: 4 } })
    const b = stableStringify({ two: { a: 4, z: 3 }, one: 1 })
    expect(a).toBe(b)
  })
  it('null and nested null survive', () => {
    expect(stableStringify({ capacity: null })).toBe('{"capacity":null}')
  })
})

// ── semanticDigest — §W3.1 ──────────────────────────────────────────────
const XY = { x: 0, y: 0 }
const pool = (id: string, initial = 0, capacity: number | null = null, label = id): LoopNode => ({
  id, type: 'pool', position: XY,
  data: { kind: 'pool', label, activation: 'passive', initial, capacity, mode: 'pullAny' },
})
const gate = (id: string, distribution: 'deterministic' | 'probabilistic' = 'deterministic'): LoopNode => ({
  id, type: 'gate', position: XY,
  data: { kind: 'gate', label: id, activation: 'automatic', distribution, mode: 'pullAny' },
})
const drain = (id: string): LoopNode => ({
  id, type: 'drain', position: XY, data: { kind: 'drain', label: id, activation: 'automatic', mode: 'pullAny' },
})
const res = (id: string, s: string, t: string, flow: string): LoopEdge => ({
  id, source: s, target: t, type: 'loop', sourceHandle: 'out', targetHandle: 'in',
  data: { kind: 'resource', flow },
})
const state = (id: string, s: string, t: string, mode: 'trigger' | 'activator' | 'label', expr = '', delay?: number): LoopEdge => ({
  id, source: s, target: t, type: 'loop', sourceHandle: 'state-source', targetHandle: 'state-target',
  data: delay == null ? { kind: 'state', mode, expr } : { kind: 'state', mode, expr, delay },
})

const graph = () => ({
  nodes: [pool('p', 3, 8), gate('g', 'probabilistic'), drain('d'), pool('q', 0)],
  edges: [
    res('e1', 'p', 'g', 'all'),
    res('e2', 'g', 'd', '2'),
    state('s1', 'q', 'd', 'trigger', '', 2),
    state('s2', 'p', 'q', 'activator', '>= 5'),
  ],
})

const digest = (g: { nodes: LoopNode[]; edges: LoopEdge[] }) => semanticDigest(g)

describe('semanticDigest', () => {
  it('is a 64-char lowercase hex string', async () => {
    expect(await digest(graph())).toMatch(/^[0-9a-f]{64}$/)
  })

  it('ignores node position, node/edge label, selection, and React-Flow type', async () => {
    const base = await digest(graph())
    const moved = graph()
    moved.nodes[0].position = { x: 999, y: -50 }
    moved.nodes[1].data.label = 'Renamed Gate'
    ;(moved.nodes[2] as { selected?: boolean }).selected = true
    ;(moved.edges[0] as { label?: string }).label = 'flow!'
    ;(moved.edges[0] as { selected?: boolean }).selected = true
    expect(await digest(moved)).toBe(base)
  })

  it('changes when an engine-relevant field changes', async () => {
    const base = await digest(graph())

    const cap = graph(); (cap.nodes[0].data as { capacity: number | null }).capacity = 10
    expect(await digest(cap)).not.toBe(base)

    const init = graph(); (init.nodes[0].data as { initial: number }).initial = 4
    expect(await digest(init)).not.toBe(base)

    const dist = graph(); (dist.nodes[1].data as { distribution: string }).distribution = 'deterministic'
    expect(await digest(dist)).not.toBe(base)

    const flow = graph(); (flow.edges[0].data as { flow: string }).flow = '1'
    expect(await digest(flow)).not.toBe(base)

    const delay = graph(); (delay.edges[2].data as { delay?: number }).delay = 5
    expect(await digest(delay)).not.toBe(base)

    const expr = graph(); (expr.edges[3].data as { expr: string }).expr = '>= 9'
    expect(await digest(expr)).not.toBe(base)

    const act = graph(); (act.nodes[2].data as { activation: string }).activation = 'passive'
    expect(await digest(act)).not.toBe(base)
  })

  it('is independent of node/edge array order', async () => {
    const base = await digest(graph())
    const g = graph()
    g.nodes.reverse()
    g.edges.reverse()
    expect(await digest(g)).toBe(base)
  })

  it('is stable across a JSON round-trip of the graph', async () => {
    const g = graph()
    const clone = JSON.parse(JSON.stringify(g))
    expect(await digest(clone)).toBe(await digest(g))
  })

  it('the canonical string has no structural whitespace and is id-sorted', () => {
    const s = canonicalGraphString(graph())
    // whitespace inside a string value (e.g. the expr ">= 5") is fine; there
    // must be none between structural tokens.
    const noStrings = s.replace(/"(?:[^"\\]|\\.)*"/g, '""')
    expect(noStrings).not.toMatch(/\s/)
    expect(s.indexOf('"id":"d"')).toBeLessThan(s.indexOf('"id":"g"')) // nodes sorted by id
    expect(s.indexOf('"id":"e1"')).toBeLessThan(s.indexOf('"id":"e2"')) // edges sorted by id
  })

  it('an added edge changes the digest', async () => {
    const base = await digest(graph())
    const g = graph()
    g.edges.push(res('e3', 'q', 'd', '1'))
    expect(await digest(g)).not.toBe(base)
  })
})
