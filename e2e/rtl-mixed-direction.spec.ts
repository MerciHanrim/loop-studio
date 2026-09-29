import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// docs/localization.md §L9.3 — the two shapes a single `dir` cannot express.
//
// PER-FRAGMENT MARKUP. A string built from several INDEPENDENT values joined by a
// neutral separator. One `dir="auto"` on the whole thing picks a single paragraph
// direction from the first strong character of the entire string — so it reorders
// whichever fragment disagrees with that direction, and the fragment SEQUENCE
// itself flips depending on which script the first value happens to be in. Each
// fragment gets its own `<bdi dir="auto">`.
//
// BRANCH-COMPUTED. One element whose text arrives from several branches that want
// different directions — an engine number from one, a catalog sentence from
// another. By the render site the branch is gone, so the direction is decided where
// the text is, and the class and the direction read the SAME boolean. That last
// part is what this file checks at runtime: not "is there a dir", but "do the class
// and the direction still agree", which is the way those two come apart.
//
// WHAT IS MEASURED HERE AND WHAT IS NOT
//
// Source-exhaustiveness is scripts/check-content-direction.mjs: it can say "all of
// them". This file is behaviour, on product paths, under `ar-XB` — where the
// catalogue is English verbatim, so a catalog fragment reading rtl can only have
// come from the app's own resolver and never from `auto`.
//
// The data-import cell label's three fragments are NOT driven here: reaching them
// needs the whole spreadsheet wizard, and what could go wrong in it is the join,
// not the browser. Its contract is covered by the source check plus a unit test
// tying the joined label to the same three parts the renderer isolates
// (src/model/dataImportCommit.test.ts). Said plainly rather than left as a gap.

type Bridge = {
  __loop: {
    graph: { getState: () => any }
    ui: { setState: (p: Record<string, unknown>) => void }
    i18n: { getState: () => { activeLocale: string; setLocale: (c: string) => void } }
  }
}

const AR = 'مبيعات'

async function switchLocale(page: Page, code: string): Promise<void> {
  await page.evaluate((c) => {
    ;(window as unknown as Bridge).__loop.i18n.getState().setLocale(c)
  }, code)
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.i18n.getState().activeLocale))
    .toBe(code)
}

/** the interface really mirrored, and the canvas still did not */
async function expectMirrored(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('dir'))).toBe('rtl')
}

// ───────────────────────────────────────────────────────────────────────────
// per-fragment markup: the Inputs panel's flow row, two user node labels
// ───────────────────────────────────────────────────────────────────────────

/** a source → pool resource edge whose flow references a parameter, which is what
 *  makes the Inputs panel render a flow row at all */
async function seedFlowRow(page: Page, sourceLabel: string, targetLabel: string) {
  return page.evaluate(
    ({ sourceLabel: sl, targetLabel: tl }) => {
      const g = () => (window as unknown as Bridge).__loop.graph.getState()
      g().newGraph()
      g().addNodeAt('source', { x: 0, y: 0 })
      g().addNodeAt('pool', { x: 240, y: 0 })
      g().addNodeAt('parameter', { x: 480, y: 0 })
      const [src, pool, rate] = g().nodes.map((n: { id: string }) => n.id)
      g().updateNodeData(src, { label: sl })
      g().updateNodeData(pool, { label: tl })
      g().updateNodeData(rate, { label: 'Rate', value: 5 })
      g().onConnect({ source: src, target: pool, sourceHandle: 'out', targetHandle: 'in' })
      g().setEdgeData(g().edges[0].id, { kind: 'resource', flow: `@${rate}` })
      return { src, pool, rate }
    },
    { sourceLabel, targetLabel },
  )
}

/** the flow row's fragments: their text, resolved direction and document order */
const fragments = (page: Page) =>
  page.evaluate(() => {
    const btn = document.querySelector('.mp-row--flow .mp-row__label') as HTMLElement | null
    if (!btn) return null
    const bdis = Array.from(btn.querySelectorAll('bdi')) as HTMLElement[]
    return {
      count: bdis.length,
      parts: bdis.map((b) => ({ text: b.textContent, dir: getComputedStyle(b).direction, attr: b.getAttribute('dir') })),
      text: btn.textContent,
      title: btn.getAttribute('title'),
    }
  })

