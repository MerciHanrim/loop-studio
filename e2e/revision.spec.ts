import { readFileSync } from 'node:fs'
import type { Download, Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// SEMANTICS-R.md loop-revision/1 — the Slice 1C surface through the real UI:
//  • Export ▾ gains "Project revision" / "Make a proposal" (two-phase commit);
//  • importing a proposal opens the non-destructive Review overlay and mutates
//    NOTHING until Apply / Open-as-a-document;
//  • whole Apply = one atomic loadDoc (+1 simulationRev, paused@0, one undo
//    entry that also restores the project header), a fresh revision id, and an
//    `appliedProposal` record;
//  • non-`exact` whole Apply needs an explicit confirmation;
//  • a wrong project / Cancel changes nothing;
//  • plain Graph / Workspace Export never carries a `project` header.

const textOf = async (dl: Download): Promise<string> => readFileSync((await dl.path())!, 'utf8')

const exportBtn = (page: Page) =>
  page.locator('.toolbar__actions .menu > button', { hasText: 'Export ▾' })
const exportItem = (page: Page, name: RegExp | string) =>
  page
    .locator('.toolbar__actions .menu__pop .menu__item')
    .filter({ has: page.locator('.menu__name', { hasText: name }) })

/** open Export ▾, click an item, answer the in-app disclosure dialog if it
 *  appears (Slice 2b — Project revision now discloses via ConfirmDialog), and
 *  return the download it produced (or null). */
async function exportVia(
  page: Page,
  item: RegExp | string,
  choice: 'accept' | 'cancel' | null = 'accept',
): Promise<Download | null> {
  await exportBtn(page).click()
  const wait = page.waitForEvent('download', { timeout: 3000 }).catch(() => null)
  await exportItem(page, item).click()
  const dlg = page.locator('.mcdlg--confirm')
  if (choice && (await dlg.isVisible().catch(() => false))) {
    const name = choice === 'cancel' ? /^cancel$/i : /export revision|save workspace/i
    await dlg.getByRole('button', { name }).click()
    await expect(dlg).toHaveCount(0)
  }
  return wait
}

async function setFile(page: Page, name: string, text: string): Promise<void> {
  await page.setInputFiles('.toolbar__actions input[type=file]', {
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(text, 'utf8'),
  })
}

type Snap = {
  nodes: number
  edges: number
  simRev: number
  canUndo: boolean
  dirty: boolean
  simStatus: string
  step: number
  open: null | {
    projectId: string
    revisionId: string
    role: string
    parentId: string | null
    applied: null | { proposalId: string; baseId: string; baseDigest: string }
  }
  headerRevisionId: string | null
}

const snap = (page: Page): Promise<Snap> =>
  page.evaluate(() => {
    const L = (window as unknown as { __loop: Record<string, { getState: () => any }> }).__loop
    const g = L.graph.getState()
    const p = L.project.getState()
    const s = L.sim.getState()
    let headerRevisionId: string | null = null
    try {
      headerRevisionId =
        JSON.parse(localStorage.getItem('loop-studio:graph:v1') ?? '{}').project?.revisionId ?? null
    } catch {
      headerRevisionId = null
    }
    return {
      nodes: g.nodes.length,
      edges: g.edges.length,
      simRev: g.simulationRev,
      canUndo: g.canUndo,
      dirty: p.dirty,
      simStatus: s.status,
      step: s.stepIndex,
      open: p.open
        ? {
            projectId: p.open.projectId,
            revisionId: p.open.revisionId,
            role: p.open.role,
            parentId: p.open.parentId,
            applied: p.open.appliedProposal ?? null,
          }
        : null,
      headerRevisionId,
    }
  })

async function seedGraph(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = (window as unknown as { __loop: Record<string, { getState: () => any }> }).__loop.graph.getState()
    g.newGraph()
    g.addNodeAt('pool', { x: 0, y: 0 })
    g.addNodeAt('drain', { x: 220, y: 0 })
  })
}

const addNode = (page: Page, kind: string) =>
  page.evaluate(
    (k) =>
      (window as unknown as { __loop: Record<string, { getState: () => any }> }).__loop.graph
        .getState()
        .addNodeAt(k, { x: 400, y: 120 }),
    kind,
  )

