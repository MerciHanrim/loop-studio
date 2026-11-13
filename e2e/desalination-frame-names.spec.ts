import { expect, test } from './support/loop'
import { measureFrames, openTemplateAt100, TEMPLATE_LOCALES } from './support/templateFrames'

// #533 follow-up and #540 — on the desalination Template, opened from the menu, at 100 %, in
// every shipped language: no node, outside name or run-rule line passes its frame's edge, no
// outside name lies over another node or another node's name in its frame, and the router
// draws every line (no `[route]` warning, which the dev build logs for a line it could only
// draw as `outer` or `blocked`). Zoomed in, a long name wraps to two lines and a run-rule
// line comes under a stage's name; in the overview neither happens, so the overview cannot
// show it.
//
// Before #541 and #540, among others: German "Versorgung der Stadt" passed frame 4's foot,
// the Coagulation filter's run-rule line passed frame 2's foot and lay over the Filtered
// water tank's name, Grid feed B's name lay over Recovered energy's in twelve languages, the
// Thickener passed frame 5's foot in sixteen, and the run-rule read line into the Coagulation
// filter was drawn blocked in six.

const FRAMES = ['f_intake', 'f_pre', 'f_ro', 'f_post', 'f_out']
const NODES = 43
/** the stages that hold a run rule, so their run-rule line is drawn under their name */
const RULED = ['adjust', 'dpump', 'filter', 'remin', 'ro', 'thick']

test.describe('#533 / #540 — the desalination Template keeps its names inside its frames and apart', () => {
  for (const locale of TEMPLATE_LOCALES) {
    test(`${locale}: at 100 %, no name passes a frame edge or lies over another, and every line is routed`, async ({ page }) => {
      const routeWarnings: string[] = []
      page.on('console', (m) => {
        if (m.text().startsWith('[route]')) routeWarnings.push(m.text())
      })
      await openTemplateAt100(page, locale, 'desalination', NODES)
      const r = await measureFrames(page, FRAMES)
      expect(r.frames).toBe(5)
      // every node of the Template sits in one of the five frames, so every one was checked
      expect(r.inFrames).toBe(r.nodes)
      // what was measured, by kind, so an empty result cannot pass for a clean one: every node
      // box and outside name, and the run-rule line of each of the six ruled stages. The same
      // in every language when the test was written.
      expect(r.measured.node, 'node boxes').toBeGreaterThanOrEqual(NODES)
      expect(r.measured.name, 'outside names').toBeGreaterThanOrEqual(NODES)
      expect(r.measured['run rule'], 'run-rule lines').toBeGreaterThanOrEqual(RULED.length)
      expect(r.ruled).toEqual(expect.arrayContaining(RULED))
      expect(r.problems, r.problems.join('\n')).toEqual([])
      expect(routeWarnings, routeWarnings.join('\n')).toEqual([])
    })
  }
})