test.describe('§L9.3 per-fragment markup — two user labels in one row', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await resetAll(page)
  })

  test('each label is isolated and takes its own direction', async ({ page }) => {
    await seedFlowRow(page, AR, 'Gold reserve')
    await switchLocale(page, 'ar-XB')
    await expectMirrored(page)

    const f = await fragments(page)
    expect(f, 'the flow row should be on screen').not.toBeNull()
    expect(f!.count, 'one isolate per user label').toBe(2)
    expect(f!.parts.map((p) => p.attr)).toEqual(['auto', 'auto'])
    // the Arabic label reads rtl and the Latin one ltr, in the same row, under an
    // rtl interface. A single `dir` on the row could not produce this.
    expect(f!.parts[0].dir).toBe('rtl')
    expect(f!.parts[1].dir).toBe('ltr')
  })

  test('the fragment SEQUENCE does not flip with the first label’s script', async ({ page }) => {
    // The measured defect: with the two labels joined under one `dir="auto"`, the
    // whole sequence reversed when the first value's script changed, so the row
    // read target → source. The DOM order is the contract.
    await switchLocale(page, 'ar-XB')
    await expectMirrored(page)

    await seedFlowRow(page, AR, 'Gold reserve')
    const arFirst = await fragments(page)
    expect(arFirst!.parts.map((p) => p.text)).toEqual([AR, 'Gold reserve'])

    await seedFlowRow(page, 'Gold reserve', AR)
    const latinFirst = await fragments(page)
    expect(latinFirst!.parts.map((p) => p.text)).toEqual(['Gold reserve', AR])
  })

  test('isolation keeps a digit-leading label in its own order, where a joined string does not', async ({
    page,
  }) => {
    // `2024 Sales` is the shape the census measured as broken: inside an rtl
    // paragraph a joined `dir="auto"` rendered it `Sales 2024`. The comparison is
    // made in the SAME conditions rather than argued - a probe holding the joined
    // string is placed in the row itself, so both are in one rtl context with one
    // font, and then removed.
    // ORDER MATTERS in the fixture, and getting it wrong measured nothing: with
    // `2024 Sales` FIRST the joined string's first strong character is `S`, so
    // `dir="auto"` resolves ltr and there is no reordering to see. The broken case
    // is a digit-leading fragment FOLLOWING one that sets the paragraph rtl, so the
    // Arabic label goes first and the digit-leading one second.
    await seedFlowRow(page, AR, '2024 Sales')
    await switchLocale(page, 'ar-XB')
    await expectMirrored(page)

    const measured = await page.evaluate((ar) => {
      const btn = document.querySelector('.mp-row--flow .mp-row__label') as HTMLElement
      const bdis = Array.from(btn.querySelectorAll('bdi')) as HTMLElement[]
      const digitLeading = bdis[1]
      const spanOf = (t: Text, from: number, to: number) => {
        const r = document.createRange()
        r.setStart(t, from)
        r.setEnd(t, to)
        return r.getBoundingClientRect().left
      }
      const it = digitLeading.firstChild as Text
      const isolated = { digits: spanOf(it, 0, 4), word: spanOf(it, 5, it.length) }

      // the same two values joined, unisolated, in the same row: one rtl context and
      // one font, so the comparison is measured rather than argued
      const probe = document.createElement('span')
      probe.setAttribute('dir', 'auto')
      probe.textContent = ar + ' → 2024 Sales'
      btn.appendChild(probe)
      const pt = probe.firstChild as Text
      const base = ar.length + 3 // past the label, the space, the arrow and the space
      const joined = { digits: spanOf(pt, base, base + 4), word: spanOf(pt, base + 5, pt.length) }
      const joinedDir = getComputedStyle(probe).direction
      probe.remove()
      return {
        isolated,
        joined,
        joinedDir,
        isolatedDir: getComputedStyle(digitLeading).direction,
        text: digitLeading.textContent,
      }
    }, AR)

    expect(measured.text).toBe('2024 Sales')

    // isolated: the digits paint before the word, as authored
    expect(measured.isolatedDir).toBe('ltr')
    expect(measured.isolated.digits).toBeLessThan(measured.isolated.word)
    // joined: `auto` took rtl from the Arabic fragment, and the digit-leading run
    // reordered. This is the comparison that makes the isolate necessary rather
    // than decorative - if it ever stops holding, the premise changed.
    expect(measured.joinedDir).toBe('rtl')
    expect(measured.joined.digits).toBeGreaterThan(measured.joined.word)
  })

  test('the markup adds elements and changes nothing a reader consumes', async ({ page }) => {
    await seedFlowRow(page, AR, 'Gold reserve')
    await switchLocale(page, 'ar-XB')
    const f = await fragments(page)
    // textContent is exactly the two labels around the arrow — <bdi> contributes
    // no text of its own, so what an assistive technology reads is unchanged
    expect(f!.text).toBe(`${AR} → Gold reserve`)
    // the tooltip is an ATTRIBUTE: markup cannot reach it, and it still holds the
    // joined form. PR C owns the attribute sites; this pins that it did not change.
    expect(f!.title).toBe(`${AR} → Gold reserve`)
  })

  test('the arrow between them is not mirrored — it names a relation the canvas draws', async ({ page }) => {
    await seedFlowRow(page, AR, 'Gold reserve')
    await switchLocale(page, 'ar-XB')
    const f = await fragments(page)
    expect(f!.text).toContain('→')
    expect(f!.text).not.toContain('←')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// branch-computed: the edge label, and the register read-back total
// ───────────────────────────────────────────────────────────────────────────

test.describe('§L9.3 branch-computed — one element, two directions', () => {
  test('an edge label pins a number and lets a catalog fallback follow the reader', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    // two resource edges: one with a plain number, one whose reference dangles and
    // therefore renders the translated "missing reference" phrase
    await page.evaluate(() => {
      const g = () => (window as unknown as Bridge).__loop.graph.getState()
      g().newGraph()
      g().addNodeAt('source', { x: 0, y: 0 })
      g().addNodeAt('pool', { x: 260, y: 0 })
      g().addNodeAt('source', { x: 0, y: 220 })
      g().addNodeAt('pool', { x: 260, y: 220 })
      const [s1, p1, s2, p2] = g().nodes.map((n: { id: string }) => n.id)
      g().onConnect({ source: s1, target: p1, sourceHandle: 'out', targetHandle: 'in' })
      g().onConnect({ source: s2, target: p2, sourceHandle: 'out', targetHandle: 'in' })
      const [e1, e2] = g().edges.map((e: { id: string }) => e.id)
      g().setEdgeData(e1, { kind: 'resource', flow: '2' })
      g().setEdgeData(e2, { kind: 'resource', flow: '@nope' })
      return { e1, e2 }
    })
    await switchLocale(page, 'ar-XB')
    await expectMirrored(page)

    const labels = page.locator('.edge-label')
    await expect(labels).toHaveCount(2)

    const read = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.edge-label')).map((el) => ({
        text: (el.textContent ?? '').trim(),
        dir: getComputedStyle(el).direction,
        attr: el.getAttribute('dir'),
      })),
    )
    const number = read.find((r) => r.text === '2')
    const fallback = read.find((r) => r.text !== '2')
    expect(number, 'the numeric edge label').toBeTruthy()
    expect(fallback, 'the dangling-reference edge label').toBeTruthy()

    // the same class, the same component, one render — two directions, because the
    // branch that produced the text is what decided
    expect(number!.dir).toBe('ltr')
    expect(fallback!.dir).toBe('rtl')
    // and the fallback really is the catalogue, which under ar-XB is English — so
    // `auto` would have resolved it ltr and only the resolver makes it rtl
    expect(fallback!.text.length).toBeGreaterThan(1)
    expect(/[A-Za-z]/.test(fallback!.text)).toBe(true)
  })

  test('the register total’s class and direction never disagree', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    const ids = await page.evaluate(() => {
      const g = () => (window as unknown as Bridge).__loop.graph.getState()
      g().newGraph()
      g().addNodeAt('parameter', { x: 0, y: 0 })
      g().addNodeAt('register', { x: 240, y: 0 })
      g().addNodeAt('register', { x: 480, y: 0 })
      const [p, ok, bad] = g().nodes.map((n: { id: string }) => n.id)
      g().updateNodeData(p, { label: 'Rate', value: 5 })
      g().updateNodeData(ok, { label: 'Fine', expr: `@${p} + 1` })
      // A DANGLING ref would not do: it makes the result not-a-value, so the whole
      // result line is replaced by an error paragraph and `.regrb__total` never
      // renders. A division by zero keeps the value line and puts a verdict in the
      // total - which is the branch this element actually has.
      g().updateNodeData(bad, { label: 'Broken', expr: `@${p} / 0` })
      return { ok, bad }
    })
    await switchLocale(page, 'ar-XB')
    await expectMirrored(page)

    const total = async (nodeId: string) => {
      await page.evaluate((n) => (window as unknown as Bridge).__loop.graph.getState().setSelection(n, null), nodeId)
      const el = page.locator('.regrb__total')
      await expect(el).toBeVisible()
      return el.evaluate((e) => ({
        bad: e.classList.contains('regrb__total--bad'),
        dir: getComputedStyle(e).direction,
        text: e.textContent,
      }))
    }

    const fine = await total(ids.ok)
    const broken = await total(ids.bad)

    // a value: the engine's own number, pinned
    expect(fine.bad).toBe(false)
    expect(fine.dir).toBe('ltr')
    // a verdict: a catalog sentence, following the reader
    expect(broken.bad).toBe(true)
    expect(broken.dir).toBe('rtl')

    // THE contract: one boolean drives both. Stated as the biconditional so a
    // future change that updates the class and forgets the direction is red, which
    // a pair of independent assertions would not catch.
    for (const s of [fine, broken]) {
      expect(s.bad === (s.dir === 'rtl'), `class --bad=${s.bad} and dir=${s.dir} must agree`).toBe(true)
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
// per-fragment markup: the language menu row
// ───────────────────────────────────────────────────────────────────────────

test.describe('§L9.3 per-fragment markup — the language menu row', () => {
  test('the native name is isolated, and the row order and text survive a locale round trip', async ({
    page,
  }) => {
    await openApp(page)

    // the same path e2e/i18n-acceptance.spec.ts takes rather than a guess: on
    // desktop the switch lives inside the Settings menu, so that opens first
    const openMenu = async () => {
      const trigger = page.locator('.lang-switch').first()
      if (!(await trigger.isVisible().catch(() => false))) {
        await page.locator('.toolbar__actions .menu > button', { hasText: /Settings/ }).first().click()
        await expect(trigger).toBeVisible()
      }
      if ((await trigger.getAttribute('aria-expanded')) === 'true') await page.keyboard.press('Escape')
      await trigger.click()
      await expect(trigger).toHaveAttribute('aria-expanded', 'true')
      await expect(page.locator('.lang-menu__item').first()).toBeVisible()
    }

    const rows = () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll('.lang-menu__item .menu__name')).map((el) => ({
          text: el.textContent,
          // the children in document order: the mark, the isolate, the suffix
          childOrder: Array.from(el.childNodes).map((n) =>
            n.nodeType === Node.ELEMENT_NODE ? (n as Element).tagName.toLowerCase() : '#text',
          ),
          bdi: el.querySelector('bdi')?.textContent ?? null,
          bdiAttr: el.querySelector('bdi')?.getAttribute('dir') ?? null,
          lang: el.getAttribute('lang'),
        })),
      )

    await openMenu()
    const before = await rows()
    expect(before.length, 'the language menu should list locales').toBeGreaterThan(1)
    // every row isolates its own native name, and nothing else in the row
    for (const r of before) {
      expect(r.bdiAttr).toBe('auto')
      expect(r.bdi).not.toBeNull()
      expect(r.childOrder.filter((c) => c === 'bdi').length).toBe(1)
      // `lang` is still there and is NOT the direction — it drives pronunciation
      // and font selection, and treating it as a direction is the substitution
      // that closed these sites wrongly the first time
      expect(r.lang).toBeTruthy()
    }

    // the isolate contributes no text, so the row reads exactly as before
    expect(before.every((r) => (r.text ?? '').includes(r.bdi ?? ''))).toBe(true)

    await page.keyboard.press('Escape')
    await switchLocale(page, 'ar-XB')
    await expectMirrored(page)
    await openMenu()
    const during = await rows()
    // the names and their isolates are untouched by the interface direction
    expect(during.map((r) => r.bdi)).toEqual(before.map((r) => r.bdi))
    // The child ORDER is NOT compared row for row here, and the reason is a real
    // product fact rather than a tolerance: `ar-XB` is a disabled locale (§L9.2), so
    // it is not offered in the picker and no row is the active one - the `✓ ` text
    // node that one row carried under `en` is simply absent. Asserting equality
    // measured the checkmark's position, not the isolate's.
    expect(during.filter((r) => r.childOrder.includes('#text')).length, 'a disabled locale marks no row active').toBe(0)
    for (const r of during) {
      expect(r.childOrder.filter((c) => c === 'bdi').length).toBe(1)
      expect(r.bdiAttr).toBe('auto')
    }
    // and where a checkmark DOES exist it precedes the isolate - the invariant the
    // markup change could have broken
    for (const r of before.filter((x) => x.childOrder.includes('#text'))) {
      expect(r.childOrder.indexOf('#text')).toBeLessThan(r.childOrder.indexOf('bdi'))
    }

    await page.keyboard.press('Escape')
    await switchLocale(page, 'en')
    await openMenu()
    expect(await rows()).toEqual(before)
  })
})
