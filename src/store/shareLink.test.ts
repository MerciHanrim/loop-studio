import { beforeEach, describe, expect, it, vi } from 'vitest'
import { serialize } from '../model/serialize'
import type { LoopEdge, LoopNode } from '../model/types'
import { encodeShareText } from '../model/share'
import { useGraphStore } from './graphStore'
import { useMcStore } from './mcStore'
import { REPLACE_PROMPT, consumeShareLink } from './shareLink'
import { useSimStore } from './simStore'

// SEMANTICS-U.md loop-share/1 §U5 — boot-time load. Node env: no window /
// localStorage, so the graph store boots "pristine" and callers inject `hash` /
// `confirm` / `stripFragment`.

const NEVER = (): never => {
  throw new Error('must not be called')
}

function docString(opts: { label?: string; runs?: number } = {}): string {
  const nodes = [
    { id: 's', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: opts.label ?? 'Shared' } },
    { id: 'p', type: 'pool', position: { x: 200, y: 0 }, data: { kind: 'pool', label: 'P', initial: 3 } },
  ] as unknown as LoopNode[]
  const edges = [
    { id: 'e', source: 's', target: 'p', type: 'loop', data: { kind: 'resource', flow: '2' } },
  ] as unknown as LoopEdge[]
  return serialize(nodes, edges, opts.runs ? { runs: opts.runs, steps: 9 } : undefined)
}

async function shareHash(text = docString()): Promise<string> {
  const { payload } = await encodeShareText(text)
  return `#g1=${payload}`
}

const rev = () => useGraphStore.getState().simulationRev
const nodeIds = () => useGraphStore.getState().nodes.map((n) => n.id).sort()

/** count `simulationRev` transitions during `fn` */
async function countBumps(fn: () => Promise<unknown>): Promise<number> {
  let n = 0
  const unsub = useGraphStore.subscribe((s, p) => {
    if (s.simulationRev !== p.simulationRev) n++
  })
  try {
    await fn()
  } finally {
    unsub()
  }
  return n
}

beforeEach(() => {
  useMcStore.getState().clear()
  useSimStore.getState().reset()
  // a distinct, non-shared starting graph; `newGraph` also clears `pristineSample`
  useGraphStore.getState().newGraph()
  useGraphStore.getState().addNodeAt('gate', { x: 10, y: 10 })
})

// ── foreign fragments: not ours, left in the address bar ───────────────
describe('a fragment that is not a Loop Studio share link', () => {
  it('empty / plain-anchor / route / other-app fragments ⇒ none, nothing touched, no strip', async () => {
    for (const hash of ['', '#', '#section-2', '#/some/route', '#w1=abc', '#gg=1', '#g=1']) {
      const before = rev()
      const out = await consumeShareLink({ hash, stripFragment: NEVER, confirm: NEVER })
      expect(out).toEqual({ kind: 'none' })
      expect(rev()).toBe(before)
    }
  })
})

// ── ours, but not a link this build can open: warn + strip, no changes ──
describe('an unsupported or malformed share link (§U6)', () => {
  it('`#g2=...` while a run is active ⇒ run kept, bump 0, fragment stripped, warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    useSimStore.setState({ status: 'running' }, false)
    const before = rev()
    const beforeNodes = useGraphStore.getState().nodes
    let strips = 0
    const out = await consumeShareLink({
      hash: '#g2=eJxLYY=whatever',
      confirm: NEVER,
      stripFragment: () => {
        strips++
      },
    })
    expect(out).toEqual({ kind: 'failed', reason: 'unsupported-version' })
    expect(rev()).toBe(before)
    expect(useGraphStore.getState().nodes).toBe(beforeNodes)
    expect(useSimStore.getState().status).toBe('running')
    expect(strips).toBe(1)
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('`#g10=...` ⇒ unsupported-version, stripped', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let strips = 0
    const out = await consumeShareLink({
      hash: '#g10=AAAA',
      confirm: NEVER,
      stripFragment: () => {
        strips++
      },
    })
    expect(out).toEqual({ kind: 'failed', reason: 'unsupported-version' })
    expect(strips).toBe(1)
    warn.mockRestore()
  })

  it('`#g1` and `#g1=` ⇒ handled as a broken link, fragment stripped, nothing mutated', async () => {
    for (const hash of ['#g1', '#g1=']) {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      useSimStore.setState({ status: 'running' }, false)
      const before = rev()
      const beforeNodes = useGraphStore.getState().nodes
      let strips = 0
      const out = await consumeShareLink({
        hash,
        confirm: NEVER,
        stripFragment: () => {
          strips++
        },
      })
      expect(out.kind).toBe('failed') // 'malformed' for `#g1`, an inflate failure for `#g1=`
      expect(rev()).toBe(before)
      expect(useGraphStore.getState().nodes).toBe(beforeNodes)
      expect(useSimStore.getState().status).toBe('running')
      expect(strips).toBe(1)
      expect(warn).toHaveBeenCalledOnce()
      warn.mockRestore()
    }
  })
})

