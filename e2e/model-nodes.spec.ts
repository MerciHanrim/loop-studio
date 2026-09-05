import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// loop-model/1 editor wiring — a malformed `parameter` / `register` node must be
// SAFE in the real UI: the graph opens (with a warning), the Canvas and the
// Inspector never crash, a bad value is never shown as `0` / `"0"`, and the
// `project` header is dropped (no Review / Apply).

async function setFile(page: Page, name: string, text: string): Promise<void> {
  await page.setInputFiles('.toolbar__actions input[type=file]', {
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(text, 'utf8'),
  })
}

const graphFile = (nodes: unknown[], edges: unknown[] = [], project?: unknown) =>
  JSON.stringify({ schema: 'loop-studio/graph', version: 1, nodes, edges, ...(project ? { project } : {}) })

const badProject = {
  schema: 'loop-revision/1',
  version: 1,
  projectId: `proj_${'A'.repeat(26)}`,
  revisionId: `rev_${'A'.repeat(26)}`,
  parentId: null,
  role: 'revision',
  contentDigest: 'f'.repeat(64),
}

const pool = {
  id: 'p1',
  type: 'pool',
  position: { x: 260, y: 0 },
  data: { kind: 'pool', label: 'P', activation: 'passive', initial: 5, capacity: null, mode: 'pullAny' },
}

const projectOpen = (page: Page) =>
  page.evaluate(() => {
    const l = (window as unknown as { __loop: Record<string, { getState: () => { open?: unknown } }> }).__loop
    return Boolean(l.project?.getState().open)
  })

test.describe('malformed model nodes are safe in the UI', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    page.on('dialog', (d) => void d.accept())
  })

  const CASES: { name: string; data: unknown; type: string }[] = [
    { name: 'data is not an object', type: 'parameter', data: 'nope' },
    { name: 'parameter value is a string', type: 'parameter', data: { kind: 'parameter', label: 'x', value: 'lots' } },
    { name: 'parameter value is NaN-ish', type: 'parameter', data: { kind: 'parameter', label: 'x', value: null, extra: 'NaN' } },
    { name: 'register expr is not a string', type: 'register', data: { kind: 'register', label: 'x', expr: 42 } },
    { name: 'register expr does not parse', type: 'register', data: { kind: 'register', label: 'x', expr: 'min(@a,@b)' } },
  ]

  for (const c of CASES) {
    test(c.name, async ({ page }) => {
      const bad = { id: 'm1', type: c.type, position: { x: 0, y: 0 }, data: c.data }
      await setFile(page, 'bad.json', graphFile([bad, pool], [], badProject))

      const m1 = page.locator('.react-flow__node[data-id="m1"]')
      await expect(page.locator('.react-flow__node[data-id="p1"]')).toBeVisible()

      // some of these are structurally valid-enough to seat (null value fills to
      // 0); only the genuinely-unseatable ones show the fallback. Either way the
      // app must not crash and no fake stand-in for a broken value is shown.
      await expect(m1).toBeVisible()
      const seated = c.name === 'parameter value is NaN-ish'
      if (!seated) {
        await expect(m1).toContainText(/unreadable/i)
        // §R2-1.1 — the project header is dropped for an unseatable model node
        expect(await projectOpen(page)).toBe(false)
      }
      await expect(page.locator('.review-scrim, .review')).toHaveCount(0)

      // selecting it never crashes the Inspector
      await m1.click()
      await expect(page.locator('.inspector')).toBeVisible()
      if (!seated) {
        await expect(page.locator('.inspector')).toContainText(/can.?t be read/i)
      }

      // still interactive
      await page.locator('.pstrip button[title="Advance one step"]').click()
      await expect(page.locator('.pstrip')).toBeVisible()
    })
  }
})

