import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'
import { openPanelDetails } from './support/panel'

// docs/localization.md §L9.3 / §L9.4 / §L2.0a — the bidi-isolation contract, under
// the shipped Arabic (`ar`).
//
// THE CONTRACT (2026-10-29): the LAYOUT never mirrors — `<html dir>` is `ltr` for
// every locale — and only the TEXT of an RTL language reads right to left. A chrome
// sentence gets its reading direction from `unicode-bidi: plaintext` (src/index.css):
// its computed `direction` stays `ltr`, and the paragraph reads in the direction of
// its first strong character, which in the Arabic catalog is Arabic
// (src/i18n/arCopy.test.ts). Everything here is TEXT, so it runs under `ar`, with
// Arabic sentences. It ran under `ar-XB` while Arabic was archived; `ar-XB`'s English
// sentences now read ltr under `plaintext`, so it can no longer show an rtl sentence
// and is kept for the direction switch itself (rtl-locale-direction.spec.ts).
//
// WHERE THIS CAME FROM. These checks were measured in `e2e/i18n-ar-isolation.spec.ts`
// and `e2e/i18n-ar.spec.ts`, in real Arabic sentences. `i18n-ar.spec.ts` is restored
// to e2e/; `i18n-ar-isolation.spec.ts` STAYS ARCHIVED (archive/i18n/e2e/): its
// contract lives here, now under `ar` again. The isolates never came from the Arabic
// catalogue: `isolateAuto` / `isolateLtr` (src/i18n/bidiIsolate.ts) are called at the
// RENDER ARGUMENT, in product code, whatever the active locale, and a `dir` pin is an
// attribute in JSX.
//
// WHAT IS KEPT, AND WHAT IS NOT
//
//   kept      — STRUCTURE: which isolate (FSI or LRI) bounds which value, that each
//               argument gets exactly one pair and nothing else, that a hostile
//               control is cleaned from the DISPLAY copy and kept in the STORED one,
//               that a locale round trip adds no second isolate, and that the
//               document and its digest do not move.
//             — INNER LAYOUT: the visual order of the characters inside an isolate
//               equals the same value laid out on its own in the same container.
//               That comparison does not depend on the sentence around the value,
//               which is what an isolate is for.
//             — the OUTER reading order (`expectReadingOrder`): the sentence's head
//               paints to the RIGHT of the value and its tail to the LEFT. Dropped
//               while this ran under `ar-XB` (an English sentence has no rtl outer
//               order to measure); back with the Arabic sentences, and it is now the
//               evidence that a sentence reads rtl, since its computed `direction`
//               is `ltr` under `plaintext`.
//   not kept  — the "necessity" probes (the same value interpolated raw must
//               reorder). They are in the archived i18n-ar-isolation.spec.ts and
//               are not restored here: they measure the bidi algorithm on a raw
//               value, not a product path.
//
// Already covered elsewhere and not repeated: fragment and endonym isolation
// (`rtl-mixed-direction.spec.ts`), the frame name's isolate shape in the live
// announcement (`a11y-announcement-contract.spec.ts`), and the document never moving
// on a direction switch (`rtl-canvas-content-direction.spec.ts`).
//
// Why geometry and not `textContent` for the layout half: the helpers add zero-width
// characters, so a text comparison is green whether or not the isolate works. The
// measurement is `Range` rectangles over the text node's own offsets — the only handle
// there is on a value that has no element of its own.

const PDI = String.fromCharCode(0x2069)

// the hostile input: an RLO override closed by nothing, an unmatched PDI that would
// end an isolate placed around this value, and a bare LRM strong mark. None of the
// three is a C0 control, so nothing upstream of the display boundary removes them.
const RLO = String.fromCharCode(0x202e)
const LRM = String.fromCharCode(0x200e)
const HOSTILE = `A${RLO}B${PDI}C${LRM}D`
const HOSTILE_CLEAN = 'ABCD'

// ZWNJ and an Arabic combining mark must SURVIVE the strip — they shape and compose
// the text rather than steer its direction. User content, so it stays Arabic.
const ZWNJ = String.fromCharCode(0x200c)
const FATHA = String.fromCharCode(0x064e)
const SHAPED = `ت${ZWNJ}ج${FATHA}ربة`

/** `order` is the whole span's visual order (lines top to bottom); `lines` is the
 *  same, one array per rendered line, each in its own visual order; `chars` the
 *  glyph boxes, for the outer reading order. */
type Glyph = { left: number; right: number; top: number }
type Span = { kind: string; text: string; width: number; order: number[]; lines: number[][]; chars: Glyph[] }
type Anchor = { ch: string; left: number; right: number; top: number }
type Measured = {
  found: boolean
  controls: string[]
  /** the computed `direction` of the element the sentence is in — `ltr` for chrome
   *  prose under `plaintext`, `rtl` where a component declares the reader's `dir` */
  direction: string
  unicodeBidi: string
  node: string
  head: string
  tail: string
  /** the nearest Arabic letter before the first isolate / after the last */
  headAnchor: Anchor | null
  tailAnchor: Anchor | null
  between: string[]
  spans: Span[]
}

type Bridge = {
  __loop: {
    graph: { getState: () => any }
    frame: { getState: () => any }
    ui: { getState: () => any }
    tour: {
      getState: () => { startReplay: (platform: string) => void }
      setState: (p: Record<string, unknown>) => void
    }
    hint: { setState: (p: Record<string, unknown>) => void }
    project: { getState: () => any }
    i18n: { getState: () => { setLocale: (c: string) => void } }
  }
}

async function setLocale(page: Page, code: 'ar' | 'en'): Promise<void> {
  await page.evaluate((c) => {
    ;(window as unknown as Bridge).__loop.i18n.getState().setLocale(c)
  }, code)
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(code)
  // the TEXT direction really is the RTL one, so nothing below is passing on an ltr
  // reader — and the LAYOUT direction stays ltr for both
  await expect(page.locator('html')).toHaveAttribute('data-text-dir', code === 'ar' ? 'rtl' : 'ltr')
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
}

/** OUTER — in an RTL paragraph the sentence's head paints to the RIGHT of the value
 *  and its tail to the LEFT, unless the line wrapped between them, in which case the
 *  later part is simply lower. Restored from the archived i18n-ar-isolation.spec.ts.
 *
 *  Returns HOW MANY relations it checked. A head with no Arabic letter (a bare quote)
 *  has no side of its own and is skipped — and skipping silently is how a file like
 *  this ends up asserting nothing, so every caller asserts the returned count. */
