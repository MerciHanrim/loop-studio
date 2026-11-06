import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { estimateMonteCarloCost, type CostEstimate } from '../engine'
import { useGraphStore } from '../store/graphStore'
import { runRefusalText, timetableRefusalText } from '../ui/runMessages'
import { useMcStore } from '../store/mcStore'
import { useSimStore } from '../store/simStore'
import { useT } from '../i18n'
import { useDialogFocus } from './useDialogFocus'
import { InlineHintNote } from './HintNote'
import { DraftNumberInput } from './DraftNumberInput'
import { DialogScrim } from './DialogScrim'
import { Icon } from '../ui/icons'

// P2 — Monte-Carlo setup. Opens from the simulation strip (an execution mode,
// not an authoring command). Shows an exact memory projection and a time RANGE
// — labelled as a local benchmark or as measured from the last real run, never
// as a parallel prediction. Closing it does not stop a run in progress.

const fmtMs = (ms: number) => (ms < 950 ? `${Math.round(ms / 10) * 10}ms` : `${(ms / 1000).toFixed(1)}s`)
const fmtBytes = (b: number) =>
  b < 1e6 ? `${Math.round(b / 1e3)} KB` : `${(b / 1e6).toFixed(b < 1e7 ? 1 : 0)} MB`

export function MonteCarloDialog() {
  const t = useT()
  const open = useMcStore((s) => s.dialogOpen)
  const closeDialog = useMcStore((s) => s.closeDialog)
  // #471 (Deploy 2, F1) — a refused Converter group: Run does not start, and
  // the dialog shows the run bar's line (mcStore.run guards it as well)
  const groupRefusedCount = useSimStore((s) => s.refusals.length)
  // loop-model/3 (SEMANTICS-M3.md §M3-4) — a kind finding that refuses the run, same posture
  const kindRefusedCount = useSimStore((s) => s.kindRefusals.length)
  const timetableRefusals = useSimStore((s) => s.timetableRefusals)
  const runRefusals = useSimStore((s) => s.runRefusals)
  const timetables = useGraphStore((s) => s.timetables)
  const refusedCount = groupRefusedCount + kindRefusedCount + timetableRefusals.length + runRefusals.length
  // iOS Safari keeps its focus-zoom until the field is blurred — drop focus (and
  // dismiss the soft keyboard) before the dialog unmounts so the page returns to
  // 100% (docs/mobile.md §MV4b). No-op on desktop.
  const close = useCallback(() => {
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    closeDialog()
  }, [closeDialog])
  const config = useMcStore((s) => s.config)
  const setConfig = useMcStore((s) => s.setConfig)
  const run = useMcStore((s) => s.run)
  const cancel = useMcStore((s) => s.cancel)
  const status = useMcStore((s) => s.status)
  const progress = useMcStore((s) => s.progress)
  const completedRuns = useMcStore((s) => s.completedRuns)
  const lastThroughput = useMcStore((s) => s.lastThroughput)

  const nodes = useGraphStore((s) => s.nodes)
  const graphPools = useMemo(
    () =>
      nodes
        .filter((n) => n.data.kind === 'pool')
        .map((n) => ({ id: n.id, label: n.data.label })),
    [nodes],
  )

  const [estimate, setEstimate] = useState<CostEstimate | null>(null)
  const [estimating, setEstimating] = useState(false)
  const probeRef = useRef<AbortController | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  // debounced cost probe — on open and on any config change
  useEffect(() => {
    if (!open) return
    probeRef.current?.abort()
    const ac = new AbortController()
    probeRef.current = ac
    setEstimating(true)
    const t = window.setTimeout(async () => {
      const g = useGraphStore.getState()
      const prior =
        lastThroughput && lastThroughput.rev === g.simulationRev
          ? { msPerRunStep: lastThroughput.msPerRunStep }
          : undefined
      try {
        const e = await estimateMonteCarloCost(g.nodes, g.edges, config, { signal: ac.signal, prior })
        if (!ac.signal.aborted) setEstimate(e)
      } finally {
        if (!ac.signal.aborted) setEstimating(false)
      }
    }, 300)
    return () => {
      window.clearTimeout(t)
      ac.abort()
    }
  }, [open, config, lastThroughput])

  // Escape closes (does NOT cancel a run); Tab trapped; focus returns to the
  // strip's Monte Carlo button — or, where the row folds it (docs/workbench.md
  // §WB7), to the Run menu it is reached from, or ⋯ holding that menu: a
  // folded button cannot take focus, which then fell to <body> (2026-10-20)
  useDialogFocus(open, dialogRef, close, () => {
    const shown = (el: HTMLElement | null) => (el && el.getClientRects().length > 0 ? el : null)
    return (
      shown(document.querySelector<HTMLButtonElement>('.pstrip__mc button')) ??
      shown(document.querySelector<HTMLButtonElement>('[data-menu="run"] > .wb-mb')) ??
      shown(document.querySelector<HTMLButtonElement>('.toolbar__overflow-btn'))
    )
  })

  if (!open) return null

  const running = status === 'running'
  const overLimit = estimate?.overLimit ?? false
  // the fields' range rule, unchanged by #422: a whole number, at least `lo`.
  // The fields set it on Enter or blur only; a blank or non-finite text never
  // gets here (`DraftNumberInput`, `commitOnConfirm`)
  const num = (n: number, lo: number) => Math.max(lo, Math.floor(n))

  // tracked-Pool selection. `tracked: []` is the canonical "all" (auto-tracks
  // Pools added later); a strict subset is stored as an explicit graph-order id
  // list. The last remaining Pool cannot be unchecked.
  const allIds = graphPools.map((p) => p.id)
  const trackAll = config.tracked.length === 0
  const isTracked = (id: string) => trackAll || config.tracked.includes(id)
  const onCount = graphPools.filter((p) => isTracked(p.id)).length
  const noPools = graphPools.length === 0

  const toggleTracked = (id: string) => {
    const on = new Set(graphPools.filter((p) => isTracked(p.id)).map((p) => p.id))
    if (on.has(id)) {
      if (on.size <= 1) return // keep at least one
      on.delete(id)
    } else {
      on.add(id)
    }
    setConfig({ tracked: on.size === allIds.length ? [] : allIds.filter((x) => on.has(x)) })
  }

  return (
    <DialogScrim onMouseDown={close}>
      <div
        ref={dialogRef}
        className="mcdlg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mcdlg-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mcdlg__head">
          <span id="mcdlg-title">{t('mc.title')}</span>
          <button type="button" className="mcdlg__x" onClick={close} aria-label={t('mc.close')}>
            <Icon name="close" />
          </button>
        </div>

        {/* docs/contextual-inline-help.md §CIH3 #2 — first-open orientation
            for a dialog the guided tour deliberately skips (§GT10). */}
        <InlineHintNote id="mc-first-open" trigger={open}>
          {t('hint.mc.body')}
        </InlineHintNote>

        <div className="mcdlg__body">
          <label className="mcdlg__field">
            <span>{t('mc.field.runs')}</span>
            <DraftNumberInput
              min={1}
              step={50}
              value={config.runs}
              disabled={running}
              allowEmpty={false}
              commitOnConfirm
              onCommit={(n) => {
                if (n != null) setConfig({ runs: num(n, 1) })
              }}
            />
          </label>
          <label className="mcdlg__field">
            <span>{t('mc.field.steps')}</span>
            <DraftNumberInput
              min={1}
              step={5}
              value={config.steps}
              disabled={running}
              allowEmpty={false}
              commitOnConfirm
              onCommit={(n) => {
                if (n != null) setConfig({ steps: num(n, 1) })
              }}
            />
          </label>
          <label className="mcdlg__field">
            <span>{t('mc.field.baseSeed')}</span>
            <DraftNumberInput
              min={0}
              step={1}
              value={config.baseSeed}
              disabled={running}
              allowEmpty={false}
              commitOnConfirm
              onCommit={(n) => {
                if (n != null) setConfig({ baseSeed: num(n, 0) })
              }}
            />
          </label>
          <div className="mcdlg__pools">
            <div className="mcdlg__poolshead">
              <span>
                {noPools
                  ? t('mc.pools.head')
                  : trackAll
                    ? t('mc.pools.headAll')
                    : t('mc.pools.headSome', { n: onCount, total: graphPools.length })}
              </span>
              <button
                type="button"
                className="mcdlg__selectall"
                disabled={running || trackAll || noPools}
                onClick={() => setConfig({ tracked: [] })}
              >
                {t('mc.pools.selectAll')}
              </button>
            </div>
            {noPools ? (
              <p className="mcdlg__note">{t('mc.pools.none')}</p>
            ) : (
              <>
                <div className="mcdlg__poollist" role="group" aria-label={t('mc.pools.group')}>
                  {graphPools.map((p) => {
                    const on = isTracked(p.id)
                    const last = on && onCount === 1
                    return (
                      <label
                        key={p.id}
                        className="mcdlg__pool"
                        dir="auto"
                        title={last ? t('mc.pools.keepOne') : undefined}
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={running || last}
                          onChange={() => toggleTracked(p.id)}
                        />
                        {p.label}
                      </label>
                    )
                  })}
                </div>
                <p className="mcdlg__note">{t('mc.pools.keepOne')}</p>
              </>
            )}
          </div>

          <div className={`mcdlg__cost${overLimit ? ' is-over' : ''}`}>
            {estimating && !estimate ? (
              <span>{t('mc.cost.estimating')}</span>
            ) : estimate ? (
              <>
                {estimate.source !== 'none' ? (
                  // #419 item 3 — over the memory limit nothing was probed, so
                  // there is no time band: the memory line and its warning only
                  <span className="mcdlg__costline">
                    <span className="mcdlg__costlabel">
                      {estimate.source === 'measured' ? t('mc.cost.measured') : t('mc.cost.benchmark')}
                    </span>
                    <b dir="ltr">~{fmtMs(estimate.lowMs)}–{fmtMs(estimate.highMs)}</b>
                  </span>
                ) : null}
                <span className="mcdlg__costline">
                  <span className="mcdlg__costlabel">{t('mc.cost.execution')}</span>
                  <span className="mcdlg__path">
                    {estimate.path === 'parallel'
                      ? t('mc.cost.parallel', { workers: estimate.workers })
                      : estimate.fileProtocol
                        ? t('mc.cost.localPause')
                        : t('mc.cost.local')}
                  </span>
                </span>
                <span className="mcdlg__costline">
                  <span className="mcdlg__costlabel">{t('mc.cost.memory')}</span>
                  <span dir="ltr">
                    ~{fmtBytes(estimate.memoryBytes)}
                    {overLimit ? <span className="mcdlg__over">{t('mc.cost.overLimit')}</span> : null}
                  </span>
                </span>
              </>
            ) : (
              <span>—</span>
            )}
          </div>

          {running ? (
            <div
              className="mcdlg__progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
              aria-live="polite"
            >
              <span className="mcdlg__bar" style={{ width: `${progress * 100}%` }} />
              <span className="mcdlg__pct" dir="ltr">
                {completedRuns} / {config.runs}
              </span>
            </div>
          ) : null}
        </div>

        {refusedCount > 0 ? (
          <p className="mcdlg__note mcdlg__refused" role="status">
            {groupRefusedCount > 0
              ? t('playbar.refused', { n: groupRefusedCount })
              : kindRefusedCount > 0
                ? t('playbar.refused.kinds', { n: kindRefusedCount })
                : timetableRefusals.length > 0
                  ? timetableRefusalText(timetableRefusals[0], timetables, t)
                  : runRefusalText(runRefusals[0], useGraphStore.getState().nodes, t)}
          </p>
        ) : null}

        <div className="mcdlg__foot">
          {running ? (
            <button type="button" className="btn" onClick={cancel}>
              {t('mc.cancel')}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--primary btn--run"
              disabled={overLimit || noPools || refusedCount > 0 || (estimating && !estimate)}
              onClick={() => void run()}
            >
              {t('mc.run', { runs: config.runs })}
            </button>
          )}
          <button type="button" className="btn" onClick={close}>
            {running ? t('mc.closeKeepRunning') : t('mc.close')}
          </button>
        </div>
      </div>
    </DialogScrim>
  )
}
