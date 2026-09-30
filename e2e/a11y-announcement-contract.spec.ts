import type { CDPSession, Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// docs/localization.md §L9.3 - the announcement contract for the seven surfaces
// that carry text nobody can SEE.
//
// SCOPE, stated once because the value of this spec depends on it:
//
//   verified here : the DOM string the app renders, and Chrome's own
//                   accessibility tree over CDP
//   NOT verified  : the Windows UI Automation payload, and therefore anything
//                   about NVDA, speech or braille. A green run here is NOT a
//                   claim that a screen reader reads any of this correctly.
//                   That tier is issue #290, manual, and deliberately
//                   non-blocking.
//
// The spec is locale-parameterized. `ar` is the locale the isolates were added
// for; `en` is the LTR control. Adding a locale is adding a row to LOCALES -
// retro-running it over the other shipped locales is deliberately out of scope.

const LOCALES = ['ar', 'en'] as const

// exactly these seven sites, and exactly 26 product paths across them
const SITES = [
  'frame-announce',
  'playback-announce',
  'playbar-steady',
  'register-srmsg',
  'frame-desc-unselected',
  'frame-desc-selected',
  'frame-desc-readonly',
] as const
type Site = (typeof SITES)[number]
const EXPECTED_PATHS = 26

/** which AX property must carry the rendered string, per site */
const AX_CARRIER: Record<Site, 'descendantText' | 'description'> = {
  'frame-announce': 'descendantText',
  'playback-announce': 'descendantText',
  'playbar-steady': 'descendantText',
  'register-srmsg': 'descendantText',
  'frame-desc-unselected': 'description',
  'frame-desc-selected': 'description',
  'frame-desc-readonly': 'description',
}

const ISOLATE_OPEN = 0x2068 // FSI
const ISOLATE_CLOSE = 0x2069 // PDI
const OTHER_CONTROLS = [0x2066, 0x2067, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x200e, 0x200f, 0x061c]

function isolateShape(s: string) {
  const cps = [...s].map((c) => c.codePointAt(0) as number)
  return {
    opens: cps.filter((c) => c === ISOLATE_OPEN).length,
    closes: cps.filter((c) => c === ISOLATE_CLOSE).length,
    others: cps.filter((c) => OTHER_CONTROLS.includes(c)).length,
  }
}

/** the value between the FSI and its PDI - what an isolate is FOR */
function isolatedValue(s: string): string | null {
  const a = [...s].findIndex((c) => c.codePointAt(0) === ISOLATE_OPEN)
  if (a < 0) return null
  const chars = [...s]
  const b = chars.findIndex((c, i) => i > a && c.codePointAt(0) === ISOLATE_CLOSE)
  return b < 0 ? null : chars.slice(a + 1, b).join('')
}

async function axOf(cdp: CDPSession, selector: string) {
  const doc = await cdp.send('DOM.getDocument', { depth: -1, pierce: true })
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector })
  if (!nodeId) return null
  const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: true })
  const n = nodes.find((x) => x.backendDOMNodeId !== undefined && x.role?.value !== 'generic') ?? nodes[0]
  if (!n) return null
  const byId = new Map(nodes.map((x) => [x.nodeId, x]))
  const texts: string[] = []
  const walk = (id: string) => {
    const node = byId.get(id)
    if (!node) return
    if (node.role?.value === 'StaticText' || node.role?.value === 'text') {
      const v = node.name?.value ?? ''
      if (v) texts.push(v)
    }
    for (const c of node.childIds ?? []) walk(c)
  }
  walk(n.nodeId)
  return {
    role: n.role?.value ?? '',
    name: n.name?.value ?? '',
    description: n.description?.value ?? '',
    descendantText: texts.join(''),
  }
}

/**
 * A transition, not a sample.
 *
 * The prior value is sampled IMMEDIATELY BEFORE the action, so polling for
 * "different from before" cannot be satisfied by something that was already
 * there. Sampling it any earlier is the bug this shape exists to prevent: a
 * stale playback string once passed a `not.toBe('')` poll against a step that
 * never announced at all.
 */
async function transition(
  read: () => Promise<string>,
  action: () => Promise<void>,
  what: string,
): Promise<{ before: string; after: string }> {
  const before = await read()
  await action()
  await expect.poll(read, { timeout: 6000, message: what }).not.toBe(before)
  const after = await read()
  expect(after, `${what}: must not be empty`).not.toBe('')
  return { before, after }
}

type Case = { id: string; site: Site; selector: string; dom: string }