function expectReadingOrder(m: Measured, label: string): number {
  let n = 0
  const check = (anchor: Anchor, span: Span, side: 'head' | 'tail') => {
    const onLine = span.chars.filter((c) => Math.abs(c.top - anchor.top) <= 2)
    if (onLine.length === 0) {
      const spanTop = Math.min(...span.chars.map((c) => c.top))
      if (side === 'head') expect(anchor.top, `${label}: head wrapped above the value`).toBeLessThan(spanTop)
      else expect(anchor.top, `${label}: tail wrapped below the value`).toBeGreaterThan(spanTop)
    } else if (side === 'head') {
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
  if (m.headAnchor && m.spans[0]?.chars.length) check(m.headAnchor, m.spans[0], 'head')
  const last = m.spans[m.spans.length - 1]
  if (m.tailAnchor && last?.chars.length) check(m.tailAnchor, last, 'tail')
  return n
}

/** the sentence reads rtl: an element that declares the reader's `dir` computes
 *  `rtl`; chrome prose keeps `direction: ltr` and reads rtl through `plaintext` —
 *  either way the outer order is measured, at least once */
function expectRtlSentence(m: Measured, label: string): void {
  if (m.direction !== 'rtl') {
    expect(m.direction, `${label}: the layout direction stays ltr`).toBe('ltr')
    expect(m.unicodeBidi, `${label}: the chrome text carries plaintext`).toBe('plaintext')
  }
  expect(expectReadingOrder(m, label), `${label}: at least one outer relation measured`).toBeGreaterThan(0)
}

/** Everything one rendered sentence can say about its isolates.
 *
 *  `order` is the VISUAL order of a span's characters as logical indexes — `[0,1,2]`
 *  paints left to right as authored, `[2,1,0]` reversed. Sorted by LINE and then by
 *  x (x alone interleaves two lines and reports a wrap as a reordering); whitespace
 *  and zero-width characters contribute no rectangle and are left out. */
function measure(page: Page, selector: string, nth = 0): Promise<Measured | null> {
  return page.evaluate(
    async ({ selector: sel, nth: idx }) => {
      const B = await import('/src/i18n/bidiControls.ts')
      const el = document.querySelectorAll(sel)[idx] as HTMLElement | undefined
      if (!el) return null
      const NAME = new Map<string, string>([...B.BANNED_CONTROLS, ...B.ISOLATE_OPENERS, [B.PDI, 'PDI']])
      const controls = [...(el.textContent ?? '')].filter((c) => NAME.has(c)).map((c) => NAME.get(c)!)

      // the text node that carries the isolate — the ICU output is ONE node, and a
      // sibling node (an icon's space, a count) is not part of this sentence
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      let tn: Text | null = null
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if ([...(n as Text).data].some((c) => B.ISOLATE_OPENERS.has(c))) {
          tn = n as Text
          break
        }
      }
      // the direction of the element the SENTENCE is in, which is not always the one
      // the selector named (a hint panel can sit in the canvas pane, pinned `ltr`)
      const direction = getComputedStyle(tn?.parentElement ?? el).direction
      const unicodeBidi = getComputedStyle(tn?.parentElement ?? el).unicodeBidi
      if (!tn) {
        return { found: false, controls, direction, unicodeBidi, node: '', head: '', tail: '', headAnchor: null, tailAnchor: null, between: [] as string[], spans: [] as Span[] }
      }

      const text = tn
      const data = text.data
      const rectOf = (from: number, to: number) => {
        const r = document.createRange()
        r.setStart(text, from)
        r.setEnd(text, to)
        return r.getBoundingClientRect()
      }
      const linesIn = (from: number, to: number) => {
        const seen: { i: number; left: number; top: number }[] = []
        for (let i = from; i < to; i++) {
          if (/\s/.test(data[i]!)) continue
          const b = rectOf(i, i + 1)
          if (b.width > 0.01) seen.push({ i: i - from, left: b.left, top: Math.round(b.top) })
        }
        seen.sort((a, b) => a.top - b.top || a.left - b.left)
        const lines: number[][] = []
        let top: number | null = null
        for (const s of seen) {
          if (s.top !== top) {
            lines.push([])
            top = s.top
          }
          lines[lines.length - 1]!.push(s.i)
        }
        return lines
      }

      const found: { span: Span; from: number; to: number }[] = []
      for (let i = 0; i < data.length; i++) {
        const opener = B.ISOLATE_OPENERS.get(data[i]!)
        if (!opener) continue
        const close = data.indexOf(B.PDI, i)
        if (close < 0) break
        const lines = linesIn(i + 1, close)
        const chars: Glyph[] = []
        for (let k = i + 1; k < close; k++) {
          if (/\s/.test(data[k]!)) continue
          const b = rectOf(k, k + 1)
          if (b.width > 0.01) chars.push({ left: b.left, right: b.right, top: Math.round(b.top) })
        }
        found.push({
          span: {
            kind: opener,
            text: data.slice(i + 1, close),
            width: close > i + 1 ? rectOf(i + 1, close).width : 0,
            order: lines.flat(),
            lines,
            chars,
          },
          from: i,
          to: close,
        })
        i = close
      }
      const between: string[] = []
      for (let k = 1; k < found.length; k++) between.push(data.slice(found[k - 1]!.to + 1, found[k]!.from))
      // The head / tail ANCHOR: the nearest character on that side that is an Arabic
      // letter. A union rectangle over the whole head or tail is not usable — once
      // the sentence wraps it spans every line — and a neutral character (a quote, a
      // dash) has no side of its own to compare against. One strong letter does.
      const STRONG = /[֐-ࣿיִ-﷿ﹰ-﻿]/
      const anchorAt = (k: number) => {
        const r = rectOf(k, k + 1)
        return { ch: data[k]!, left: r.left, right: r.right, top: Math.round(r.top) }
      }
      let headAnchor: { ch: string; left: number; right: number; top: number } | null = null
      let tailAnchor: { ch: string; left: number; right: number; top: number } | null = null
      if (found.length > 0) {
        let hi = found[0]!.from - 1
        while (hi >= 0 && !STRONG.test(data[hi]!)) hi--
        if (hi >= 0) headAnchor = anchorAt(hi)
        let ti = found[found.length - 1]!.to + 1
        while (ti < data.length && !STRONG.test(data[ti]!)) ti++
        if (ti < data.length) tailAnchor = anchorAt(ti)
      }
      return {
        found: found.length > 0,
        controls,
        direction,
        unicodeBidi,
        headAnchor,
        tailAnchor,
        node: data,
        // an opener with no PDI after it leaves `found` empty: the whole node is head
        head: found.length > 0 ? data.slice(0, found[0]!.from) : data,
        tail: found.length > 0 ? data.slice(found[found.length - 1]!.to + 1) : '',
        between,
        spans: found.map((f) => f.span),
      }
    },
    { selector, nth },
  )
}

/** The same value rendered ALONE in the element that contains the sentence — one
 *  font, one direction context, so the two orders are comparable rather than argued.
 *
 *  An `inline-block` with `white-space: nowrap`: a probe that wraps reads as
 *  "unchanged" whatever the bidi algorithm did, and an inline-block is its own bidi
 *  paragraph, which is what the isolate makes of the value too. */
function probeAlone(
  page: Page,
  selector: string,
  value: string,
  dir: 'auto' | 'ltr',
  nth = 0,
): Promise<{ alone: number[]; aloneDir: string } | null> {
  return page.evaluate(
    async ({ selector: sel, nth: idx, value: v, dir: d }) => {
      const B = await import('/src/i18n/bidiControls.ts')
      const el = document.querySelectorAll(sel)[idx] as HTMLElement | undefined
      if (!el) return null
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      let host: HTMLElement | null = null
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if ([...(n as Text).data].some((c) => B.ISOLATE_OPENERS.has(c))) {
          host = (n as Text).parentElement
          break
        }
      }
      if (!host) return null
      const solo = document.createElement('span')
      solo.setAttribute('dir', d)
      solo.style.whiteSpace = 'nowrap'
      solo.style.display = 'inline-block'
      solo.textContent = v
      host.appendChild(solo)
      const node = solo.firstChild as Text
      const seen: { i: number; left: number; top: number }[] = []
      for (let i = 0; i < v.length; i++) {
        if (/\s/.test(v[i]!)) continue
        const r = document.createRange()
        r.setStart(node, i)
        r.setEnd(node, i + 1)
        const b = r.getBoundingClientRect()
        if (b.width > 0.01) seen.push({ i, left: b.left, top: Math.round(b.top) })
      }
      const aloneDir = getComputedStyle(solo).direction
      solo.remove()
      return { alone: seen.sort((x, y) => x.top - y.top || x.left - y.left).map((s) => s.i), aloneDir }
    },
    { selector, nth, value, dir },
  )
}

