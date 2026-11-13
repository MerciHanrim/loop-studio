import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useGraphStore } from '../store/graphStore'
import { kindFindingEdgeId, kindFindingNodeId } from '../model/kinds'
import { useMcStore } from '../store/mcStore'
import { useSimStore } from '../store/simStore'
import { useT } from '../i18n'
import { isolateAuto } from '../i18n/bidiIsolate'
import { documentPoolAmounts, runNoticeText, runRefusalText, runStreak, timetableNoticeText, timetableRefusalText } from '../ui/runMessages'
import { Icon } from '../ui/icons'
import { topOverlay } from '../ui/overlayStack'
import { DraftNumberInput } from './DraftNumberInput'
import { checkedRangeOf } from '../model/runGuide'
import { phaseTexts, shownPhase } from '../ui/runPhase'
// measured on the children's boxes: a right-to-left row spills on its start
// side, which `scrollWidth` does not count (ar-XB at 900 px, 2026-10-20)
import { fitsRow } from './workbench/toolRowFit'
import { useReactFlow } from '@xyflow/react'
import { enterObserve, leaveObserve, useObserve } from './workbench/panelLayout'
import { anyMenuOpenSelector, useMenuOpenStore } from './toolbar/menuOpenStore'

// P2 — playback lives in the chart-header strip, treated as part of the time
// axis rather than the editing toolbar.

// The slider maps to `speedMs` (the per-step beat, docs/simulation-playback.md
// §PB6 — wall-clock only; the engine / RNG / MC result is byte-identical at any
// speed). Range: 120 ms/step (fastest) … 2400 ms/step (slowest — ~1 change you
// can follow by eye), still available for detailed step-by-step observation
// or debugging. The default (simStore, `speedMs`) is 600 — a brisk-but-still-
// followable middle ground, NOT the slowest stop: a fresh document / template
// opening at the slowest possible speed reads as sluggish for the common case
// (a large graph, or a many-run Monte Carlo comparison) where the point is to
// see the aggregate result quickly, not linger on every single step.
const SPEED_MIN = 120
const SPEED_MAX = 2400
const toSlider = (ms: number) => SPEED_MIN + SPEED_MAX - ms
const fromSlider = (v: number) => SPEED_MIN + SPEED_MAX - v

type Props = {
  collapsed: boolean
  onToggleCollapse: () => void
}

// The run row is ONE row at every desktop width (Lumi, 2026-10-20). Short of
// room it gives up, in steps, what has another way in — never Reset, Step,
// Play, the current step or the run's STATE beside it (the steady state: the
// run's state comes before its settings, Lumi 2026-10-20):
//   1 — the Monte-Carlo button (Run ▸ Monte Carlo… opens the same dialog;
//       a run in progress keeps its progress and Cancel here)
//   2 — also Speed and Seed, folded into "Run settings" (the same two inputs,
//       in a popover over the row)
//   3 — also the Observation view toggle (#538, Lumi 2026-11-10: View ▸
//       Observation view is always there; in the view the row has room and the
//       toggle comes back)
//   4 — last, the steady-state text may shorten (an ellipsis, its whole text
//       on the tooltip and announced as before)
// The step is the first that fits, measured on the row itself after every
// render: the step readout, the ended note and a Monte-Carlo progress change
// its width as a run goes on. The steady-state status keeps its room whether
// shown or not, so it never moves a control when it appears.
const RUN_ROW_STEPS = 4
function fitRunRow(row: HTMLElement): void {
  for (let step = 0; step <= RUN_ROW_STEPS; step++) {
    if (step === 0) delete row.dataset.fit
    else row.dataset.fit = String(step)
    if (fitsRow(row)) return
  }
}

