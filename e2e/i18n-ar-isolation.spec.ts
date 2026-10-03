import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// docs/localization.md §L9.4 — the isolation obligations, measured in a real
// browser, in real Arabic sentences.
//
// WHAT THE OTHER TWO LAYERS ALREADY SETTLE, SO THIS FILE DOES NOT REPEAT THEM
//
//   * `src/i18n/bidiIsolate.test.ts` — what the helpers PRODUCE: per-mode
//     idempotence, the strip, exactly one outer pair, zero inner controls.
//   * `scripts/check-isolate-arguments.mjs` — that every declared obligation is
//     implemented with its declared kind on its declared argument at all eleven
//     call sites, and that no isolate exists outside a declared row.
//
// Both are statements about STRINGS. Neither can say the browser then lays the
// sentence out the way the isolate was added to make it, and a string check is
// exactly what would still pass if it did not. That is this file.
//
// WHY NOT A SCREENSHOT, AND WHY NOT `textContent`
//
// `textContent` equality is what the isolate is DESIGNED not to change — the
// helpers add zero-width characters, so a text comparison is green whether or
// not the isolate is there at all. A screenshot is a single number over a whole
// region: it cannot separate "the value sits in the wrong place in the
// sentence" from "the characters inside the value are in the wrong order",
// which are different defects with different causes, and it goes red for a font
// update that changed nothing.
//
// So the measurement is GEOMETRIC and it is taken INSIDE the one string ICU
// produced: `Range` rectangles over the text node's own offsets, which is the
// only handle there is on a value that has no element of its own. Two
// independent things are read off it:
//
//   * OUTER — where the value's run sits relative to the sentence's head and
//     tail, in the reader's direction.
//   * INNER — the visual order of the characters within the value, compared
//     against the SAME value rendered on its own in the SAME container. That
//     comparison is the actual contract: an isolate's whole purpose is to make
//     the inside of the value independent of the sentence around it. Asserting
//     it this way also means the test never has to predict a bidi outcome,
//     which is the part a test gets wrong.
//
// And the necessity is measured too, not argued: for the shapes the PR B census
// recorded as breaking, the same value is rendered UNISOLATED in the same
// container and the two orders must DIFFER. Without that, every assertion here
// would still pass with the isolates removed for the values that never needed
// one, and the file would be measuring the font.
//
// WHAT THIS FILE DOES NOT CLAIM. It closes "the isolation contract holds in
// real Arabic sentences, all the way to browser layout". Pronunciation,
// navigation and braille are the named-AT-stack review; whether the Arabic
// reads naturally is a native review. Neither is a browser measurement.

const PDI = String.fromCharCode(0x2069)

// the hostile input: an RLO override closed by nothing, an unmatched PDI that
// would end an isolate placed around this value, and a bare LRM strong mark.
// None of the three is a C0 control, so nothing upstream of the display
// boundary removes them.
const RLO = String.fromCharCode(0x202e)
const LRM = String.fromCharCode(0x200e)
const HOSTILE = `A${RLO}B${PDI}C${LRM}D`
const HOSTILE_CLEAN = 'ABCD'

// ZWJ / ZWNJ and an Arabic combining mark must SURVIVE the strip — they shape
// and compose the text rather than steer its direction
const ZWNJ = String.fromCharCode(0x200c)
const FATHA = String.fromCharCode(0x064e)
const SHAPED = `ت${ZWNJ}ج${FATHA}ربة`

type Rect = { left: number; right: number; top: number; bottom: number; width: number }
type Glyph = { left: number; right: number; top: number }
type Anchor = { ch: string; left: number; right: number; top: number }
type Span = { kind: string; text: string; rect: Rect | null; order: number[]; chars: Glyph[] }
type Measured = {
  found: boolean
  whole: string
  controls: string[]
  direction: string
  node: string
  head: { text: string; anchor: Anchor | null }
  tail: { text: string; anchor: Anchor | null }
  between: string[]
  spans: Span[]
}

type Bridge = {
  __loop: {
    graph: { getState: () => any }
    frame: { getState: () => any }
    ui: { getState: () => any }
    tour: { setState: (p: Record<string, unknown>) => void }
    hint: { setState: (p: Record<string, unknown>) => void }
    project: { getState: () => any }
    i18n: { getState: () => { setLocale: (c: string) => void } }
  }
}

async function setLocale(page: Page, code: string): Promise<void> {
  await page.evaluate((c) => {
    ;(window as unknown as Bridge).__loop.i18n.getState().setLocale(c)
  }, code)
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(code)
  // the direction really is the RTL one, so nothing below can be passing on a
  // fallback to an LTR catalogue
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dir))
    .toBe(code === 'ar' ? 'rtl' : 'ltr')
}

/** Everything one rendered sentence can say about its isolates.
 *
 *  `order` is the VISUAL order of a span's characters as logical indexes —
 *  `[0,1,2]` means they paint left to right as authored, `[2,1,0]` means
 *  reversed. Zero-width characters (the controls themselves, a combining mark)
 *  contribute no rectangle and are left out, which is why the comparison below
 *  is between two measured orders rather than against a literal. */
