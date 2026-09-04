import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMcStore } from './mcStore'
import { selectOverlay, useUiStore } from './uiStore'

// docs/mobile.md §MV5 / §MV-D11 — mutual exclusion, and the MC dialog is part
// of it even though it lives in mcStore.

beforeEach(() => {
  useUiStore.setState({ overlay: 'none' })
  useMcStore.setState({ dialogOpen: false })
})

describe('uiStore — exclusive mobile overlay', () => {
  it('opening one overlay replaces any other', () => {
    useUiStore.getState().openOverlay('more')
    expect(selectOverlay(useUiStore.getState())).toBe('more')
    useUiStore.getState().openOverlay('timeline')
    expect(selectOverlay(useUiStore.getState())).toBe('timeline')
    useUiStore.getState().openOverlay('export')
    expect(selectOverlay(useUiStore.getState())).toBe('export')
  })

  it('toggleOverlay closes when the same overlay is already open', () => {
    useUiStore.getState().toggleOverlay('more')
    expect(useUiStore.getState().overlay).toBe('more')
    useUiStore.getState().toggleOverlay('more')
    expect(useUiStore.getState().overlay).toBe('none')
  })

  it('opening any overlay dismisses the Monte-Carlo dialog', () => {
    const close = vi.spyOn(useMcStore.getState(), 'closeDialog')
    useMcStore.setState({ dialogOpen: true })
    useUiStore.getState().openOverlay('templates')
    expect(close).toHaveBeenCalled()
    expect(useMcStore.getState().dialogOpen).toBe(false)
    expect(useUiStore.getState().overlay).toBe('templates')
  })

  it('closeOverlay(name) only closes when that name is the open one', () => {
    useUiStore.getState().openOverlay('share')
    useUiStore.getState().closeOverlay('templates') // not the open one — no-op
    expect(useUiStore.getState().overlay).toBe('share')
    useUiStore.getState().closeOverlay('share')
    expect(useUiStore.getState().overlay).toBe('none')
  })

  it('closeOverlay() with no argument clears whatever is open', () => {
    useUiStore.getState().openOverlay('more')
    useUiStore.getState().closeOverlay()
    expect(useUiStore.getState().overlay).toBe('none')
  })
})

describe('uiStore — canvasLocked (edit-lock, UI-only)', () => {
  beforeEach(() => useUiStore.setState({ canvasLocked: false }))

  it('defaults to false; set / toggle flip it', () => {
    const s = () => useUiStore.getState()
    expect(s().canvasLocked).toBe(false)
    s().setCanvasLocked(true)
    expect(s().canvasLocked).toBe(true)
    s().toggleCanvasLocked()
    expect(s().canvasLocked).toBe(false)
    s().toggleCanvasLocked()
    expect(s().canvasLocked).toBe(true)
  })

  it('setCanvasLocked to the same value is a no-op (stable reference)', () => {
    useUiStore.getState().setCanvasLocked(true)
    const before = useUiStore.getState()
    useUiStore.getState().setCanvasLocked(true)
    expect(useUiStore.getState()).toBe(before)
  })
})

describe('uiStore — focusMode (large-graph readability, UI-only)', () => {
  beforeEach(() => {
    try {
      localStorage.removeItem('loop-studio:focus-mode')
    } catch {
      /* jsdom always has it */
    }
    useUiStore.setState({ focusMode: false })
  })

  it('defaults to false; set / toggle flip it', () => {
    const s = () => useUiStore.getState()
    expect(s().focusMode).toBe(false)
    s().setFocusMode(true)
    expect(s().focusMode).toBe(true)
    s().toggleFocusMode()
    expect(s().focusMode).toBe(false)
    s().toggleFocusMode()
    expect(s().focusMode).toBe(true)
  })

  it('setFocusMode to the same value is a no-op (stable reference)', () => {
    useUiStore.getState().setFocusMode(true)
    const before = useUiStore.getState()
    useUiStore.getState().setFocusMode(true)
    expect(useUiStore.getState()).toBe(before)
  })

  // localStorage persistence to `loop-studio:focus-mode` (§LGR3.4) is covered by
  // e2e/large-graph-readability.spec.ts — the store test env has no localStorage
  // and the read/write helpers are try/catch-guarded for exactly that.
})

describe('uiStore — Inputs / Summary panels (docs/module-system.md §MS5)', () => {
  beforeEach(() => {
    try {
      localStorage.removeItem('loop-studio:inputs-panel')
      localStorage.removeItem('loop-studio:summary-panel')
    } catch {
      /* node env has no localStorage */
    }
    useUiStore.setState({ inputsPanelOpen: true, summaryPanelOpen: true })
  })

  it('both default open; each toggle flips independently', () => {
    const s = () => useUiStore.getState()
    expect(s().inputsPanelOpen).toBe(true)
    expect(s().summaryPanelOpen).toBe(true)

    s().toggleInputsPanel()
    expect(s().inputsPanelOpen).toBe(false)
    expect(s().summaryPanelOpen).toBe(true) // unaffected

    s().toggleSummaryPanel()
    expect(s().inputsPanelOpen).toBe(false)
    expect(s().summaryPanelOpen).toBe(false)

    s().toggleInputsPanel()
    expect(s().inputsPanelOpen).toBe(true)
  })

  // localStorage persistence (`loop-studio:inputs-panel` / `:summary-panel`) is
  // covered by e2e/model-panels.spec.ts — same reason as focusMode above.
})

describe('uiStore — panMode (docs/dense-graph-pan.md — session-only)', () => {
  beforeEach(() => useUiStore.setState({ panMode: false }))

  it('defaults to false; set / toggle flip it', () => {
    const s = () => useUiStore.getState()
    expect(s().panMode).toBe(false)
    s().togglePanMode()
    expect(s().panMode).toBe(true)
    s().togglePanMode()
    expect(s().panMode).toBe(false)
    s().setPanMode(true)
    expect(s().panMode).toBe(true)
  })

  it('setPanMode to the same value is a no-op (stable reference)', () => {
    useUiStore.getState().setPanMode(true)
    const before = useUiStore.getState()
    useUiStore.getState().setPanMode(true)
    expect(useUiStore.getState()).toBe(before)
  })

  it('never touches localStorage — session-only', () => {
    // the node test env has no `localStorage`; give it one and assert the
    // panMode setters read/write nothing (focusMode etc. would call setItem).
    const calls: string[] = []
    const fake = {
      getItem: (k: string) => {
        calls.push(`get:${k}`)
        return null
      },
      setItem: (k: string) => {
        calls.push(`set:${k}`)
      },
      removeItem: (k: string) => {
        calls.push(`remove:${k}`)
      },
    }
    vi.stubGlobal('localStorage', fake)
    try {
      useUiStore.getState().togglePanMode()
      useUiStore.getState().setPanMode(false)
      useUiStore.getState().setPanMode(true)
    } finally {
      vi.unstubAllGlobals()
    }
    expect(calls).toEqual([])
  })
})
