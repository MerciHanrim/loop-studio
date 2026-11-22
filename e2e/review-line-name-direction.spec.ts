import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'
import { pickLocale, pickTemplate } from './support/workbenchMenus'

// Review I1 (2026-11-22) — in the Arabic interface, a connection named in a
// review line ("The value of {name} …", the line's two end names and an arrow)
// reads on screen as the Inspector names it: the from name, the arrow, the to
// name, left to right, whatever script each name is in. The review used to wrap
// the already isolated "from → to" in one more isolate, which stripped the
// inner ones, so the pair took the direction of its FIRST name: an Arabic first
// name laid it out to · arrow · from. Controls: the accessibility tree keeps the
// logical order (from, →, to), and the Inspector's own summary is unchanged.

type L = { __loop: Record<string, { getState: () => any; setState: (s: object) => void }> }

async function openCoffeeAr(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openApp(page)
  await resetAll(page)
  await pickLocale(page, 'ar')
  await pickTemplate(page, 'coffee-roasting-batch')
  const confirm = page.locator('.mcdlg--confirm .btn--primary')
  if (await confirm.isVisible().catch(() => false)) await confirm.click()
  await expect(page.locator('.react-flow__node')).toHaveCount(11)
}

/** on screen, left to right: the from name, the arrow and the to name inside the first `sel` */
const screenOrder = (page: Page, sel: string, from: string, to: string) =>
  page.evaluate(
    ({ sel, from, to }) => {
      const el = document.querySelector(sel)!
      const text = el.textContent ?? ''
      const xOf = (at: number, len: number) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        let pos = 0
        let node: Node | null
        while ((node = walker.nextNode())) {
          const n = node.textContent!.length
          if (at >= pos && at < pos + n) {
            const r = document.createRange()
            r.setStart(node, at - pos)
            r.setEnd(node, Math.min(n, at - pos + len))
            return r.getBoundingClientRect().left
          }
          pos += n
        }
        return NaN
      }
      const f = text.indexOf(from)
      const a = text.indexOf('→', f)
      const tt = text.indexOf(to, f)
      const xs = { from: xOf(f, from.length), arrow: xOf(a, 1), to: xOf(tt, to.length) }
      return (Object.entries(xs) as [string, number][]).sort((p, q) => p[1] - q[1]).map(([k]) => k).join(' · ')
    },
    { sel, from, to },
  )

/** rename the hopper and the drum, and review a proposal that writes the hopper → drum line in a
 *  rate unit this document does not declare; Choose changes, Kinds unticked: the Apply is refused
 *  with the line named */
async function reviewTheLine(page: Page, from: string, to: string) {
  await page.evaluate(
    ({ from, to }) => {
      const l = (window as unknown as L).__loop
      l.graph.getState().updateNodeData('bean_hopper', { label: from })
      l.graph.getState().updateNodeData('charge_drum', { label: to })
      l.project.getState().clear()
      l.review.getState().close()
    },
    { from, to },
  )
  const text = await page.evaluate(async () => {
    const M = await import('/src/model/revision.ts')
    const S = await import('/src/model/serialize.ts')
    const P = (window as unknown as L).__loop.project.getState()
    P.commitRevisionExport(P.planRevision({}).plan)
    const f = JSON.parse((window as unknown as L).__loop.project.getState().planProposal({}).text)
    f.kinds[0].rateUnits.push({ name: 'bag per min', factor: '60', per: 'min' })
    Object.assign(f.edges.find((e: { id: string }) => e.id === 'e_hopper_charge').data, { flow: '0.9', unit: 'bag per min' })
    const d = S.deserialize(JSON.stringify(f))
    f.project.contentDigest = M.digestOfCanonical(
      M.canonicalContent({ nodes: d.nodes, edges: d.edges, recommendedRunConfig: d.recommendedRunConfig, frames: d.frames, dataImports: d.dataImports, kinds: d.kinds, time: d.time, timetables: d.timetables, phases: d.phases }, { modelVersion: d.modelVersion }),
    )
    return JSON.stringify(f)
  })
  await page.setInputFiles('.toolbar__actions input[type=file]', { name: 'proposal.json', mimeType: 'application/json', buffer: Buffer.from(text, 'utf8') })
  const review = page.locator('.review')
  await expect(review).toBeVisible()
  await review.locator('.review__actions button').nth(1).click() // Choose changes
  await review.locator('.review__hunk input[data-hunk="kinds"]').uncheck()
  const line = page.getByTestId('review-diagnostics').locator('li').first()
  await expect(line).toContainText(from)
  return line
}

const CASES = [
  { name: 'from a right-to-left name to a left-to-right one', from: 'قادوس البن', to: 'Drum A1' },
  { name: 'from a left-to-right name to a right-to-left one', from: 'Hopper B2', to: 'أسطوانة التحميص' },
  { name: 'both left-to-right', from: 'Hopper C3', to: 'Drum C4' },
]

for (const c of CASES) {
  test(`Arabic, ${c.name}: the review line reads from · arrow · to, as the Inspector does`, async ({ page }) => {
    await openCoffeeAr(page)
    const line = await reviewTheLine(page, c.from, c.to)
    expect(await screenOrder(page, '[data-testid="review-diagnostics"] li', c.from, c.to), 'the review line on screen').toBe('from · arrow · to')

    // control: the accessibility tree gives the words in their logical order
    const aria = (await line.ariaSnapshot()).replace(/[⁦-⁩]/g, '')
    expect(aria.indexOf(c.from)).toBeGreaterThan(-1)
    expect(aria.indexOf(c.from)).toBeLessThan(aria.indexOf('→'))
    expect(aria.indexOf('→')).toBeLessThan(aria.indexOf(c.to))

    // control: the Inspector's own summary of the line, unchanged
    await page.keyboard.press('Escape')
    await expect(page.locator('.review')).toBeHidden()
    await page.evaluate(() => (window as unknown as L).__loop.graph.setState({ selectedEdgeId: 'e_hopper_charge', selectedNodeId: null }))
    const summary = page.locator('.ends__summary').first()
    await expect(summary).toHaveText(`⁨${c.from}⁩ → ⁨${c.to}⁩`)
    expect(await screenOrder(page, '.ends__summary', c.from, c.to), 'the Inspector summary on screen').toBe('from · arrow · to')
  })
}