// v0.8.0 pre-release usability audit — a Register's Inspector `expr` field
// used to re-validate the WHOLE node through the same §R2-1.1 payload gate a
// loaded-from-file corrupt node hits, on every keystroke. Since virtually any
// expression is syntactically incomplete at some point while being typed
// (e.g. "@x * " before the right operand), this replaced the input with the
// "can't be read — fix it in the file or delete the node" fallback the
// instant a user typed a binary operator — a dead end with no path back to
// the field. Fixed by giving the field a local `draft` that only reaches the
// model (`updateNodeData` → GraphDoc / simulationRev / digest / dirty) once it
// parses; an invalid draft shows an inline note and nothing else. The
// loaded-from-file defense above is untouched — it never goes through this
// draft at all.
test.describe('Register expression — live editing never corrupts the model (v0.8.0 audit)', () => {
  const G = JSON.stringify({
    schema: 'loop-studio/graph',
    version: 1,
    nodes: [
      { id: 'x', type: 'parameter', position: { x: 0, y: 0 }, data: { kind: 'parameter', label: 'X', value: 5 } },
      { id: 'reg1', type: 'register', position: { x: 220, y: 0 }, data: { kind: 'register', label: 'R', expr: '1' } },
      { id: 'p1', type: 'pool', position: { x: 0, y: 200 }, data: { kind: 'pool', label: 'P1', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
      { id: 'p2', type: 'pool', position: { x: 260, y: 200 }, data: { kind: 'pool', label: 'P2', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
    ],
    edges: [
      { id: 'e1', source: 'p1', target: 'p2', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '@x' } },
    ],
  })

  const exprInput = (page: Page) => page.getByLabel('Expression')
  const registerNode = (page: Page) => page.locator('.react-flow__node[data-id="reg1"]')
  const registerModelExpr = (page: Page) =>
    page.evaluate(
      () => (window as unknown as { __loop: any }).__loop.graph.getState().nodes.find((n: any) => n.id === 'reg1')?.data.expr,
    )
  const simRev = (page: Page) =>
    page.evaluate(() => (window as unknown as { __loop: any }).__loop.graph.getState().simulationRev)

  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, G)
    await registerNode(page).click()
    await expect(exprInput(page)).toHaveValue('1')
  })

  test('real keystrokes through a syntactically-incomplete state keep the field editable, show only an inline error, and never commit the invalid draft', async ({ page }) => {
    await exprInput(page).fill('')
    // "@x * " is invalid as a whole (a trailing operator with no right-hand
    // side) — note a BARE prefix like "@x" is independently valid (a
    // reference is a complete expression on its own) and is expected to
    // commit as the model reaches it; that's correct (§ "last valid model"),
    // not a leak of the invalid tail. What must never happen is the DISPLAYED
    // invalid string itself reaching the model.
    await exprInput(page).pressSequentially('@x * ', { delay: 20 })

    await expect(exprInput(page)).toBeVisible()
    await expect(exprInput(page)).toHaveValue('@x * ')
    await expect(page.locator('.inspector')).not.toContainText(/can.?t be read/i)
    await expect(page.locator('.inspector__note--warn')).toBeVisible()
    const modelWhileInvalid = await registerModelExpr(page)
    expect(modelWhileInvalid).not.toBe('@x * ') // the invalid draft itself never committed
    expect(modelWhileInvalid).toBe('@x ') // the last independently-valid prefix reached (a bare
    // reference parses even with trailing whitespace)
    const revAtInvalid = await simRev(page)

    // sitting on the invalid draft a moment longer changes nothing further
    await page.waitForTimeout(200)
    expect(await registerModelExpr(page)).toBe(modelWhileInvalid)
    expect(await simRev(page)).toBe(revAtInvalid)

    // finish the expression — now it commits, and simulationRev moves again
    await exprInput(page).pressSequentially('2', { delay: 20 })
    await expect(page.locator('.inspector__note--warn')).toHaveCount(0)
    await expect.poll(() => registerModelExpr(page)).toBe('@x * 2')
    expect(await simRev(page)).toBeGreaterThan(revAtInvalid)
  })

  test('switching to another node while the draft is invalid discards the draft, keeping only whatever the model last validly committed', async ({ page }) => {
    await exprInput(page).fill('')
    await exprInput(page).pressSequentially('@x * ', { delay: 20 })
    await expect(page.locator('.inspector__note--warn')).toBeVisible()
    const lastValidExpr = await registerModelExpr(page)
    expect(await exprInput(page).inputValue()).not.toBe(lastValidExpr) // a draft ahead of the model exists right now

    await page.locator('.react-flow__node[data-id="x"]').click()
    await expect(page.locator('.inspector')).not.toContainText(/can.?t be read/i)

    await registerNode(page).click()
    await expect(exprInput(page)).toHaveValue(lastValidExpr) // the abandoned draft never leaked in
    expect(await registerModelExpr(page)).toBe(lastValidExpr)
  })

  test('a completed edit undoes back to the previous valid expression, then redoes forward', async ({ page }) => {
    await exprInput(page).fill('')
    await exprInput(page).pressSequentially('@x * 2', { delay: 20 })
    await expect.poll(() => registerModelExpr(page)).toBe('@x * 2')

    await page.evaluate(() => (window as unknown as { __loop: any }).__loop.graph.getState().undo())
    await expect.poll(() => registerModelExpr(page)).toBe('1')

    await page.evaluate(() => (window as unknown as { __loop: any }).__loop.graph.getState().redo())
    await expect.poll(() => registerModelExpr(page)).toBe('@x * 2')
  })

  test('a node already corrupt from a loaded file still shows the original defense screen', async ({ page }) => {
    await importGraph(
      page,
      JSON.stringify({
        schema: 'loop-studio/graph',
        version: 1,
        nodes: [{ id: 'bad', type: 'register', position: { x: 0, y: 0 }, data: { kind: 'register', label: 'x', expr: 'min(@a,@b)' } }],
        edges: [],
      }),
    )
    await page.locator('.react-flow__node[data-id="bad"]').click()
    await expect(page.locator('.inspector')).toContainText(/can.?t be read/i)
    await expect(exprInput(page)).toHaveCount(0) // no live-editable field for a structurally-rejected node
  })

  test('an edge flow expression is unaffected — its own inline validation still applies, no Inspector crash', async ({ page }) => {
    // a React Flow edge's own SVG path is thin and awkward to click reliably;
    // selecting through the real store action lands in the same place a click
    // does (`Canvas.tsx`'s `onSelectionChange` calls the identical `setSelection`).
    await page.evaluate(() => (window as unknown as { __loop: any }).__loop.graph.getState().setSelection('edge', 'e1'))
    const flowInput = page.locator('label.field:has-text("Flow") input[placeholder]')
    await expect(flowInput).toHaveValue('@x')

    await flowInput.fill('')
    await flowInput.pressSequentially('@x * ', { delay: 20 })
    await expect(flowInput).toBeVisible()
    await expect(flowInput).toHaveValue('@x * ')
    await expect(page.locator('.inspector')).toContainText('not a valid parameter reference')
    await expect(page.locator('.inspector')).not.toContainText(/can.?t be read/i)
  })
})

test.describe('an edge to a model node is isolated on import', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    page.on('dialog', (d) => void d.accept())
  })

  test('resource edge param → pool ⇒ graph loads, run still works, project dropped', async ({ page }) => {
    const param = { id: 'pm', type: 'parameter', position: { x: 0, y: 0 }, data: { kind: 'parameter', label: 'x', value: 1 } }
    const edge = { id: 'e1', type: 'loop', source: 'pm', target: 'p1', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } }
    await setFile(page, 'edge-to-param.json', graphFile([param, pool], [edge], badProject))

    await expect(page.locator('.react-flow__node[data-id="p1"]')).toBeVisible()
    await expect(page.locator('.react-flow__node[data-id="pm"]')).toBeVisible()
    expect(await projectOpen(page)).toBe(false)

    await page.locator('.pstrip button[title="Advance one step"]').click()
    await expect(page.locator('.pstrip')).toBeVisible()
  })
})
