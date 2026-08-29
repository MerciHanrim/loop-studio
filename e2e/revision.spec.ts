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

/** open Export ▾, click an item, return the download it produced (or null). */
async function exportVia(page: Page, item: RegExp | string): Promise<Download | null> {
  await exportBtn(page).click()
  const wait = page.waitForEvent('download', { timeout: 3000 }).catch(() => null)
  await exportItem(page, item).click()
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
