import { describe, expect, it } from 'vitest'
import { t as translate } from '../i18n'
import enCatalog from '../i18n/locales/en'
import koCatalog from '../i18n/locales/ko'
import { useI18n } from '../i18n/store'
import { stripBidiControls } from '../i18n/bidiIsolate'
import { phaseTexts, shownPhase } from './runPhase'

/** the wording without the isolates that keep a name's direction to itself */
const plain = (p: Parameters<typeof phaseTexts>[0]) => {
  const x = phaseTexts(p, translate)
  return { range: x.range, full: stripBidiControls(x.full), sr: stripBidiControls(x.sr) }
}

// docs/run-phases.md — which phase a run row names, and how it is worded

const PH = [
  { id: 'a', label: 'Charge', from: 1, to: 1 },
  { id: 'b', label: 'Browning', from: 6, to: 9 },
]

describe('shownPhase', () => {
  it('is the phase of the current step while a run is under way', () => {
    expect(shownPhase(PH, 1, false, false)?.id).toBe('a')
    expect(shownPhase(PH, 8, false, false)?.id).toBe('b')
  })
  it('is none before the first step, in a gap, at the end, when the run cannot start, and without phases', () => {
    expect(shownPhase(PH, 0, false, false)).toBeNull()
    expect(shownPhase(PH, 3, false, false)).toBeNull()
    expect(shownPhase(PH, 9, true, false)).toBeNull()
    expect(shownPhase(PH, 8, false, true)).toBeNull()
    expect(shownPhase([], 8, false, false)).toBeNull()
  })
})

describe('phaseTexts', () => {
  it('names a range of steps, and one step as the step readout does', () => {
    useI18n.setState({ activeLocale: 'en', activeCatalog: enCatalog, requestedLocale: 'en' })
    expect(plain(PH[1]!)).toEqual({ range: 'steps 6–9', full: 'Browning (steps 6–9)', sr: 'Browning phase, steps 6–9' })
    expect(plain(PH[0]!)).toEqual({ range: 'step 1', full: 'Charge (step 1)', sr: 'Charge phase, step 1' })
  })
  it('keeps a name’s direction to itself: a right-to-left name in a left-to-right sentence is isolated', () => {
    const x = phaseTexts({ id: 'r', label: 'التحميص', from: 2, to: 3 }, translate)
    expect(x.full).not.toBe(stripBidiControls(x.full))
    expect(stripBidiControls(x.full)).toBe('التحميص (steps 2–3)')
  })
  it('follows the language', () => {
    useI18n.setState({ activeLocale: 'ko', activeCatalog: koCatalog, requestedLocale: 'ko' })
    expect(plain({ id: 'b', label: '갈변', from: 6, to: 9 })).toEqual({ range: '6–9단계', full: '갈변 (6–9단계)', sr: '갈변 구간, 6–9단계' })
    useI18n.setState({ activeLocale: 'en', activeCatalog: enCatalog, requestedLocale: 'en' })
  })
})
