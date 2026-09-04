import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// docs/module-system.md §MS8 — the module insert / extract surface through the
// real UI: the Insert-module menu, the bundled blocks, one atomic history
// entry, the v1 → v2 consent gate, extract to a download, and the
// dangling-`@ref` refusal.

type GS = {
  nodes: { id: string; selected?: boolean; data?: { label?: string } }[]
  edges: { id: string; source: string; target: string }[]
  past: unknown[]
  future: unknown[]
  modelVersion: number
}

const gs = (page: Page): Promise<GS> =>
  page.evaluate(() => {
    const g = (window as unknown as { __loop: { graph: { getState: () => GS } } }).__loop.graph.getState()
    return {
      nodes: g.nodes.map((n) => ({ id: n.id, selected: n.selected, data: { label: n.data?.label } })),
      edges: g.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
      past: g.past,
      future: g.future,
      modelVersion: g.modelVersion,
    }
  })

const moduleMenu = (page: Page) =>
  page.locator('.toolbar__actions .menu', {
    has: page.getByRole('button', { name: 'Insert module ▾' }),
  })

async function openMenu(page: Page): Promise<void> {
  await moduleMenu(page).getByRole('button', { name: 'Insert module ▾' }).click()
  await expect(moduleMenu(page).locator('.menu__pop')).toBeVisible()
}

async function insertBlock(page: Page, name: string): Promise<void> {
  await openMenu(page)
  await moduleMenu(page)
    .locator('.menu__item')
    .filter({ has: page.locator('.menu__name', { hasText: name }) })
    .click()
}

/** seed a tiny v1 host: one pool, no history. */
async function seedHost(page: Page): Promise<void> {
  await resetAll(page)
  await page.evaluate(() => {
    const g = (window as unknown as { __loop: { graph: { getState: () => any } } }).__loop.graph.getState()
    g.addNodeAt('pool', { x: 200, y: 200 })
  })
}

test.beforeEach(async ({ page }) => {
  await openApp(page)
  page.on('dialog', (d) => void d.accept().catch(() => {}))
})

test('the Insert-module menu lists the bundled blocks + From file + Extract', async ({ page }) => {
  await openMenu(page)
  const pop = moduleMenu(page).locator('.menu__pop')
  await expect(pop.locator('.menu__name', { hasText: 'Buffered production step' })).toBeVisible()
  await expect(pop.locator('.menu__name', { hasText: 'Reward split loop' })).toBeVisible()
  await expect(pop.locator('.menu__name', { hasText: 'From file…' })).toBeVisible()
  await expect(pop.locator('.menu__name', { hasText: 'Extract selection as module…' })).toBeVisible()
})

test('inserting a bundled block: fresh ids, inserted set selected, one history entry', async ({ page }) => {
  await seedHost(page)
  const before = await gs(page)

  await insertBlock(page, 'Buffered production step')
  const after = await gs(page)

  expect(after.nodes.length).toBe(before.nodes.length + 10)
  expect(after.edges.length).toBe(before.edges.length + 6)
  expect(after.past.length).toBe(before.past.length + 1)
  // every authored module id is gone; the inserted nodes are the selected set
  for (const authored of ['supply', 'inbox', 'intake', 'process', 'outbox']) {
    expect(after.nodes.some((n) => n.id === authored)).toBe(false)
  }
  const selected = after.nodes.filter((n) => n.selected)
  expect(selected).toHaveLength(10)
  expect(after.nodes.find((n) => n.id === before.nodes[0].id)!.selected).toBeFalsy()
})

test('one undo removes the whole inserted set; redo restores the same ids', async ({ page }) => {
  await seedHost(page)
  await insertBlock(page, 'Reward split loop')
  const inserted = (await gs(page)).nodes.filter((n) => n.selected).map((n) => n.id)
  expect(inserted.length).toBeGreaterThan(0)

  await page.evaluate(() => (window as any).__loop.graph.getState().undo())
  let s = await gs(page)
  expect(s.nodes).toHaveLength(1)
  expect(s.edges).toHaveLength(0)

  await page.evaluate(() => (window as any).__loop.graph.getState().redo())
  s = await gs(page)
  expect(s.nodes.filter((n) => n.selected).map((n) => n.id).sort()).toEqual([...inserted].sort())
})

test('the same block inserted twice yields two disjoint copies', async ({ page }) => {
  await seedHost(page)
  await insertBlock(page, 'Buffered production step')
  const first = (await gs(page)).nodes.map((n) => n.id)
  await insertBlock(page, 'Buffered production step')
  const all = (await gs(page)).nodes.map((n) => n.id)

  expect(all.length).toBe(first.length + 10)
  expect(new Set(all).size).toBe(all.length) // no shared id
})

