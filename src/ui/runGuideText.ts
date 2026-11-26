import { useMemo } from 'react'
import { useGraphStore } from '../store/graphStore'
import { useSimStore } from '../store/simStore'
import { checkedRangeOf } from '../model/runGuide'
import { useT } from '../i18n'
import { isolateAuto } from '../i18n/bidiIsolate'

/**
 * #537 — the run guide's two lines, worded in the reader's language: the pause auto-play
 * made at the run's first stop of a core process (`simStore.autoPause`), and the note past
 * the steps a bundled example is checked over (model/runGuide.ts), which holds only while
 * the document's model is the example's. An empty string is a line not shown.
 *
 * One source for both run bars (issue #614 item 1): the desktop strip (PlayBar) and the
 * phone's run bar (MobileRunBar) show the same lines and read them from the same status
 * regions.
 */
export function useRunGuideTexts(): { pauseText: string; checkedText: string } {
  const t = useT()
  const autoPause = useSimStore((s) => s.autoPause)
  const stepIndex = useSimStore((s) => s.stepIndex)
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const kinds = useGraphStore((s) => s.kinds)
  const time = useGraphStore((s) => s.time)
  const timetables = useGraphStore((s) => s.timetables)
  const version = useGraphStore((s) => s.modelVersion)
  const checkedRange = useMemo(() => checkedRangeOf({ nodes, edges, kinds, time, timetables }, version), [nodes, edges, kinds, time, timetables, version])
  const pauseText = autoPause
    ? t(autoPause.pool ? (autoPause.cause === 'supply' ? 'playbar.guide.pausedSupply' : 'playbar.guide.pausedRoom') : 'playbar.guide.paused', {
        step: autoPause.step,
        stage: isolateAuto(autoPause.stage),
        pool: isolateAuto(autoPause.pool ?? ''),
      })
    : ''
  const checkedText = checkedRange && stepIndex > checkedRange.steps ? t('playbar.guide.checked', { days: checkedRange.days, steps: checkedRange.steps }) : ''
  return { pauseText, checkedText }
}