class Registry {
  readonly cases: Case[] = []
  add(c: Case): void {
    // an explicit unique id per path. A derived key (site + steps) once
    // collapsed six rows into one because the key was not a key.
    expect(this.cases.map((x) => x.id), `duplicate case id ${c.id}`).not.toContain(c.id)
    this.cases.push(c)
  }
  /** every case must carry a real string and land on one of the seven sites */
  assertComplete(): void {
    expect(this.cases.length, 'exactly 26 product paths must be exercised').toBe(EXPECTED_PATHS)
    expect(new Set(this.cases.map((c) => c.id)).size, 'case ids must be unique').toBe(EXPECTED_PATHS)
    const covered = new Set(this.cases.map((c) => c.site))
    expect([...covered].sort(), 'all seven sites must be covered').toEqual([...SITES].sort())
    for (const c of this.cases) {
      expect(c.dom.trim().length, `${c.id} must carry text`).toBeGreaterThan(0)
    }
  }
}

const LABELS: Array<[string, string]> = [
  ['arabic', 'مبيعات الربع الأول'],
  ['latin', 'Quarterly Sales'],
  ['digit-leading', '2024 Sales'],
  ['mixed', 'مبيعات Q1'],
  ['paren-leading', '(Draft) Q1'],
  ['bare-number', '2024'],
]

const GRAPH = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'wallet', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'محفظة', activation: 'passive', initial: 3, capacity: null, mode: 'pullAny' } },
    { id: 'reserve', type: 'pool', position: { x: 0, y: 160 }, data: { kind: 'pool', label: '2024 Reserve', activation: 'passive', initial: 34, capacity: null, mode: 'pullAny' } },
    { id: 'rate', type: 'parameter', position: { x: 0, y: 320 }, data: { kind: 'parameter', label: 'Growth rate', value: 2 } },
    { id: 'net', type: 'register', position: { x: 260, y: 0 }, data: { kind: 'register', label: 'صافي القيمة', expr: '@wallet', format: 'integer' } },
  ],
  edges: [],
})

async function setLocale(page: Page, code: string): Promise<void> {
  await page.evaluate((c) => (window as any).__loop.i18n.getState().setLocale(c), code)
  await expect.poll(() => page.evaluate(() => (window as any).__loop.i18n.getState().activeLocale)).toBe(code)
}
async function makeFrame(page: Page, label: string): Promise<void> {
  await page.evaluate((l) => {
    ;(window as any).__loop.frame.getState().adoptFrame({ x: 40, y: 40, w: 420, h: 260 }, l)
  }, label)
  await page.waitForSelector('.lgr-frame[role="group"]')
}

const FRAME_SEL = '.lgr-frame[role="group"]'
const readFrameAnn = (page: Page) =>
  page.evaluate(() => document.querySelector('[data-frame-announce]')?.textContent ?? '')
const readPlay = (page: Page) =>
  page.evaluate(() => document.querySelector('[data-playback-announce]')?.textContent ?? '')
const readSteady = (page: Page) =>
  page.evaluate(() => {
    const rs = [...document.querySelectorAll('.sr-only[role="status"]')] as HTMLElement[]
    const r = rs.find((el) => !el.hasAttribute('data-frame-announce') && !el.hasAttribute('data-playback-announce'))
    return r?.textContent ?? ''
  })
const readSr = (page: Page) =>
  page.evaluate(() => document.querySelector('.regexpr .sr-only[role="status"]')?.textContent ?? '')
const describedText = (page: Page) =>
  page.evaluate(() => {
    const c = document.querySelector('.lgr-frame[role="group"]')
    const id = c?.getAttribute('aria-describedby')
    return id ? (document.getElementById(id)?.textContent ?? '') : ''
  })
const describedId = (page: Page) =>
  page.evaluate(() => document.querySelector('.lgr-frame[role="group"]')?.getAttribute('aria-describedby') ?? '')