/** INNER — span `i` of `m` lays out exactly as its value does on its own. Returns the
 *  probe of the whole value so a caller can also assert the direction it resolved to.
 *
 *  LINE BY LINE. A value can wrap inside its sentence, and the probe never does. The
 *  bidi algorithm reorders each LINE on its own, after line breaking (UAX #9 §3.4), so
 *  an rtl value of two words that wraps paints word one on the first line and word two
 *  on the next, where alone on one line word two sits LEFT of word one. Comparing the
 *  two whole orders read that wrap as a reordering — it failed on `مبيعات الربع` under
 *  the longer `ar-XB` sentence (2026-10-19), with the isolate working. So each rendered
 *  line is compared with ITS OWN logical slice of the value laid out alone, and the
 *  slices must be contiguous and in logical order: a value whose characters jumped
 *  between lines out of order fails here as a real reordering. */
async function expectOwnOrder(
  page: Page,
  selector: string,
  m: Measured,
  i: number,
  dir: 'auto' | 'ltr',
  nth = 0,
): Promise<{ alone: number[]; aloneDir: string }> {
  const span = m.spans[i]!
  const p = await probeAlone(page, selector, span.text, dir, nth)
  expect(p, `${span.text}: the probe found the sentence`).not.toBeNull()
  // non-vacuous: an empty order on both sides would compare equal and prove nothing
  expect(span.order.length, `${span.text}: the isolated value was laid out`).toBeGreaterThan(0)
  if (span.lines.length <= 1) {
    expect(span.order, `${span.text}: the isolated value must lay out as it does alone`).toEqual(p!.alone)
    return p!
  }
  let next = 0
  for (const [k, line] of span.lines.entries()) {
    const from = Math.min(...line)
    const to = Math.max(...line)
    // line k holds the logical slice that follows line k-1's, and nothing else
    expect(from, `${span.text}: line ${k + 1} continues where line ${k} ended`).toBeGreaterThanOrEqual(next)
    const nonSpace = [...span.text.slice(from, to + 1)].filter((c) => !/\s/.test(c)).length
    expect(line.length, `${span.text}: line ${k + 1} is one contiguous logical slice`).toBe(nonSpace)
    const piece = await probeAlone(page, selector, span.text.slice(from, to + 1), dir, nth)
    expect(
      line,
      `${span.text}: line ${k + 1} (${JSON.stringify(span.text.slice(from, to + 1))}) must lay out as that slice does alone`,
    ).toEqual(piece!.alone.map((x) => x + from))
    next = to + 1
  }
  return p!
}

/** move the selection marks onto the first edge, as a click on it does — the last add
 *  left its node marked selected. Runs in the page: `page.evaluate(selectFirstEdge)`. */
function selectFirstEdge() {
  const g = (window as unknown as Bridge).__loop.graph.getState()
  g.onNodesChange(
    g.nodes
      .filter((n: { selected?: boolean }) => n.selected)
      .map((n: { id: string }) => ({ id: n.id, type: 'select', selected: false })),
  )
  g.onEdgesChange([{ id: g.edges[0].id, type: 'select', selected: true }])
  g.setSelection(null, g.edges[0].id)
}

// ───────────────────────────────────────────────────────────────────────────
// two element-level pins that i18n-ar.spec.ts measured
// ───────────────────────────────────────────────────────────────────────────