function measure(page: Page, selector: string, nth = 0): Promise<Measured | null> {
  return page.evaluate(
    async ({ selector: sel, nth: idx }) => {
      const B = await import('/src/i18n/bidiControls.ts')
      const el = document.querySelectorAll(sel)[idx] as HTMLElement | undefined
      if (!el) return null
      const NAME = new Map<string, string>([...B.BANNED_CONTROLS, ...B.ISOLATE_OPENERS, [B.PDI, 'PDI']])
      const whole = el.textContent ?? ''
      const controls = [...whole].filter((c) => NAME.has(c)).map((c) => NAME.get(c)!)

      // the text node that carries the isolate — the ICU output is ONE node,
      // and a sibling node (a separator, a count) is not part of this sentence
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      let tn: Text | null = null
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if ([...(n as Text).data].some((c) => B.ISOLATE_OPENERS.has(c))) {
          tn = n as Text
          break
        }
      }
      // the direction of the element the SENTENCE is in, which is not always the
      // one the selector named (the canvas hint's panel is pinned `ltr`; only
      // the span inside it follows the reader)
      const direction = getComputedStyle(tn?.parentElement ?? el).direction
      if (!tn) {
        return {
          found: false,
          whole,
          controls,
          direction,
          node: '',
          head: { text: '', anchor: null },
          tail: { text: '', anchor: null },
          between: [] as string[],
          spans: [] as Span[],
        }
      }

      const text = tn
      const data = text.data
      const rectOf = (from: number, to: number) => {
        if (to <= from) return null
        const r = document.createRange()
        r.setStart(text, from)
        r.setEnd(text, to)
        const b = r.getBoundingClientRect()
        return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width }
      }
      // VISIBLE, NON-SPACE characters, each as its own rectangle. Sorted by
      // LINE and then by x: sorting on x alone silently interleaves two lines
      // and reports a wrap as a reordering.
      //
      // Whitespace is left out on purpose. A space carries no direction of its
      // own, and its measured width depends on where the line happens to break
      // — a space that lands at the end of a line collapses to nothing. Keeping
      // it made the comparison a measurement of the container's width.
      const charsIn = (from: number, to: number) => {
        const seen: { i: number; left: number; right: number; top: number }[] = []
        for (let i = from; i < to; i++) {
          if (/\s/.test(data[i]!)) continue
          const r = rectOf(i, i + 1)
          if (r && r.width > 0.01) seen.push({ i: i - from, left: r.left, right: r.right, top: Math.round(r.top) })
        }
        return seen.sort((a, b) => a.top - b.top || a.left - b.left)
      }

      const found: { span: Span; from: number; to: number }[] = []
      for (let i = 0; i < data.length; i++) {
        const opener = B.ISOLATE_OPENERS.get(data[i]!)
        if (!opener) continue
        const close = data.indexOf(B.PDI, i)
        if (close < 0) break
        const chars = charsIn(i + 1, close)
        found.push({
          span: {
            kind: opener,
            text: data.slice(i + 1, close),
            rect: rectOf(i + 1, close),
            order: chars.map((c) => c.i),
            chars: chars.map((c) => ({ left: c.left, right: c.right, top: c.top })),
          },
          from: i,
          to: close,
        })
        i = close
      }
      const between: string[] = []
      for (let k = 1; k < found.length; k++) between.push(data.slice(found[k - 1]!.to + 1, found[k]!.from))
      const first = found[0]!
      const last = found[found.length - 1]!

      // The head / tail ANCHOR: the nearest character on that side that has a
      // strong direction of its own. A union rectangle over the whole head or
      // tail is not usable — once the sentence wraps it spans every line and
      // compares nothing — and a neutral character (a quote, a dash) has no
      // side of its own to compare against. One strong character does.
      const STRONG = /[֐-ࣿיִ-﷿ﹰ-﻿]/
      let hi = first.from - 1
      while (hi >= 0 && !STRONG.test(data[hi]!)) hi--
      let ti = last.to + 1
      while (ti < data.length && !STRONG.test(data[ti]!)) ti++
      const anchorAt = (i: number) => {
        const r = rectOf(i, i + 1)
        return r ? { ch: data[i]!, left: r.left, right: r.right, top: Math.round(r.top) } : null
      }
      return {
        found: found.length > 0,
        whole,
        controls,
        direction,
        node: data,
        head: { text: data.slice(0, first.from), anchor: hi >= 0 ? anchorAt(hi) : null },
        tail: { text: data.slice(last.to + 1), anchor: ti < data.length ? anchorAt(ti) : null },
        between,
        spans: found.map((f) => f.span),
      }
    },
    { selector, nth },
  )
}

/** The same value rendered ALONE, and rendered UNISOLATED inside a copy of the
 *  sentence, in the same container — one font, one direction context, so the
 *  three orders are comparable rather than argued. */
function probe(
  page: Page,
  selector: string,
  args: { value: string; head: string; tail: string; dir: 'auto' | 'ltr' },
  nth = 0,
): Promise<{ alone: number[]; joined: number[]; aloneDir: string } | null> {
  return page.evaluate(
    async ({ selector: sel, nth: idx, a }) => {
      const B = await import('/src/i18n/bidiControls.ts')
      const el = document.querySelectorAll(sel)[idx] as HTMLElement | undefined
      if (!el) return null
      // Mount into the element that actually CONTAINS the sentence, not the one
      // the selector named. The canvas hint is the case that makes this matter:
      // its panel sits inside the React Flow pane, which is pinned `ltr` (§L9.2),
      // and only the inner span carries the reader's direction. A probe appended
      // to the panel was resolved left-to-right and reported "no reordering" for
      // a value that reorders — a green result produced by measuring the wrong
      // paragraph.
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      let host: HTMLElement | null = null
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if ([...(n as Text).data].some((c) => B.ISOLATE_OPENERS.has(c))) {
          host = (n as Text).parentElement
          break
        }
      }
      if (!host) return null
      // by LINE and then by x, whitespace left out — the same rule the
      // in-sentence measurement uses, so the two orders are comparable
      const orderIn = (node: Text, from: number, to: number) => {
        const seen: { i: number; left: number; top: number }[] = []
        for (let i = from; i < to; i++) {
          if (/\s/.test(node.data[i]!)) continue
          const r = document.createRange()
          r.setStart(node, i)
          r.setEnd(node, i + 1)
          const b = r.getBoundingClientRect()
          if (b.width > 0.01) seen.push({ i: i - from, left: b.left, top: Math.round(b.top) })
        }
        return seen.sort((x, y) => x.top - y.top || x.left - y.left).map((s) => s.i)
      }
      // Each probe is an `inline-block` with `white-space: nowrap`, for two
      // reasons that are both failures this measurement actually hit:
      //   * a probe that WRAPS puts the value's fragments on two lines, and a
      //     line-aware order then reads as "unchanged" no matter what the bidi
      //     algorithm did to it — the reorder was real and the probe hid it.
      //   * an inline-block is its own bidi paragraph, which is what the real
      //     sentence is too; a bare inline span would be resolved as part of
      //     whatever the host element happened to contain already.
      const mount = (el: HTMLElement) => {
        el.style.whiteSpace = 'nowrap'
        el.style.display = 'inline-block'
        host.appendChild(el)
      }
      // the value on its own, in the direction context the isolate declares
      const solo = document.createElement('span')
      solo.setAttribute('dir', a.dir)
      solo.textContent = a.value
      mount(solo)
      const alone = orderIn(solo.firstChild as Text, 0, a.value.length)
      const aloneDir = getComputedStyle(solo).direction
      solo.remove()
      // the same sentence with the value interpolated RAW
      const raw = document.createElement('span')
      raw.textContent = a.head + a.value + a.tail
      mount(raw)
      const joined = orderIn(raw.firstChild as Text, a.head.length, a.head.length + a.value.length)
      raw.remove()
      return { alone, joined, aloneDir }
    },
    { selector, nth, a: args },
  )
}

