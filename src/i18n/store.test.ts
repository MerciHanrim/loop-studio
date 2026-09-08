import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { MessageCatalog } from './locales/en'
import enCatalog from './locales/en'
import koCatalog from './locales/ko'
import { getEntry } from './registry'
import { useI18n } from './store'
import { ensureTemplateLabelDict } from './templateLabels/dicts'

// docs/localization.md §L4.5 — the atomic-activation state machine + race rules.
// Runs in the node env (no DOM); `applyHtml` is a guarded no-op there.
//
// A locale switch loads BOTH the UI catalog AND the template-label dict before
// the one commit. The dicts are tiny and their `import()` resolves fast in
// Node; pre-load them once so `ensureTemplateLabelDict` returns synchronously
// and these tests only exercise the (mocked) catalog timing.

beforeAll(async () => {
  await ensureTemplateLabelDict('ko')
  await ensureTemplateLabelDict('ja')
})

const reset = () =>
  useI18n.setState({
    activeLocale: 'en',
    activeCatalog: enCatalog,
    requestedLocale: 'en',
    requestGeneration: 0,
    loading: false,
    loadError: null,
  })

afterEach(() => {
  vi.restoreAllMocks()
  reset()
})

/** a controllable catalog loader for one entry */
function defer(code: string) {
  let resolve!: (c: MessageCatalog) => void
  let reject!: (e: unknown) => void
  const p = new Promise<MessageCatalog>((res, rej) => {
    resolve = res
    reject = rej
  })
  vi.spyOn(getEntry(code)!, 'catalog').mockReturnValue(p)
  return { resolve, reject }
}

const tick = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe('i18n store — atomic activation', () => {
  it('does NOT change activeLocale before the catalog is ready', async () => {
    reset()
    const d = defer('ko')
    useI18n.getState().setLocale('ko')
    expect(useI18n.getState().activeLocale).toBe('en') // still en
    expect(useI18n.getState().loading).toBe(true)
    d.resolve(koCatalog)
    await tick()
    expect(useI18n.getState().activeLocale).toBe('ko')
    expect(useI18n.getState().activeCatalog).toBe(koCatalog)
    expect(useI18n.getState().loading).toBe(false)
    expect(useI18n.getState().loadError).toBeNull()
  })

  it('an unknown code is ignored — no state change', () => {
    reset()
    const before = useI18n.getState()
    useI18n.getState().setLocale('xx')
    expect(useI18n.getState()).toEqual(before)
  })

  it('re-selecting the active locale is a no-op (no generation bump, loadError untouched)', () => {
    reset()
    useI18n.setState({ loadError: { code: 'ja', current: 'en' } })
    const spy = vi.spyOn(getEntry('en')!, 'catalog')
    useI18n.getState().setLocale('en')
    expect(spy).not.toHaveBeenCalled()
    expect(useI18n.getState().requestGeneration).toBe(0)
    expect(useI18n.getState().loadError).toEqual({ code: 'ja', current: 'en' })
  })

  it('a stale late completion is dropped by the generation check', async () => {
    reset()
    const dKo = defer('ko')
    useI18n.getState().setLocale('ko') // gen 1
    const dEn = defer('en')
    useI18n.getState().setLocale('en') // gen 2 — supersedes
    dKo.resolve(koCatalog) // the stale gen-1 result arrives late
    await tick()
    expect(useI18n.getState().activeLocale).toBe('en') // NOT ko
    dEn.resolve(enCatalog)
    await tick()
    expect(useI18n.getState().activeLocale).toBe('en')
  })

  it('ko -> en -> ko settles on the LAST request', async () => {
    reset()
    const d1 = defer('ko')
    useI18n.getState().setLocale('ko') // gen 1
    const d2 = defer('en')
    useI18n.getState().setLocale('en') // gen 2
    const d3 = defer('ko')
    useI18n.getState().setLocale('ko') // gen 3 — the winner
    d1.resolve(koCatalog)
    d2.resolve(enCatalog)
    d3.resolve(koCatalog)
    await tick()
    expect(useI18n.getState().activeLocale).toBe('ko')
    expect(useI18n.getState().loading).toBe(false)
  })

  it('a catalog load failure keeps the current locale and raises loadError', async () => {
    reset()
    const d = defer('ko')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    useI18n.getState().setLocale('ko')
    d.reject(new Error('offline'))
    await tick()
    expect(useI18n.getState().activeLocale).toBe('en') // unchanged
    expect(useI18n.getState().activeCatalog).toBe(enCatalog)
    expect(useI18n.getState().loading).toBe(false)
    expect(useI18n.getState().loadError).toEqual({ code: 'ko', current: 'en' })
    expect(warn).toHaveBeenCalled()
  })

  it('a later successful switch clears a prior loadError', async () => {
    reset()
    useI18n.setState({ loadError: { code: 'ja', current: 'en' } })
    const d = defer('ko')
    useI18n.getState().setLocale('ko')
    d.resolve(koCatalog)
    await tick()
    expect(useI18n.getState().activeLocale).toBe('ko')
    expect(useI18n.getState().loadError).toBeNull()
  })

  it('dismissLoadError clears the notice', () => {
    reset()
    useI18n.setState({ loadError: { code: 'ja', current: 'en' } })
    useI18n.getState().dismissLoadError()
    expect(useI18n.getState().loadError).toBeNull()
  })

  it('the preference is still persisted even if the load fails', () => {
    reset()
    const set = vi.fn()
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: set })
    defer('ko').reject(new Error('x'))
    useI18n.getState().setLocale('ko')
    expect(set).toHaveBeenCalledWith('loop-studio/ui-locale/1', 'ko')
    vi.unstubAllGlobals()
  })
})
