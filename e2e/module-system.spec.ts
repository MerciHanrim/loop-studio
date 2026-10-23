import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'
import {
  INSERT_STRUCTURE as INSERT,
  SAVE_STRUCTURE as SAVE,
  STRUCTURE,
  fileItem,
  filePop,
  insertStructureFile as insertFile,
  openFileMenu,
} from './support/structure'

// docs/module-system.md §MS8 — saving and inserting a structure through the real
// UI: the two File-menu actions, one atomic history entry per insert, the v1 → v2
// consent gate, saving the selection to a download, and the dangling-`@ref`
// refusal.
//
// The Insert-module menu, its two bundled blocks and the drag-to-insert path were
// removed in the workbench redesign (2026-10); a structure now comes from a file
// the user saved, so every insert below picks one.

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

/** seed a tiny v1 host: one pool, no history. */
async function seedHost(page: Page): Promise<void> {
  await resetAll(page)
  await page.evaluate(() => {
    const g = (window as unknown as { __loop: { graph: { getState: () => any } } }).__loop.graph.getState()
    g.addNodeAt('pool', { x: 200, y: 200 })
  })
}

/** select exactly the nodes with these labels */
async function selectLabels(page: Page, labels: string[]): Promise<void> {
  await page.evaluate((want) => {
    const g = (window as any).__loop.graph.getState()
    g.onNodesChange(
      g.nodes.map((n: any) => ({ id: n.id, type: 'select', selected: want.includes(n.data?.label) })),
    )
  }, labels)
}

test.beforeEach(async ({ page }) => {
  await openApp(page)
  page.on('dialog', (d) => void d.accept().catch(() => {}))
})

test('the File menu offers saving and inserting a structure, apart from Import', async ({ page }) => {
  await openFileMenu(page)
  const names = await filePop(page).locator('.menu__name').allInnerTexts()
  expect(names).toContain(SAVE)
  expect(names).toContain(INSERT)
  // Import (a whole document) stays its own item, named differently
  expect(names).toContain('Import')
  expect(names.indexOf(INSERT)).toBeGreaterThan(names.indexOf('Import'))
  // its description (File's description area, docs/workbench.md §WB2.2)
  await expect(fileItem(page, INSERT)).toHaveAccessibleDescription(/this document/i)
  // the removed menu is gone
  await expect(page.getByRole('button', { name: 'Insert module' })).toHaveCount(0)
})

test('inserting a saved structure: fresh ids, inserted set selected, one history entry', async ({ page }) => {
  await seedHost(page)
  const before = await gs(page)

  await insertFile(page, STRUCTURE)
  await expect.poll(async () => (await gs(page)).nodes.length).toBe(before.nodes.length + 4)
  const after = await gs(page)

  expect(after.edges.length).toBe(before.edges.length + 2)
  expect(after.past.length).toBe(before.past.length + 1)
  // every authored id is gone; the inserted nodes are the selected set
  for (const authored of ['supply', 'inbox', 'outbox', 'in_system']) {
    expect(after.nodes.some((n) => n.id === authored)).toBe(false)
  }
  expect(after.nodes.filter((n) => n.selected)).toHaveLength(4)
  expect(after.nodes.find((n) => n.id === before.nodes[0].id)!.selected).toBeFalsy()
})

test('one undo removes the whole inserted set; redo restores the same ids', async ({ page }) => {
  await seedHost(page)
  await insertFile(page, STRUCTURE)
  await expect.poll(async () => (await gs(page)).nodes.length).toBe(5)
  const inserted = (await gs(page)).nodes.filter((n) => n.selected).map((n) => n.id)
  expect(inserted).toHaveLength(4)

  await page.evaluate(() => (window as any).__loop.graph.getState().undo())
  let s = await gs(page)
  expect(s.nodes).toHaveLength(1)
  expect(s.edges).toHaveLength(0)

  await page.evaluate(() => (window as any).__loop.graph.getState().redo())
  s = await gs(page)
  expect(s.nodes.filter((n) => n.selected).map((n) => n.id).sort()).toEqual([...inserted].sort())
})

test('the same structure inserted twice yields two disjoint copies', async ({ page }) => {
  await seedHost(page)
  await insertFile(page, STRUCTURE)
  await expect.poll(async () => (await gs(page)).nodes.length).toBe(5)
  await insertFile(page, STRUCTURE)
  await expect.poll(async () => (await gs(page)).nodes.length).toBe(9)
  const all = (await gs(page)).nodes.map((n) => n.id)
  expect(new Set(all).size).toBe(all.length) // no shared id
})