test.describe('loop-revision/1 — Slice 1C', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await page.evaluate(() => {
      const L = (window as unknown as { __loop: Record<string, { getState: () => any }> }).__loop
      L.project.getState().clear()
      L.review.getState().close()
      try {
        localStorage.removeItem('loop-studio:author')
      } catch {
        /* ignore */
      }
    })
    // accept the Project-revision disclosure + any alert by default
    page.on('dialog', (d) => {
      d.accept().catch(() => {})
    })
    await seedGraph(page)
  })

  test('Export → Project revision writes a project header; Graph / Workspace never do', async ({
    page,
  }) => {
    const rev = await exportVia(page, /Project revision/)
    expect(rev).not.toBeNull()
    const revFile = JSON.parse(await textOf(rev!))
    expect(revFile.project).toMatchObject({ schema: 'loop-revision/1', role: 'revision', parentId: null })
    expect(revFile.project.contentDigest).toMatch(/^[0-9a-f]{64}$/)
    // the chip now reflects an open revision
    await expect(page.locator('.rev-chip')).toContainText('rev ')

    // with a project OPEN, the plain exports must still be header-free
    const graph = await exportVia(page, /Graph JSON/)
    expect(JSON.parse(await textOf(graph!)).project).toBeUndefined()

    const ws = await exportVia(page, /Workspace JSON/)
    expect(JSON.parse(await textOf(ws!)).project).toBeUndefined()
  })

  test('Make a proposal is gated until a project exists, then carries base.content', async ({
    page,
  }) => {
    await exportBtn(page).click()
    await expect(exportItem(page, /Make a proposal/)).toBeDisabled()
    await exportBtn(page).click() // close

    await exportVia(page, /Project revision/)
    const prop = await exportVia(page, /Make a proposal/)
    expect(prop).not.toBeNull()
    const f = JSON.parse(await textOf(prop!))
    expect(f.project.role).toBe('proposal')
    expect(f.project.base.content).toBeTruthy()
    expect(f.project.base.contentDigest).toMatch(/^[0-9a-f]{64}$/)
  })

  test('importing a proposal opens Review and mutates nothing; author shows as unverified', async ({
    page,
  }) => {
    await exportVia(page, /Project revision/)
    const prop = await exportVia(page, /Make a proposal/)
    const proposalText = await textOf(prop!)

    await addNode(page, 'gate') // the open doc drifts from the base
    const before = await snap(page)

    await setFile(page, 'p.json', proposalText)
    await expect(page.locator('.review')).toBeVisible()
    await expect(page.locator('.review')).toContainText('unverified')
    await expect(page.locator('.review__foot')).toContainText('Nothing is written to a file')

    // Import ≠ Apply — the graph, the sim, the undo stack and the open revision
    // are all exactly where they were.
    const during = await snap(page)
    expect(during.nodes).toBe(before.nodes)
    expect(during.edges).toBe(before.edges)
    expect(during.simRev).toBe(before.simRev)
    expect(during.canUndo).toBe(before.canUndo)
    expect(during.step).toBe(before.step)
    expect(during.open!.revisionId).toBe(before.open!.revisionId)
    expect(during.open!.applied).toBeNull()
  })

  test('non-exact whole Apply needs confirmation; Cancel leaves everything intact', async ({
    page,
  }) => {
    await exportVia(page, /Project revision/)
    const r0 = (await snap(page)).open!.revisionId
    const prop = await exportVia(page, /Make a proposal/)
    const proposalText = await textOf(prop!)

    await addNode(page, 'gate') // diverge from the base
    const before = await snap(page)

    await setFile(page, 'p.json', proposalText)
    await expect(page.locator('.review')).toBeVisible()

    // first click only arms the confirmation (§R7A.4)
    await page.locator('.review__actions button', { hasText: 'Apply proposal' }).click()
    await expect(page.locator('.review__warn')).toBeVisible()
    await expect(page.locator('.review__actions button', { hasText: 'Apply anyway' })).toBeVisible()

    // Cancel → no state change at all
    await page.locator('.review__actions button', { hasText: 'Cancel' }).click()
    await expect(page.locator('.review')).toBeHidden()
    const after = await snap(page)
    expect(after.open!.revisionId).toBe(r0)
    expect(after.nodes).toBe(before.nodes)
    expect(after.simRev).toBe(before.simRev)
    expect(after.open!.applied).toBeNull()
  })

  test('exact whole Apply lands with no confirmation; +1 simulationRev, paused@0, new revision + appliedProposal', async ({
    page,
  }) => {
    await exportVia(page, /Project revision/)
    const r0 = (await snap(page)).open!.revisionId
    const prop = await exportVia(page, /Make a proposal/)
    const proposalText = await textOf(prop!)
    const proposalId = JSON.parse(proposalText).project.revisionId

    const before = await snap(page)
    await setFile(page, 'p.json', proposalText) // target IS the base ⇒ exact
    await expect(page.locator('.review')).toBeVisible()
    await expect(page.locator('.review')).toContainText('exactly the base')

    await page.locator('.review__actions button', { hasText: 'Apply proposal' }).click()
    await expect(page.locator('.review')).toBeHidden()

    const after = await snap(page)
    expect(after.open!.revisionId).not.toBe(r0)
    expect(after.open!.parentId).toBe(r0)
    expect(after.open!.role).toBe('revision')
    expect(after.open!.applied).toEqual({
      proposalId,
      baseId: r0,
      baseDigest: JSON.parse(proposalText).project.base.contentDigest,
    })
    expect(after.simRev).toBe(before.simRev + 1)
    expect(after.step).toBe(0)
    expect(after.simStatus).not.toBe('running')
    expect(after.headerRevisionId).toBe(after.open!.revisionId)
  })

  test('one Undo restores the pre-Apply graph AND the project header together', async ({ page }) => {
    await exportVia(page, /Project revision/)
    const r0 = (await snap(page)).open!.revisionId
    const prop = await exportVia(page, /Make a proposal/)
    const proposalText = await textOf(prop!)

    await addNode(page, 'gate')
    const preApply = await snap(page) // 3 nodes, dirty, still r0

    await setFile(page, 'p.json', proposalText)
    await page.locator('.review__actions button', { hasText: 'Apply proposal' }).click()
    await page.locator('.review__actions button', { hasText: 'Apply anyway' }).click()
    await expect(page.locator('.review')).toBeHidden()

    const applied = await snap(page)
    expect(applied.open!.revisionId).not.toBe(r0)
    expect(applied.nodes).toBe(2) // proposal graph (== base) adopted whole

    await page.locator('.toolbar__actions button[title^="Undo"]').click()

    const undone = await snap(page)
    expect(undone.nodes).toBe(preApply.nodes) // graph back
    expect(undone.open!.revisionId).toBe(r0) // header back
    expect(undone.open!.applied).toBeNull()
    expect(undone.headerRevisionId).toBe(r0) // autosave record back
  })

  test('a proposal for a different project cannot be applied, only opened as a document', async ({
    page,
  }) => {
    await exportVia(page, /Project revision/)
    const prop = await exportVia(page, /Make a proposal/)
    const f = JSON.parse(await textOf(prop!))
    f.project.projectId = `proj_${'Z'.repeat(26)}`
    const before = await snap(page)

    await setFile(page, 'p.json', JSON.stringify(f))
    await expect(page.locator('.review')).toBeVisible()
    await expect(page.locator('.review')).toContainText('different project')
    await expect(page.locator('.review__actions button', { hasText: 'Apply proposal' })).toHaveCount(0)

    // Apply is impossible; only "Open as a document" is offered.
    await page.locator('.review__actions button', { hasText: 'Open as a document' }).click()
    await expect(page.locator('.review')).toBeHidden()
    const after = await snap(page)
    expect(after.open!.role).toBe('proposal')
    expect(after.open!.revisionId).toBe(f.project.revisionId) // the proposal's own id
    expect(after.open!.projectId).not.toBe(before.open!.projectId) // its own (foreign) project
  })

  test('re-exporting an edited proposal keeps the original base.content and digest (§R6)', async ({
    page,
  }) => {
    await exportVia(page, /Project revision/)
    const r0 = (await snap(page)).open!.revisionId
    const prop = await exportVia(page, /Make a proposal/)
    const p0 = JSON.parse(await textOf(prop!))
    const baseDigest0 = p0.project.base.contentDigest

    // Open the proposal as a document, edit it, re-export
    await setFile(page, 'p.json', JSON.stringify(p0))
    await page.locator('.review__actions button', { hasText: 'Open as a document' }).click()
    await expect(page.locator('.rev-chip')).toContainText('proposal')
    await addNode(page, 'converter')

    const prop2 = await exportVia(page, /Make a proposal/)
    const p2 = JSON.parse(await textOf(prop2!))
    expect(p2.project.role).toBe('proposal')
    expect(p2.project.base.revisionId).toBe(r0) // pinned
    expect(p2.project.base.contentDigest).toBe(baseDigest0) // pinned
    expect(p2.project.parentId).toBe(r0)
    // the proposed top-level graph is the EDITED one
    expect(p2.nodes.length).toBeGreaterThan(p0.nodes.length)
  })

  test('Apply re-classifies at the click: a target edited after an exact Review needs confirmation', async ({
    page,
  }) => {
    await exportVia(page, /Project revision/)
    const prop = await exportVia(page, /Make a proposal/)
    const proposalText = await textOf(prop!)

    await setFile(page, 'p.json', proposalText)
    await expect(page.locator('.review')).toContainText('exactly the base') // exact at open time

    // edit the target through the normal editor AFTER the Review is open
    await addNode(page, 'gate')

    // first Apply click now returns needs-confirmation (re-checked), not a silent apply
    await page.locator('.review__actions button', { hasText: 'Apply proposal' }).click()
    await expect(page.locator('.review__warn')).toBeVisible()
    await expect(page.locator('.review__actions button', { hasText: 'Apply anyway' })).toBeVisible()
    // and the graph was not touched by that first click
    expect((await snap(page)).open!.applied).toBeNull()
  })

  test('proposal reboot rule (§R8): reload drops the proposal header, keeps the graph, re-import restores it', async ({
    page,
  }) => {
    await exportVia(page, /Project revision/)
    const r0 = (await snap(page)).open!.revisionId
    const prop = await exportVia(page, /Make a proposal/)
    const proposalText = await textOf(prop!)

    await setFile(page, 'p.json', proposalText)
    await page.locator('.review__actions button', { hasText: 'Open as a document' }).click()
    await expect(page.locator('.rev-chip')).toContainText('proposal')
    await addNode(page, 'converter')
    const nodesBefore = (await snap(page)).nodes
    // wait for graphStore's debounced autosave to actually hit localStorage
    await expect
      .poll(() =>
        page.evaluate(() => {
          try {
            return JSON.parse(localStorage.getItem('loop-studio:graph:v1') ?? '{}').nodes?.length ?? 0
          } catch {
            return 0
          }
        }),
      )
      .toBe(nodesBefore)

    // ── reload ──
    await page.reload()
    await page.waitForFunction(() => Boolean((window as unknown as { __loop?: unknown }).__loop))

    const after = await snap(page)
    expect(after.nodes).toBe(nodesBefore) // the graph work is kept
    expect(after.open).toBeNull() // the proposal header is dropped (no pinned base to restore)
    await expect(page.locator('.boot-notice')).toBeVisible()
    // re-export / apply are unavailable while there is no project
    await exportBtn(page).click()
    await expect(exportItem(page, /Make a proposal/)).toBeDisabled()
    await exportBtn(page).click()

    await page.locator('.boot-notice button', { hasText: 'Dismiss' }).click()
    await expect(page.locator('.boot-notice')).toBeHidden()

    // ── re-importing the original proposal file restores the pinned base ──
    await setFile(page, 'p.json', proposalText)
    await page.locator('.review__actions button', { hasText: 'Open as a document' }).click()
    await expect(page.locator('.rev-chip')).toContainText('proposal')
    const prop2 = await exportVia(page, /Make a proposal/)
    expect(JSON.parse(await textOf(prop2!)).project.base.revisionId).toBe(r0)
  })
})

