import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import enCatalog from './locales/en'
import koCatalog from './locales/ko'
import { getEntry } from './registry'
import { initI18n, useI18n } from './store'
import { ensureTemplateLabelDict } from './templateLabels/dicts'

// #424 item 2 (Lumi, 2026-10-31) — boot runs `initI18n()` more than once (the
// storage gate, the recovery screen, `startApp`). A failed load raises
// `loadError`; a LATER successful one must clear it, or the person is told
// their language could not load while it shows. A failure that repeats keeps
// the error. In headless Chromium this could not be reproduced end to end —
// the browser re-used the failed chunk import instead of fetching it again, so
// the second load failed too — so the loader is mocked here.

beforeAll(async () => {
  await ensureTemplateLabelDict('ko') // resident, so only the catalog's timing matters
})
beforeEach(() => {
  useI18n.setState({ activeLocale: 'en', activeCatalog: enCatalog, requestedLocale: 'en', requestGeneration: 0, loading: false, loadError: null })
  vi.stubGlobal('navigator', { languages: ['ko-KR'], language: 'ko-KR' }) // nothing stored: the browser's language picks ko
  vi.spyOn(console, 'warn').mockImplementation(() => {}) // the failed boot's own warning
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const state = () => {
  const s = useI18n.getState()
  return { activeLocale: s.activeLocale, loadError: s.loadError }
}

describe('initI18n and loadError', () => {
  it('a failed first load raises loadError; a successful second load clears it', async () => {
    vi.spyOn(getEntry('ko')!, 'catalog').mockRejectedValueOnce(new Error('chunk failed')).mockResolvedValueOnce(koCatalog)
    await initI18n()
    expect(state()).toEqual({ activeLocale: 'en', loadError: { code: 'ko', current: 'en' } })
    await initI18n()
    expect(state()).toEqual({ activeLocale: 'ko', loadError: null })
  })

  it('a failure that repeats keeps loadError', async () => {
    vi.spyOn(getEntry('ko')!, 'catalog').mockRejectedValue(new Error('chunk failed'))
    await initI18n()
    await initI18n()
    expect(state()).toEqual({ activeLocale: 'en', loadError: { code: 'ko', current: 'en' } })
  })

  it('a first load that succeeds raises nothing', async () => {
    vi.spyOn(getEntry('ko')!, 'catalog').mockResolvedValue(koCatalog)
    await initI18n()
    expect(state()).toEqual({ activeLocale: 'ko', loadError: null })
  })
})
