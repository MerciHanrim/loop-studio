// docs/run-phases.md — the wording of the phase a run row names beside its step
import { isolateAuto } from '../i18n/bidiIsolate'
import type { FormatParams } from '../i18n/format'
import type { MessageKey } from '../i18n/locales/en'
import { phaseAt, type DocPhase } from '../model/phases'

type Translate = (key: MessageKey, params?: FormatParams) => string

/** the phase a run row names: the one that covers the current step of a run under
 *  way. None before the first step, in a gap between phases, once the run has ended
 *  (the end is the state to read then) and while the run cannot start. */
export function shownPhase(phases: readonly DocPhase[], stepIndex: number, ended: boolean, cannotRun: boolean): DocPhase | null {
  if (ended || cannotRun || phases.length === 0) return null
  return phaseAt(phases, stepIndex)
}

/** a phase's range ("steps 6–9", or "step 14" for one step), its name with the range,
 *  and the same for a screen reader */
export function phaseTexts(p: DocPhase, t: Translate): { range: string; full: string; sr: string } {
  // each argument is written out at its call: the ICU-argument check reads the call sites
  // (the name is isolated there, the range is catalog text)
  const one = p.from === p.to
  return {
    range: one ? t('playbar.step', { n: p.from }) : t('playbar.phase.range', { from: p.from, to: p.to }),
    full: t('playbar.phase.full', { name: isolateAuto(p.label), range: one ? t('playbar.step', { n: p.from }) : t('playbar.phase.range', { from: p.from, to: p.to }) }),
    sr: t('playbar.phase.sr', { name: isolateAuto(p.label), range: one ? t('playbar.step', { n: p.from }) : t('playbar.phase.range', { from: p.from, to: p.to }) }),
  }
}