test.describe('§L9.3 the tour step counter keeps its order under an rtl interface', () => {
  // ported from i18n-ar.spec.ts while Arabic was archived; i18n-ar.spec.ts is back
  // and carries the same check from the Arabic side. `tour.nav.position` is
  // `{n} / {total}` — two number runs with a neutral slash between them, so inside
  // an rtl paragraph the runs swap and step 2 of 6 reads `6 / 2`. The fix is the
  // element's own `dir="ltr"` (GuidedTour.tsx), not the catalogue. Asserted on
  // GEOMETRY: the characters are identical either way.
  test('`{n} / {total}` paints n-then-total', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'ar')
    await page.evaluate(() => (window as unknown as Bridge).__loop.tour.getState().startReplay('desktop'))
    const pos = page.locator('.tour-popover__pos')
    await expect(pos).toBeVisible()
    // advance once so the two numbers differ and a swap is visible at all
    await page.locator('.tour-popover__foot .btn--primary').click()
    await expect(pos).toHaveText('2 / 6')

    const measured = await pos.evaluate((el) => {
      const t = el.firstChild as Text
      const rect = (from: number, to: number) => {
        const r = document.createRange()
        r.setStart(t, from)
        r.setEnd(t, to)
        const b = r.getBoundingClientRect()
        return { left: b.left, right: b.right }
      }
      const i = t.data.indexOf('/')
      return { text: t.data, n: rect(0, i), total: rect(i + 1, t.data.length), direction: getComputedStyle(el).direction }
    })

    expect(measured.text).toBe('2 / 6')
    expect(measured.direction, 'the counter is pinned ltr inside the rtl popover').toBe('ltr')
    expect(
      measured.n.right,
      `"${measured.text}" rendered with the step number to the RIGHT of the total — the runs swapped`,
    ).toBeLessThanOrEqual(measured.total.left + 1)
  })
})