test('a v2 structure into a v1 host: consent gate — no-op without, one undo unit with', async ({ page }) => {
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

  await insertFile(page, v2mod, 'v2mod.json')

  // the consent dialog appears; nothing has changed yet
  const dlg = page.locator('.mcdlg--confirm')
  await expect(dlg).toBeVisible()
  expect((await gs(page)).modelVersion).toBe(1)
  expect((await gs(page)).nodes).toHaveLength(1)
  // the copy must not contradict itself — it says the change is undoable, never
  // that it is "one-way" (that latch property is out of scope for this dialog)
  const body = await dlg.locator('.mcdlg__note').innerText()
  expect(body).toMatch(/reverses the model change and the insert together/i)
  expect(body).not.toMatch(/one[- ]way/i)

  // cancel → still nothing
  await dlg.getByRole('button', { name: /^cancel$/i }).click()
  await expect(dlg).toBeHidden()
  expect((await gs(page)).modelVersion).toBe(1)

  // re-pick and confirm → promotion + insert as one undo unit
  await insertFile(page, v2mod, 'v2mod.json')
  await page.locator('.mcdlg--confirm').getByRole('button', { name: 'Promote and insert' }).click()

  let s = await gs(page)
  expect(s.modelVersion).toBe(2)
  expect(s.nodes).toHaveLength(4)

  await page.evaluate(() => (window as any).__loop.graph.getState().undo())
  s = await gs(page)
  expect(s.modelVersion).toBe(1)
  expect(s.nodes).toHaveLength(1)
})