export function PlayBar({ collapsed, onToggleCollapse }: Props) {
  const status = useSimStore((s) => s.status)
  const stepIndex = useSimStore((s) => s.stepIndex)
  const speedMs = useSimStore((s) => s.speedMs)
  const seed = useSimStore((s) => s.seed)
  const steadyState = useSimStore((s) => s.steadyState)
  const initError = useSimStore((s) => s.initError)
  // #471 (Deploy 2, F1) — a refused Converter group: Play / Step do not start;
  // one line names the shape, Show selects the first group's split
  const refusals = useSimStore((s) => s.refusals)
  // loop-model/3 (SEMANTICS-M3.md §M3-4) — a kind finding that refuses the
  // run, the same line; Show selects the finding's node (or its connection)
  const kindRefusals = useSimStore((s) => s.kindRefusals)
  // loop-model/5 (SEMANTICS-M5.md §M5-5) — a table line that refuses the run, the
  // same line; Show selects the connection
  const timetableRefusals = useSimStore((s) => s.timetableRefusals)
  // loop-model/6 (SEMANTICS-M6.md §M6-3) — a rule that refuses the run; Show selects its stage
  const runRefusals = useSimStore((s) => s.runRefusals)
  const timetables = useGraphStore((s) => s.timetables)
  // #537 — the run guide (model/runGuide.ts): the pause auto-play made at the run's first
  // stop of a core process, and the note past the steps a bundled example is checked over,
  // which holds only while the document's model is the example's
  const autoPause = useSimStore((s) => s.autoPause)
  const gNodes = useGraphStore((s) => s.nodes)
  const gEdges = useGraphStore((s) => s.edges)
  const gKinds = useGraphStore((s) => s.kinds)
  const gTime = useGraphStore((s) => s.time)
  const gVersion = useGraphStore((s) => s.modelVersion)
  const checkedRange = useMemo(() => checkedRangeOf({ nodes: gNodes, edges: gEdges, kinds: gKinds, time: gTime, timetables }, gVersion), [gNodes, gEdges, gKinds, gTime, timetables, gVersion])
  const refused =refusals.length > 0 || kindRefusals.length > 0 || timetableRefusals.length > 0 || runRefusals.length > 0
  const showRefused = () => {
    const g = refusals[0]
    if (g) return useGraphStore.getState().setSelection(g.split ?? g.members[0], null)
    const f = kindRefusals[0]
    if (f) {
      const nodeId = kindFindingNodeId(f)
      useGraphStore.getState().setSelection(nodeId, nodeId ? null : kindFindingEdgeId(f))
      return
    }
    const line = timetableRefusals[0]
    if (line) return useGraphStore.getState().setSelection(null, line.edgeId)
    const rule = runRefusals[0]
    if (rule) useGraphStore.getState().setSelection(rule.stage, null)
  }
  const cannotRun = initError != null || refused
  const engineDiagnostics = useSimStore((s) => s.diagnostics)
  const notices = useSimStore((s) => s.notices)
  const play = useSimStore((s) => s.play)
  const pause = useSimStore((s) => s.pause)
  const stepOnce = useSimStore((s) => s.stepOnce)
  const reset = useSimStore((s) => s.reset)
  const setSpeed = useSimStore((s) => s.setSpeed)
  const setSeed = useSimStore((s) => s.setSeed)

  const mcStatus = useMcStore((s) => s.status)
  const mcProgress = useMcStore((s) => s.progress)
  const mcMessage = useMcStore((s) => s.message)
  const openMcDialog = useMcStore((s) => s.openDialog)
  const cancelMc = useMcStore((s) => s.cancel)
  const mcRunning = mcStatus === 'running'
  const t = useT()
  // the refusal line: a split that rejoins first, else the kind findings (loop-model/3)
  const refusedText =
    refusals.length > 0
      ? t('playbar.refused', { n: refusals.length })
      : kindRefusals.length > 0
        ? t('playbar.refused.kinds', { n: kindRefusals.length })
        : timetableRefusals.length > 0
          ? timetableRefusalText(timetableRefusals[0], timetables, t)
          : runRefusals.length > 0
            ? runRefusalText(runRefusals[0], useGraphStore.getState().nodes, t)
            : ''
  // #471 (Deploy 2) — the engine's structured notices, worded here in the
  // user's language (the node label isolated), ahead of the English engine
  // diagnostics in the same list
  const diagnostics = useMemo(
    () => [
      ...notices.map((x) =>
        x.kind === 'runHeld' || x.kind === 'runCapped'
          ? runNoticeText(x, runStreak(useSimStore.getState().series, x.group), t, documentPoolAmounts())
          : x.kind === 'timetableEnded' || x.kind === 'timetableUnmet'
          ? timetableNoticeText(x, t)
          : t(x.kind === 'multiSupplyHeld' ? 'playbar.diag.multiSupplyHeld' : 'playbar.diag.multiSupplyLoss', {
              label: isolateAuto(x.label),
              amount: x.amount,
            }),
      ),
      ...engineDiagnostics,
    ],
    [notices, engineDiagnostics, t],
  )

  const running = status === 'running'
  const ended = status === 'ended'

  // the step the timeline was last open at: the run going past it while the
  // timeline is folded is a new result; a reset below it clears the mark
  // (adjusted while rendering, React's pattern for state that follows a prop)
  const [seenStep, setSeenStep] = useState(stepIndex)
  if ((!collapsed || stepIndex < seenStep) && seenStep !== stepIndex) setSeenStep(stepIndex)
  const newResult = collapsed && stepIndex > seenStep
  const collapseLabel = collapsed
    ? newResult
      ? `${t('playbar.timeline.show')}, ${t('playbar.timeline.newResult')}`
      : t('playbar.timeline.show')
    : t('playbar.timeline.hide')

  // docs/simulation-playback-ordering.md §PBO5 — the "Steady state — flows
  // continue" status, beside the current step. Its room is kept whether it is
  // shown or not (`visibility`), so it never shifts a control or the strip
  // height when it appears; the row folds its settings to keep it (above).
  // (Until 2026-10-20 it was out of flow and hidden wherever it would meet a
  // control — at 1280 × 800 with the default panels, always.)
  const stripRef = useRef<HTMLDivElement>(null)
  const showSteady = steadyState && running

  // docs/run-phases.md — the phase the document's author named for the current step, in
  // the same room: the step readout keeps its place and no control moves. A state wording
  // comes first (the steady state here; the end is on the step readout), and the phase is
  // then not shown. Where a name has no room it is never cut: EVERY phase of the document
  // then shows as one small button whose press or focus opens the name and range, so the
  // form does not change from step to step (Lumi, 2026-11-13). Judged again after every
  // render and on a window resize, with the row's fit below.
  const phases = useGraphStore((s) => s.phases)
  const phase = showSteady ? null : shownPhase(phases, stepIndex, ended, cannotRun)
  const phaseText = phase ? phaseTexts(phase, t) : null
  const stateRef = useRef<HTMLSpanElement>(null)
  const phaseProbeRef = useRef<HTMLSpanElement>(null)
  const phaseBtnRef = useRef<HTMLButtonElement>(null)
  const phasePopRef = useRef<HTMLDivElement>(null)
  const [phaseAsButton, setPhaseAsButton] = useState(false)
  // the button's popover: pressed open, or shown while the keyboard focus or the pointer is on it
  const [phasePinned, setPhasePinned] = useState(false)
  const [phasePeek, setPhasePeek] = useState(false)
  const phaseOpen = phase != null && phaseAsButton && (phasePinned || phasePeek)
  const phasePopId = useId()
  const phaseNoteId = useId()
  // the popover belongs to the phase it was opened on: another phase, or none, closes it
  const [phaseOpenedOn, setPhaseOpenedOn] = useState<string | null>(null)
  if ((phase?.id ?? null) !== phaseOpenedOn) {
    setPhaseOpenedOn(phase?.id ?? null)
    if (phasePinned) setPhasePinned(false)
  }
  useEffect(() => {
    if (!phaseOpen) return
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (phaseBtnRef.current?.contains(target) || phasePopRef.current?.contains(target)) return
      setPhasePinned(false)
      setPhasePeek(false)
    }
    const onKey = (e: KeyboardEvent) => {
      // as the run settings popover below: an overlay above takes its own Escape first
      if (e.key !== 'Escape' || topOverlay() != null) return
      e.stopPropagation()
      setPhasePinned(false)
      setPhasePeek(false)
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [phaseOpen])
  // the button goes when the phase does (the end, the steady state, a wider room): focus
  // that was on it is not left on nothing, it moves to Play beside it
  const primaryBtnRef = useRef<HTMLButtonElement>(null)
  const phaseBtnFocused = useRef(false)
  useLayoutEffect(() => {
    const btn = phaseBtnRef.current
    if (btn) {
      phaseBtnFocused.current = document.activeElement === btn
      return
    }
    if (!phaseBtnFocused.current) return
    phaseBtnFocused.current = false
    const a = document.activeElement
    if (!a || a === document.body) primaryBtnRef.current?.focus()
  })

  // Re-check after every render (PlayBar re-renders on step / status / speed /
  // seed / MC changes — frequent enough during a run that a stale verdict
  // self-corrects within a frame) and on window resize. No ResizeObserver — a
  // measure that also `setState`s inside an RO callback trips the benign
  // "ResizeObserver loop" warning, and the render-driven re-check is enough here.
  // "Run settings" (fit step 2): Speed and Seed in a popover
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsId = useId()
  const settingsBtnRef = useRef<HTMLButtonElement>(null)
  const settingsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!settingsOpen) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (settingsRef.current?.contains(t) || settingsBtnRef.current?.contains(t)) return
      setSettingsOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // issue #413 (Lumi, 2026-10-30) — the popover is not an overlay-stack
      // entry; while a dialog or a sheet is open above it the Escape is theirs:
      // this capture listener must neither close the popover nor stop the
      // event (it runs before the dialog's own listener). The next Escape,
      // with the stack empty again, closes the popover and returns the focus.
      if (topOverlay() != null) return
      e.stopPropagation()
      setSettingsOpen(false)
      settingsBtnRef.current?.focus()
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [settingsOpen])

  useLayoutEffect(() => {
    const strip = stripRef.current
    if (!strip) return
    const measure = () => {
      fitRunRow(strip)
      // a fold the row no longer needs closes its popover
      if (strip.dataset.fit !== '2' && strip.dataset.fit !== '3' && strip.dataset.fit !== '4' && settingsOpen) setSettingsOpen(false)
      // the open popover stands over its button (2026-10-20: it was pinned to
      // the row's start, and drifted from the button once the steady state
      // took its room beside the step), pulled in where the row's end is near
      const btn = settingsBtnRef.current
      const pop = settingsRef.current
      if (settingsOpen && btn && pop) {
        const room = strip.clientWidth - pop.offsetWidth - 12
        pop.style.left = `${Math.max(12, Math.min(btn.offsetLeft, room))}px`
        pop.style.right = 'auto'
      } else if (pop) {
        pop.style.left = ''
        pop.style.right = ''
      }
      // docs/run-phases.md — after the fit, which sets the room's width: does every phase
      // name of the document fit the room? One that does not turns them all into the button
      const room = stateRef.current
      const probe = phaseProbeRef.current
      if (room && probe && room.clientWidth > 0) {
        const cs = getComputedStyle(probe)
        const space = probe.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
        let widest = 0
        for (const el of probe.children) widest = Math.max(widest, el.getBoundingClientRect().width)
        const asButton = widest > space + 0.5
        setPhaseAsButton((was) => (was === asButton ? was : asButton))
      }
      // the open phase popover stands over its button, pulled in at the row's end
      const pbtn = phaseBtnRef.current
      const ppop = phasePopRef.current
      if (pbtn && ppop && room) {
        const at = room.offsetLeft + pbtn.offsetLeft
        ppop.style.left = `${Math.max(12, Math.min(at, strip.clientWidth - ppop.offsetWidth - 12))}px`
      }
    }
    measure()
    const onResize = () => requestAnimationFrame(measure)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  })

  const onPrimary = () => {
    if (ended) {
      reset()
      play()
    } else if (running) {
      pause()
    } else {
      play()
    }
  }

  // §PBO5 accessibility — announce ONCE on first entry into `steadyState &&
  // running`. If the detector turns true while stopped (e.g. the user stepped
  // manually to a fixed point) nothing is spoken — the chip is hidden and it
  // would be wrong to read "flows continue" while paused; pressing Play then
  // announces it. Pause → Resume is the same steady verdict → no re-announce.
  // The "already announced" flag resets only when `steadyState` goes false, so
  // a genuine re-settle after a disruption does announce again.
  const [announce, setAnnounce] = useState('')
  const announcedRef = useRef(false)
  useEffect(() => {
    if (!steadyState) {
      announcedRef.current = false
      setAnnounce('') // '' → string next time is a real change, so SR re-announces
      return
    }
    if (running && !announcedRef.current) {
      announcedRef.current = true
      setAnnounce(t('playbar.steady'))
    }
  }, [steadyState, running, t])

  // #537 — the two guide lines, kept in view under the run row; each is read to a screen
  // reader once, from its own always-mounted status region (a region whose text does not
  // change is not read again)
  const pauseText = autoPause
    ? t(autoPause.pool ? (autoPause.cause === 'supply' ? 'playbar.guide.pausedSupply' : 'playbar.guide.pausedRoom') : 'playbar.guide.paused', {
        step: autoPause.step,
        stage: isolateAuto(autoPause.stage),
        pool: isolateAuto(autoPause.pool ?? ''),
      })
    : ''
  const checkedText = checkedRange && stepIndex > checkedRange.steps ? t('playbar.guide.checked', { days: checkedRange.days, steps: checkedRange.steps }) : ''

  // #538 — the observation view's toggle (Lumi, 2026-11-10: a text button, no icon). The view
  // hides both panels and the tool row (workbench/panelLayout.ts); the canvas keeps its zoom
  // and the model point at its centre (Canvas.tsx)
  const observing = useObserve((s) => s.on)
  const { getViewport } = useReactFlow()
  const observeBtnRef = useRef<HTMLButtonElement>(null)
  const toggleObserve = () => (useObserve.getState().on ? leaveObserve() : enterObserve(getViewport()))
  // focus never stays on what the view hides: when the view comes on with focus inside a
  // hidden panel or the tool row (or already lost to the page), it moves to this toggle.
  // Before paint, while the hidden element still holds focus, so the check sees it
  useLayoutEffect(() => {
    const btn = observeBtnRef.current
    if (observing) {
      const a = document.activeElement
      if (!a || a === document.body || a.closest('[hidden]')) btn?.focus()
      return
    }
    // leaving at a width where the row folds the toggle (fit step 3, set by the fit effect
    // above in this same commit): focus on it would be left on nothing, so it goes to View,
    // the toggle's other way in
    if (btn && document.activeElement === btn && btn.getClientRects().length === 0) document.querySelector<HTMLElement>('.wb-viewmenu > .wb-mb')?.focus()
  }, [observing])
  // Esc leaves the view only when nothing is open on top: an open menu (each reports to
  // menuOpenStore), a dialog or sheet (the overlay stack) or the run-settings popover takes
  // it first. Capture phase, registered as the view is entered, so this runs before a menu
  // opened later closes itself (the View menu closes in its own capture listener without
  // marking the event; MEASURED: in the bubble phase the first Esc closed the menu and left
  // the view too)
  const settingsOpenRef = useRef(false)
  useEffect(() => {
    // either popover of the row: the run settings, or the phase button's
    settingsOpenRef.current = settingsOpen || phaseOpen
  }, [settingsOpen, phaseOpen])
  useEffect(() => {
    if (!observing) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (anyMenuOpenSelector(useMenuOpenStore.getState()) || topOverlay() != null || settingsOpenRef.current) return
      leaveObserve()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [observing])

  return (
    <>
    <div
      ref={stripRef}
      className="pstrip"
      data-placeholder="P2 — chart-header strip"
      data-tour="playback"
    >
      <div className="pstrip__group">
        <button type="button" className="pb-btn pb-btn--transport pstrip__reset" onClick={reset} title={t('playbar.reset.title')} aria-label={t('playbar.reset.title')}>
          <Icon name="run-reset" />
        </button>
        <button
          type="button"
          className="pb-btn pb-btn--transport pstrip__step-btn"
          onClick={stepOnce}
          disabled={running || cannotRun}
          title={t('playbar.step.title')}
          aria-label={t('playbar.step.title')}
        >
          <Icon name="run-step" />
        </button>
        <button
          ref={primaryBtnRef}
          type="button"
          className={`pb-btn pb-btn--transport pb-btn--primary${running ? ' is-running' : ''}`}
          onClick={onPrimary}
          disabled={cannotRun}
        >
          <Icon name={ended ? 'run-replay' : running ? 'run-pause' : 'run-play'} className="icon--lead" />
          {ended ? t('playbar.replay') : running ? t('playbar.pause') : t('playbar.play')}
        </button>
        <button ref={observeBtnRef} type="button" className="pb-btn pstrip__observe" aria-pressed={observing} onClick={toggleObserve}>
          {t('playbar.observe')}
        </button>
      </div>

      {initError != null ? (
        // the graph cannot be initialised for a run (simStore.initError — e.g.
        // a Pool with a negative `initial` from a hand-edited file). Play /
        // Step are disabled above; this names the reason (the engine's text).
        <span className="pstrip__step pstrip__initerr" role="alert" title={initError}>
          {t('playbar.initError', { detail: initError })}
        </span>
      ) : refused ? (
        // #471 (Deploy 2, F1) — a split that rejoins is refused before the run
        // (SEMANTICS.md §6 erratum, part 2): the line counts the groups, Show
        // selects the first one's split, whose Inspector note says what to
        // change. Announced when it appears, like the line above.
        <span className="pstrip__step pstrip__initerr pstrip__refused" role="alert">
          <span className="pstrip__refused-text" title={refusedText}>{refusedText}</span>
          <button type="button" className="btn btn--ghost pstrip__refused-show" onClick={showRefused}>
            {t('playbar.refused.show')}
          </button>
        </span>
      ) : (
        <span className="pstrip__step">
          {ended ? t('playbar.stepEnded', { n: stepIndex }) : t('playbar.step', { n: stepIndex })}
        </span>
      )}

      {/* the run's state beside its step: its room is kept while hidden; the
          screen reader hears it once, from the status region below */}
      <span ref={stateRef} className="pstrip__state">
        <span className={`pstrip__steady${showSteady ? ' is-on' : ''}`} aria-hidden="true" title={showSteady ? t('playbar.steady') : undefined}>
          {/* the row's last fit step shows the short wording, not an ellipsis
              (the whole text stays on the tooltip and in the status region) */}
          <span className="pstrip__steady-full">{t('playbar.steady')}</span>
          <span className="pstrip__steady-short">{t('playbar.steadyShort')}</span>
        </span>
        {/* docs/run-phases.md — every phase name of the document, unseen, in the name's own
            box: the measure above reads from it whether they all fit the room */}
        {phases.length > 0 && (
          <span ref={phaseProbeRef} className="pstrip__phase pstrip__phase--probe" aria-hidden="true">
            {phases.map((p) => (
              <span key={p.id}>{p.label}</span>
            ))}
          </span>
        )}
        {phase && phaseText && !phaseAsButton && (
          // the short name; its range and what a phase is are on the tooltip, and a screen
          // reader reads the name with its range
          <span className="pstrip__phase" data-testid="run-phase" data-phase={phase.id} title={`${phaseText.full}\n${t('playbar.phase.note')}`}>
            <span className="pstrip__phase-name" aria-hidden="true" dir="auto">
              {phase.label}
            </span>
            <span className="sr-only">{phaseText.sr}</span>
          </span>
        )}
        {phase && phaseText && phaseAsButton && (
          <>
            <button
              ref={phaseBtnRef}
              type="button"
              className={`pb-btn pstrip__phase-btn${phaseOpen ? ' is-open' : ''}`}
              data-testid="run-phase"
              data-phase={phase.id}
              aria-label={phaseText.sr}
              aria-describedby={phaseNoteId}
              aria-expanded={phaseOpen}
              aria-controls={phaseOpen ? phasePopId : undefined}
              onClick={() => {
                // pressed while only peeked at (focus, pointer): it stays; pressed while pinned: it closes
                setPhasePinned((v) => !v)
                if (phasePinned) setPhasePeek(false)
              }}
              onFocus={(e) => {
                if (e.currentTarget.matches(':focus-visible')) setPhasePeek(true)
              }}
              onBlur={() => {
                setPhasePeek(false)
                setPhasePinned(false)
              }}
              onPointerEnter={(e) => {
                if (e.pointerType === 'mouse') setPhasePeek(true)
              }}
              onPointerLeave={(e) => {
                if (e.pointerType === 'mouse' && !e.currentTarget.matches(':focus-visible')) setPhasePeek(false)
              }}
            >
              <Icon name="info" />
            </button>
            <span id={phaseNoteId} className="sr-only">
              {t('playbar.phase.note')}
            </span>
          </>
        )}
      </span>
      {phaseOpen && phaseText && (
        <div ref={phasePopRef} id={phasePopId} className="pstrip__phase-pop" role="tooltip" data-testid="run-phase-pop">
          <span className="pstrip__phase-pop-name">{phaseText.full}</span>
          <span className="pstrip__phase-pop-note">{t('playbar.phase.note')}</span>
        </div>
      )}

      <button
        ref={settingsBtnRef}
        type="button"
        className={`pb-btn pstrip__settings-btn${settingsOpen ? ' is-open' : ''}`}
        aria-expanded={settingsOpen}
        aria-controls={settingsOpen ? settingsId : undefined}
        onClick={() => setSettingsOpen((v) => !v)}
      >
        {t('playbar.settings')}
      </button>
      {/* Speed and Seed: in the row, or — folded (fit step 2) — the popover's
          content; one pair of inputs either way */}
      <div
        ref={settingsRef}
        id={settingsId}
        className={`pstrip__settings${settingsOpen ? ' is-open' : ''}`}
        role="group"
        aria-label={t('playbar.settings')}
      >
      <label className="pstrip__field">
        <span>{t('playbar.speed')}</span>
        <input
          type="range"
          min={SPEED_MIN}
          max={SPEED_MAX}
          step={20}
          value={toSlider(speedMs)}
          onChange={(e) => setSpeed(fromSlider(Number(e.target.value)))}
        />
      </label>

      <label className="pstrip__field" title={t('playbar.seed.title')}>
        <span>{t('playbar.seed')}</span>
        {/* #422 — set on Enter or leaving the field, never per keystroke (each
            new seed resets the run); a blank sets nothing. `setSeed` keeps its
            rule for a number: an integer, uint32 */}
        <DraftNumberInput
          className="pstrip__seed"
          min={0}
          step={1}
          value={seed}
          allowEmpty={false}
          commitOnConfirm
          onCommit={(n) => {
            if (n != null) setSeed(n)
          }}
        />
      </label>
      </div>

      <span className="pstrip__mc">
        {mcRunning ? (
          <>
            <span className="pstrip__mcprog" title={t('playbar.mc.progress.title')}>
              {t('playbar.mc.progress', { pct: Math.round(mcProgress * 100) })}
            </span>
            <button type="button" className="pb-btn" onClick={cancelMc}>
              {t('playbar.cancel')}
            </button>
          </>
        ) : (
          <button
            type="button"
            // a cancelled / failed run's note is the run's state, not a
            // setting: the button carrying it is not folded (2026-10-20)
            className={`pb-btn pstrip__mc-btn${mcMessage ? ' has-note' : ''}`}
            onClick={openMcDialog}
            title={t('playbar.mc.title')}
          >
            {mcMessage
              ? t('playbar.mc.withNote', {
                  note: mcMessage === 'cancelled' ? t('playbar.mc.cancelled') : t('playbar.mc.failed'),
                })
              : t('playbar.mc')}
          </button>
        )}
      </span>

      <button
        type="button"
        className={`pb-btn pstrip__collapse${newResult ? ' has-new' : ''}`}
        onClick={onToggleCollapse}
        // docs/timeline-series-contract.md §7 — the state is exposed, not only
        // implied by the swapped title (the section headers and the legend
        // trigger both expose `aria-expanded`; this one did not)
        aria-expanded={!collapsed}
        aria-label={collapseLabel}
        title={collapseLabel}
      >
        {/* folded, the button names what it opens and says when the run has
            gone on since (2026-10-25, Lumi: "결과 보기 · 새 결과" — in words,
            not by colour alone); the words go first when the row is short */}
        {collapsed && (
          <span className="pstrip__collapse-text" aria-hidden="true">
            {t('playbar.timeline.short')}
            {newResult && <> · {t('playbar.timeline.newResult')}</>}
          </span>
        )}
        {newResult && <span className="pstrip__new-dot" aria-hidden="true" />}
        <Icon name={collapsed ? 'chevron-up' : 'chevron-down'} />
      </button>

      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announce}
      </div>

    </div>
      {(pauseText || checkedText) && (
        // #537 — a block of its own under the run row, like the diagnostics below; the
        // analysis area's least height counts it (TimelineChart), so it never takes a
        // strip's room
        <div className="pstrip-guide" data-testid="run-guide">
          {pauseText && (
            <p className="pstrip-guide__line pstrip-guide__line--pause" data-guide="pause">
              {pauseText}
            </p>
          )}
          {checkedText && (
            <p className="pstrip-guide__line pstrip-guide__line--checked" data-guide="checked">
              {checkedText}
            </p>
          )}
        </div>
      )}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-guide-status="pause">
        {pauseText}
      </div>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-guide-status="checked">
        {checkedText}
      </div>
      {/* issue #396 — the engine's diagnostics for the step that produced the
          current head (simStore.diagnostics): a refused percent on a Converter
          connection names the connection, the expression and the number that
          keeps the old rate. A block of its own UNDER the strip — a sibling,
          never a child of the one-row flex strip, whose own controls would
          wrap around it — gone with Reset or the next clean step. */}
      {diagnostics.length > 0 && (
        // a bounded, scrollable region (Lumi's review of #437: many refused
        // connections must not push the canvas or the Timeline off screen);
        // every item stays in the list; focusable so the keyboard can scroll it
        <div className="pstrip-diag" data-testid="run-diagnostics" role="region" tabIndex={0} aria-label={t('playbar.diag.title', { n: diagnostics.length })}>
          <span className="pstrip__diag-title">{t('playbar.diag.title', { n: diagnostics.length })}</span>
          <ul className="pstrip__diag-list">
            {diagnostics.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
      )}
      {/* the diagnostics' own status region — always mounted (a region that
          appears with its text is not read), OUTSIDE the strip so the strip's
          one steady-state status region stays the only one in it; it reads
          the set once per change — the same text on the next step is not a
          DOM change, so a repeating diagnostic is not re-announced */}
      <div className="sr-only pstrip-diag__status" role="status" aria-live="polite" aria-atomic="true">
        {diagnostics.length > 0 ? `${t('playbar.diag.title', { n: diagnostics.length })}: ${diagnostics.join(' ')}` : ''}
      </div>
    </>
  )
}