// ── pristine sample: no confirm ────────────────────────────────────────
describe('pristine first-boot sample', () => {
  it('applies the link with no confirm, exactly one bump, strips the fragment', async () => {
    useGraphStore.setState({ pristineSample: true }, false)
    let strips = 0
    const bumps = await countBumps(async () => {
      const out = await consumeShareLink({
        hash: await shareHash(docString({ label: 'FromLink' })),
        confirm: NEVER, // must not be consulted while pristine
        stripFragment: () => {
          strips++
        },
      })
      expect(out).toEqual({ kind: 'loaded' })
    })
    expect(bumps).toBe(1)
    expect(strips).toBe(1)
    expect(nodeIds()).toEqual(['p', 's'])
    expect(useGraphStore.getState().nodes.find((n) => n.id === 's')?.data.label).toBe('FromLink')
    expect(useGraphStore.getState().pristineSample).toBe(false) // loadDoc ended it
    expect(useSimStore.getState().stepIndex).toBe(0)
  })

  it('applies the link’s recommendedRunConfig after the load', async () => {
    useGraphStore.setState({ pristineSample: true }, false)
    await consumeShareLink({ hash: await shareHash(docString({ runs: 137 })), confirm: NEVER })
    expect(useMcStore.getState().config.runs).toBe(137)
  })
})

// ── not pristine: confirm gates the replace ────────────────────────────
describe('a modified session (not pristine)', () => {
  it('Cancel ⇒ cancelled: graph, rev, and a running sim all untouched; fragment still stripped', async () => {
    expect(useGraphStore.getState().pristineSample).toBe(false)
    useSimStore.setState({ status: 'running' }, false)
    const before = rev()
    const beforeNodes = useGraphStore.getState().nodes
    let strips = 0
    let asked = ''
    const out = await consumeShareLink({
      hash: await shareHash(),
      confirm: (m) => {
        asked = m
        return false
      },
      stripFragment: () => {
        strips++
      },
    })
    expect(out).toEqual({ kind: 'cancelled' })
    expect(asked).toBe(REPLACE_PROMPT)
    expect(rev()).toBe(before)
    expect(useGraphStore.getState().nodes).toBe(beforeNodes) // same reference, untouched
    expect(useSimStore.getState().status).toBe('running') // NOT stopped on cancel
    expect(strips).toBe(1)
  })

  it('OK ⇒ loaded: run stopped first, then exactly one bump', async () => {
    useSimStore.setState({ status: 'running' }, false)
    let strips = 0
    const bumps = await countBumps(async () => {
      const out = await consumeShareLink({
        hash: await shareHash(docString({ label: 'Replaced' })),
        confirm: () => true,
        stripFragment: () => {
          strips++
        },
      })
      expect(out).toEqual({ kind: 'loaded' })
    })
    expect(bumps).toBe(1)
    expect(strips).toBe(1)
    expect(useSimStore.getState().status).not.toBe('running') // pause() + loadDoc reset
    expect(nodeIds()).toEqual(['p', 's'])
  })
})

// ── damaged links never mutate anything ───────────────────────────────
describe('a damaged share link', () => {
  const cases: Array<{ name: string; hash: () => Promise<string> | string }> = [
    { name: 'non-alphabet base64url', hash: () => '#g1=not*valid*b64' },
    { name: 'valid base64url, not a zlib stream', hash: async () => `#g1=${(await encodeShareText('x')).payload.replace(/^../, 'AA')}` },
    { name: 'valid zlib, not a graph doc', hash: async () => `#g1=${(await encodeShareText('{"hello":"world"}')).payload}` },
    { name: 'valid zlib, wrong schema', hash: async () => `#g1=${(await encodeShareText(JSON.stringify({ schema: 'x', version: 1, nodes: [], edges: [] }))).payload}` },
  ]

  for (const c of cases) {
    it(`${c.name} ⇒ failed; graph / rev / run untouched; fragment stripped; warns`, async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      useSimStore.setState({ status: 'running' }, false)
      const before = rev()
      const beforeNodes = useGraphStore.getState().nodes
      let strips = 0
      const out = await consumeShareLink({
        hash: await c.hash(),
        confirm: NEVER, // validation fails before any confirm
        stripFragment: () => {
          strips++
        },
      })
      expect(out.kind).toBe('failed')
      expect(rev()).toBe(before)
      expect(useGraphStore.getState().nodes).toBe(beforeNodes)
      expect(useSimStore.getState().status).toBe('running') // no run-stop on failure
      expect(strips).toBe(1)
      expect(warn).toHaveBeenCalledOnce()
      warn.mockRestore()
    })
  }
})

// ── the fragment strip keeps path + query ─────────────────────────────
describe('default fragment strip', () => {
  it('replaceState with pathname + search only, fragment gone, history entry replaced', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const calls: unknown[][] = []
    const g = globalThis as unknown as { window?: unknown }
    const prev = g.window
    g.window = {
      history: { state: { k: 7 }, replaceState: (...a: unknown[]) => calls.push(a) },
      location: { pathname: '/studio/app', search: '?ref=abc', hash: '#g1=broken!' },
    }
    try {
      // a broken link reaches the strip via `defaultStrip`
      const out = await consumeShareLink({ hash: '#g1=broken!' })
      expect(out.kind).toBe('failed')
    } finally {
      g.window = prev
      warn.mockRestore()
    }
    expect(calls).toEqual([[{ k: 7 }, '', '/studio/app?ref=abc']])
  })
})
