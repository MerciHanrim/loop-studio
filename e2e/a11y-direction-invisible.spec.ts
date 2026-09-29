import type { CDPSession, Page } from '@playwright/test'
import { expect, openApp, test } from './support/loop'

// docs/localization.md §L9.3 — the surfaces that carry text nobody can SEE.
//
// Three `.sr-only` regions and three shared `aria-describedby` targets render
// nothing: they are 1×1 and clipped away. That settles their ELEMENT DIRECTION
// (there is no visual order to get wrong, so there is no `dir` to write) and it
// settles nothing else, because these elements exist for assistive technology.
//
// This spec closes the tier BELOW the assistive technology:
//
//   * the DOM reference holds — the `aria-describedby` target exists and its id
//     is unique in the document
//   * the accessibility API agrees — the computed description, or the live
//     region's string, is EXACTLY the `textContent` the app rendered
//   * a direction change does not disturb either. `ar-XB` ships the English
//     catalogue verbatim (§L9.2), so "unchanged" is literally assertable: the
//     strings and the reference relation must come back identical
//   * a state change replaces the phrasing rather than leaving the old one
//
// What it deliberately does NOT do, and what no browser test can do: say how a
// screen reader PRONOUNCES any of this, how it segments it for navigation, or
// what a braille display puts out. The accessibility API returns a string; an
// assistive technology is a tier above it. Those remain an open, non-blocking
// obligation whose scope names its stack — a result on Windows + Chrome + NVDA
// is a result for that combination, never for "screen readers".

type Bridge = {
  __loop: {
    frame: { getState: () => { adoptFrame: (rect: Rect, label: string) => string; clear?: () => void } }
    ui: { getState: () => { setCanvasLocked: (v: boolean) => void; canvasLocked: boolean } }
    sim: { setState: (patch: Record<string, unknown>) => void; getState: () => { status: string; stepIndex: number } }
    i18n: { getState: () => { activeLocale: string; setLocale: (code: string) => void } }
  }
}
type Rect = { x: number; y: number; w: number; h: number }

const MIXED_LABEL = 'مبيعات Q1'

/** the computed accessibility node for a selector, straight from the protocol */
async function axNode(cdp: CDPSession, selector: string) {
  const doc = await cdp.send('DOM.getDocument', { depth: -1, pierce: true })
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector })
  if (!nodeId) return null
  const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false })
  const n = nodes[0]
  return n ? { role: n.role?.value, name: n.name?.value ?? '', description: n.description?.value ?? '' } : null
}

async function switchLocale(page: Page, code: string): Promise<void> {
  await page.evaluate((c) => {
    ;(window as unknown as Bridge).__loop.i18n.getState().setLocale(c)
  }, code)
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.i18n.getState().activeLocale))
    .toBe(code)
}

/** a real frame, created through the app's own store rather than injected markup */
async function makeFrame(page: Page, label: string): Promise<void> {
  await page.evaluate((l) => {
    ;(window as unknown as Bridge).__loop.frame.getState().adoptFrame({ x: 40, y: 40, w: 420, h: 260 }, l)
  }, label)
  await page.waitForSelector('.lgr-frame[role="group"]')
}

/** what the container points at, and what that target actually holds */
const describedBy = (page: Page) =>
  page.evaluate(() => {
    const c = document.querySelector('.lgr-frame[role="group"]')
    if (!c) return null
    const id = c.getAttribute('aria-describedby')
    const targets = id ? document.querySelectorAll('#' + CSS.escape(id)) : []
    return {
      id,
      idOccurrences: targets.length,
      targetText: targets[0]?.textContent ?? null,
      ariaLabel: c.getAttribute('aria-label'),
    }
  })

