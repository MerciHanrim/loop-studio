import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, openApp, resetAll } from './loop'

// loop-revision/1 verification fixture (examples/revision/*, generated + guarded
// by test/revision-fixture.test.ts). This spec replays the real
// Import → Review → whole/selective Apply → Undo → Redo flow through the UI and
// checks every graph state against the committed oracle. The mobile project
// runs the same assertions from mobile.spec.ts (`fixtureFlow('mobile')`).

const FX = resolve(import.meta.dirname, '..', '..', 'examples', 'revision')
const read = (f: string) => readFileSync(resolve(FX, f), 'utf8')
export const ORACLE = JSON.parse(read('oracle.json'))
export const BASE_REVISION = read('base.revision.json')
export const PROPOSAL_CLEAN = read('proposal.clean.json')
export const PROPOSAL_STRUCTURAL = read('proposal.structural.json')

export async function graphDigest(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const M = await import('/src/model/revision.ts')
    const g = (window as unknown as { __loop: any }).__loop.graph.getState()
    return M.digestOfCanonical(M.canonicalContent({ nodes: g.nodes, edges: g.edges }))
  })
}
const openRev = (page: Page) =>
  page.evaluate(() => (window as unknown as { __loop: any }).__loop.project.getState().open?.revisionId ?? null)
const undo = (page: Page) => page.evaluate(() => (window as unknown as { __loop: any }).__loop.graph.getState().undo())
const redo = (page: Page) => page.evaluate(() => (window as unknown as { __loop: any }).__loop.graph.getState().redo())
const closeReview = (page: Page) =>
  page.evaluate(() => (window as unknown as { __loop: any }).__loop.review.getState().close())

async function importFixture(page: Page, kind: 'toolbar' | 'mobile', text: string): Promise<void> {
  const sel = kind === 'mobile' ? '.toolbar--mobile input[type="file"]' : '.toolbar__actions input[type=file]'
  await page.setInputFiles(sel, { name: 'fx.json', mimeType: 'application/json', buffer: Buffer.from(text) })
}

/** apply a named oracle selection through the real store, on the pending proposal */
async function applyOracleSelection(page: Page, key: string): Promise<{ ok: boolean }> {
  return page.evaluate((k) => {
    const L = (window as unknown as { __loop: any }).__loop
    const pending = L.review.getState().pending
    const sel = (window as unknown as { __ORACLE: any }).__ORACLE.selective[k].selection
    return L.revisionIO.applyPendingProposal(pending, { selection: sel })
  }, key) as Promise<{ ok: boolean }>
}

export function fixtureFlow(kind: 'toolbar' | 'mobile') {
  return async ({ page }: { page: Page }) => {
    await openApp(page)
    await resetAll(page)
    await page.evaluate((o) => {
      const L = (window as unknown as { __loop: any }).__loop
      L.project.getState().clear()
      L.review.getState().close()
      ;(window as unknown as { __ORACLE: unknown }).__ORACLE = o
    }, ORACLE)
    page.on('dialog', (d) => void d.accept().catch(() => {}))
    const reviewSel = kind === 'mobile' ? '.sheet[aria-label="Review proposal"]' : '.review'

    // ── Import the base Project revision ──
    await importFixture(page, kind, BASE_REVISION)
    await expect.poll(() => graphDigest(page)).toBe(ORACLE.digests.base)
    await expect.poll(() => openRev(page)).toBe(ORACLE.baseRevisionId)

    // ── Import the clean proposal ⇒ Review, no mutation ──
    await importFixture(page, kind, PROPOSAL_CLEAN)
    await expect(page.locator(reviewSel)).toBeVisible()
    expect(await graphDigest(page)).toBe(ORACLE.digests.base)

    // ── whole Apply (exact) via the real button ⇒ the proposed graph ──
    await page.locator(`${reviewSel} .review__actions button`, { hasText: 'Apply proposal' }).click()
    await expect(page.locator(reviewSel)).toBeHidden()
    expect(await graphDigest(page)).toBe(ORACLE.wholeApply.cleanOntoBase.digest)
    const applied = await openRev(page)
    expect(applied).not.toBe(ORACLE.baseRevisionId)

    // ── one Undo restores the base graph AND the base revision header ──
    await undo(page)
    await expect.poll(() => graphDigest(page)).toBe(ORACLE.digests.base)
    await expect.poll(() => openRev(page)).toBe(ORACLE.baseRevisionId)

    // ── Redo re-applies both ──
    await redo(page)
    await expect.poll(() => graphDigest(page)).toBe(ORACLE.wholeApply.cleanOntoBase.digest)
    await expect.poll(() => openRev(page)).toBe(applied)
    await undo(page) // back to base for the selective checks
    await expect.poll(() => graphDigest(page)).toBe(ORACLE.digests.base)

    // ── selective: clean proposal, new node + gate change only ──
    await importFixture(page, kind, PROPOSAL_CLEAN)
    await expect(page.locator(reviewSel)).toBeVisible()
    expect((await applyOracleSelection(page, 'clean/base/addNode+gateOnly')).ok).toBe(true)
    await closeReview(page)
    expect(await graphDigest(page)).toBe(ORACLE.selective['clean/base/addNode+gateOnly'].digest)
    await undo(page)
    await expect.poll(() => graphDigest(page)).toBe(ORACLE.digests.base)

    // ── selective: structural proposal ──
    await importFixture(page, kind, PROPOSAL_STRUCTURAL)
    await expect(page.locator(reviewSel)).toBeVisible()
    // node alone ⇒ invalid (e_pg dangles), nothing changes
    expect((await applyOracleSelection(page, 'structural/base/nodeAlone')).ok).toBe(false)
    expect(await graphDigest(page)).toBe(ORACLE.digests.base)
    // remove gate + drop e_pg + retarget e_gd ⇒ equals the whole structural graph
    expect((await applyOracleSelection(page, 'structural/base/removeGate+retarget')).ok).toBe(true)
    await closeReview(page)
    expect(await graphDigest(page)).toBe(ORACLE.selective['structural/base/removeGate+retarget'].digest)
    expect(await graphDigest(page)).toBe(ORACLE.digests.structural)
  }
}