test('a v2 module into a v1 host: consent gate — no-op without, one undo unit with', async ({ page }) => {
  await seedHost(page)
  const v2mod = JSON.stringify({
    schema: 'loop-studio/graph/2',
    version: 1,
    nodes: [
      { id: 'a', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'A' } },
      { id: 'b', type: 'pool', position: { x: 200, y: 0 }, data: { kind: 'pool', label: 'B' } },
      { id: 'rate', type: 'parameter', position: { x: 0, y: 120 }, data: { kind: 'parameter', label: 'rate', value: 2 } },
    ],
    edges: [
      { id: 'e', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '@rate' } },
    ],
  })

  const pickFrom = async () => {
    await openMenu(page)
    const chooserP = page.waitForEvent('filechooser')
    await moduleMenu(page).locator('.menu__name', { hasText: 'From file…' }).click()
    const chooser = await chooserP
    await chooser.setFiles({ name: 'v2mod.json', mimeType: 'application/json', buffer: Buffer.from(v2mod, 'utf8') })
  }

  await pickFrom()

  // the consent dialog appears; nothing has changed yet
  const dlg = page.locator('.mcdlg--confirm')
  await expect(dlg).toBeVisible()
  expect((await gs(page)).modelVersion).toBe(1)
  expect((await gs(page)).nodes).toHaveLength(1)

  // cancel → still nothing
  await dlg.getByRole('button', { name: /^cancel$/i }).click()
  await expect(dlg).toBeHidden()
  expect((await gs(page)).modelVersion).toBe(1)

  // re-pick and confirm → promotion + insert as one undo unit
  await pickFrom()
  await page.locator('.mcdlg--confirm').getByRole('button', { name: 'Promote and insert' }).click()

  let s = await gs(page)
  expect(s.modelVersion).toBe(2)
  expect(s.nodes).toHaveLength(4)

  await page.evaluate(() => (window as any).__loop.graph.getState().undo())
  s = await gs(page)
  expect(s.modelVersion).toBe(1)
  expect(s.nodes).toHaveLength(1)
})

test('a module file with a frames block: the exclusion notice appears, then insert proceeds without frames', async ({ page }) => {
  await seedHost(page)
  const framed = JSON.stringify({
    schema: 'loop-studio/graph',
    version: 1,
    nodes: [
      { id: 'a', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'A' } },
      { id: 'b', type: 'pool', position: { x: 200, y: 0 }, data: { kind: 'pool', label: 'B' } },
    ],
    edges: [{ id: 'e', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1' } }],
    frames: [{ id: 'f1', label: 'Zone', rect: { x: -20, y: -20, w: 260, h: 120 } }],
  })

  await openMenu(page)
  const chooserP = page.waitForEvent('filechooser')
  await moduleMenu(page).locator('.menu__name', { hasText: 'From file…' }).click()
  ;(await chooserP).setFiles({ name: 'framed.json', mimeType: 'application/json', buffer: Buffer.from(framed, 'utf8') })

  const dlg = page.locator('.mcdlg--confirm')
  await expect(dlg).toContainText(/frames are not/i)
  // nothing applied yet, and the editor has no frames
  expect((await gs(page)).nodes).toHaveLength(1)
  expect(await page.evaluate(() => (window as any).__loop.frame.getState().snapshot().length)).toBe(0)

  await dlg.getByRole('button', { name: 'Continue' }).click()
  const s = await gs(page)
  expect(s.nodes).toHaveLength(3) // 2 inserted, no frame
  expect(await page.evaluate(() => (window as any).__loop.frame.getState().snapshot().length)).toBe(0)
})

test('Extract selection as module → a Graph JSON download with internal edges only, no run config / frames', async ({ page }) => {
  await seedHost(page)
  await insertBlock(page, 'Buffered production step')
  // select two connected inserted nodes
  await page.evaluate(() => {
    const g = (window as any).__loop.graph.getState()
    const inbox = g.nodes.find((n: any) => n.data?.label === 'Inbox')
    const intake = g.nodes.find((n: any) => n.data?.label === 'Intake')
    g.onNodesChange([
      { id: inbox.id, type: 'select', selected: true },
      { id: intake.id, type: 'select', selected: true },
    ])
    // clear the rest
    for (const n of g.nodes) if (n.id !== inbox.id && n.id !== intake.id && n.selected) {
      ;(window as any).__loop.graph.getState().onNodesChange([{ id: n.id, type: 'select', selected: false }])
    }
  })

  const dlP = page.waitForEvent('download')
  await openMenu(page)
  await moduleMenu(page).locator('.menu__name', { hasText: 'Extract selection as module…' }).click()
  const dl = await dlP
  const file = JSON.parse(readFileSync((await dl.path())!, 'utf8'))

  expect(file.schema).toBe('loop-studio/graph')
  expect(file.nodes).toHaveLength(2)
  expect(file.edges).toHaveLength(1) // only the fully-internal edge
  expect(file.recommendedRunConfig).toBeUndefined()
  expect(file.frames).toBeUndefined()
  // positions normalised to origin
  expect(Math.min(...file.nodes.map((n: any) => n.position.x))).toBe(0)
})

test('Extract refuses when a selected register references a node outside the selection', async ({ page }) => {
  await seedHost(page)
  await insertBlock(page, 'Buffered production step')
  await page.evaluate(() => {
    const g = (window as any).__loop.graph.getState()
    const reg = g.nodes.find((n: any) => n.data?.label === 'Units in system') // expr @inbox + @outbox
    const inbox = g.nodes.find((n: any) => n.data?.label === 'Inbox')
    g.onNodesChange([
      { id: reg.id, type: 'select', selected: true },
      { id: inbox.id, type: 'select', selected: true },
    ])
    for (const n of g.nodes) if (n.id !== reg.id && n.id !== inbox.id && n.selected) {
      g.onNodesChange([{ id: n.id, type: 'select', selected: false }])
    }
  })

  let alerted = ''
  page.removeAllListeners('dialog')
  page.on('dialog', (d) => {
    alerted = d.message()
    void d.accept()
  })

  await openMenu(page)
  await moduleMenu(page).locator('.menu__name', { hasText: 'Extract selection as module…' }).click()
  await expect.poll(() => alerted).toMatch(/references nodes outside it/)
})