// ── Slice 2 — per-hunk selective apply (§R7.2 / §R7A.3) ───────────────────

/** promote a 2-node graph, then build an edited proposal (adds `p_new`, changes
 *  the seeded pool's `initial` 0 → 42) with a valid `contentDigest`. Uses the
 *  dev source module for the digest so the router accepts it. */
async function editedProposal(page: Page): Promise<{ text: string; r0: string; sid: string }> {
  return page.evaluate(async () => {
    const M = await import('/src/model/revision.ts')
    const L = (window as unknown as { __loop: Record<string, { getState: () => any }> }).__loop
    const G = L.graph.getState()
    G.newGraph()
    G.addNodeAt('pool', { x: 0, y: 0 })
    G.addNodeAt('drain', { x: 200, y: 0 })
    const P = L.project.getState()
    P.commitRevisionExport(P.planRevision({}).plan)
    const r0 = L.project.getState().open.revisionId
    const sid = L.graph.getState().nodes[0].id
    const f = JSON.parse(P.planProposal({}).text)
    f.nodes.push({
      id: 'p_new',
      type: 'pool',
      position: { x: 60, y: 60 },
      data: { kind: 'pool', label: 'New', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' },
    })
    f.nodes.find((n: { id: string }) => n.id === sid).data.initial = 42
    f.project.contentDigest = M.digestOfCanonical(M.canonicalContent({ nodes: f.nodes, edges: f.edges }))
    return { text: JSON.stringify(f), r0, sid }
  })
}

const nodeInitial = (page: Page, id: string) =>
  page.evaluate(
    (nid) =>
      (window as unknown as { __loop: Record<string, { getState: () => any }> }).__loop.graph
        .getState()
        .nodes.find((n: { id: string }) => n.id === nid)?.data.initial,
    id,
  )

test.describe('loop-revision/1 — Slice 2 per-hunk apply', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await page.evaluate(() => {
      const L = (window as unknown as { __loop: Record<string, { getState: () => any }> }).__loop
      L.project.getState().clear()
      L.review.getState().close()
    })
    page.on('dialog', (d) => {
      d.accept().catch(() => {})
    })
  })

  test('"Choose changes" lists the hunks; applying a subset touches only those, atomically', async ({
    page,
  }) => {
    const { r0, sid, text } = await editedProposal(page)
    await setFile(page, 'p.json', text)
    await expect(page.locator('.review')).toBeVisible()

    await page.locator('.review__actions button', { hasText: 'Choose changes' }).click()
    const hunks = page.locator('.review__hunk')
    await expect(hunks).toHaveCount(2)
    await expect(hunks.filter({ hasText: 'Add node' })).toContainText('p_new')
    await expect(hunks.filter({ hasText: 'Change node' })).toContainText('data.initial')

    const simRevBefore = await page.evaluate(
      () => (window as unknown as { __loop: any }).__loop.graph.getState().simulationRev,
    )

    // deselect the "Add p_new" hunk → apply only the change
    await page.locator('.review__hunk', { hasText: 'Add node' }).locator('input[type=checkbox]').uncheck()
    await page.locator('.review__actions button', { hasText: /^Apply \d+ selected/ }).click()
    await expect(page.locator('.review')).toBeHidden()

    expect(await nodeInitial(page, sid)).toBe(42) // the change WAS applied
    expect(
      await page.evaluate(() => (window as unknown as { __loop: any }).__loop.graph.getState().nodes.some((n: any) => n.id === 'p_new')),
    ).toBe(false) // the add was NOT

    const after = await page.evaluate(() => {
      const L = (window as unknown as { __loop: any }).__loop
      return {
        simRev: L.graph.getState().simulationRev,
        step: L.sim.getState().stepIndex,
        parent: L.project.getState().open.parentId,
        rev: L.project.getState().open.revisionId,
      }
    })
    expect(after.simRev).toBe(simRevBefore + 1)
    expect(after.step).toBe(0)
    expect(after.parent).toBe(r0)
    expect(after.rev).not.toBe(r0)

    // one undo restores the pre-apply graph AND the r0 header
    await page.locator('.toolbar__actions button[title^="Undo"]').click()
    expect(await nodeInitial(page, sid)).toBe(0)
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __loop: any }).__loop.project.getState().open.revisionId))
      .toBe(r0)
  })

  test('a field conflict shows base / yours / theirs and "keep mine" wins when chosen', async ({
    page,
  }) => {
    const { sid, text } = await editedProposal(page)
    // diverge the same field to a third value ⇒ the change hunk is a conflict
    await page.evaluate(
      (nid) => (window as unknown as { __loop: any }).__loop.graph.getState().updateNodeData(nid, { initial: 15 }),
      sid,
    )
    await setFile(page, 'p.json', text)
    await page.locator('.review__actions button', { hasText: 'Choose changes' }).click()

    const conflict = page.locator('.review__field-row--conflict')
    await expect(conflict).toBeVisible()
    await expect(conflict).toContainText('base')
    await expect(conflict).toContainText('yours')
    await expect(conflict).toContainText('theirs')

    // keep mine on the conflicting field
    await conflict.locator('label', { hasText: 'keep mine' }).locator('input').check()
    await page.locator('.review__actions button', { hasText: /^Apply \d+ selected/ }).click()
    await expect(page.locator('.review')).toBeHidden()
    expect(await nodeInitial(page, sid)).toBe(15) // yours preserved
  })

  test('an invalid selection is refused before Apply, with an explanation and no change', async ({
    page,
  }) => {
    const built = await page.evaluate(async () => {
      const M = await import('/src/model/revision.ts')
      const L = (window as unknown as { __loop: Record<string, { getState: () => any }> }).__loop
      const G = L.graph.getState()
      G.newGraph()
      G.addNodeAt('pool', { x: 0, y: 0 })
      G.addNodeAt('drain', { x: 200, y: 0 })
      const P = L.project.getState()
      P.commitRevisionExport(P.planRevision({}).plan)
      const sid = L.graph.getState().nodes[0].id
      const f = JSON.parse(P.planProposal({}).text)
      f.nodes.push({
        id: 'c',
        type: 'pool',
        position: { x: 80, y: 0 },
        data: { kind: 'pool', label: 'C', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' },
      })
      f.edges.push({
        id: 'e_xc',
        type: 'loop',
        source: sid,
        target: 'c',
        sourceHandle: 'out',
        targetHandle: 'in',
        data: { kind: 'resource', flow: '1' },
      })
      f.project.contentDigest = M.digestOfCanonical(M.canonicalContent({ nodes: f.nodes, edges: f.edges }))
      return { text: JSON.stringify(f) }
    })
    const sigBefore = await page.evaluate(() =>
      JSON.stringify((window as unknown as { __loop: any }).__loop.graph.getState().nodes.map((n: any) => n.id)),
    )

    await setFile(page, 'p.json', built.text)
    await page.locator('.review__actions button', { hasText: 'Choose changes' }).click()
    // accept the edge, NOT node c
    await page.locator('.review__hunk', { hasText: 'Add edge' }).locator('input[type=checkbox]').check()
    await page.locator('.review__hunk', { hasText: 'Add node' }).locator('input[type=checkbox]').uncheck()
    await page.locator('.review__actions button', { hasText: /^Apply \d+ selected/ }).click()

    await expect(page.locator('.review__warn')).toContainText(/edge/i)
    await expect(page.locator('.review')).toBeVisible() // still open, nothing applied
    expect(
      await page.evaluate(() =>
        JSON.stringify((window as unknown as { __loop: any }).__loop.graph.getState().nodes.map((n: any) => n.id)),
      ),
    ).toBe(sigBefore)
  })

  test('node removal shows its edge dependency; the node alone is refused, node + dep applies', async ({
    page,
  }) => {
    const built = await page.evaluate(async () => {
      const M = await import('/src/model/revision.ts')
      const L = (window as unknown as { __loop: Record<string, { getState: () => any }> }).__loop
      const G = L.graph.getState()
      G.newGraph()
      G.addNodeAt('pool', { x: 0, y: 0 })
      G.addNodeAt('drain', { x: 200, y: 0 })
      const [a, b] = L.graph.getState().nodes
      L.graph.getState().onConnect({ source: a.id, target: b.id, sourceHandle: 'out', targetHandle: 'in' })
      const eid = L.graph.getState().edges[0].id
      const P = L.project.getState()
      P.commitRevisionExport(P.planRevision({}).plan)
      const f = JSON.parse(P.planProposal({}).text)
      f.nodes = f.nodes.filter((n: { id: string }) => n.id !== b.id) // proposal removes node b …
      f.edges = f.edges.filter((e: { id: string }) => e.id !== eid) // … and its edge
      f.project.contentDigest = M.digestOfCanonical(M.canonicalContent({ nodes: f.nodes, edges: f.edges }))
      return { text: JSON.stringify(f), bId: b.id, eid }
    })

    await setFile(page, 'p.json', built.text)
    await page.locator('.review__actions button', { hasText: 'Choose changes' }).click()

    const nodeHunk = page.locator('.review__hunk', { hasText: 'Remove node' })
    await expect(nodeHunk.locator('.review__hunk-dep')).toContainText(built.eid) // dependency is visible

    // deselect the standalone edge-removal hunk, keep the node ⇒ refused
    await page
      .locator('.review__hunk', { hasText: 'Remove edge' })
      .locator('input[type=checkbox]')
      .uncheck()
    await nodeHunk.locator('input[type=checkbox]').check()
    await page.locator('.review__actions button', { hasText: /^Apply \d+ selected/ }).click()
    await expect(page.locator('.review__warn')).toContainText(built.eid)
    await expect(page.locator('.review')).toBeVisible()

    // re-select the dependency ⇒ clean removal of both
    await page
      .locator('.review__hunk', { hasText: 'Remove edge' })
      .locator('input[type=checkbox]')
      .check()
    await page.locator('.review__actions button', { hasText: /^Apply \d+ selected/ }).click()
    await expect(page.locator('.review')).toBeHidden()
    const after = await page.evaluate(() => {
      const g = (window as unknown as { __loop: any }).__loop.graph.getState()
      return { nodes: g.nodes.length, edges: g.edges.length }
    })
    expect(after.nodes).toBe(1)
    expect(after.edges).toBe(0)
  })

  test('editing the target while the hunk list is open re-computes it; apply runs on the fresh state', async ({
    page,
  }) => {
    const { sid, text } = await editedProposal(page) // proposal: add p_new + change sid.initial 0→42
    await setFile(page, 'p.json', text)
    await page.locator('.review__actions button', { hasText: 'Choose changes' }).click()
    // initially the change hunk is clean (target initial still 0)
    await expect(page.locator('.review__field-row--conflict')).toHaveCount(0)

    // edit the SAME field on the target through the normal editor
    await page.evaluate(
      (nid) => (window as unknown as { __loop: any }).__loop.graph.getState().updateNodeData(nid, { initial: 15 }),
      sid,
    )
    // the hunk list re-computes → the field is now a conflict
    await expect(page.locator('.review__field-row--conflict')).toBeVisible()
    await expect(page.locator('.review__field-row--conflict')).toContainText('15') // yours

    // resolve it and apply — runs against the fresh target
    await page
      .locator('.review__field-row--conflict label', { hasText: 'take theirs' })
      .locator('input')
      .check()
    await page.locator('.review__actions button', { hasText: /^Apply \d+ selected/ }).click()
    await expect(page.locator('.review')).toBeHidden()
    expect(await nodeInitial(page, sid)).toBe(42)
  })

  test('structural conflict: a local edge onto a proposal-removed node ⇒ divergent + confirm, blocked in the hunk list', async ({
    page,
  }) => {
    const built = await page.evaluate(async () => {
      const M = await import('/src/model/revision.ts')
      const L = (window as unknown as { __loop: Record<string, { getState: () => any }> }).__loop
      const G = L.graph.getState()
      G.newGraph()
      G.addNodeAt('pool', { x: 0, y: 0 })
      G.addNodeAt('drain', { x: 200, y: 0 })
      const [p0, d0] = L.graph.getState().nodes
      const P = L.project.getState()
      P.commitRevisionExport(P.planRevision({}).plan)
      const f = JSON.parse(P.planProposal({}).text)
      f.nodes = f.nodes.filter((n: { id: string }) => n.id !== d0.id) // proposal removes the drain
      f.project.contentDigest = M.digestOfCanonical(M.canonicalContent({ nodes: f.nodes, edges: f.edges }))
      return { text: JSON.stringify(f), pId: p0.id, dId: d0.id }
    })

    await setFile(page, 'p.json', built.text)
    await expect(page.locator('.review')).toBeVisible()

    // add a LOCAL edge onto the node the proposal removes
    await page.evaluate(
      ([src, tgt]) =>
        (window as unknown as { __loop: any }).__loop.graph
          .getState()
          .onConnect({ source: src, target: tgt, sourceHandle: 'out', targetHandle: 'in' }),
      [built.pId, built.dId],
    )

    // the class line is `divergent` — never "No field conflicts"
    await expect(page.locator('.review__class--divergent')).toBeVisible()
    await expect(page.locator('.review')).not.toContainText('No field conflicts')

    // whole apply confirms
    await page.locator('.review__actions button', { hasText: 'Apply proposal' }).click()
    await expect(page.locator('.review__warn')).toBeVisible()

    // and in the hunk list the node removal is blocked with "yours added edge"
    // (switching mode also clears the armed confirmation)
    await page.locator('.review__actions button', { hasText: 'Choose changes' }).click()
    const nodeHunk = page.locator('.review__hunk', { hasText: 'Remove node' })
    await expect(nodeHunk.locator('.review__hunk-dep--blocked')).toContainText('yours added edge')
    await expect(nodeHunk.locator('input[type=checkbox]')).toBeDisabled()
  })

  test('node removal dependency is satisfied by retargeting the incident edge', async ({ page }) => {
    const built = await page.evaluate(async () => {
      const M = await import('/src/model/revision.ts')
      const L = (window as unknown as { __loop: Record<string, { getState: () => any }> }).__loop
      const G = L.graph.getState()
      G.newGraph()
      G.addNodeAt('source', { x: 0, y: 0 })
      G.addNodeAt('pool', { x: 200, y: 0 })
      G.addNodeAt('drain', { x: 400, y: 0 })
      const [s, mid, d] = L.graph.getState().nodes
      L.graph.getState().onConnect({ source: s.id, target: mid.id, sourceHandle: 'out', targetHandle: 'in' })
      const eid = L.graph.getState().edges[0].id
      const P = L.project.getState()
      P.commitRevisionExport(P.planRevision({}).plan)
      const f = JSON.parse(P.planProposal({}).text)
      f.nodes = f.nodes.filter((n: { id: string }) => n.id !== mid.id) // remove `mid`
      f.edges.find((e: { id: string }) => e.id === eid).target = d.id // retarget s→mid ⇒ s→d
      f.project.contentDigest = M.digestOfCanonical(M.canonicalContent({ nodes: f.nodes, edges: f.edges }))
      return { text: JSON.stringify(f), midId: mid.id, dId: d.id, eid }
    })

    await setFile(page, 'p.json', built.text)
    await page.locator('.review__actions button', { hasText: 'Choose changes' }).click()

    const nodeHunk = page.locator('.review__hunk', { hasText: 'Remove node' })
    await expect(nodeHunk.locator('.review__hunk-dep')).toContainText(built.eid)
    await expect(nodeHunk.locator('.review__hunk-dep')).toContainText('retarget')

    // accept the node removal AND take the edge's new endpoint
    await nodeHunk.locator('input[type=checkbox]').check()
    await page
      .locator('.review__field-row', { hasText: 'target' })
      .locator('label', { hasText: 'take theirs' })
      .locator('input')
      .check()
    await page.locator('.review__actions button', { hasText: /^Apply \d+ selected/ }).click()
    await expect(page.locator('.review')).toBeHidden()

    const after = await page.evaluate((eid) => {
      const g = (window as unknown as { __loop: any }).__loop.graph.getState()
      return { nodes: g.nodes.length, edgeTarget: g.edges.find((e: any) => e.id === eid)?.target }
    }, built.eid)
    expect(after.nodes).toBe(2) // source + drain
    expect(after.edgeTarget).toBe(built.dId)
  })
})