test('a structure file with a frames block + its own run config: the exclusion notice appears; host frames / run config / Timeline untouched', async ({ page }) => {
  await seedHost(page)
  // give the host a frame, a non-default MC config, and a non-default Timeline selection
  await page.evaluate(() => {
    const l = (window as any).__loop
    l.frame.getState().adoptFrame({ x: 0, y: 0, w: 100, h: 100 }, 'Host zone')
    l.mc.getState().setConfig({ runs: 999, steps: 77 })
    l.sim.getState().setTimelineSeries([l.graph.getState().nodes[0].id])
  })
  const hostState = () =>
    page.evaluate(() => {
      const l = (window as any).__loop
      return {
        frames: l.frame.getState().snapshot(),
        mc: JSON.stringify(l.mc.getState().config),
        timeline: JSON.stringify(l.sim.getState().timelineSeries),
      }
    })
  const before = await hostState()

  const framed = JSON.stringify({
    schema: 'loop-studio/graph',
    version: 1,
    nodes: [
      { id: 'a', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'A' } },
      { id: 'b', type: 'pool', position: { x: 200, y: 0 }, data: { kind: 'pool', label: 'B' } },
    ],
    edges: [{ id: 'e', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1' } }],
    recommendedRunConfig: { baseSeed: 5, runs: 3, steps: 4, tracked: [] },
    frames: [{ id: 'f1', label: 'Zone', rect: { x: -20, y: -20, w: 260, h: 120 } }],
  })

  await insertFile(page, framed, 'framed.json')

  const dlg = page.locator('.mcdlg--confirm')
  await expect(dlg).toContainText(/frames are not/i)
  expect((await gs(page)).nodes).toHaveLength(1) // nothing applied yet

  await dlg.getByRole('button', { name: 'Continue' }).click()
  expect((await gs(page)).nodes).toHaveLength(3) // 2 inserted, no frame added

  const after = await hostState()
  expect(after.frames).toEqual(before.frames) // §MS4a-B3 — host's own frame kept, the file's dropped
  expect(after.mc).toBe(before.mc) // §MS4a-B2 — the file's run config ignored
  expect(after.timeline).toBe(before.timeline)
})

test('Save selected structure → a Graph JSON download with internal edges only, no run config / frames', async ({ page }) => {
  await seedHost(page)
  await insertFile(page, STRUCTURE)
  await expect.poll(async () => (await gs(page)).nodes.length).toBe(5)
  await selectLabels(page, ['Inbox', 'Outbox'])

  const dlP = page.waitForEvent('download')
  await openFileMenu(page)
  await fileItem(page, SAVE).click()
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

test('a saved structure inserts back as the same shape', async ({ page }) => {
  await seedHost(page)
  await insertFile(page, STRUCTURE)
  await expect.poll(async () => (await gs(page)).nodes.length).toBe(5)
  await selectLabels(page, ['Supply', 'Inbox', 'Outbox'])

  const dlP = page.waitForEvent('download')
  await openFileMenu(page)
  await fileItem(page, SAVE).click()
  const saved = readFileSync((await (await dlP).path())!, 'utf8')

  await insertFile(page, saved, 'saved.json')
  await expect.poll(async () => (await gs(page)).nodes.length).toBe(8)
  const s = await gs(page)
  expect(s.nodes.filter((n) => n.selected).map((n) => n.data?.label).sort()).toEqual(['Inbox', 'Outbox', 'Supply'])
  expect(s.edges).toHaveLength(4)
})

// Kept from the removed `module-label-localization.spec.ts`: a structure the
// user saved is the user's content, so a language switch never renames it.
test('an inserted structure keeps its names through a language switch', async ({ page }) => {
  await seedHost(page)
  await insertFile(page, STRUCTURE)
  await expect.poll(async () => (await gs(page)).nodes.length).toBe(5)
  const names = async () => (await gs(page)).nodes.map((n) => n.data?.label).filter((l) => l !== undefined).sort()
  const before = await names()
  const setLocale = (code: string) =>
    page.evaluate((c) => (window as any).__loop.i18n.getState().setLocale(c), code)
  await setLocale('ko')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko')
  expect(await names()).toEqual(before)
  await setLocale('en')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  expect(await names()).toEqual(before)
})

test('Save refuses when a selected register references a node outside the selection', async ({ page }) => {
  await seedHost(page)
  await insertFile(page, STRUCTURE)
  await expect.poll(async () => (await gs(page)).nodes.length).toBe(5)
  // the register reads @inbox + @outbox; leave Outbox out
  await selectLabels(page, ['Units in system', 'Inbox'])

  let alerted = ''
  page.removeAllListeners('dialog')
  page.on('dialog', (d) => {
    alerted = d.message()
    void d.accept()
  })

  const noDownload = page.waitForEvent('download', { timeout: 1500 }).then(() => 'downloaded', () => 'none')
  await openFileMenu(page)
  await fileItem(page, SAVE).click()
  await expect.poll(() => alerted).toMatch(/references nodes outside it/)
  expect(await noDownload).toBe('none') // a refusal produces no file
})

test('Insert saved structure is unavailable while editing is locked; saving stays available', async ({ page }) => {
  await seedHost(page)
  await page.evaluate(() => (window as any).__loop.ui.getState().setCanvasLocked(true))
  await openFileMenu(page)
  await expect(fileItem(page, INSERT)).toBeDisabled()
  await expect(fileItem(page, SAVE)).toBeEnabled()
})

test('failure leaves the viewport untouched', async ({ page }) => {
  await seedHost(page)
  // pan the camera somewhere non-default
  await page.mouse.move(700, 400)
  await page.mouse.down()
  await page.mouse.move(560, 300, { steps: 8 })
  await page.mouse.up()
  const vpBefore = await page.locator('.react-flow__viewport').getAttribute('style')

  // a structurally-broken file (edge onto a parameter)
  const bad = JSON.stringify({
    schema: 'loop-studio/graph',
    version: 1,
    nodes: [
      { id: 'p', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'P' } },
      { id: 'lever', type: 'parameter', position: { x: 100, y: 0 }, data: { kind: 'parameter', label: 'lever', value: 1 } },
    ],
    edges: [{ id: 'bad', source: 'p', target: 'lever', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1' } }],
  })
  let alerted = ''
  page.removeAllListeners('dialog')
  page.on('dialog', (d) => {
    alerted = d.message()
    void d.accept()
  })
  await insertFile(page, bad, 'bad.json')

  await expect.poll(() => alerted).toMatch(/Could not insert the structure/)
  expect((await gs(page)).nodes).toHaveLength(1) // nothing inserted
  expect(await page.locator('.react-flow__viewport').getAttribute('style')).toBe(vpBefore)
})

test('saving and inserting a structure is desktop-only — absent on a narrow (mobile) viewport', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 900 }) // < the 720px mobile breakpoint
  await page.reload()
  await expect(page.locator('.toolbar--mobile')).toBeVisible()
  await expect(page.getByText(SAVE, { exact: true })).toHaveCount(0)
  await expect(page.getByText(INSERT, { exact: true })).toHaveCount(0)
  // the More sheet carries neither
  await page.getByRole('button', { name: /more/i }).first().click()
  await expect(page.getByText(SAVE, { exact: true })).toHaveCount(0)
  await expect(page.getByText(INSERT, { exact: true })).toHaveCount(0)
})

test('Import → Insert saved structure → Import again all work in sequence (one file input)', async ({ page }) => {
  await resetAll(page)
  const graphJson = (label: string) =>
    JSON.stringify({
      schema: 'loop-studio/graph',
      version: 1,
      nodes: [{ id: 'n1', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label } }],
      edges: [],
    })
  const structureJson = JSON.stringify({
    schema: 'loop-studio/graph',
    version: 1,
    nodes: [
      { id: 'a', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'A' } },
      { id: 'b', type: 'pool', position: { x: 120, y: 0 }, data: { kind: 'pool', label: 'B' } },
    ],
    edges: [{ id: 'e', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1' } }],
  })

  // 1) toolbar Import — the app's one standing file input
  await page.setInputFiles('.toolbar__actions input[type=file]', {
    name: 'g1.json', mimeType: 'application/json', buffer: Buffer.from(graphJson('First'), 'utf8'),
  })
  await expect.poll(async () => (await gs(page)).nodes.length).toBe(1)

  // 2) Insert saved structure — a transient input, no collision with the above
  await insertFile(page, structureJson, 'm.json')
  await expect.poll(async () => (await gs(page)).nodes.length).toBe(3) // 1 + 2 inserted

  // 3) toolbar Import again — still works, replaces the graph
  await page.setInputFiles('.toolbar__actions input[type=file]', {
    name: 'g2.json', mimeType: 'application/json', buffer: Buffer.from(graphJson('Second'), 'utf8'),
  })
  await expect.poll(async () => (await gs(page)).nodes.length).toBe(1)
  expect((await gs(page)).nodes[0].data?.label).toBe('Second')
})