/** The fixtures MEASURED to reorder when interpolated raw into an RTL sentence.
 *
 *  Listed, not pattern-matched. The first attempt was `/^[\d([]/` — "opens with
 *  a digit or a bracket" — and that is not the condition. Two things have to be
 *  true together: the value's own direction must disagree with the paragraph's,
 *  AND it must contain more than one bidi run, so the runs swap. A single-script
 *  value never reorders INTERNALLY (only its position moves), and an Arabic value
 *  agrees with the paragraph. `(مسودة) بن` is bracket-leading and Arabic and does
 *  not reorder — the regex claimed it did, and the test caught it. */
const REORDERS = new Set([
  '#7-beta',
  '2024 Sales',
  '7 days left',
  '(Draft) Q1',
  '[wip] later',
  '2024 Coins',
])
const needsIsolate = (v: string) => REORDERS.has(v)

/** OUTER — in an RTL paragraph the sentence's head paints to the RIGHT of the
 *  value and its tail to the LEFT, unless the line wrapped between them, in
 *  which case the later part is simply lower.
 *
 *  Returns HOW MANY relations it checked. A head that is neutral-only (a bare
 *  quote) has no defined side of its own and is skipped — and skipping silently
 *  is exactly how a file like this ends up asserting nothing, so every caller
 *  asserts the returned count. */
function expectReadingOrder(m: Measured, label: string): number {
  let n = 0
  const check = (anchor: Anchor, span: Span, side: 'head' | 'tail') => {
    const onLine = span.chars.filter((c) => Math.abs(c.top - anchor.top) <= 2)
    if (onLine.length === 0) {
      // the sentence wrapped between them, so the relation is one of LINES: a
      // head is on an earlier line, a tail on a later one
      const spanTop = Math.min(...span.chars.map((c) => c.top))
      if (side === 'head') expect(anchor.top, `${label}: head wrapped above the value`).toBeLessThan(spanTop)
      else expect(anchor.top, `${label}: tail wrapped below the value`).toBeGreaterThan(spanTop)
    } else if (side === 'head') {
      // RTL: what comes first in the sentence paints further RIGHT
      expect(anchor.left, `${label}: the head must paint to the right of the value`).toBeGreaterThanOrEqual(
        Math.max(...onLine.map((c) => c.right)) - 1,
      )
    } else {
      expect(anchor.right, `${label}: the tail must paint to the left of the value`).toBeLessThanOrEqual(
        Math.min(...onLine.map((c) => c.left)) + 1,
      )
    }
    n += 1
  }
  if (m.head.anchor) check(m.head.anchor, m.spans[0]!, 'head')
  if (m.tail.anchor) check(m.tail.anchor, m.spans[m.spans.length - 1]!, 'tail')
  return n
}

// ───────────────────────────────────────────────────────────────────────────
// LRI — a technical token whose direction is known in advance
// ───────────────────────────────────────────────────────────────────────────

