import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { serialize } from '../model/serialize'
import type { LoopEdge, LoopNode } from '../model/types'
import { encodeShareText } from '../model/share'
import { sealShareText } from '../model/shareProtected'
import { useGraphStore } from './graphStore'
import { useMcStore } from './mcStore'
import {
  __resetProtectedLinkForTests,
  cancelProtectedOpen,
  dismissProtectedNotice,
  submitProtectedPassword,
  useProtectedLinkStore,
} from './protectedLink'
import { type ShareLoadOutcome, consumeShareLink } from './shareLink'
import { useSimStore } from './simStore'

// SEMANTICS-P.md loop-share-protected/1 SS P6 - the opening flow, driven the way
// the app drives it: through `consumeShareLink`, with `hash` / `confirm` /
// `stripFragment` injected (node env: no window).

const PASSWORD = 'correct horse battery staple'
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
const protectedHash = async (text = docString(), password = PASSWORD) => `#p1=${(await sealShareText(text, password)).payload}`

const phase = () => useProtectedLinkStore.getState().open
const rev = () => useGraphStore.getState().simulationRev
const nodeIds = () => useGraphStore.getState().nodes.map((n) => n.id).sort()

/** start the flow; `settled` flips when the returned promise resolves */
function start(hash: string, confirm: (m: string) => boolean = NEVER) {
  const strip = vi.fn()
  const result: { outcome: ShareLoadOutcome | null } = { outcome: null }
  const done = consumeShareLink({ hash, confirm, stripFragment: strip }).then((o) => {
    result.outcome = o
    return o
  })
  return { strip, result, done }
}
/** let already-resolved promises run their continuations */
const tick = () => new Promise<void>((r) => setTimeout(r, 0))

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  __resetProtectedLinkForTests()
  useMcStore.getState().clear()
  useSimStore.getState().reset()
  // a distinct, non-shared starting graph; `newGraph` also clears `pristineSample`
  useGraphStore.getState().newGraph()
  useGraphStore.getState().addNodeAt('gate', { x: 10, y: 10 })
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('a link that is not asked a password for', () => {
  it.each(['#p1', '#p1x', '#p1=', '#p1=AAAA', '#p1=' + 'A'.repeat(59), '#p1=' + 'A'.repeat(8193), '#p1=' + 'A'.repeat(63) + '+'])(
    '%s ⇒ the damaged notice, the fragment removed, nothing touched',
    async (hash) => {
      const before = { ids: nodeIds(), rev: rev() }
      const { strip, result, done } = start(hash)
      await tick()
      expect(phase()).toEqual({ phase: 'notice', notice: 'damaged' })
      expect(strip).toHaveBeenCalledTimes(1)
      expect(result.outcome).toBeNull() // the flow is not over until the notice is closed
      dismissProtectedNotice()
      expect(await done).toEqual({ kind: 'failed', reason: 'protected-damaged' })
      expect(phase()).toEqual({ phase: 'idle' })
      expect({ ids: nodeIds(), rev: rev() }).toEqual(before)
      expect(warn.mock.calls).toEqual([['Loop Studio: ignored a damaged protected share link.']])
    },
  )

  it.each(['#p2=AAAA', '#p10=' + 'A'.repeat(80)])('%s ⇒ the newer-version notice, and the fragment is KEPT', async (hash) => {
    const { strip, done } = start(hash)
    await tick()
    expect(phase()).toEqual({ phase: 'notice', notice: 'newer' })
    dismissProtectedNotice()
    expect(await done).toEqual({ kind: 'failed', reason: 'protected-newer' })
    expect(strip).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('no Web Crypto ⇒ the requirement notice, the fragment KEPT, no prompt', async () => {
    const hash = await protectedHash()
    vi.stubGlobal('crypto', {})
    const { strip, done } = start(hash)
    await tick()
    expect(phase()).toEqual({ phase: 'notice', notice: 'unavailable' })
    dismissProtectedNotice()
    expect(await done).toEqual({ kind: 'failed', reason: 'protected-unavailable' })
    expect(strip).not.toHaveBeenCalled()
  })

  it('a broken link is damaged even where Web Crypto is missing (the structure check needs none)', async () => {
    vi.stubGlobal('crypto', {})
    const { strip, done } = start('#p1=AAAA')
    await tick()
    expect(phase()).toEqual({ phase: 'notice', notice: 'damaged' })
    dismissProtectedNotice()
    await done
    expect(strip).toHaveBeenCalledTimes(1)
  })
})

describe('a well-formed protected link', () => {
  it('is copied to memory and its fragment removed BEFORE any password, and derives nothing yet', async () => {
    const hash = await protectedHash() // sealing derives a key of its own: spy only afterwards
    const derive = vi.spyOn(crypto.subtle, 'deriveKey')
    const { strip, result } = start(hash)
    await tick()
    expect(phase()).toEqual({ phase: 'prompt', busy: false, failures: 0 })
    expect(strip).toHaveBeenCalledTimes(1)
    expect(derive).not.toHaveBeenCalled()
    expect(result.outcome).toBeNull()
    cancelProtectedOpen()
  })

  it('the right password on the untouched sample ⇒ loaded with no confirm, exactly one bump, the run config applied', async () => {
    useGraphStore.setState({ pristineSample: true })
    const { done } = start(await protectedHash(docString({ runs: 77 })))
    await tick()
    const before = rev()
    await submitProtectedPassword(PASSWORD)
    expect(await done).toEqual({ kind: 'loaded' })
    expect(rev()).toBe(before + 1)
    expect(nodeIds()).toEqual(['p', 's'])
    expect(useMcStore.getState().config.runs).toBe(77)
    expect(phase()).toEqual({ phase: 'idle' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('a modified session asks before replacing: Cancel keeps everything, and the flow ends', async () => {
    const before = { ids: nodeIds(), rev: rev() }
    const confirm = vi.fn(() => false)
    const { done } = start(await protectedHash(), confirm)
    await tick()
    await submitProtectedPassword(PASSWORD)
    expect(await done).toEqual({ kind: 'cancelled' })
    expect(confirm).toHaveBeenCalledTimes(1)
    expect({ ids: nodeIds(), rev: rev() }).toEqual(before)
    expect(phase()).toEqual({ phase: 'idle' })
  })

  it('a modified session, OK ⇒ a running sim is stopped first, then one load', async () => {
    useSimStore.setState({ status: 'running' }, false)
    const { done } = start(await protectedHash(), () => true)
    await tick()
    const before = rev()
    await submitProtectedPassword(PASSWORD)
    expect(await done).toEqual({ kind: 'loaded' })
    expect(useSimStore.getState().status).not.toBe('running') // pause() + loadDoc reset
    expect(rev()).toBe(before + 1)
  })
})

describe('a wrong password', () => {
  it('leaves the prompt open, counts the failure, touches nothing, and can be retried without limit', async () => {
    useSimStore.setState({ status: 'running' }, false)
    const before = { ids: nodeIds(), rev: rev() }
    const { result, done } = start(await protectedHash(), () => true)
    await tick()
    for (let n = 1; n <= 3; n++) {
      await submitProtectedPassword('not the password ' + n)
      expect(phase()).toEqual({ phase: 'prompt', busy: false, failures: n })
    }
    expect({ ids: nodeIds(), rev: rev() }).toEqual(before)
    expect(useSimStore.getState().status).toBe('running')
    expect(result.outcome).toBeNull()
    await submitProtectedPassword(PASSWORD)
    expect(await done).toEqual({ kind: 'loaded' })
  })

  it('and a damaged link write the SAME console line, and nothing else', async () => {
    const hash = await protectedHash()
    // flip one character in the middle of the payload: still well-formed, no longer authentic
    const i = 4 + 60
    const damaged = hash.slice(0, i) + (hash[i] === 'A' ? 'B' : 'A') + hash.slice(i + 1)

    start(hash)
    await tick()
    await submitProtectedPassword('not the password')
    const wrongPassword = warn.mock.calls.slice()
    cancelProtectedOpen()
    warn.mockClear()

    start(damaged)
    await tick()
    await submitProtectedPassword(PASSWORD)
    const damagedLink = warn.mock.calls.slice()
    expect(phase()).toEqual({ phase: 'prompt', busy: false, failures: 1 })
    cancelProtectedOpen()

    expect(wrongPassword).toEqual([['Loop Studio: a protected share link was not opened; the password is wrong or the link is damaged.']])
    expect(damagedLink).toEqual(wrongPassword)
  })
})

describe('content that authenticates and is not a diagram', () => {
  it('⇒ a different notice from the wrong-password one, no retry, nothing touched', async () => {
    const before = { ids: nodeIds(), rev: rev() }
    const { done } = start(await protectedHash('this is not a graph document'))
    await tick()
    await submitProtectedPassword(PASSWORD)
    expect(phase()).toEqual({ phase: 'notice', notice: 'content' })
    await submitProtectedPassword(PASSWORD) // the prompt is gone: ignored
    expect(phase()).toEqual({ phase: 'notice', notice: 'content' })
    dismissProtectedNotice()
    expect(await done).toEqual({ kind: 'failed', reason: 'protected-content' })
    expect({ ids: nodeIds(), rev: rev() }).toEqual(before)
    expect(warn.mock.calls).toEqual([['Loop Studio: a protected share link opened, but what it carries is not a diagram.']])
  })
})

describe('one operation at a time, and cancel', () => {
  it('a second submit while the first is deriving is ignored: one derivation, busy shown', async () => {
    const hash = await protectedHash()
    const derive = vi.spyOn(crypto.subtle, 'deriveKey')
    useGraphStore.setState({ pristineSample: true })
    const { done } = start(hash)
    await tick()
    const first = submitProtectedPassword(PASSWORD)
    expect(phase()).toEqual({ phase: 'prompt', busy: true, failures: 0 })
    const second = submitProtectedPassword('another attempt, typed fast')
    await Promise.all([first, second])
    expect(derive).toHaveBeenCalledTimes(1)
    expect(await done).toEqual({ kind: 'loaded' })
  })

  it('Cancel on the prompt ⇒ cancelled, nothing touched; the link has to be opened again', async () => {
    const before = { ids: nodeIds(), rev: rev() }
    const { done } = start(await protectedHash())
    await tick()
    cancelProtectedOpen()
    expect(await done).toEqual({ kind: 'cancelled' })
    expect(phase()).toEqual({ phase: 'idle' })
    await submitProtectedPassword(PASSWORD) // nothing is open any more
    expect({ ids: nodeIds(), rev: rev() }).toEqual(before)
  })

  it('Cancel DURING a derivation ⇒ its result is dropped: no load even with the right password', async () => {
    useGraphStore.setState({ pristineSample: true })
    const before = { ids: nodeIds(), rev: rev() }
    const { done } = start(await protectedHash())
    await tick()
    const running = submitProtectedPassword(PASSWORD)
    cancelProtectedOpen()
    await running
    expect(await done).toEqual({ kind: 'cancelled' })
    expect({ ids: nodeIds(), rev: rev() }).toEqual(before)
    expect(phase()).toEqual({ phase: 'idle' })
  })
})

describe('the password is not kept', () => {
  it('nothing the prompt store holds contains it, during or after an attempt', async () => {
    const secret = 'a very particular password 7391'
    const seen: string[] = []
    const unsub = useProtectedLinkStore.subscribe((s) => seen.push(JSON.stringify(s)))
    const { done } = start(await protectedHash(docString(), secret), () => true)
    await tick()
    await submitProtectedPassword('wrong ' + secret)
    await submitProtectedPassword(secret)
    await done
    unsub()
    seen.push(JSON.stringify(useProtectedLinkStore.getState()))
    expect(seen.length).toBeGreaterThan(3)
    for (const s of seen) expect(s).not.toContain('7391')
    expect(warn.mock.calls.flat().join(' ')).not.toContain('7391')
  })
})

describe('the plain path is unchanged by the protected one', () => {
  it('a foreign fragment is still none, and a `g2=` link is still stripped with its own warning', async () => {
    expect(await consumeShareLink({ hash: '#section-2', confirm: NEVER, stripFragment: NEVER })).toEqual({ kind: 'none' })
    const strip = vi.fn()
    expect(await consumeShareLink({ hash: '#g2=abc', confirm: NEVER, stripFragment: strip })).toEqual({ kind: 'failed', reason: 'unsupported-version' })
    expect(strip).toHaveBeenCalledTimes(1)
    expect(phase()).toEqual({ phase: 'idle' })
  })
})

// issue #301 decision 1 - there is no bundled zlib fallback any more, so a page
// without Compression Streams opens no link of either kind (SEMANTICS-U.md SS U1.3)
describe('a page without Compression Streams', () => {
  it('a plain link ⇒ the "Share link" notice, the fragment KEPT, the graph untouched', async () => {
    const hash = `#g1=${(await encodeShareText(docString())).payload}`
    vi.stubGlobal('DecompressionStream', undefined)
    const before = { ids: nodeIds(), rev: rev() }
    const { strip, result, done } = start(hash)
    await tick()
    expect(phase()).toEqual({ phase: 'notice', notice: 'plain-no-compression' })
    expect(result.outcome).toBeNull() // the boot flow waits for the notice
    dismissProtectedNotice()
    expect(await done).toEqual({ kind: 'failed', reason: 'share-unavailable' })
    expect(strip).not.toHaveBeenCalled()
    expect({ ids: nodeIds(), rev: rev() }).toEqual(before)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('Loop Studio: this browser cannot open share links; a current browser is required.')
  })

  it('a protected link ⇒ the same sentence, checked before Web Crypto, the fragment KEPT, no prompt', async () => {
    const hash = await protectedHash()
    vi.stubGlobal('DecompressionStream', undefined)
    vi.stubGlobal('crypto', {}) // both missing: the message names Compression Streams
    const { strip, done } = start(hash)
    await tick()
    expect(phase()).toEqual({ phase: 'notice', notice: 'no-compression' })
    dismissProtectedNotice()
    expect(await done).toEqual({ kind: 'failed', reason: 'share-unavailable' })
    expect(strip).not.toHaveBeenCalled()
  })

  it('a broken protected link is still damaged (the structure check needs neither)', async () => {
    vi.stubGlobal('DecompressionStream', undefined)
    const { strip, done } = start('#p1=AAAA')
    await tick()
    expect(phase()).toEqual({ phase: 'notice', notice: 'damaged' })
    dismissProtectedNotice()
    await done
    expect(strip).toHaveBeenCalledTimes(1)
  })

  it('a link this build does not know is handled as before', async () => {
    vi.stubGlobal('DecompressionStream', undefined)
    const strip = vi.fn()
    expect(await consumeShareLink({ hash: '#g2=abc', confirm: NEVER, stripFragment: strip })).toEqual({ kind: 'failed', reason: 'unsupported-version' })
    expect(strip).toHaveBeenCalledTimes(1)
  })
})
