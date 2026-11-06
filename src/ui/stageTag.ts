// SEMANTICS-M6.md §M6-8 — the stage tag's words. Each state has its own words, so none
// rests on colour. `met` is a judgement within a ratio (§M6-5), so its words say only
// how far the stage ran: no target, and nothing that reads as the target being hit.
import type { RunGroupReport } from '../engine/types'
import type { MessageKey } from '../i18n'
import { isolateAuto } from '../i18n/bidiIsolate'

type Words = (key: MessageKey, params?: Record<string, string | number>) => string

/** a share of a full run as percent text, in plain digits at any size: a target far
 *  under 1 % keeps its first digits instead of reading 0 */
export function percentText(fraction: number, digits = 0): string {
  const p = fraction * 100
  if (p === 0) return '0'
  const places = p >= 1 ? digits : Math.min(20, Math.ceil(-Math.log10(p)) + digits)
  const text = p.toFixed(places)
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text
}

/** a stage held short must not read as if it ran at its target, so two numbers that
 *  round alike take more digits */
function apart(moved: number, target: number): [string, string] {
  for (let d = 0; d < 6; d++) {
    const pair: [string, string] = [percentText(moved, d), percentText(target, d)]
    if (pair[0] !== pair[1]) return pair
  }
  return [percentText(moved, 6), percentText(target, 6)]
}

/** what the stage did this step; `compact` is the state of the last form */
function stateWords(t: Words, r: RunGroupReport | null, compact: boolean): string {
  if (!r) return t('run.tag.idle')
  if (r.state === 'off') return t('run.tag.off')
  if (r.state === 'stopped') return compact ? t('run.tag.stoppedCompact') : t('run.tag.stopped', { target: percentText(r.target) })
  if (r.state === 'short') {
    const [pct, target] = apart(r.moved, r.target)
    return compact ? t('run.tag.shortCompact', { pct, target }) : t('run.tag.short', { pct, target })
  }
  return t('run.tag.run', { pct: percentText(r.moved) })
}

/** the state's words at their longest, so the block's size holds through a run */
function widestState(t: Words, compact: boolean): string {
  const short = t(compact ? 'run.tag.shortCompact' : 'run.tag.short', { pct: '100', target: '100' })
  const stopped = compact ? t('run.tag.stoppedCompact') : t('run.tag.stopped', { target: '100' })
  return short.length >= stopped.length ? short : stopped
}

export const FOLDED = '…'

export type StageTagForm = { state: string; rest: string }

export type StageTagText = {
  /** this step's words, longest first; the last is what a tag folds to */
  forms: StageTagForm[]
  /** the same forms at the widest state: what the block is sized to and folding measures */
  widest: string[]
  /** the longest form, for the unfolded tag and the accessible name */
  full: string
  /** the last form still names the tank: no line shows it */
  noLine: boolean
}

const joined = ({ state, rest }: StageTagForm): string => (state === '' ? rest : rest === '' ? state : rest === FOLDED ? `${state} ${FOLDED}` : `${state} · ${rest}`)

/** The forms, longest first. The second drops the tank when a line shows it, and keeps
 *  the table, which nothing else shows. Then the state in its short words, and last `…`
 *  alone, for a stage with a chip too close for even that. With no line the tank is
 *  never dropped. */
export function stageTagText(t: Words, input: { report: RunGroupReport | null; tank: string | null; table: string | null; noLine: boolean }): StageTagText {
  const { report, tank, table, noLine } = input
  const readsTable = table !== null ? t('run.tag.readsTable', { table: isolateAuto(table) }) : null
  const reads = tank !== null && table !== null ? t('run.tag.readsBoth', { tank: isolateAuto(tank), table: isolateAuto(table) }) : tank !== null ? t('run.tag.readsTank', { tank: isolateAuto(tank) }) : readsTable
  const missing = noLine && tank !== null ? t('run.tag.noLine', { tank: isolateAuto(tank) }) : null
  const rests: [string, boolean][] =
    missing !== null
      ? readsTable !== null
        ? [[`${readsTable} · ${missing}`, false], [missing, true]]
        : [[missing, true]]
      : tank !== null && readsTable !== null
        ? [[reads!, false], [readsTable, false], [FOLDED, true]]
        : reads !== null
          ? [[reads, false], [FOLDED, true]]
          : [['', true]]
  const forms = rests.map(([rest, compact]) => ({ state: stateWords(t, report, compact), rest }))
  const widest = rests.map(([rest, compact]) => joined({ state: widestState(t, compact), rest }))
  if (missing === null) {
    forms.push({ state: '', rest: FOLDED })
    widest.push(FOLDED)
  }
  return { forms, widest, full: joined(forms[0]!), noLine: missing !== null }
}
