// SEMANTICS-M6.md §M6-8 — the stage tag's words. Each state has its own words, so none
// rests on colour. `met` is a judgement within a ratio (§M6-5), so its words say only
// how far the stage ran: no target, and nothing that reads as the target being hit.
import type { RunGroupReport } from '../engine/types'
import type { MessageKey } from '../i18n'
import { isolateAuto, isolateLtr } from '../i18n/bidiIsolate'

type Words = (key: MessageKey, params?: Record<string, string | number>) => string

/** the most decimals a tag prints, and the least share it can name: past them it says
 *  `<`. So what a run can print is bounded, and the block can be sized before the run. */
const MOST_DIGITS = 2
const UNDER = '<'
const LEAST = `${UNDER}0.01`
/** the widest numbers a run can print: on its own, and as a held stage's pair. Only a
 *  run can read `<99.99`, and its target is then `99.99`, or both are `<0.01`. */
const WIDEST_ALONE = ['99.99', '<0.01'] as const
const WIDEST_PAIRS = [['<99.99', '99.99'], ['<0.01', '<0.01']] as const

/** a share of a full run as percent text: at most two decimals, or `<0.01` */
export function percentText(fraction: number, digits = 0): string {
  const p = fraction * 100
  if (p === 0) return '0'
  if (p < 0.01) return LEAST
  const places = p >= 1 ? digits : Math.min(MOST_DIGITS, Math.ceil(-Math.log10(p)) + digits)
  const text = p.toFixed(places)
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text
}

/** a stage held short must not read as if it ran at its target, so two numbers that
 *  round alike take more digits, and past those the run says `<` its target */
export function apart(moved: number, target: number): [string, string] {
  for (let d = 0; d <= MOST_DIGITS; d++) {
    const pair: [string, string] = [percentText(moved, d), percentText(target, d)]
    if (pair[0] !== pair[1]) return pair
  }
  const t = percentText(target, MOST_DIGITS)
  return [t.startsWith(UNDER) ? t : `${UNDER}${t}`, t]
}

/** what the stage did this step; `compact` is the state of the last form */
function stateWords(t: Words, r: RunGroupReport | null, compact: boolean): string {
  if (!r) return t('run.tag.idle')
  if (r.state === 'off') return t('run.tag.off')
  if (r.state === 'stopped') return compact ? t('run.tag.stoppedCompact') : t('run.tag.stopped', { target: isolateLtr(percentText(r.target)) })
  if (r.state === 'short') {
    const [pct, target] = apart(r.moved, r.target)
    return compact ? t('run.tag.shortCompact', { pct: isolateLtr(pct), target: isolateLtr(target) }) : t('run.tag.short', { pct: isolateLtr(pct), target: isolateLtr(target) })
  }
  return t('run.tag.run', { pct: isolateLtr(percentText(r.moved)) })
}

/** a step's state in the tag's own words, for a surface that reads one step */
export const stageStateText = (t: Words, r: RunGroupReport): string => stateWords(t, r, false)

/** every state's words at their widest numbers. Which is widest depends on the language
 *  and its font, so the block takes them all and the browser finds the size. */
function everyState(t: Words, compact: boolean): string[] {
  return [
    t('run.tag.idle'),
    t('run.tag.off'),
    ...WIDEST_ALONE.map((pct) => t('run.tag.run', { pct })),
    ...WIDEST_PAIRS.map(([pct, target]) => (compact ? t('run.tag.shortCompact', { pct, target }) : t('run.tag.short', { pct, target }))),
    ...(compact ? [t('run.tag.stoppedCompact')] : WIDEST_ALONE.map((target) => t('run.tag.stopped', { target }))),
  ]
}

export const FOLDED = '…'

export type StageTagForm = { state: string; rest: string }

export type StageTagText = {
  /** this step's words, longest first; the last is what a tag folds to */
  forms: StageTagForm[]
  /** per form, its words in every state at the widest numbers: what the block is sized
   *  to and folding measures, so nothing a run prints can pass them */
  widest: string[][]
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
  const widest = rests.map(([rest, compact]) => everyState(t, compact).map((state) => joined({ state, rest })))
  if (missing === null) {
    forms.push({ state: '', rest: FOLDED })
    widest.push([FOLDED])
  }
  return { forms, widest, full: joined(forms[0]!), noLine: missing !== null }
}
