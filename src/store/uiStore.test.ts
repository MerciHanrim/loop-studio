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