// ── SEMANTICS-R5.md §R5-6 — the graph-level saved-`frames` hunk through the
// Review UI (cosmetic diff row + per-hunk selective apply). ──────────────────
test.describe('loop-revision/5 — saved frames in Review', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await page.evaluate(() => {
      const L = (window as unknown as { __loop: Record<string, { getState: () => any }> }).__loop
      L.project.getState().clear()
      L.review.getState().close()
      L.frame.getState().loadFrames(null)
    })
    page.on('dialog', (d) => {
      d.accept().catch(() => {})
    })
  })

  const liveFrames = (page: Page) =>
    page.evaluate(() =>
      (window as unknown as { __loop: any }).__loop.frame.getState().frames.map((f: any) => ({ ...f, n: undefined })),
    )

  /** a proposal file carrying a top-level `frames` array (digest recomputed to
   *  cover it). Planned while the origin is clean. `seedFrames` seeds the editor
   *  + the committed base first; `mutateNodes` can also edit a node. */
  const framedProposal = (
    page: Page,
    proposedFrames: unknown,
    opts: { seedFrames?: unknown; changeSeededInitial?: number } = {},
  ) =>
    page.evaluate(
      async ([pf, o]) => {
        const M = await import('/src/model/revision.ts')
        const L = (window as unknown as { __loop: Record<string, { getState: () => any }> }).__loop
        const G = L.graph.getState()
        G.newGraph()
        G.addNodeAt('pool', { x: 0, y: 0 })
        G.addNodeAt('drain', { x: 200, y: 0 })
        const opt = o as { seedFrames?: unknown; changeSeededInitial?: number }
        if (opt.seedFrames) L.frame.getState().loadFrames(opt.seedFrames)
        const P = L.project.getState()
        P.commitRevisionExport(P.planRevision({}).plan)
        const r0 = L.project.getState().open.revisionId
        const sid = L.graph.getState().nodes[0].id
        const f = JSON.parse(P.planProposal({}).text)
        if (typeof opt.changeSeededInitial === 'number') {
          f.nodes.find((n: { id: string }) => n.id === sid).data.initial = opt.changeSeededInitial
        }
        if (pf === null) delete f.frames
        else f.frames = pf
        f.project.contentDigest = M.digestOfCanonical(
          M.canonicalContent({ nodes: f.nodes, edges: f.edges, frames: f.frames }),
        )
        return { text: JSON.stringify(f), r0, sid }
      },
      [proposedFrames, opts] as const,
    )

  const F = [
    { id: 'zf1', label: 'Intake', rect: { x: 0, y: 0, w: 120, h: 60 } },
    { id: 'zf2', label: 'Output', rect: { x: 200, y: 0, w: 90, h: 50 }, color: 'gold' },
  ]

  test('a frames-only proposal: the diff names it "frames", "Choose changes" shows one Saved-frames row, checking it swaps the whole array in atomically; one undo restores', async ({ page }) => {
    const { r0, text } = await framedProposal(page, F)
    await setFile(page, 'p.json', text)
    await expect(page.locator('.review')).toBeVisible()
    // the whole-diff summary calls it a cosmetic "frames" change (not empty)
    await expect(page.locator('.review__diff')).toContainText('frames')
    await expect(page.locator('.review__diff')).not.toContainText('Nodes')

    await page.locator('.review__actions button', { hasText: 'Choose changes' }).click()
    const framesRow = page.locator('.review__hunk', { hasText: 'Saved frames' })
    await expect(framesRow).toHaveCount(1)
    await expect(page.locator('.review__hunk')).toHaveCount(1) // no node/edge hunks
    const box = framesRow.locator('input[type=checkbox]')
    await expect(box).toBeChecked() // a CLEAN frames hunk is pre-accepted

    const simRevBefore = await page.evaluate(
      () => (window as unknown as { __loop: any }).__loop.graph.getState().simulationRev,
    )
    await page.locator('.review__actions button', { hasText: /^Apply \d+ selected/ }).click()
    await expect(page.locator('.review')).toBeHidden()

    expect(await liveFrames(page)).toEqual(F.map((f) => ({ ...f, n: undefined })))
    const after = await page.evaluate(() => {
      const L = (window as unknown as { __loop: any }).__loop
      return { simRev: L.graph.getState().simulationRev, step: L.sim.getState().stepIndex, parent: L.project.getState().open.parentId }
    })
    expect(after.simRev).toBe(simRevBefore + 1) // ONE atomic step
    expect(after.step).toBe(0)
    expect(after.parent).toBe(r0)

    // one undo restores the pre-apply (empty) frames AND the r0 header together
    await page.evaluate(() => (window as unknown as { __loop: any }).__loop.graph.getState().undo())
    expect(await liveFrames(page)).toEqual([])
    expect(
      await page.evaluate(() => (window as unknown as { __loop: any }).__loop.project.getState().open.revisionId),
    ).toBe(r0)
  })

  test('leaving the frames row unchecked keeps the editor’s frames while a node change still applies', async ({ page }) => {
    const { sid, text } = await framedProposal(page, F, { changeSeededInitial: 77 })
    await setFile(page, 'p.json', text)
    await expect(page.locator('.review')).toBeVisible()
    // give the editor its own local frame (unrelated to the proposal)
    await page.evaluate(() =>
      (window as unknown as { __loop: any }).__loop.frame
        .getState()
        .loadFrames([{ id: 'mine', label: 'Mine', rect: { x: 1, y: 1, w: 9, h: 9 } }]),
    )
    await page.locator('.review__actions button', { hasText: 'Choose changes' }).click()
    // the frames hunk vs. a local frame is a CONFLICT — NOT pre-accepted; leave it
    const framesRow = page.locator('.review__hunk', { hasText: 'Saved frames' })
    await expect(framesRow).toHaveClass(/review__hunk--conflict/)
    await expect(framesRow.locator('input[type=checkbox]')).not.toBeChecked()
    // the node change (data.initial) is clean ⇒ its "take theirs" radio is pre-set
    const changeRow = page.locator('.review__hunk', { hasText: 'Change node' })
    await expect(changeRow.locator('input[type=radio]').first()).toBeChecked()
    await page.locator('.review__actions button', { hasText: /^Apply 1 selected/ }).click()
    await expect(page.locator('.review')).toBeHidden()

    expect(
      await page.evaluate(
        (id) =>
          (window as unknown as { __loop: any }).__loop.graph
            .getState()
            .nodes.find((n: any) => n.id === id).data.initial,
        sid,
      ),
    ).toBe(77) // the node change applied
    expect(await liveFrames(page)).toEqual([{ id: 'mine', label: 'Mine', rect: { x: 1, y: 1, w: 9, h: 9 }, n: undefined }]) // frames KEPT
  })

  test('a divergent frames edit is a conflict row and gates the whole Apply behind a confirmation', async ({ page }) => {
    const { text } = await framedProposal(page, [{ id: 'zf1', label: 'Intake (theirs)', rect: { x: 0, y: 0, w: 120, h: 60 } }], { seedFrames: F })
    await setFile(page, 'p.json', text)
    await expect(page.locator('.review')).toBeVisible()
    // diverge the editor's frames locally (a third array)
    await page.evaluate(() =>
      (window as unknown as { __loop: any }).__loop.frame
        .getState()
        .loadFrames([{ id: 'zf1', label: 'Intake (mine)', rect: { x: 0, y: 0, w: 120, h: 60 } }]),
    )
    await expect(page.locator('.review__class')).toContainText('overlap') // divergent copy
    await page.locator('.review__actions button', { hasText: 'Choose changes' }).click()
    const framesRow = page.locator('.review__hunk', { hasText: 'Saved frames' })
    await expect(framesRow).toHaveClass(/review__hunk--conflict/)
    await expect(framesRow.locator('input[type=checkbox]')).not.toBeChecked() // a conflict is NOT pre-accepted

    // the whole-proposal path now needs the explicit confirmation
    await page.locator('.review__actions button', { hasText: 'Whole proposal' }).click()
    await page.locator('.review__actions button', { hasText: 'Apply proposal' }).click()
    await expect(page.locator('.review__warn')).toBeVisible()
    await expect(page.locator('.review__actions button', { hasText: 'Apply anyway' })).toBeVisible()
  })
})