for (const locale of LOCALES) {
  test.describe(`announcement contract [${locale}]`, () => {
    test(`all seven sites, all 26 paths [${locale}]`, async ({ page }) => {
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Accessibility.enable')
      const reg = new Registry()

      /** one path: record it, and hold both tiers to the contract */
      const settle = async (id: string, site: Site, selector: string, dom: string, isolated?: string) => {
        reg.add({ id, site, selector, dom })
        const ax = await axOf(cdp, selector)
        expect(ax, `${id}: the element must be in the accessibility tree`).not.toBeNull()
        expect(
          (ax as Record<string, string>)[AX_CARRIER[site]],
          `${id}: the rendered string must appear as the AX ${AX_CARRIER[site]}`,
        ).toBe(dom)

        const shape = isolateShape(dom)
        expect(shape.others, `${id}: no bidi control outside the FSI/PDI pair`).toBe(0)
        if (isolated === undefined) {
          expect(shape.opens, `${id}: no isolate expected`).toBe(0)
          expect(shape.closes, `${id}: no isolate expected`).toBe(0)
        } else {
          expect(shape.opens, `${id}: exactly one FSI`).toBe(1)
          expect(shape.closes, `${id}: exactly one PDI`).toBe(1)
          expect(isolatedValue(dom), `${id}: the user value must survive whole inside the isolate`).toBe(isolated)
        }
      }

      await openApp(page)
      await setLocale(page, locale)

      // ---- sites 5-7: the three descriptions, via the REFERENCING frame.
      // The targets are inside an aria-hidden wrapper and can never be read on
      // their own; what an assistive technology receives is the frame's
      // name + role + description on focus.
      await makeFrame(page, 'مبيعات Q1')
      await page.focus(FRAME_SEL)
      await page.keyboard.press('Escape') // a freshly drawn frame arrives SELECTED
      await expect.poll(() => describedId(page)).toBe('lgr-frame-desc')
      await settle('desc/unselected', 'frame-desc-unselected', FRAME_SEL, await describedText(page))

      const descBefore = await describedText(page)
      await page.keyboard.press('Enter')
      await expect.poll(() => describedId(page)).toBe('lgr-frame-desc-selected')
      const descSelected = await describedText(page)
      expect(descSelected, 'the description must be REPLACED, not appended').not.toContain(descBefore)
      await settle('desc/selected', 'frame-desc-selected', FRAME_SEL, descSelected)

      await page.evaluate(() => (window as any).__loop.ui.getState().setCanvasLocked(true))
      await expect.poll(() => describedId(page)).toBe('lgr-frame-desc-readonly')
      await settle('desc/readonly', 'frame-desc-readonly', FRAME_SEL, await describedText(page))
      await page.evaluate(() => (window as any).__loop.ui.getState().setCanvasLocked(false))

      // the frame carries a real accessible NAME alongside, and focus delivers
      // the three together - the thing the manual pass judges
      const frameAx = await axOf(cdp, FRAME_SEL)
      expect(frameAx?.role, 'the referencing element must be a group').toBe('group')
      expect((frameAx?.name ?? '').length, 'the frame must have an accessible name').toBeGreaterThan(0)

      // ---- site 1: the frame live region, per label shape, move and resize
      for (const [shape, label] of LABELS) {
        await page.evaluate(() => (window as any).__loop.frame.getState().clearFrames())
        await expect.poll(() => page.locator(FRAME_SEL).count()).toBe(0)
        await makeFrame(page, label)
        await page.focus(FRAME_SEL)
        await page.keyboard.press('Enter')
        const { after: moved } = await transition(
          () => readFrameAnn(page),
          async () => void (await page.keyboard.press('ArrowRight')),
          `move/${shape}`,
        )
        expect(moved, `move/${shape}: the user label must survive whole`).toContain(label)
        await settle(`frame/move/${shape}`, 'frame-announce', '[data-frame-announce]', moved, label)

        const { after: resized } = await transition(
          () => readFrameAnn(page),
          async () => {
            await page.focus('.lgr-frame__resize')
            await page.keyboard.press('ArrowRight')
          },
          `resize/${shape}`,
        )
        expect(resized).toContain(label)
        await settle(`frame/resize/${shape}`, 'frame-announce', '[data-frame-announce]', resized, label)
      }
      await page.evaluate(() => (window as any).__loop.frame.getState().clearFrames())

      // ---- site 2: the playback announcer, each phrasing by its real transition
      const sim = (patch: Record<string, unknown>) =>
        page.evaluate((p) => (window as any).__loop.sim.setState(p), patch)

      await sim({ status: 'idle', stepIndex: 0 })
      const { after: started } = await transition(
        () => readPlay(page),
        () => sim({ status: 'running', stepIndex: 0 }),
        'playback/started',
      )
      await settle('playback/started', 'playback-announce', '[data-playback-announce]', started)

      // a SINGLE increment is the only thing that produces `Step N`, and it is
      // deferred by the 900ms throttle - so this is a transition, not a sample
      const { after: stepN } = await transition(
        () => readPlay(page),
        () => sim({ stepIndex: 1 }),
        'playback/stepN',
      )
      await settle('playback/stepN', 'playback-announce', '[data-playback-announce]', stepN)

      const { after: paused } = await transition(
        () => readPlay(page),
        () => sim({ status: 'paused', stepIndex: 1 }),
        'playback/paused',
      )
      await settle('playback/paused', 'playback-announce', '[data-playback-announce]', paused)

      const { after: ended } = await transition(
        () => readPlay(page),
        () => sim({ status: 'ended', stepIndex: 12 }),
        'playback/ended',
      )
      expect(ended, 'the previous phrasing must be replaced, not appended').not.toContain(paused)
      await settle('playback/ended', 'playback-announce', '[data-playback-announce]', ended)

      const { after: reset } = await transition(
        () => readPlay(page),
        () => sim({ status: 'idle', stepIndex: 0 }),
        'playback/reset',
      )
      await settle('playback/reset', 'playback-announce', '[data-playback-announce]', reset)

      // ---- site 3: the steady-state region
      const { after: steady } = await transition(
        () => readSteady(page),
        () => sim({ status: 'running', steadyState: true }),
        'playbar/steady',
      )
      await settle('playbar/steady', 'playbar-steady', '.pstrip .sr-only[role="status"]', steady)

      // ---- site 4: RegisterExprField srMsg, via the RXA8 canvas arm flow
      // (the `@` listbox pick does NOT write this region)
      await sim({ status: 'idle', stepIndex: 0, steadyState: false })
      await resetAll(page)
      await importGraph(page, GRAPH)
      await setLocale(page, locale)
      await page.evaluate(() => (window as any).__loop.graph.getState().setSelection('net', null))
      await expect(page.locator('.regexpr input[role="combobox"]')).toBeVisible()

      const PICKS: Array<[string, string, string]> = [
        ['arabic', 'wallet', 'محفظة'],
        ['digit-leading', 'reserve', '2024 Reserve'],
        ['latin', 'rate', 'Growth rate'],
      ]
      let armedRecorded = false
      for (const [shape, nodeId, name] of PICKS) {
        const { after: armed } = await transition(
          () => readSr(page),
          () => page.locator('.regexpr__pick').click(),
          `srmsg/armed/${shape}`,
        )
        if (!armedRecorded) {
          await settle('srmsg/armed', 'register-srmsg', '.regexpr .sr-only[role="status"]', armed)
          armedRecorded = true
        }
        const { after: landed } = await transition(
          () => readSr(page),
          () => page.locator(`.react-flow__node[data-id="${nodeId}"]`).click(),
          `srmsg/pick/${shape}`,
        )
        expect(landed, `srmsg/pick/${shape}: the node name must survive whole`).toContain(name)
        await settle(`srmsg/pick/${shape}`, 'register-srmsg', '.regexpr .sr-only[role="status"]', landed, name)
      }

      const { after: opMsg } = await transition(
        () => readSr(page),
        () => page.locator('.regexpr__op').first().click(),
        'srmsg/operator',
      )
      await settle('srmsg/operator', 'register-srmsg', '.regexpr .sr-only[role="status"]', opMsg)

      // ---- completeness: exactly 26 paths, unique ids, all seven sites
      reg.assertComplete()
    })

    // Two behaviours that are contracts in their own right, kept separate
    // because they assert the ABSENCE and the TIMING of an announcement rather
    // than the content of one.
    test(`a multi-step jump announces nothing [${locale}]`, async ({ page }) => {
      await openApp(page)
      await setLocale(page, locale)
      const sim = (patch: Record<string, unknown>) =>
        page.evaluate((p) => (window as any).__loop.sim.setState(p), patch)

      await sim({ status: 'idle', stepIndex: 0 })
      await sim({ status: 'running', stepIndex: 0 })
      await expect.poll(() => readPlay(page)).not.toBe('')
      const before = await readPlay(page)

      // 0 -> 9 is a JUMP, not progress: it cancels any queued step message and
      // announces nothing. The region must still hold the previous string.
      await sim({ stepIndex: 9 })
      await page.waitForTimeout(1500) // longer than ANNOUNCE_MIN_MS (900ms)
      expect(await readPlay(page), 'a jump must not announce').toBe(before)
    })

    test(`a single increment announces once, after the throttle [${locale}]`, async ({ page }) => {
      await openApp(page)
      await setLocale(page, locale)
      const sim = (patch: Record<string, unknown>) =>
        page.evaluate((p) => (window as any).__loop.sim.setState(p), patch)

      await sim({ status: 'idle', stepIndex: 0 })
      await sim({ status: 'running', stepIndex: 0 })
      await expect.poll(() => readPlay(page)).not.toBe('')
      const started = await readPlay(page)

      const t0 = Date.now()
      const { after: stepped } = await transition(
        () => readPlay(page),
        () => sim({ stepIndex: 1 }),
        'throttled step',
      )
      const waited = Date.now() - t0
      expect(stepped).not.toBe(started)
      // it is DEFERRED: the status change reset the throttle window, so the
      // step message cannot have arrived immediately
      expect(waited, 'the step message must be deferred by the throttle').toBeGreaterThanOrEqual(500)
    })
  })
}