test.describe('direction-invisible surfaces: the DOM/AX contract', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
  })

  test('every sr-only description target exists exactly once and carries text', async ({ page }) => {
    const ids = await page.evaluate(() => {
      const spans = [...document.querySelectorAll('.sr-only [id]')] as HTMLElement[]
      return spans.map((el) => ({
        id: el.id,
        occurrences: document.querySelectorAll('#' + CSS.escape(el.id)).length,
        text: el.textContent ?? '',
      }))
    })
    expect(ids.length).toBeGreaterThanOrEqual(3)
    for (const row of ids) {
      expect(row.occurrences, `#${row.id} must be unique in the document`).toBe(1)
      expect(row.text.trim().length, `#${row.id} must carry text`).toBeGreaterThan(0)
    }
  })

  test('an editable frame is described by the SELECTED target, and the AX description is that text', async ({ page }) => {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Accessibility.enable')
    await makeFrame(page, MIXED_LABEL)
    await page.focus('.lgr-frame[role="group"]')
    await page.keyboard.press('Enter')

    const dom = await describedBy(page)
    expect(dom?.id).toBe('lgr-frame-desc-selected')
    expect(dom?.idOccurrences).toBe(1)

    const ax = await axNode(cdp, '.lgr-frame[role="group"]')
    // the reference resolves THROUGH the aria-hidden wrapper the targets live in
    expect(ax?.description).toBe(dom?.targetText)
    expect(ax?.description?.length ?? 0).toBeGreaterThan(0)
  })

  test('a READ-ONLY frame is described by the read-only target — a real product state, not a prop', async ({ page }) => {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Accessibility.enable')
    await makeFrame(page, MIXED_LABEL)

    // §AF-INV-7 / D6 — a locked canvas is what makes a frame non-editable. The
    // state is produced by the app's own action, so this is the branch users
    // reach, not a test-only shape.
    await page.evaluate(() => {
      ;(window as unknown as Bridge).__loop.ui.getState().setCanvasLocked(true)
    })
    await expect
      .poll(() => page.evaluate(() => document.querySelector('.lgr-frame[role="group"]')?.getAttribute('aria-describedby')))
      .toBe('lgr-frame-desc-readonly')

    const dom = await describedBy(page)
    expect(dom?.idOccurrences).toBe(1)
    const ax = await axNode(cdp, '.lgr-frame[role="group"]')
    expect(ax?.description).toBe(dom?.targetText)

    // and unlocking puts the editable description back - a state change must
    // replace the phrasing, not leave the previous one in place
    await page.evaluate(() => {
      ;(window as unknown as Bridge).__loop.ui.getState().setCanvasLocked(false)
    })
    await expect
      .poll(() => page.evaluate(() => document.querySelector('.lgr-frame[role="group"]')?.getAttribute('aria-describedby')))
      .not.toBe('lgr-frame-desc-readonly')
  })

  test('the frame live region carries the whole user label after a real keyboard gesture', async ({ page }) => {
    await makeFrame(page, MIXED_LABEL)
    await page.focus('.lgr-frame[role="group"]')
    await page.keyboard.press('Enter')
    await page.keyboard.press('ArrowRight')

    await expect
      .poll(() => page.evaluate(() => document.querySelector('[data-frame-announce]')?.textContent ?? ''))
      .not.toBe('')
    const announced = await page.evaluate(() => document.querySelector('[data-frame-announce]')?.textContent ?? '')
    // the user's own name survives whole - this is the string an assistive
    // technology is handed, and a broken interpolation would show up here
    expect(announced).toContain(MIXED_LABEL)
  })

  test('a locale round trip leaves the strings and the reference relation identical', async ({ page }) => {
    await makeFrame(page, MIXED_LABEL)
    await page.focus('.lgr-frame[role="group"]')
    await page.keyboard.press('Enter')

    const before = await describedBy(page)
    // the baseline must be a WORKING reference. Without this, the three
    // snapshots can be equal and equally broken - which is exactly what the
    // broken-reference injection showed.
    expect(before?.idOccurrences).toBe(1)
    expect((before?.targetText ?? '').length).toBeGreaterThan(0)
    // ar-XB ships the English catalogue verbatim (§L9.2), so these strings must
    // come back character for character. A test against a real translation
    // could only assert "something changed"; this one can assert identity.
    await switchLocale(page, 'ar-XB')
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('dir'))).toBe('rtl')
    const during = await describedBy(page)
    await switchLocale(page, 'en')
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('dir'))).toBe('ltr')
    const after = await describedBy(page)

    expect(during).toEqual(before)
    expect(after).toEqual(before)
  })

  test('the playback announcer replaces its phrasing on a state change and leaves nothing stale', async ({ page }) => {
    const read = () => page.evaluate(() => document.querySelector('[data-playback-announce]')?.textContent ?? '')
    expect(await read()).toBe('')

    await page.evaluate(() => {
      ;(window as unknown as Bridge).__loop.sim.setState({ status: 'running' })
    })
    await expect.poll(read).not.toBe('')
    const running = await read()

    await page.evaluate(() => {
      ;(window as unknown as Bridge).__loop.sim.setState({ status: 'ended' })
    })
    await expect.poll(read).not.toBe(running)
    const ended = await read()
    expect(ended).not.toBe('')
    // the old phrasing is gone, not appended
    expect(ended).not.toContain(running)
  })

  test('the steady-state region announces once, and again only after the state has gone false', async ({ page }) => {
    const read = () => page.evaluate(() => {
      const regions = [...document.querySelectorAll('.sr-only[role="status"]')] as HTMLElement[]
      const r = regions.find((el) => !el.hasAttribute('data-frame-announce') && !el.hasAttribute('data-playback-announce'))
      return r?.textContent ?? ''
    })

    await page.evaluate(() => {
      ;(window as unknown as Bridge).__loop.sim.setState({ status: 'running', steadyState: true })
    })
    await expect.poll(read).not.toBe('')
    const first = await read()

    // still steady, still running: no second announcement to make
    await page.evaluate(() => {
      ;(window as unknown as Bridge).__loop.sim.setState({ steadyState: true })
    })
    expect(await read()).toBe(first)

    // the state goes false, then true again - a genuine re-settle re-announces
    await page.evaluate(() => {
      ;(window as unknown as Bridge).__loop.sim.setState({ steadyState: false })
    })
    await expect.poll(read).toBe('')
    await page.evaluate(() => {
      ;(window as unknown as Bridge).__loop.sim.setState({ steadyState: true })
    })
    await expect.poll(read).toBe(first)
  })
})
