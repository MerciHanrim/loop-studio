import { describe, expect, it } from 'vitest'
import { blocksCanvasKey, isModalOpen, isTypingTarget } from './keyboardTarget'

// §LGR6.6 — the two guards every destructive canvas key passes. The dialog one
// is the fix for audit finding F3: React Flow's own delete handler listens on
// `document` and only skips text inputs, so a dialog's Cancel button was enough
// to delete the node behind it. Both helpers are pure DOM reads, so they are
// exercised here against stubs (this suite has no browser environment; the
// real markup is covered by `e2e/frame-a11y.spec.ts`).

const el = (tagName: string, isContentEditable = false) =>
  ({ tagName, isContentEditable }) as unknown as EventTarget

/** a `Document` stand-in whose `querySelector` answers for a fixed selector list */
const doc = (...present: string[]) =>
  ({
    querySelector: (sel: string) => (sel.split(', ').some((s) => present.includes(s)) ? {} : null),
  }) as unknown as Document

describe('isTypingTarget', () => {
  it('is true for the browser-editing controls', () => {
    expect(isTypingTarget(el('INPUT'))).toBe(true)
    expect(isTypingTarget(el('TEXTAREA'))).toBe(true)
    expect(isTypingTarget(el('SELECT'))).toBe(true)
    expect(isTypingTarget(el('DIV', true))).toBe(true)
  })

  it('is false for everything else, including a focused button', () => {
    expect(isTypingTarget(el('BUTTON'))).toBe(false)
    expect(isTypingTarget(el('DIV'))).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })
})

describe('isModalOpen', () => {
  it('is false with nothing over the canvas', () => {
    expect(isModalOpen(doc())).toBe(false)
  })

  it.each(['.mcdlg__scrim', '.review-scrim', '[role="dialog"]', '[aria-modal="true"]'])(
    'is true for %s',
    (sel) => {
      expect(isModalOpen(doc(sel))).toBe(true)
    },
  )
})

describe('blocksCanvasKey', () => {
  it('blocks while typing even with no dialog', () => {
    expect(blocksCanvasKey(el('INPUT'), doc())).toBe(true)
  })

  it('blocks a plain button while a dialog is open (F3)', () => {
    expect(blocksCanvasKey(el('BUTTON'), doc('.mcdlg__scrim'))).toBe(true)
  })

  it('lets a canvas key through when nothing is in the way', () => {
    expect(blocksCanvasKey(el('DIV'), doc())).toBe(false)
  })
})