test.describe('§L9.3 the quick-start column mapping is prose, the example above it is data', () => {
  // ported from i18n-ar.spec.ts while Arabic was archived. The `<pre>` holding
  // EXAMPLE_CSV is `dir="ltr"` because its layout IS the data; the mapping paragraph
  // under it pairs a column name with a role name, so it takes the reader's
  // direction. That element-level ruling is product markup and is kept.
  //
  // Under the fixed LTR layout the paragraph's computed `direction` is `ltr` and it
  // reads rtl through `plaintext` — so "takes the reader's direction" is measured on
  // the glyphs: the first column name, `item_id`, paints to the RIGHT of the last,
  // `drop_rate` (same line). The full right-to-left geometry is i18n-ar.spec.ts's.
  test('the mapping takes the reader’s direction, the CSV stays ltr, and the four names are intact and in file order', async ({
    page,
  }) => {
    await openApp(page)
    await resetAll(page)
    await setLocale(page, 'ar')

    // Data, reached by its slot — the label is Arabic now
    await page.locator('.toolbar__actions [data-group="data"] .wb-mb').click()
    await page.getByRole('menuitem').first().click()
    const dlg = page.locator('.mcdlg--dataimport')
    await expect(dlg).toBeVisible()
    const mapping = dlg.locator('.import__quickstartMapping')
    if (!(await mapping.isVisible().catch(() => false))) {
      await dlg.locator('.import__quickstartToggle').click()
    }
    await expect(mapping).toBeVisible()

    const read = await dlg.evaluate((d) => {
      const p = d.querySelector('.import__quickstartMapping') as HTMLElement
      const pre = d.querySelector('.import__example') as HTMLElement | null
      const t = p.firstChild as Text
      const box = (needle: string) => {
        const i = t.data.indexOf(needle)
        const r = document.createRange()
        r.setStart(t, i)
        r.setEnd(t, i + needle.length)
        const b = r.getBoundingClientRect()
        return { left: b.left, right: b.right, top: Math.round(b.top) }
      }
      return {
        text: p.textContent ?? '',
        direction: getComputedStyle(p).direction,
        unicodeBidi: getComputedStyle(p).unicodeBidi,
        preDirection: pre ? getComputedStyle(pre).direction : null,
        first: box('item_id'),
        last: box('drop_rate'),
      }
    })

    // the prose carries the locale's `dir` — a text-level direction (its
    // Latin column names open the sentence, so the chrome's plaintext rule
    // alone would read it ltr); the layout around it is untouched
    expect(read.direction, 'the prose takes the reader’s direction').toBe('rtl')
    // the text half: the paragraph reads rtl — what comes first paints further right
    if (read.first.top === read.last.top) {
      expect(read.first.left, `prose takes the reader’s direction: \`item_id\` right of \`drop_rate\` in ${JSON.stringify(read.text)}`).toBeGreaterThanOrEqual(read.last.right - 1)
    } else {
      expect(read.last.top, 'a wrap puts the later name on a later line').toBeGreaterThan(read.first.top)
    }
    expect(read.preDirection, 'the literal CSV is pinned ltr').toBe('ltr')
    // each name is one intact run, and they come in the order the file has them
    const names = ['item_id', 'item_name', 'price', 'drop_rate']
    const at = names.map((n) => read.text.indexOf(n))
    for (const [i, n] of names.entries()) expect(at[i], `\`${n}\` survives as one run`).toBeGreaterThanOrEqual(0)
    for (let i = 1; i < at.length; i++) {
      expect(at[i], `\`${names[i]}\` follows \`${names[i - 1]}\``).toBeGreaterThan(at[i - 1]!)
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
// LRI — a technical token whose direction is known in advance
// ───────────────────────────────────────────────────────────────────────────

test.describe('§L9.4 LRI — an id keeps its own left-to-right order under an rtl interface', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await resetAll(page)
  })

  test('a DIGIT-leading revision id is LRI-isolated and reads in its authored order', async ({ page }) => {
    // ported from i18n-ar-isolation.spec.ts (archived; its contract lives here).
    // `short()` strips the `rev_` prefix, so the token starts with a digit — which
    // has no strong direction of its own. That is why the obligation is `LRI` and not
    // `FSI`: a first-strong isolate would hand the token the paragraph's direction.
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
    expect(m.controls).toEqual(['LRI', 'PDI'])
    // `revChip.rev` in the Arabic catalog: `مراجعة {id}`
    expect(m.head).toContain('مراجعة')
    expectRtlSentence(m, 'rev chip')

    const p = await expectOwnOrder(page, '.rev-chip', m, 0, 'ltr')
    expect(p.aloneDir).toBe('ltr')
  })

  test('a SYMBOL-leading node id in a flow reference is LRI-isolated', async ({ page }) => {
    // ported from i18n-ar-isolation.spec.ts (archived; its contract lives here).
    // `@{…}` is the braced reference form, so an id the generator would never produce
    // can still be authored — which is what makes a symbol-leading token reachable.
    await page.evaluate(() => {
      const g = () => (window as unknown as Bridge).__loop.graph.getState()
      g().newGraph()
      g().addNodeAt('source', { x: 0, y: 0 })
      g().addNodeAt('pool', { x: 240, y: 0 })
      const [src, pool] = g().nodes.map((n: { id: string }) => n.id)
      g().onConnect({ source: src, target: pool, sourceHandle: 'out', targetHandle: 'in' }, 'flow')
      g().setEdgeData(g().edges[0].id, { kind: 'resource', flow: '@{#7-beta}' })
    })
    await page.evaluate(selectFirstEdge)
    await setLocale(page, 'ar')
    await expect(page.locator('.inspector__note--warn')).toBeVisible()

    const m = (await measure(page, '.inspector__note--warn'))!
    expect(m.spans.map((s) => s.kind)).toEqual(['LRI'])
    expect(m.spans[0]!.text).toBe('#7-beta')
    // `inspector.edge.flowParam.unknown`: `لا يوجد مُعامِل باسم “{id}” — …`
    expect(m.head).toContain('لا يوجد مُعامِل باسم')
    expectRtlSentence(m, 'flowParam.unknown')
    await expectOwnOrder(page, '.inspector__note--warn', m, 0, 'ltr')
  })

  test('an existing non-Parameter node id takes the same isolate on the other branch', async ({ page }) => {
    // ported from i18n-ar-isolation.spec.ts (archived; its contract lives here).
    // The closed key set's second branch: `flowParam.notParam`.
    const pool = await page.evaluate(() => {
      const g = () => (window as unknown as Bridge).__loop.graph.getState()
      g().newGraph()
      g().addNodeAt('source', { x: 0, y: 0 })
      g().addNodeAt('pool', { x: 240, y: 0 })
      const ids = g().nodes.map((n: { id: string }) => n.id)
      g().onConnect({ source: ids[0], target: ids[1], sourceHandle: 'out', targetHandle: 'in' }, 'flow')
      g().setEdgeData(g().edges[0].id, { kind: 'resource', flow: `@{${ids[1]}}` })
      return ids[1] as string
    })
    await page.evaluate(selectFirstEdge)
    await setLocale(page, 'ar')
    await expect(page.locator('.inspector__note--warn')).toBeVisible()

    const m = (await measure(page, '.inspector__note--warn'))!
    expect(m.spans.map((s) => s.kind)).toEqual(['LRI'])
    expect(m.spans[0]!.text).toBe(pool)
    // `inspector.edge.flowParam.notParam`: `“{id}” ليس مُعامِلًا — …`
    expect(m.tail).toContain('ليس مُعامِلًا')
    expectRtlSentence(m, 'flowParam.notParam')
    await expectOwnOrder(page, '.inspector__note--warn', m, 0, 'ltr')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// FSI — a value whose direction is not known in advance
// ───────────────────────────────────────────────────────────────────────────

/** an edge whose timing / condition combination the engine does not support, so the
 *  Inspector renders the one sentence that interpolates BOTH raw document values.
 *  They are raw strings in the document, which is what makes this the cheapest honest
 *  place to put a deliberately hostile value. */
async function seedUnsupportedTiming(page: Page, timing: string, when: string): Promise<void> {
  await page.evaluate(
    ({ timing: tm, when: wh }) => {
      const g = () => (window as unknown as Bridge).__loop.graph.getState()
      g().newGraph()
      g().addNodeAt('pool', { x: 0, y: 0 })
      g().addNodeAt('pool', { x: 260, y: 0 })
      const ids = g().nodes.map((n: { id: string }) => n.id)
      g().onConnect({ source: ids[0], target: ids[1], sourceHandle: 'state-source', targetHandle: 'state-target' }, 'change')
      // `mode: 'label'` is what makes the Inspector render LabelTimingField at all,
      // and `expr` is what makes the label a label
      g().setEdgeData(g().edges[0].id, { kind: 'state', mode: 'label', expr: '+1', timing: tm, when: wh })
    },
    { timing, when },
  )
  await page.evaluate(selectFirstEdge)
  // the timing sentence is in the panel's More settings (the workbench,
  // 2026-10), opened the way a user opens it; it then stays open
  await openPanelDetails(page)
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
    // two words each, as the source spec had it: a sentence that wraps INSIDE
    // `مبيعات الربع` at the Inspector's width is the case `expectOwnOrder`
    // compares line by line
    { name: 'an ARABIC value', timing: 'مبيعات الربع', when: 'عند السحب' },
  ]) {
    test(`${c.name} is FSI-isolated in inspector.labelTiming.unsupported and keeps its own layout`, async ({ page }) => {
      // ported from i18n-ar-isolation.spec.ts (archived; its contract lives here).
      await seedUnsupportedTiming(page, c.timing, c.when)
      await setLocale(page, 'ar')
      await expect(page.locator('.labeltiming__groupline')).toBeVisible()

      const m = (await measure(page, '.labeltiming__groupline'))!
      expect(m.found, 'the unsupported sentence should carry two isolates').toBe(true)
      // ONE catalog call, TWO arguments — both wrapped, in the order the sentence
      // names them, and the connective between them belongs to the sentence
      expect(m.spans.map((s) => s.kind)).toEqual(['FSI', 'FSI'])
      expect(m.spans.map((s) => s.text)).toEqual([c.timing, c.when])
      expect(m.controls).toEqual(['FSI', 'PDI', 'FSI', 'PDI'])
      // the Arabic catalog: `… (حاليًا: التوقيت = {timing}، والشرط = {when}) …`
      expect(m.head).toContain('التوقيت = ')
      expect(m.between).toEqual(['، والشرط = '])
      expectRtlSentence(m, c.name)

      await expectOwnOrder(page, '.labeltiming__groupline', m, 0, 'auto')
      await expectOwnOrder(page, '.labeltiming__groupline', m, 1, 'auto')
    })
  }

  // REGRESSION (2026-10-19): a value that wraps inside its sentence is compared line
  // by line, not misread as a reordering. Supported languages are English and Korean,
  // but a NAME is whatever the user types, so an rtl value of several words is still
  // ordinary input. The width is narrowed so every value here is forced across lines,
  // and the test first proves that the wrap really happened — otherwise it would pass
  // on the one-line path and say nothing about the line-wise one.
  for (const c of [
    { name: 'an ARABIC value of three words', timing: 'مبيعات الربع الأول', when: 'عند السحب' },
    { name: 'a LATIN value of three words', timing: 'Ember Blade Forge', when: 'after pull' },
  ]) {
    test(`${c.name} that wraps inside the sentence keeps its own layout on every line`, async ({ page }) => {
      await seedUnsupportedTiming(page, c.timing, c.when)
      await setLocale(page, 'ar')
      const line = page.locator('.labeltiming__groupline')
      await expect(line).toBeVisible()
      await line.evaluate((el) => {
        ;(el as HTMLElement).style.maxWidth = '7em'
      })

      const m = (await measure(page, '.labeltiming__groupline'))!
      expect(m.spans.map((s) => s.text)).toEqual([c.timing, c.when])
      expect(m.spans[0]!.lines.length, `${c.timing}: the narrowed sentence wraps inside the value`).toBeGreaterThan(1)
      await expectOwnOrder(page, '.labeltiming__groupline', m, 0, 'auto')
      await expectOwnOrder(page, '.labeltiming__groupline', m, 1, 'auto')
    })
  }

  test('a hostile value is cleaned on the product path, and the sentence keeps exactly one pair per argument', async ({ page }) => {
    // ported from i18n-ar-isolation.spec.ts (archived; its contract lives here).
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

  test('a frame name in the keyboard move and resize announcements lays out as it does alone', async ({ page }) => {
    // ported from i18n-ar-isolation.spec.ts (archived; its contract lives here).
    // The isolate's SHAPE in this live region is a11y-announcement-contract.spec.ts's;
    // what is kept here is the layout half and the stored name. The region is
    // sr-only, but `clip` is a PAINT-time rule, so the text is still laid out and
    // still measurable — the width assertion says so rather than assuming it.
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
    // `canvas.frame.a11y.moved` in the Arabic catalog: `نُقل {label} إلى x {x}، y {y}`
    await expect
      .poll(() => page.evaluate(() => document.querySelector('[data-frame-announce]')?.textContent ?? ''))
      .toContain('نُقل')

    const moved = (await measure(page, '[data-frame-announce]'))!
    expect(moved.spans.map((s) => s.kind)).toEqual(['FSI'])
    expect(moved.spans[0]!.text).toBe('2024 مبيعات')
    expect(moved.spans[0]!.width, 'the announcement is clipped, not unlaid-out').toBeGreaterThan(0)
    expect(moved.head).toContain('نُقل')
    expect(moved.tail).toContain('إلى x')
    expectRtlSentence(moved, 'frame moved')
    await expectOwnOrder(page, '[data-frame-announce]', moved, 0, 'auto')

    // the OTHER branch of the closed key set, same frame, same name —
    // `canvas.frame.a11y.resized`: `غُيّر حجم {label} إلى العرض {w}، الارتفاع {h}`
    await page.locator('.lgr-frame__resize').first().focus()
    await page.keyboard.press('ArrowRight')
    await expect
      .poll(() => page.evaluate(() => document.querySelector('[data-frame-announce]')?.textContent ?? ''))
      .toContain('غُيّر حجم')

    const resized = (await measure(page, '[data-frame-announce]'))!
    expect(resized.spans.map((s) => s.kind)).toEqual(['FSI'])
    expect(resized.spans[0]!.text).toBe('2024 مبيعات')
    expect(resized.tail).toContain('إلى العرض')
    expectRtlSentence(resized, 'frame resized')
    await expectOwnOrder(page, '[data-frame-announce]', resized, 0, 'auto')

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
  // this test is ABOUT a canvas hint note: the shared fixture's "every canvas hint
  // already seen" seed is turned off for it
  test.use({ hintsSeen: false })

  test('three labels, three isolates, and the quotes and commas stay with the sentence', async ({ page }) => {
    // ported from i18n-ar-isolation.spec.ts (archived; its contract lives here).
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
    expect(m.controls).toEqual(['FSI', 'PDI', 'FSI', 'PDI', 'FSI', 'PDI'])
    // the sentence follows the READER whatever the panel around it does — on the
    // phone that panel is the React Flow pane pinned `ltr` (§L9.2), in the desktop
    // notice rail it is the app's layout; the span inside declares the reader's
    // `dir` (CanvasHintNote), which is the claim
    expect(m.direction, 'the sentence itself is rtl').toBe('rtl')
    expectRtlSentence(m, 'import hint')
    expect(m.spans.map((s) => s.text)).toEqual(LABELS)
    // THE point of the shape: the quote and the comma belong to the sentence, so
    // they sit OUTSIDE the isolates. One isolate around the joined list would have
    // swallowed them and given the whole list one direction.
    expect(m.head.endsWith('"'), 'the opening quote is the sentence’s').toBe(true)
    expect(m.between).toEqual(['", "', '", "'])
    expect(m.tail.startsWith('"')).toBe(true)
    // the Arabic plural's `few` arm for 3: `أُضيفت # مُعامِلات من {tables}`
    expect(m.head).toContain('أُضيفت 3 مُعامِلات')

    for (const i of [0, 1, 2]) await expectOwnOrder(page, '.hint-note', m, i, 'auto')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// the spreadsheet paths — a real paste
// ───────────────────────────────────────────────────────────────────────────

const AR_HEADER = 'اسم العرض'
const MIXED_HEADER = '2024 Sales'
/** an INCOMING column nothing matches */
const NEW_HEADER = '2024 جديد'

/** The wizard is driven through its English labels BEFORE the switch to `ar`, as the
 *  source spec did: the flow itself is `e2e/data-import-wizard.spec.ts`'s, and what
 *  is under test here starts after the switch. */
async function pasteTableWithCell(page: Page, cell: string): Promise<void> {
  await page.locator('.toolbar__actions [data-group="data"] .wb-mb').click()
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
    // ported from i18n-ar-isolation.spec.ts (archived; its contract lives here).
    // The cell goes in through the real paste field: this is the path a user's
    // spreadsheet takes, not a store-level shortcut.
    await pasteTableWithCell(page, HOSTILE)
    await page.locator('.mcdlg--dataimport').getByRole('button', { name: 'Next' }).click()
    await expect(page.locator('.import__issueLink').first()).toBeVisible()
    await setLocale(page, 'ar')

    // ONE rendered string from TWO catalog calls: `${issueLocation(issue)}: ${desc}`.
    // The table name and the column header in the location half are bounded as well
    // as the description's `{value}`.
    const m = (await measure(page, '.import__issueLink'))!
    expect(m.found, 'the issue line should carry the isolated cell').toBe(true)
    expect(m.spans.map((s) => s.kind)).toEqual(['FSI', 'FSI', 'FSI'])
    expect(m.spans.map((s) => s.text), 'table name, column header, cell — in that order').toEqual([
      'جدول 2024',
      MIXED_HEADER,
      HOSTILE_CLEAN,
    ])
    expect(m.controls, 'three pairs, nothing else').toEqual(['FSI', 'PDI', 'FSI', 'PDI', 'FSI', 'PDI'])
    // `import.loc.*` opens with `الجدول {table}`; `import.issue.invalid-number`
    // carries `"{value}" ليس رقمًا…`
    expect(m.head).toContain('الجدول')
    expect(m.tail).toContain('ليس رقمًا')
    expectRtlSentence(m, 'issue line')
    for (const i of [0, 1, 2]) await expectOwnOrder(page, '.import__issueLink', m, i, 'auto')

    // the textarea still holds the pasted bytes — the strip is a display copy
    const raw = await page.evaluate(() => (document.querySelector('.import__paste') as HTMLTextAreaElement | null)?.value ?? '')
    expect(raw).toContain(HOSTILE)
  })

  test('the three column-event branches each bound the header they name', async ({ page }) => {
    // ported from i18n-ar-isolation.spec.ts (archived; its contract lives here).
    // The refresh wizard's closed key set. An existing column whose header now
    // matches two incoming columns is `ambiguous-match`, one that is gone is
    // `missing-header`, and a fourth INCOMING column nothing matches is
    // `unrecognized` — so the refresh paste duplicates one header, drops the other
    // and adds a new one.
    await pasteTableWithCell(page, '10')
    const dlg = page.locator('.mcdlg--dataimport')
    await dlg.getByRole('button', { name: 'Next' }).click() // -> placement
    await dlg.getByRole('button', { name: 'Next' }).click() // -> review
    await dlg.getByRole('button', { name: 'Import' }).click()
    await expect(dlg).toBeHidden()

    await page.locator('.toolbar__actions [data-group="data"] .wb-mb').click()
    await page.getByRole('menuitem', { name: 'Refresh or manage imported tables…' }).click()
    const manage = page.getByRole('dialog', { name: 'Manage spreadsheet bindings' })
    await expect(manage).toBeVisible()
    await manage.getByRole('button', { name: 'Refresh…' }).click()
    const refresh = page.getByRole('dialog', { name: /^Refresh "/ })
    await expect(refresh).toBeVisible()
    await refresh
      .getByPlaceholder('Paste CSV or TSV text here')
      .fill(`item_key,${AR_HEADER},${AR_HEADER},${NEW_HEADER}\nitm_a,Ember Blade,Iron Charm,7`)
    await refresh.getByRole('button', { name: 'Next' }).click()
    const rows = page.locator('.import__issues ul li p')
    await expect(rows).toHaveCount(2)
    await refresh.getByRole('button', { name: 'Map more columns…' }).click()
    await expect(rows).toHaveCount(3)
    await setLocale(page, 'ar')

    const measured = [
      await measure(page, '.import__issues ul li p', 0),
      await measure(page, '.import__issues ul li p', 1),
      await measure(page, '.import__issues ul li p', 2),
    ]
    // the three `import.refresh.columnEvents.*` sentences of the Arabic catalog
    const missing = measured.find((m) => m!.tail.includes('لم يعد في البيانات الجديدة'))!
    const ambiguous = measured.find((m) => m!.tail.includes('يطابق أكثر من عمود وارد'))!
    const unrecognized = measured.find((m) => m!.tail.includes('غير مربوط'))!
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
      expect(m.head).toContain('العمود')
      expectRtlSentence(m, `column event ${header}`)
      await expectOwnOrder(page, '.import__issues ul li p', m, 0, 'auto', measured.indexOf(m))
    }
  })

  test('the key-column header is bounded in the per-table status line', async ({ page }) => {
    // ported from i18n-ar-isolation.spec.ts (archived; its contract lives here).
    await pasteTableWithCell(page, '10')
    await setLocale(page, 'ar')
    await expect(page.locator('.import__status').first()).toBeVisible()

    const m = (await measure(page, '.import__status'))!
    expect(m.found).toBe(true)
    expect(m.spans.map((s) => s.kind)).toEqual(['FSI'])
    expect(m.spans[0]!.text).toBe('item_key')
    // `import.status.key`: `المفتاح: {header}`
    expect(m.head).toContain('المفتاح')
    expectRtlSentence(m, 'status line')
    await expectOwnOrder(page, '.import__status', m, 0, 'auto')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// the document never moves, and a locale round trip never accumulates
// ───────────────────────────────────────────────────────────────────────────

test.describe('§L9.4 display only — the stored document and its digest do not move', () => {
  test('rendering the whole RTL interface leaves the serialization and the digest byte-identical', async ({ page }) => {
    // ported from i18n-ar-isolation.spec.ts (archived; its contract lives here).
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
      g().onConnect({ source: ids[0], target: ids[1], sourceHandle: 'state-source', targetHandle: 'state-target' }, 'change')
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
    // render every isolating surface this document reaches: the edge is selected, so
    // the Inspector's timing sentence runs; the canvas paints both node labels and
    // the frame
    await page.evaluate(selectFirstEdge)
    // the timing sentence is in More settings, opened as a user opens it
    await openPanelDetails(page)
    await expect(page.locator('.labeltiming__groupline')).toBeVisible()
    const after = await snapshot()

    expect(after.json, 'serializing after an RTL render must be byte-identical').toBe(before.json)
    expect(after.digest, 'the digest must not move').toBe(before.digest)
    // the controls the USER typed are still in the document — the strip is a display
    // copy, and rewriting stored bytes would itself move the digest
    expect(before.controls, 'the hostile value really did reach the document').toBeGreaterThan(0)
    expect(after.controls).toBe(before.controls)
  })

  test('ar → en → ar produces the same string, with no second isolate', async ({ page }) => {
    // ported from i18n-ar-isolation.spec.ts (`ar → en → ar`; archived, its contract
    // lives here).
    await openApp(page)
    await resetAll(page)
    await seedUnsupportedTiming(page, '2024 Sales', '(Draft) later')

    await setLocale(page, 'ar')
    await expect(page.locator('.labeltiming__groupline')).toBeVisible()
    const first = (await measure(page, '.labeltiming__groupline'))!
    expect(first.controls).toEqual(['FSI', 'PDI', 'FSI', 'PDI'])

    await setLocale(page, 'en')
    const inEnglish = (await measure(page, '.labeltiming__groupline'))!
    // the isolate is not an RTL feature — the same argument is bounded under an ltr
    // interface too, and the count does not change with the reader
    expect(inEnglish.controls).toEqual(['FSI', 'PDI', 'FSI', 'PDI'])
    expect(inEnglish.spans.map((s) => s.text)).toEqual(['2024 Sales', '(Draft) later'])

    await setLocale(page, 'ar')
    const second = (await measure(page, '.labeltiming__groupline'))!
    expect(second.node, 'the round trip must reproduce the same string exactly').toBe(first.node)
    expect(second.controls).toEqual(first.controls)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// the shapes C3.5 added
// ───────────────────────────────────────────────────────────────────────────

test.describe('§L9.4 the shapes C3.5 added', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await resetAll(page)
  })

  test('the resource-type mismatch isolates each TYPE, leaving the connectives and the comma to the sentence', async ({ page }) => {
    // ported from i18n-ar-isolation.spec.ts (archived; its contract lives here).
    // The second per-fragment site: this joins PAIRS with `, `, and each pair is a
    // translated phrase around two values (`inspector.resourceType.pair`). The words
    // and the comma belong to the sentence, so four user values produce four
    // isolates and no connective is inside one.
    await page.evaluate(() => {
      const g = () => (window as unknown as Bridge).__loop.graph.getState()
      g().newGraph()
      g().addNodeAt('pool', { x: 0, y: 0 })
      g().addNodeAt('pool', { x: 260, y: 0 })
      const ids = g().nodes.map((n: { id: string }) => n.id)
      g().updateNodeData(ids[0], { resourceType: '2024 Coins' })
      g().updateNodeData(ids[1], { resourceType: '(مسودة) بن' })
      g().onConnect({ source: ids[0], target: ids[1], sourceHandle: 'out', targetHandle: 'in' }, 'flow')
      // trailing whitespace so the NORMALISED note renders in the same panel
      g().setEdgeData(g().edges[0].id, { kind: 'resource', flow: '1', resourceType: '  ذهب  ' })
    })
    await page.evaluate(selectFirstEdge)
    await setLocale(page, 'ar')
    await expect(page.locator('.inspector__note--warn')).toBeVisible()

    const m = (await measure(page, '.inspector__note--warn'))!
    // two findings (source and target pool), each naming the edge type and the node
    // type — four independent user values, four isolates
    expect(m.spans.map((s) => s.kind)).toEqual(['FSI', 'FSI', 'FSI', 'FSI'])
    expect(m.spans.map((s) => s.text)).toEqual(['ذهب', '2024 Coins', 'ذهب', '(مسودة) بن'])
    expect(m.controls).toEqual(['FSI', 'PDI', 'FSI', 'PDI', 'FSI', 'PDI', 'FSI', 'PDI'])
    // the words are BETWEEN a pair's values and the comma between pairs — outside.
    // The Arabic `inspector.resourceType.pair` is `{edge} على الاتصال و{node} على
    // العقدة`; the pairs are joined with `, ` in Inspector.tsx.
    expect(m.between[0], 'the connective belongs to the sentence').toBe(' على الاتصال و')
    expect(m.between[1], 'the tail and the comma belong to the sentence').toBe(' على العقدة, ')
    expect(m.between[2]).toBe(' على الاتصال و')
    // `inspector.resourceType.mismatch`: `عدم تطابق في النوع: {pairs}. …`
    expect(m.head).toContain('عدم تطابق في النوع')
    expectRtlSentence(m, 'resource-type mismatch')
    for (const i of [0, 1, 2, 3]) await expectOwnOrder(page, '.inspector__note--warn', m, i, 'auto')

    // and the normalised note in the same panel bounds its own value
    const n = (await measure(page, '.inspector__note:not(.inspector__note--warn)'))!
    expect(n.spans.map((s) => s.kind)).toEqual(['FSI'])
    expect(n.spans[0]!.text, 'the trimmed form, isolated').toBe('ذهب')
  })

  test('the bad-reference row bounds a NAME with FSI and an ID with LRI, from one call site', async ({ page }) => {
    // ported from i18n-ar-isolation.spec.ts (archived; its contract lives here).
    // One call passes both `{name}` and `{id}` because the key is not known until
    // runtime — but no catalog value uses both, so each rendering carries ONE
    // isolate. What matters is that it is the RIGHT one on each branch.
    const seed = (expr: string) =>
      page.evaluate((e) => {
        const g = () => (window as unknown as Bridge).__loop.graph.getState()
        g().newGraph()
        g().addNodeAt('source', { x: 0, y: 0 })
        g().addNodeAt('register', { x: 260, y: 0 })
        const ids = g().nodes.map((n: { id: string }) => n.id)
        g().updateNodeData(ids[0], { label: '2024 مصدر' })
        g().updateNodeData(ids[1], { label: 'Reg', expr: e.replace('SOURCE', ids[0]) })
        // the last add left its node marked selected: move the marks to what is selected, as a click on it does
        g().onNodesChange(g().nodes.filter((n: { selected?: boolean }) => n.selected).map((n: { id: string }) => ({ id: n.id, type: 'select', selected: false })))
        g().setSelection(ids[1], null)
      }, expr)

    await seed('@{SOURCE}')
    await setLocale(page, 'ar')
    await expect(page.locator('.regrb__line--bad')).toBeVisible()

    const wrong = (await measure(page, '.regrb__line--bad'))!
    expect(wrong.spans.map((s) => s.kind), 'a user NAME takes the first-strong isolate').toEqual(['FSI'])
    expect(wrong.spans[0]!.text).toBe('2024 مصدر')
    expect(wrong.controls).toEqual(['FSI', 'PDI'])
    // `regExpr.row.wrongKind`: `— "{name}" ليس مَجمَعًا ولا مُعامِلًا ولا سِجِلًّا`
    expect(wrong.tail).toContain('ليس مَجمَعًا')

    await seed('@{2024-ghost}')
    // `regExpr.row.unknownRef`: `— المرجع "{id}" غير موجود`
    await expect.poll(() => page.locator('.regrb__line--bad').innerText()).toContain('غير موجود')

    const unknown = (await measure(page, '.regrb__line--bad'))!
    expect(unknown.spans.map((s) => s.kind), 'a node ID takes the forced-ltr isolate').toEqual(['LRI'])
    expect(unknown.spans[0]!.text).toBe('2024-ghost')
    expect(unknown.controls).toEqual(['LRI', 'PDI'])
    const p = await expectOwnOrder(page, '.regrb__line--bad', unknown, 0, 'ltr')
    expect(p.aloneDir).toBe('ltr')
  })
})