test.describe('§L9.4 LRI — an id keeps its own left-to-right order inside an Arabic sentence', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await resetAll(page)
  })

  test('a DIGIT-leading revision id reads in its authored order', async ({ page }) => {
    // `short()` strips the `rev_` prefix, so the token a reader sees starts with
    // a digit — which has no strong direction of its own. That is the whole
    // reason this obligation is `LRI` and not `FSI`: a first-strong isolate
    // would hand the token the paragraph's direction, and the paragraph is RTL.
    await page.evaluate(() => {
      ;(window as unknown as Bridge).__loop.project.getState()._setOpen({
        projectId: 'proj_abcdef01',
        revisionId: 'rev_2024ab99',
        parentId: null,
        role: 'revision',
        lineage: [],
        meta: { tool: 'test', createdAt: '2026-01-01T00:00:00.000Z' },
        baselineDigest: 'd'.repeat(64),
      })
    })
    await setLocale(page, 'ar')
    await expect(page.locator('.rev-chip')).toBeVisible()

    const m = (await measure(page, '.rev-chip'))!
    expect(m.found, 'the chip should carry an isolate').toBe(true)
    expect(m.spans.map((s) => s.kind)).toEqual(['LRI'])
    expect(m.spans[0]!.text).toBe('2024ab')
    expect(m.direction).toBe('rtl')
    // the sentence around it really is the Arabic catalogue
    expect(m.head.text).toContain('مراجعة')
    expect(expectReadingOrder(m, 'revChip.rev'), 'a head/tail relation was checked').toBeGreaterThanOrEqual(1)

    const p = (await probe(page, '.rev-chip', { value: '2024ab', head: m.head.text, tail: m.tail.text, dir: 'ltr' }))!
    expect(p.aloneDir).toBe('ltr')
    expect(m.spans[0]!.order, 'the isolated id must lay out as it does alone').toEqual(p.alone)
  })

  test('a SYMBOL-leading node id keeps its order, where the raw sentence does not', async ({ page }) => {
    // `@{…}` is the braced reference form, so an id the generator would never
    // produce can still be authored — which is what makes a symbol-leading
    // token reachable on this path at all.
    await page.evaluate(() => {
      const g = () => (window as unknown as Bridge).__loop.graph.getState()
      g().newGraph()
      g().addNodeAt('source', { x: 0, y: 0 })
      g().addNodeAt('pool', { x: 240, y: 0 })
      const [src, pool] = g().nodes.map((n: { id: string }) => n.id)
      g().onConnect({ source: src, target: pool, sourceHandle: 'out', targetHandle: 'in' })
      g().setEdgeData(g().edges[0].id, { kind: 'resource', flow: '@{#7-beta}' })
      g().setSelection(null, g().edges[0].id)
    })
    await setLocale(page, 'ar')
    await expect(page.locator('.inspector__note--warn')).toBeVisible()

    const m = (await measure(page, '.inspector__note--warn'))!
    expect(m.spans.map((s) => s.kind)).toEqual(['LRI'])
    expect(m.spans[0]!.text).toBe('#7-beta')
    expect(m.head.text).toContain('لا يوجد')
    expect(expectReadingOrder(m, 'flowParam.unknown')).toBeGreaterThanOrEqual(2)

    const p = (await probe(page, '.inspector__note--warn', {
      value: '#7-beta',
      head: m.head.text,
      tail: m.tail.text,
      dir: 'ltr',
    }))!
    expect(m.spans[0]!.order, 'the isolated id must lay out as it does alone').toEqual(p.alone)
    // and the isolate is doing work: dropped into the same Arabic sentence raw,
    // the same token takes a DIFFERENT visual order. If this stops holding the
    // premise changed, not the test.
    expect(p.joined, `raw interpolation must reorder it (alone=${p.alone}, joined=${p.joined})`).not.toEqual(p.alone)
  })

  test('an existing non-Parameter node id takes the same isolate on the other branch', async ({ page }) => {
    // the closed key set's second branch — the checker proves both are wrapped;
    // this proves the second one also RENDERS bounded
    const pool = await page.evaluate(() => {
      const g = () => (window as unknown as Bridge).__loop.graph.getState()
      g().newGraph()
      g().addNodeAt('source', { x: 0, y: 0 })
      g().addNodeAt('pool', { x: 240, y: 0 })
      const ids = g().nodes.map((n: { id: string }) => n.id)
      g().onConnect({ source: ids[0], target: ids[1], sourceHandle: 'out', targetHandle: 'in' })
      g().setEdgeData(g().edges[0].id, { kind: 'resource', flow: `@{${ids[1]}}` })
      g().setSelection(null, g().edges[0].id)
      return ids[1] as string
    })
    await setLocale(page, 'ar')
    await expect(page.locator('.inspector__note--warn')).toBeVisible()

    const m = (await measure(page, '.inspector__note--warn'))!
    expect(m.spans.map((s) => s.kind)).toEqual(['LRI'])
    expect(m.spans[0]!.text).toBe(pool)
    expect(m.tail.text).toContain('ليس مُعامِلًا')
    expect(expectReadingOrder(m, 'flowParam.notParam')).toBeGreaterThanOrEqual(1)
    const p = (await probe(page, '.inspector__note--warn', { value: pool, head: m.head.text, tail: m.tail.text, dir: 'ltr' }))!
    expect(m.spans[0]!.order, 'the isolated value must lay out as it does alone').toEqual(p.alone)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// FSI — a value whose direction is not known in advance
// ───────────────────────────────────────────────────────────────────────────

/** an edge whose timing / condition combination the engine does not support, so
 *  the Inspector renders the one sentence that interpolates BOTH raw document
 *  values. They are raw strings in the document, which is what makes this the
 *  cheapest honest place to put a deliberately hostile value. */
async function seedUnsupportedTiming(page: Page, timing: string, when: string): Promise<void> {
  await page.evaluate(
    ({ timing: tm, when: wh }) => {
      const g = () => (window as unknown as Bridge).__loop.graph.getState()
      g().newGraph()
      g().addNodeAt('pool', { x: 0, y: 0 })
      g().addNodeAt('pool', { x: 260, y: 0 })
      const ids = g().nodes.map((n: { id: string }) => n.id)
      g().onConnect({ source: ids[0], target: ids[1], sourceHandle: 'state-source', targetHandle: 'state-target' })
      const e = g().edges[0].id
      // `mode: 'label'` is what makes the Inspector render LabelTimingField at
      // all, and `expr` is what makes the label a label
      g().setEdgeData(e, { kind: 'state', mode: 'label', expr: '+1', timing: tm, when: wh })
      g().setSelection(null, e)
    },
    { timing, when },
  )
}

test.describe('§L9.4 FSI — a value of unknown direction, bounded inside the sentence', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await resetAll(page)
  })

  for (const c of [
    { name: 'a LATIN value', timing: 'Ember Blade', when: 'after pull' },
    { name: 'a DIGIT-leading value', timing: '2024 Sales', when: '7 days left' },
    { name: 'a BRACKET-leading value', timing: '(Draft) Q1', when: '[wip] later' },
    { name: 'an ARABIC value', timing: 'مبيعات الربع', when: 'عند السحب' },
  ]) {
    test(`${c.name} keeps its own layout in inspector.labelTiming.unsupported`, async ({ page }) => {
      await seedUnsupportedTiming(page, c.timing, c.when)
      await setLocale(page, 'ar')
      await expect(page.locator('.labeltiming__groupline')).toBeVisible()

      const m = (await measure(page, '.labeltiming__groupline'))!
      expect(m.found, 'the unsupported sentence should carry two isolates').toBe(true)
      // ONE catalog call, TWO arguments — both wrapped, in the order the
      // sentence names them
      expect(m.spans.map((s) => s.kind)).toEqual(['FSI', 'FSI'])
      expect(m.spans.map((s) => s.text)).toEqual([c.timing, c.when])
      expect(m.direction).toBe('rtl')
      expect(m.head.text).toContain('التوقيت')
      expect(expectReadingOrder(m, `labelTiming/${c.name}`)).toBeGreaterThanOrEqual(2)

      let compared = 0
      let proven = 0
      for (const [i, value] of [c.timing, c.when].entries()) {
        const p = (await probe(page, '.labeltiming__groupline', {
          value,
          head: m.head.text,
          tail: m.tail.text,
          dir: 'auto',
        }))!
        expect(m.spans[i]!.order, `${value}: isolated in the sentence must lay out as it does alone`).toEqual(p.alone)
        compared += 1
        if (needsIsolate(value)) {
          expect(p.joined, `${value}: raw interpolation must reorder it (alone=${p.alone}, joined=${p.joined})`).not.toEqual(p.alone)
          proven += 1
        }
      }
      expect(compared, 'both arguments were compared').toBe(2)
      expect(proven).toBe([c.timing, c.when].filter(needsIsolate).length)
    })
  }

  test('a hostile value is cleaned on the product path, and the sentence keeps exactly one pair per argument', async ({ page }) => {
    await seedUnsupportedTiming(page, HOSTILE, SHAPED)
    await setLocale(page, 'ar')
    await expect(page.locator('.labeltiming__groupline')).toBeVisible()

    const m = (await measure(page, '.labeltiming__groupline'))!
    expect(m.spans.map((s) => s.kind)).toEqual(['FSI', 'FSI'])
    expect(m.spans[0]!.text, 'the override, the stray PDI and the mark are gone').toBe(HOSTILE_CLEAN)
    // the whole rendered sentence carries the two intended pairs and nothing else
    expect(m.controls, 'exactly the intended pairs, in order').toEqual(['FSI', 'PDI', 'FSI', 'PDI'])
    // and the joiner and the combining mark SURVIVED — they shape the word
    expect(m.spans[1]!.text).toBe(SHAPED)

    // the DOCUMENT still holds what the user typed, byte for byte
    const stored = await page.evaluate(() => {
      const e = (window as unknown as Bridge).__loop.graph.getState().edges[0]
      return { timing: e.data.timing as string, when: e.data.when as string }
    })
    expect(stored.timing).toBe(HOSTILE)
    expect(stored.when).toBe(SHAPED)
  })

  test('a frame name is bounded in the polite announcement of a keyboard move and a resize', async ({ page }) => {
    // The sr-only path. Nobody can see it, which is why it needed recording
    // rather than dropping — and `clip` is a PAINT-time rule, so the text is
    // still laid out and still measurable. The width assertion below is what
    // says so rather than assuming it.
    const id = await page.evaluate(() => {
      const f = (window as unknown as Bridge).__loop.frame.getState()
      const fid = f.addFrame({ x: -40, y: -40, w: 420, h: 280 })
      f.renameFrame(fid, '2024 مبيعات')
      return fid as string
    })
    await setLocale(page, 'ar')
    const frame = page.locator('.lgr-frame').first()
    await expect(frame).toBeVisible()
    await frame.focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('ArrowRight')
    await expect
      .poll(() => page.evaluate(() => document.querySelector('[data-frame-announce]')?.textContent ?? ''))
      .toContain('نُقل')

    const moved = (await measure(page, '[data-frame-announce]'))!
    expect(moved.spans.map((s) => s.kind)).toEqual(['FSI'])
    expect(moved.spans[0]!.text).toBe('2024 مبيعات')
    expect(moved.spans[0]!.rect!.width, 'the announcement is clipped, not unlaid-out').toBeGreaterThan(0)
    expect(expectReadingOrder(moved, 'frame.a11y.moved')).toBeGreaterThanOrEqual(2)
    const pm = (await probe(page, '[data-frame-announce]', {
      value: '2024 مبيعات',
      head: moved.head.text,
      tail: moved.tail.text,
      dir: 'auto',
    }))!
    expect(moved.spans[0]!.order, 'the isolated frame name must lay out as it does alone').toEqual(pm.alone)

    // the OTHER branch of the closed key set, same frame, same name
    await page.locator('.lgr-frame__resize').first().focus()
    await page.keyboard.press('ArrowRight')
    await expect
      .poll(() => page.evaluate(() => document.querySelector('[data-frame-announce]')?.textContent ?? ''))
      .toContain('العرض')

    const resized = (await measure(page, '[data-frame-announce]'))!
    expect(resized.spans.map((s) => s.kind)).toEqual(['FSI'])
    expect(resized.spans[0]!.text).toBe('2024 مبيعات')
    expect(resized.head.text).toContain('غُيّر')
    expect(expectReadingOrder(resized, 'frame.a11y.resized')).toBeGreaterThanOrEqual(2)

    // the stored frame name never grew a control
    const label = await page.evaluate(
      (fid) => (window as unknown as Bridge).__loop.frame.getState().frames.find((f: { id: string }) => f.id === fid).label,
      id,
    )
    expect(label).toBe('2024 مبيعات')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// per-fragment — several INDEPENDENT values in one ICU argument
// ───────────────────────────────────────────────────────────────────────────

test.describe('§L9.4 per-fragment — each table label is isolated, the punctuation is not', () => {
  test('three labels, three isolates, and the quotes and commas stay with the sentence', async ({ page }) => {
    const LABELS = ['2024 Sales', 'مبيعات الربع', '(Draft) Q1']
    await openApp(page)
    await resetAll(page)
    await page.evaluate(() => {
      const l = (window as unknown as Bridge).__loop
      l.tour.setState({ phase: 'idle' })
      l.hint.setState({ postTourCooldownActive: false })
    })
    await setLocale(page, 'ar')
    await page.evaluate((tables) => {
      ;(window as unknown as Bridge).__loop.ui.getState().setLastImportBatch({ count: 3, firstId: 'param_1', tables })
    }, LABELS)
    await expect(page.locator('.hint-note')).toBeVisible()

    const m = (await measure(page, '.hint-note'))!
    expect(m.spans.map((s) => s.kind), 'one isolate per label, never one around the join').toEqual(['FSI', 'FSI', 'FSI'])
    // the sentence follows the READER even though the panel around it does not:
    // the React Flow pane is pinned `ltr` (§L9.2) and the span inside declares
    // the reader's direction
    expect(m.direction, 'the sentence itself is rtl').toBe('rtl')
    expect(
      await page.evaluate(() => getComputedStyle(document.querySelector('.hint-note')!).direction),
      'and the panel around it is still the pinned ltr',
    ).toBe('ltr')
    expect(m.spans.map((s) => s.text)).toEqual(LABELS)
    // THE point of the shape: the quote and the comma belong to the sentence, so
    // they sit OUTSIDE the isolates. A single isolate around the joined list
    // would have swallowed them and given the whole list one direction, taken
    // from whichever table the user happened to name first.
    expect(m.head.text.endsWith('"'), 'the opening quote is the sentence’s').toBe(true)
    expect(m.between).toEqual(['", "', '", "'])
    expect(m.tail.text.startsWith('"')).toBe(true)
    expect(m.tail.text).toContain('لوحة المدخلات')
    expect(expectReadingOrder(m, 'importFirstCommit')).toBeGreaterThanOrEqual(1)

    let compared = 0
    let proven = 0
    for (const [i, value] of LABELS.entries()) {
      const p = (await probe(page, '.hint-note', { value, head: m.head.text, tail: m.tail.text, dir: 'auto' }))!
      expect(m.spans[i]!.order, `${value}: isolated fragment must lay out as it does alone`).toEqual(p.alone)
      compared += 1
      if (needsIsolate(value)) {
        expect(p.joined, `${value}: raw interpolation must reorder it (alone=${p.alone}, joined=${p.joined})`).not.toEqual(p.alone)
        proven += 1
      }
    }
    expect(compared).toBe(3)
    expect(proven).toBe(2)

    // the plural arm really is Arabic's, so this is the real catalogue and not a
    // fallback that happens to interpolate the same way
    expect(m.head.text).toContain('مُعامِلات')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// the spreadsheet paths — a real paste
// ───────────────────────────────────────────────────────────────────────────

const AR_HEADER = 'اسم العرض'
const MIXED_HEADER = '2024 Sales'
/** an INCOMING column nothing matches — digit-leading, so it is also one of the
 *  shapes that reorders without an isolate */
const NEW_HEADER = '2024 جديد'

/** The wizard is driven through its ENGLISH labels and only then switched to
 *  `ar`: the flow itself is already covered by `e2e/data-import-wizard.spec.ts`,
 *  and re-deriving every selector in Arabic would be testing that spec again.
 *  What is under test here starts after the switch. */
async function pasteTableWithCell(page: Page, cell: string): Promise<void> {
  await page.getByRole('button', { name: 'Data' }).click()
  await page.getByRole('menuitem').first().click()
  const dlg = page.locator('.mcdlg--dataimport')
  await expect(dlg).toBeVisible()
  await dlg.locator('.import__nameField input').fill('جدول 2024')
  await dlg
    .getByPlaceholder('Paste CSV or TSV text here')
    .fill(`item_key,${AR_HEADER},${MIXED_HEADER}\nitm_a,Ember Blade,${cell}`)
  const headerRow = dlg.locator('.import__preview thead tr').first()
  await headerRow.locator('select').nth(0).selectOption('key')
  await headerRow.locator('select').nth(1).selectOption('label')
  await headerRow.locator('select').nth(2).selectOption('number')
}

test.describe('§L9.4 the spreadsheet paths — a user cell and a user header', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await resetAll(page)
  })

  test('a pasted cell carrying bidi controls is cleaned where it is SHOWN and kept where it is STORED', async ({ page }) => {
    // The cell goes in through the real paste field, so nothing here is a
    // store-level shortcut: this is the path a user's spreadsheet takes.
    await pasteTableWithCell(page, HOSTILE)
    await page.locator('.mcdlg--dataimport').getByRole('button', { name: 'Next' }).click()
    await expect(page.locator('.import__issueLink').first()).toBeVisible()
    await setLocale(page, 'ar')

    // ONE rendered string, built from TWO catalog calls: `issueText` returns
    // `${issueLocation(issue)}: ${desc}`. Until C3.5 the location half passed the
    // table name and the column header RAW while the description half isolated
    // its `{value}` — one sentence with one bounded argument and two unbounded
    // ones, the first two of them at the head. All three are bounded now.
    const m = (await measure(page, '.import__issueLink'))!
    expect(m.found, 'the issue line should carry the isolated cell').toBe(true)
    expect(m.spans.map((s) => s.kind)).toEqual(['FSI', 'FSI', 'FSI'])
    expect(m.spans.map((s) => s.text), 'table name, column header, cell — in that order').toEqual([
      'جدول 2024',
      MIXED_HEADER,
      HOSTILE_CLEAN,
    ])
    expect(m.controls, 'three pairs, nothing else').toEqual(['FSI', 'PDI', 'FSI', 'PDI', 'FSI', 'PDI'])
    expect(m.head.text, 'the location prefix really is the Arabic catalogue').toContain('الجدول')
    expect(m.tail.text).toContain('ليس رقمًا')
    expect(expectReadingOrder(m, 'import.issue.invalid-number')).toBeGreaterThanOrEqual(2)

    // each of the three lays out as it does alone, and the digit-leading header
    // is one of the shapes that NEEDS the isolate
    for (const [i, value] of ['جدول 2024', MIXED_HEADER, HOSTILE_CLEAN].entries()) {
      const p = (await probe(page, '.import__issueLink', {
        value,
        head: m.head.text,
        tail: m.tail.text,
        dir: 'auto',
      }))!
      expect(m.spans[i]!.order, `${value}: isolated must lay out as it does alone`).toEqual(p.alone)
      if (needsIsolate(value)) {
        expect(p.joined, `${value}: raw interpolation must reorder it (alone=${p.alone}, joined=${p.joined})`).not.toEqual(p.alone)
      }
    }

    // the textarea still holds the pasted bytes — the strip is a display copy
    const raw = await page.evaluate(() => (document.querySelector('.import__paste') as HTMLTextAreaElement | null)?.value ?? '')
    expect(raw).toContain(HOSTILE)
  })

  test('both column-event branches bound the existing header they name', async ({ page }) => {
    // The refresh wizard's closed key set. Getting BOTH branches on screen at
    // once is a property of the data, not of the UI: an existing column whose
    // header now matches two incoming columns is `ambiguous-match`, and one that
    // is gone is `missing-header`. So the refresh paste duplicates one header
    // and drops the other.
    await pasteTableWithCell(page, '10')
    const dlg = page.locator('.mcdlg--dataimport')
    await dlg.getByRole('button', { name: 'Next' }).click() // -> placement
    await dlg.getByRole('button', { name: 'Next' }).click() // -> review
    await dlg.getByRole('button', { name: 'Import' }).click()
    await expect(dlg).toBeHidden()

    await page.getByRole('button', { name: 'Data' }).click()
    await page.getByRole('menuitem', { name: 'Refresh or manage imported tables…' }).click()
    const manage = page.getByRole('dialog', { name: 'Manage spreadsheet bindings' })
    await expect(manage).toBeVisible()
    await manage.getByRole('button', { name: 'Refresh…' }).click()
    const refresh = page.getByRole('dialog', { name: /^Refresh "/ })
    await expect(refresh).toBeVisible()
    // a fourth INCOMING column nothing matches makes the third branch reachable
    // in the same refresh: `unrecognized`, which names a NEW header rather than
    // an existing one
    await refresh
      .getByPlaceholder('Paste CSV or TSV text here')
      .fill(`item_key,${AR_HEADER},${AR_HEADER},${NEW_HEADER}\nitm_a,Ember Blade,Iron Charm,7`)
    await refresh.getByRole('button', { name: 'Next' }).click()
    const rows = page.locator('.import__issues ul li p')
    await expect(rows).toHaveCount(2)
    // opened while the labels are still English, for the same reason the wizard is
    await refresh.getByRole('button', { name: 'Map more columns…' }).click()
    await expect(rows).toHaveCount(3)
    await setLocale(page, 'ar')

    const measured = [
      await measure(page, '.import__issues ul li p', 0),
      await measure(page, '.import__issues ul li p', 1),
      await measure(page, '.import__issues ul li p', 2),
    ]
    const missing = measured.find((m) => m!.tail.text.includes('لم يعد'))!
    const ambiguous = measured.find((m) => m!.tail.text.includes('يطابق أكثر'))!
    // C3.5 — the third branch. The PR B census recorded the two events that name
    // an EXISTING column and not the one that names a NEW one; nothing
    // distinguished them but which side of the refresh the header came from.
    const unrecognized = measured.find((m) => m!.tail.text.includes('غير مربوط'))!
    expect(missing, 'the missing-header branch should be on screen').toBeTruthy()
    expect(ambiguous, 'the ambiguous-match branch should be on screen').toBeTruthy()
    expect(unrecognized, 'the unrecognized-header branch should be on screen').toBeTruthy()

    for (const [m, header] of [
      [missing, MIXED_HEADER],
      [ambiguous, AR_HEADER],
      [unrecognized, NEW_HEADER],
    ] as const) {
      expect(m.spans.map((s) => s.kind)).toEqual(['FSI'])
      expect(m.spans[0]!.text).toBe(header)
      expect(m.controls).toEqual(['FSI', 'PDI'])
      expect(m.head.text).toContain('العمود')
      expect(expectReadingOrder(m, `columnEvents/${header}`)).toBeGreaterThanOrEqual(2)
      const p = (await probe(page, '.import__issues ul li p', { value: header, head: m.head.text, tail: m.tail.text, dir: 'auto' }, measured.indexOf(m)))!
      expect(m.spans[0]!.order, `${header}: isolated header must lay out as it does alone`).toEqual(p.alone)
    }
    // the digit-leading header is one of the census's broken shapes, so it also
    // has to be shown to NEED the isolate
    const pm = (await probe(page, '.import__issues ul li p', {
      value: MIXED_HEADER,
      head: missing.head.text,
      tail: missing.tail.text,
      dir: 'auto',
    }, measured.indexOf(missing)))!
    expect(pm.joined, `${MIXED_HEADER}: raw interpolation must reorder it (alone=${pm.alone}, joined=${pm.joined})`).not.toEqual(pm.alone)
  })

  test('the key-column header is bounded in the per-table status line', async ({ page }) => {
    await pasteTableWithCell(page, '10')
    await setLocale(page, 'ar')
    await expect(page.locator('.import__status').first()).toBeVisible()

    const m = (await measure(page, '.import__status'))!
    expect(m.found).toBe(true)
    expect(m.spans.map((s) => s.kind)).toEqual(['FSI'])
    expect(m.spans[0]!.text).toBe('item_key')
    expect(m.head.text).toContain('المفتاح')
    expect(expectReadingOrder(m, 'import.status.key')).toBeGreaterThanOrEqual(1)
    const p = (await probe(page, '.import__status', {
      value: 'item_key',
      head: m.head.text,
      tail: m.tail.text,
      dir: 'auto',
    }))!
    expect(m.spans[0]!.order, 'the isolated value must lay out as it does alone').toEqual(p.alone)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// the document never moves, and a locale round trip never accumulates
// ───────────────────────────────────────────────────────────────────────────

test.describe('§L9.4 display only — the stored document and its digest do not move', () => {
  test('rendering the whole RTL interface leaves the serialization and the digest byte-identical', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await page.evaluate((hostile) => {
      const g = () => (window as unknown as Bridge).__loop.graph.getState()
      g().newGraph()
      g().addNodeAt('pool', { x: 0, y: 0 })
      g().addNodeAt('pool', { x: 260, y: 0 })
      const ids = g().nodes.map((n: { id: string }) => n.id)
      g().updateNodeData(ids[0], { label: 'مَجمَع البن' })
      g().updateNodeData(ids[1], { label: hostile })
      g().onConnect({ source: ids[0], target: ids[1], sourceHandle: 'state-source', targetHandle: 'state-target' })
      g().setEdgeData(g().edges[0].id, { kind: 'state', mode: 'label', expr: '+1', timing: hostile, when: '2024 later' })
      const f = (window as unknown as Bridge).__loop.frame.getState()
      f.renameFrame(f.addFrame({ x: -40, y: -40, w: 420, h: 280 }), '(Draft) مبيعات')
    }, HOSTILE)

    const snapshot = () =>
      page.evaluate(async () => {
        const R = await import('/src/model/revision.ts')
        const S = await import('/src/model/serialize.ts')
        const B = await import('/src/i18n/bidiControls.ts')
        const l = (window as unknown as Bridge).__loop
        const g = l.graph.getState()
        const json = S.serialize(g.nodes, g.edges, undefined, undefined, undefined, g.modelVersion, l.frame.getState().frames)
        return {
          json,
          digest: R.digestOfCanonical(R.canonicalContent({ nodes: g.nodes, edges: g.edges }, { modelVersion: g.modelVersion })),
          controls: [...json].filter((c) => B.hasAnyBidiControl(c)).length,
        }
      })

    const before = await snapshot()
    await setLocale(page, 'ar')
    // render every isolating surface this document reaches: the edge is
    // selected, so the Inspector's timing sentence runs; the canvas paints both
    // node labels and the frame
    await page.evaluate(() => {
      const g = (window as unknown as Bridge).__loop.graph.getState()
      g.setSelection(null, g.edges[0].id)
    })
    await expect(page.locator('.labeltiming__groupline')).toBeVisible()
    const after = await snapshot()

    expect(after.json, 'serializing after an RTL render must be byte-identical').toBe(before.json)
    expect(after.digest, 'the digest must not move').toBe(before.digest)
    // the controls the USER typed are still in the document — the strip is a
    // display copy, and rewriting stored bytes would itself move the digest
    expect(before.controls, 'the hostile value really did reach the document').toBeGreaterThan(0)
    expect(after.controls).toBe(before.controls)
  })

  test('ar → en → ar produces the same string, with no second isolate', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await seedUnsupportedTiming(page, '2024 Sales', '(Draft) later')

    await setLocale(page, 'ar')
    await expect(page.locator('.labeltiming__groupline')).toBeVisible()
    const first = (await measure(page, '.labeltiming__groupline'))!
    expect(first.controls).toEqual(['FSI', 'PDI', 'FSI', 'PDI'])

    await setLocale(page, 'en')
    const inEnglish = (await measure(page, '.labeltiming__groupline'))!
    // the isolate is not an RTL feature — the same argument is bounded in an LTR
    // catalogue too, and the count does not change with the reader
    expect(inEnglish.controls).toEqual(['FSI', 'PDI', 'FSI', 'PDI'])
    expect(inEnglish.spans.map((s) => s.text)).toEqual(['2024 Sales', '(Draft) later'])

    await setLocale(page, 'ar')
    const second = (await measure(page, '.labeltiming__groupline'))!
    expect(second.node, 'the round trip must reproduce the same string exactly').toBe(first.node)
    expect(second.controls).toEqual(first.controls)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// C3.5 — the shapes the first fifteen tests did not already prove
//
// The other twelve obligations added in C3.5 are further INSTANCES of shapes
// already measured above: an `FSI` around a user value, an `LRI` around a
// technical token, in an Arabic sentence. What decides whether each of those is
// wired is its kind, argument slot and call site, and that is asserted exactly
// by `scripts/check-isolate-arguments.mjs`, which is falsified per obligation.
// These three are here because each brings a shape the browser had not seen.
// ───────────────────────────────────────────────────────────────────────────

test.describe('§L9.4 the shapes C3.5 added', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await resetAll(page)
  })

  test('a language ENDONYM keeps its own direction inside the other language’s sentence', async ({ page }) => {
    // The one site where the value's direction is not merely unknown but
    // usually OPPOSITE: the banner names a language by its own endonym, in
    // whichever language is still on screen. Under `ar` that is a Cyrillic or
    // Japanese name inside an Arabic sentence, every time.
    await setLocale(page, 'ar')
    await page.evaluate(() => {
      ;(window as unknown as { __loop: { i18n: { setState: (p: Record<string, unknown>) => void } } }).__loop.i18n.setState({
        loadError: { code: 'ru', current: 'ar' },
      })
    })
    await expect(page.locator('.boot-notice__text')).toBeVisible()

    const m = (await measure(page, '.boot-notice__text'))!
    expect(m.spans.map((s) => s.kind)).toEqual(['FSI', 'FSI'])
    expect(m.spans[0]!.text, 'the endonym, not the English name').toBe('Русский')
    expect(m.spans[1]!.text).toBe('العربية')
    expect(m.controls).toEqual(['FSI', 'PDI', 'FSI', 'PDI'])
    expect(m.direction).toBe('rtl')
    // ONE relation, not two: the sentence ends `…{current}.`, so the text after
    // the last isolate is a full stop — no strong character, no defined side
    expect(expectReadingOrder(m, 'i18n.loadFailed')).toBe(1)

    const p = (await probe(page, '.boot-notice__text', {
      value: 'Русский',
      head: m.head.text,
      tail: m.tail.text,
      dir: 'auto',
    }))!
    expect(p.aloneDir, 'a Cyrillic endonym resolves ltr on its own').toBe('ltr')
    expect(m.spans[0]!.order, 'the isolated endonym lays out as it does alone').toEqual(p.alone)
  })

  test('the resource-type mismatch isolates each TYPE, leaving the arrow and the comma to the sentence', async ({ page }) => {
    // The SECOND per-fragment site, and a different shape from the first: the
    // canvas hint joins single labels with `, `, this joins PAIRS with `, ` and
    // each pair with `↔`. Both separators belong to the sentence, so four user
    // values produce four isolates and neither separator is inside one.
    await page.evaluate(() => {
      const g = () => (window as unknown as { __loop: { graph: { getState: () => any } } }).__loop.graph.getState()
      g().newGraph()
      g().addNodeAt('pool', { x: 0, y: 0 })
      g().addNodeAt('pool', { x: 260, y: 0 })
      const ids = g().nodes.map((n: { id: string }) => n.id)
      g().updateNodeData(ids[0], { resourceType: '2024 Coins' })
      g().updateNodeData(ids[1], { resourceType: '(مسودة) بن' })
      g().onConnect({ source: ids[0], target: ids[1], sourceHandle: 'out', targetHandle: 'in' })
      // trailing whitespace so the NORMALISED note renders in the same panel
      g().setEdgeData(g().edges[0].id, { kind: 'resource', flow: '1', resourceType: '  ذهب  ' })
      g().setSelection(null, g().edges[0].id)
    })
    await setLocale(page, 'ar')
    await expect(page.locator('.inspector__note--warn')).toBeVisible()

    const m = (await measure(page, '.inspector__note--warn'))!
    // two findings (source and target pool), each naming the edge type and the
    // node type — four independent user values, four isolates
    expect(m.spans.map((s) => s.kind)).toEqual(['FSI', 'FSI', 'FSI', 'FSI'])
    expect(m.spans.map((s) => s.text)).toEqual(['ذهب', '2024 Coins', 'ذهب', '(مسودة) بن'])
    expect(m.controls).toEqual(['FSI', 'PDI', 'FSI', 'PDI', 'FSI', 'PDI', 'FSI', 'PDI'])
    // the arrow is BETWEEN a pair and the comma between pairs — both outside
    expect(m.between[0], 'the arrow belongs to the sentence').toBe(' ↔ ')
    expect(m.between[1], 'the comma belongs to the sentence').toBe(', ')
    expect(m.between[2]).toBe(' ↔ ')
    expect(m.head.text).toContain('عدم تطابق')
    expect(expectReadingOrder(m, 'resourceType.mismatch')).toBeGreaterThanOrEqual(2)

    let proven = 0
    for (const [i, value] of ['ذهب', '2024 Coins', 'ذهب', '(مسودة) بن'].entries()) {
      const p = (await probe(page, '.inspector__note--warn', {
        value,
        head: m.head.text,
        tail: m.tail.text,
        dir: 'auto',
      }))!
      expect(m.spans[i]!.order, `${value}: isolated fragment must lay out as it does alone`).toEqual(p.alone)
      if (needsIsolate(value)) {
        expect(p.joined, `${value}: raw interpolation must reorder it (alone=${p.alone}, joined=${p.joined})`).not.toEqual(p.alone)
        proven += 1
      }
    }
    // one of the four — `(مسودة) بن` is bracket-leading but Arabic, so it agrees
    // with the paragraph and never reorders; it is here to prove the isolate does
    // not DAMAGE a value that needed nothing
    expect(proven, 'the one reordering shape was exercised').toBe(1)

    // and the normalised note in the same panel bounds its own value
    const n = (await measure(page, '.inspector__note:not(.inspector__note--warn)'))!
    expect(n.spans.map((s) => s.kind)).toEqual(['FSI'])
    expect(n.spans[0]!.text, 'the trimmed form, isolated').toBe('ذهب')
  })

  test('the bad-reference row bounds a NAME with FSI and an ID with LRI, from one call site', async ({ page }) => {
    // One call passes both `{name}` and `{id}` because the key is not known
    // until runtime — but no catalog value uses both, so each rendering carries
    // ONE isolate. What matters is that it is the RIGHT one on each branch.
    const seed = (expr: string) =>
      page.evaluate((e) => {
        const g = () => (window as unknown as { __loop: { graph: { getState: () => any } } }).__loop.graph.getState()
        g().newGraph()
        g().addNodeAt('source', { x: 0, y: 0 })
        g().addNodeAt('register', { x: 260, y: 0 })
        const ids = g().nodes.map((n: { id: string }) => n.id)
        g().updateNodeData(ids[0], { label: '2024 مصدر' })
        g().updateNodeData(ids[1], { label: 'Reg', expr: e.replace('SOURCE', ids[0]) })
        g().setSelection(ids[1], null)
      }, expr)

    await seed('@{SOURCE}')
    await setLocale(page, 'ar')
    await expect(page.locator('.regrb__line--bad')).toBeVisible()

    const wrong = (await measure(page, '.regrb__line--bad'))!
    expect(wrong.spans.map((s) => s.kind), 'a user NAME takes the first-strong isolate').toEqual(['FSI'])
    expect(wrong.spans[0]!.text).toBe('2024 مصدر')
    expect(wrong.tail.text).toContain('ليس مَجمَعًا')

    await seed('@{2024-ghost}')
    await expect.poll(() => page.locator('.regrb__line--bad').innerText()).toContain('غير موجود')

    const unknown = (await measure(page, '.regrb__line--bad'))!
    expect(unknown.spans.map((s) => s.kind), 'a node ID takes the forced-ltr isolate').toEqual(['LRI'])
    expect(unknown.spans[0]!.text).toBe('2024-ghost')
    expect(unknown.controls).toEqual(['LRI', 'PDI'])
    const p = (await probe(page, '.regrb__line--bad', {
      value: '2024-ghost',
      head: unknown.head.text,
      tail: unknown.tail.text,
      dir: 'ltr',
    }))!
    expect(unknown.spans[0]!.order).toEqual(p.alone)
  })
})
