import { expect, type Locator, type Page } from '@playwright/test'

// Shared by the control-boundary specs (docs/visual-language.md §VL8). Every
// contrast here is measured on the REAL composited pixels of a screenshot, not
// computed from token values: a border is only as visible as what it is
// painted over.

export type Rgb = [number, number, number]

export const lum = ([r, g, b]: Rgb) => {
  const f = (c: number) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
export const ratio = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
export const dist = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
export const parseRgb = (s: string): Rgb => {
  const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)!
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}
export const r2 = (n: number) => Math.round(n * 100) / 100

/** decode a viewport screenshot in the page and read pixels (deviceScaleFactor 1 → image px = CSS px) */
export async function rgbAt(page: Page, png: Buffer, pts: { x: number; y: number }[]): Promise<Rgb[]> {
  return page.evaluate(
    async ({ b64, pts }) => {
      const im = new Image()
      im.src = `data:image/png;base64,${b64}`
      await im.decode()
      const cv = document.createElement('canvas')
      cv.width = im.width
      cv.height = im.height
      const cx = cv.getContext('2d')!
      cx.drawImage(im, 0, 0)
      return pts.map(({ x, y }) => {
        const d = cx.getImageData(Math.round(x), Math.round(y), 1, 1).data
        return [d[0], d[1], d[2]] as [number, number, number]
      })
    },
    { b64: png.toString('base64'), pts },
  )
}

/** the composited boundary of `el`: the darkest-vs-outside column across its left
 *  edge and row across its top edge, the colour `out` px outside (the surface
 *  behind it) and 5 px / 3 px inside (its own face). `out` defaults to 5 — far
 *  enough to clear a 3 px focus halo, so the "outside" sample is the surface. */
export async function boundary(page: Page, el: Locator, out = 5) {
  const b = (await el.boundingBox())!
  const png = await page.screenshot()
  const cy = b.y + b.height / 2
  const cx = b.x + b.width / 2
  const px = await rgbAt(page, png, [
    { x: b.x - out, y: cy },
    { x: b.x + 5, y: cy },
    { x: cx, y: b.y - out },
    { x: cx, y: b.y + 3 },
    ...[-1, 0, 1, 2].map((o) => ({ x: b.x + o, y: cy })),
    ...[-1, 0, 1, 2].map((o) => ({ x: cx, y: b.y + o })),
  ])
  const [outL, inL, outT, inT] = px
  const pick = (cands: Rgb[], o: Rgb) => cands.reduce((best, c) => (dist(c, o) > dist(best, o) ? c : best))
  const edgeL = pick(px.slice(4, 8), outL)
  const edgeT = pick(px.slice(8, 12), outT)
  return {
    left: { edge: edgeL, out: outL, face: inL, vsOut: r2(ratio(edgeL, outL)), vsFace: r2(ratio(edgeL, inL)) },
    top: { edge: edgeT, out: outT, face: inT, vsOut: r2(ratio(edgeT, outT)), vsFace: r2(ratio(edgeT, inT)) },
  }
}
export type Boundary = Awaited<ReturnType<typeof boundary>>

export const expectBoundary = (name: string, m: Boundary) => {
  for (const side of ['left', 'top'] as const) {
    expect(m[side].vsOut, `${name}: ${side} border vs the surface behind the control ≥ 3:1`).toBeGreaterThanOrEqual(3)
    expect(m[side].vsFace, `${name}: ${side} border vs the control's own face ≥ 3:1`).toBeGreaterThanOrEqual(3)
  }
}

/** the rgb() string a CSS colour expression resolves to in the current theme */
export const probe = (page: Page, css: string) =>
  page.evaluate((v) => {
    const d = document.createElement('div')
    d.style.color = v
    document.body.append(d)
    const c = getComputedStyle(d).color
    d.remove()
    return c
  }, css)

export const computed = (el: Locator) =>
  el.evaluate((e) => {
    const c = getComputedStyle(e)
    return { border: c.borderTopColor, width: c.borderTopWidth, bg: c.backgroundColor, color: c.color, opacity: c.opacity }
  })

export const focusStyle = (el: Locator) =>
  el.evaluate((e) => {
    const c = getComputedStyle(e)
    return {
      fv: e.matches(':focus-visible'),
      outlineStyle: c.outlineStyle,
      outlineWidth: c.outlineWidth,
      outlineColor: c.outlineColor,
      outlineOffset: c.outlineOffset,
      border: c.borderTopColor,
      boxShadow: c.boxShadow,
    }
  })

export const noHover = async (page: Page) => {
  await page.mouse.move(2, 2)
  await page.waitForTimeout(120)
}

/** focus `el` so that it matches `:focus-visible`: a key press first puts the
 *  document in keyboard modality, then a programmatic focus counts as visible */
export async function keyboardFocus(page: Page, el: Locator) {
  await page.keyboard.press('Shift')
  await el.evaluate((e) => (e as HTMLElement).focus())
  await page.waitForTimeout(120)
}
