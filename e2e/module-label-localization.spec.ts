import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// docs/bundled-module-label-localization.md — a KO/JA node-label overlay for
// the two bundled "Insert module" Building blocks, applied at the moment of
// a FRESH insert (menu click or canvas drag-drop), AND (§MLS4 onward) kept
// in sync on every later EN/KO/JA switch for that instance's still-unedited
// official labels — never for a user-supplied "From file…" module.

type GS = { nodes: { id: string; data?: { label?: string } }[]; past: unknown[]; future: unknown[] }
const gs = (page: Page): Promise<GS> =>
  page.evaluate(() => {
    const g = (window as unknown as { __loop: { graph: { getState: () => GS } } }).__loop.graph.getState()
    return {
      nodes: g.nodes.map((n) => ({ id: n.id, data: { label: n.data?.label } })),
      past: g.past,
      future: g.future,
    }
  })

async function renameNode(page: Page, nodeId: string, label: string) {
  await page.evaluate(
    ({ id, label }) => {
      const g = (
        window as unknown as { __loop: { graph: { getState: () => { updateNodeData: (id: string, patch: Record<string, unknown>) => void } } } }
      ).__loop.graph.getState()
      g.updateNodeData(id, { label })
    },
    { id: nodeId, label },
  )
}

const STR = {
  en: { menuBtn: 'Insert module ▾', bufferedStep: 'Buffered production step', rewardSplit: 'Reward split loop' },
  ko: { menuBtn: '모듈 삽입 ▾', bufferedStep: '버퍼가 있는 생산 단계', rewardSplit: '보상 분배 루프' },
  ja: { menuBtn: 'モジュールを挿入 ▾', bufferedStep: 'バッファ付き生産ステップ', rewardSplit: '報酬分配ループ' },
} as const
type Locale = keyof typeof STR

const LABELS = {
  'buffered-step': {
    en: ['Supply', 'Inbox', 'Intake', 'Process', 'Spoilage', 'Outbox', 'Shipped', 'Batch size', 'Units in system', 'Planned run'],
    ko: ['공급원', '입고 대기', '반입', '처리', '손실', '출고 대기', '출하', '배치 크기', '시스템 내 수량', '계획 처리량'],
    ja: ['供給元', '入荷待ち', '搬入', '処理', '損失', '出荷待ち', '出荷', 'バッチサイズ', 'システム内数量', '計画処理量'],
  },
  'reward-split': {
    en: ['Activity', 'Wallet', 'Allocate', 'Spending', 'Savings', 'Withdrawals', 'Savings target', 'Net worth', 'Progress to target'],
    ko: ['활동', '지갑', '배분', '지출', '저축', '인출', '저축 목표', '순자산', '목표 달성률'],
    ja: ['活動', '財布', '配分', '支出', '貯蓄', '引き出し', '貯蓄目標', '純資産', '目標達成率'],
  },
} as const

async function setLocale(page: Page, code: Locale) {
  await page.evaluate((c) => (window as unknown as { __loop: { i18n: { getState: () => { setLocale: (c: string) => void } } } }).__loop.i18n.getState().setLocale(c), code)
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(code)
}

const moduleMenu = (page: Page, loc: Locale) =>
  page.locator('.toolbar__actions .menu', { has: page.getByRole('button', { name: STR[loc].menuBtn }) })

async function openMenu(page: Page, loc: Locale): Promise<void> {
  await moduleMenu(page, loc).getByRole('button', { name: STR[loc].menuBtn }).click()
  await expect(moduleMenu(page, loc).locator('.menu__pop')).toBeVisible()
}

async function insertViaMenu(page: Page, loc: Locale, block: keyof typeof LABELS): Promise<void> {
  await openMenu(page, loc)
  await moduleMenu(page, loc)
    .locator('.menu__item')
    .filter({ has: page.locator('.menu__name', { hasText: STR[loc][block === 'buffered-step' ? 'bufferedStep' : 'rewardSplit'] }) })
    .click()
}

async function insertViaDrag(page: Page, loc: Locale, block: keyof typeof LABELS): Promise<void> {
  const name = STR[loc][block === 'buffered-step' ? 'bufferedStep' : 'rewardSplit']
  await openMenu(page, loc) // the block menu items must exist to start the drag
  await page.evaluate((n) => {
    const item = [...document.querySelectorAll('.toolbar__actions .menu__item')].find((el) =>
      el.querySelector('.menu__name')?.textContent?.includes(n),
    ) as HTMLElement
    const dt = new DataTransfer()
    item.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
    const canvas = document.querySelector('.canvas') as HTMLElement
    const r = canvas.getBoundingClientRect()
    const at = { clientX: r.left + 300, clientY: r.top + 220, bubbles: true, dataTransfer: dt }
    canvas.dispatchEvent(new DragEvent('dragover', at))
    canvas.dispatchEvent(new DragEvent('drop', at))
  }, name)
}

function labelsOf(state: GS, before: GS): string[] {
  const beforeIds = new Set(before.nodes.map((n) => n.id))
  return state.nodes.filter((n) => !beforeIds.has(n.id)).map((n) => n.data?.label ?? '').sort()
}

test.beforeEach(async ({ page }) => {
  await openApp(page)
  page.on('dialog', (d) => void d.accept().catch(() => {}))
})

for (const loc of ['en', 'ko', 'ja'] as const) {
  test(`${loc}: inserting "Buffered production step" via the menu gets the ${loc} labels`, async ({ page }) => {
    await resetAll(page)
    if (loc !== 'en') await setLocale(page, loc)
    const before = await gs(page)
    await insertViaMenu(page, loc, 'buffered-step')
    const after = await gs(page)
    expect(labelsOf(after, before)).toEqual([...LABELS['buffered-step'][loc]].sort())
  })

  test(`${loc}: inserting "Reward split loop" via canvas drag-drop gets the ${loc} labels`, async ({ page }) => {
    await resetAll(page)
    if (loc !== 'en') await setLocale(page, loc)
    const before = await gs(page)
    await insertViaDrag(page, loc, 'reward-split')
    const after = await gs(page)
    expect(labelsOf(after, before)).toEqual([...LABELS['reward-split'][loc]].sort())
  })
}

test('a KO insert is still exactly one Undo entry, same as an EN insert', async ({ page }) => {
  await resetAll(page)
  await setLocale(page, 'ko')
  const before = await gs(page)
  await insertViaMenu(page, 'ko', 'buffered-step')
  const after = await gs(page)
  expect(after.past.length).toBe(before.past.length + 1)
  expect(after.nodes.length).toBe(before.nodes.length + 10)

  await page.evaluate(() => (window as any).__loop.graph.getState().undo())
  const undone = await gs(page)
  expect(undone.nodes.length).toBe(before.nodes.length)
})

// docs/bundled-module-label-localization.md §MLS4 — switching locale AFTER
// insert now DOES retranslate an already-inserted instance's still-official
// labels (supersedes the pre-§MLS4 behavior this test used to assert).
test('switching locale AFTER insert retranslates an already-inserted instance, both directions', async ({ page }) => {
  await resetAll(page)
  const before = await gs(page)
  await insertViaMenu(page, 'en', 'buffered-step')
  const afterEn = await gs(page)
  expect(labelsOf(afterEn, before)).toEqual([...LABELS['buffered-step'].en].sort())

  await setLocale(page, 'ko')
  expect(labelsOf(await gs(page), before)).toEqual([...LABELS['buffered-step'].ko].sort())

  await setLocale(page, 'ja')
  expect(labelsOf(await gs(page), before)).toEqual([...LABELS['buffered-step'].ja].sort())

  await setLocale(page, 'en')
  expect(labelsOf(await gs(page), before)).toEqual([...LABELS['buffered-step'].en].sort())
})

test('a module first inserted in KO, then switched to JA and back to EN, follows both switches', async ({ page }) => {
  await resetAll(page)
  await setLocale(page, 'ko')
  const before = await gs(page)
  await insertViaMenu(page, 'ko', 'reward-split')
  expect(labelsOf(await gs(page), before)).toEqual([...LABELS['reward-split'].ko].sort())

  await setLocale(page, 'ja')
  expect(labelsOf(await gs(page), before)).toEqual([...LABELS['reward-split'].ja].sort())

  await setLocale(page, 'en')
  expect(labelsOf(await gs(page), before)).toEqual([...LABELS['reward-split'].en].sort())
})

test('a module inserted via canvas drag-drop also follows a later locale switch', async ({ page }) => {
  await resetAll(page)
  const before = await gs(page)
  await insertViaDrag(page, 'en', 'buffered-step')
  await setLocale(page, 'ja')
  expect(labelsOf(await gs(page), before)).toEqual([...LABELS['buffered-step'].ja].sort())
})

test('two instances of the same bundled module are each relabeled independently on switch', async ({ page }) => {
  await resetAll(page)
  const before = await gs(page)
  await insertViaMenu(page, 'en', 'reward-split')
  await insertViaMenu(page, 'en', 'reward-split')
  const afterTwo = await gs(page)
  expect(labelsOf(afterTwo, before)).toEqual(
    [...LABELS['reward-split'].en, ...LABELS['reward-split'].en].sort(),
  )

  await setLocale(page, 'ko')
  expect(labelsOf(await gs(page), before)).toEqual(
    [...LABELS['reward-split'].ko, ...LABELS['reward-split'].ko].sort(),
  )
})

test('renaming one node in an instance preserves that node through later switches, while its siblings keep translating', async ({ page }) => {
  await resetAll(page)
  const before = await gs(page)
  await insertViaMenu(page, 'en', 'buffered-step')
  const inserted = (await gs(page)).nodes.filter((n) => !before.nodes.some((b) => b.id === n.id))
  const supply = inserted.find((n) => n.data?.label === 'Supply')!

  await renameNode(page, supply.id, 'My Custom Supply')

  await setLocale(page, 'ko')
  const afterKo = await gs(page)
  const renamed = afterKo.nodes.find((n) => n.id === supply.id)!
  expect(renamed.data?.label).toBe('My Custom Supply') // preserved
  const siblingLabels = afterKo.nodes
    .filter((n) => inserted.some((i) => i.id === n.id) && n.id !== supply.id)
    .map((n) => n.data?.label)
    .sort()
  const expectedSiblings = LABELS['buffered-step'].ko.filter((_, i) => LABELS['buffered-step'].en[i] !== 'Supply').sort()
  expect(siblingLabels).toEqual(expectedSiblings)

  // a further switch still preserves the rename
  await setLocale(page, 'ja')
  expect((await gs(page)).nodes.find((n) => n.id === supply.id)!.data?.label).toBe('My Custom Supply')
})

test('Undo/Redo across a locale switch never resurrects a stale-language label', async ({ page }) => {
  await resetAll(page)
  const before = await gs(page)
  await insertViaMenu(page, 'en', 'buffered-step')
  await setLocale(page, 'ko')
  const afterKo = await gs(page)
  expect(labelsOf(afterKo, before)).toEqual([...LABELS['buffered-step'].ko].sort())

  // add one more unrelated user node so there is something to Undo/Redo
  // without touching the module instance itself
  await page.evaluate(() => (window as any).__loop.graph.getState().addNodeAt('pool', { x: 0, y: 0 }))
  const withExtraNode = await gs(page)
  await page.evaluate(() => (window as any).__loop.graph.getState().undo())
  expect(labelsOf(await gs(page), before)).toEqual([...LABELS['buffered-step'].ko].sort())

  await page.evaluate(() => (window as any).__loop.graph.getState().redo())
  expect(labelsOf(await gs(page), before)).toEqual(labelsOf(withExtraNode, before))
})

test('re-selecting the already-active locale is a no-op', async ({ page }) => {
  await resetAll(page)
  const before = await gs(page)
  await insertViaMenu(page, 'en', 'buffered-step')
  await setLocale(page, 'ko')
  const afterKo = await gs(page)
  await setLocale(page, 'ko') // same locale again
  expect(labelsOf(await gs(page), before)).toEqual(labelsOf(afterKo, before))
})

test('a user-supplied module file (From file…) is never relabeled, even while the app is in Korean', async ({ page }) => {
  await resetAll(page)
  await setLocale(page, 'ko')
  // deliberately reuses a canonical bundled-module node id ("supply") to prove
  // the overlay — which is keyed on that exact id — is never consulted for a
  // user file; only `BUNDLED_MODULES` inserts ever pass through it.
  const userModule = JSON.stringify({
    schema: 'loop-studio/graph',
    version: 1,
    nodes: [
      { id: 'supply', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'My Own Source', activation: 'automatic', mode: 'pushAny' } },
    ],
    edges: [],
  })

  await openMenu(page, 'ko')
  const chooserP = page.waitForEvent('filechooser')
  await moduleMenu(page, 'ko').locator('.menu__name', { hasText: '파일에서…' }).click()
  const chooser = await chooserP
  await chooser.setFiles({ name: 'user.json', mimeType: 'application/json', buffer: Buffer.from(userModule, 'utf8') })

  await expect.poll(async () => (await gs(page)).nodes.some((n) => n.data?.label === 'My Own Source')).toBe(true)

  // §MLS3 boundary 2 — a LATER switch must not touch it either: it was never
  // given module-label-sync provenance in the first place.
  await setLocale(page, 'ja')
  expect((await gs(page)).nodes.some((n) => n.data?.label === 'My Own Source')).toBe(true)
})

// [P1] review round 2, 2026-09-15 — the two fixes: (1) a user rename that
// happens to equal ANOTHER locale's official string must never be
// re-adopted, and (2) provenance is a history-aware sidecar, so Undo past a
// New/Template-load/file-load restores a module instance's tracking along
// with its nodes.

test('[P1] a user rename to another locale\'s official string is preserved through every later switch', async ({ page }) => {
  await resetAll(page)
  const before = await gs(page)
  await insertViaMenu(page, 'en', 'buffered-step')
  const inserted = (await gs(page)).nodes.filter((n) => !before.nodes.some((b) => b.id === n.id))
  const supply = inserted.find((n) => n.data?.label === 'Supply')!

  // the user retypes it as the OFFICIAL Korean string directly, while the
  // app is still in English
  await renameNode(page, supply.id, '공급원')

  await setLocale(page, 'ko')
  expect((await gs(page)).nodes.find((n) => n.id === supply.id)!.data?.label).toBe('공급원')
  await setLocale(page, 'ja')
  expect((await gs(page)).nodes.find((n) => n.id === supply.id)!.data?.label).toBe('공급원')
  await setLocale(page, 'en')
  expect((await gs(page)).nodes.find((n) => n.id === supply.id)!.data?.label).toBe('공급원')
})

test('[P1] insert -> New -> Undo -> a locale switch still syncs the restored instance', async ({ page }) => {
  await resetAll(page)
  const before = await gs(page)
  await insertViaMenu(page, 'en', 'buffered-step')

  await page.evaluate(() => (window as any).__loop.graph.getState().newGraph())
  expect((await gs(page)).nodes).toHaveLength(0)

  await page.evaluate(() => (window as any).__loop.graph.getState().undo())
  expect(labelsOf(await gs(page), before)).toEqual([...LABELS['buffered-step'].en].sort())

  await setLocale(page, 'ko')
  expect(labelsOf(await gs(page), before)).toEqual([...LABELS['buffered-step'].ko].sort())
})

test('[P1] insert -> loadDoc (Import) -> Undo -> a locale switch still syncs the restored instance', async ({ page }) => {
  await resetAll(page)
  const before = await gs(page)
  await insertViaMenu(page, 'en', 'reward-split')

  // Import replaces the whole document via loadDoc — a real "start fresh"
  // point (§MLS4.2), just like New
  await page.evaluate(() => {
    const l = (window as unknown as { __loop: Record<string, { getState: () => any }> }).__loop
    l.mc.getState().applyRecommended(
      l.graph.getState().loadJSON(
        JSON.stringify({ schema: 'loop-studio/graph', version: 1, nodes: [], edges: [] }),
      ),
    )
  })
  expect((await gs(page)).nodes).toHaveLength(0)

  await page.evaluate(() => (window as any).__loop.graph.getState().undo())
  expect(labelsOf(await gs(page), before)).toEqual([...LABELS['reward-split'].en].sort())

  await setLocale(page, 'ja')
  expect(labelsOf(await gs(page), before)).toEqual([...LABELS['reward-split'].ja].sort())
})

test('[P1] insert -> loadGraph (Template-style load) -> Undo -> a locale switch still syncs the restored instance', async ({ page }) => {
  await resetAll(page)
  const before = await gs(page)
  await insertViaMenu(page, 'en', 'buffered-step')

  await page.evaluate(() => {
    const g = (window as unknown as { __loop: { graph: { getState: () => any } } }).__loop.graph.getState()
    g.loadGraph({
      nodes: [{ id: 'tpl_1', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'Template pool', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } }],
      edges: [],
    })
  })
  expect((await gs(page)).nodes.map((n) => n.data?.label)).toEqual(['Template pool'])

  await page.evaluate(() => (window as any).__loop.graph.getState().undo())
  expect(labelsOf(await gs(page), before)).toEqual([...LABELS['buffered-step'].en].sort())

  await setLocale(page, 'ko')
  expect(labelsOf(await gs(page), before)).toEqual([...LABELS['buffered-step'].ko].sort())
})

test('[P1] a loaded document reusing a former host node id is never treated as module-provenanced', async ({ page }) => {
  await resetAll(page)
  const before = await gs(page)
  await insertViaMenu(page, 'en', 'reward-split')
  const inserted = (await gs(page)).nodes.filter((n) => !before.nodes.some((b) => b.id === n.id))
  const reusedId = inserted[0].id

  // New clears the live document AND its provenance (§MLS4.2); a freshly
  // loaded file that happens to reuse that exact former host id (never
  // possible in practice -- ids are never reissued -- but this is exactly
  // the boundary §MLS3 draws: id alone proves nothing) must not sync.
  await page.evaluate(() => (window as any).__loop.graph.getState().newGraph())
  await page.evaluate((id) => {
    const l = (window as unknown as { __loop: Record<string, { getState: () => any }> }).__loop
    l.mc.getState().applyRecommended(
      l.graph.getState().loadJSON(
        JSON.stringify({
          schema: 'loop-studio/graph',
          version: 1,
          nodes: [{ id, type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'Reused Id Node', activation: 'automatic', mode: 'pushAny' } }],
          edges: [],
        }),
      ),
    )
  }, reusedId)

  await setLocale(page, 'ko')
  expect((await gs(page)).nodes.find((n) => n.id === reusedId)!.data?.label).toBe('Reused Id Node')
})

test('[P1] a user rename, then Undo/Redo, restores the managed state that matches each history point', async ({ page }) => {
  await resetAll(page)
  const before = await gs(page)
  await insertViaMenu(page, 'en', 'buffered-step')
  const inserted = (await gs(page)).nodes.filter((n) => !before.nodes.some((b) => b.id === n.id))
  const supply = inserted.find((n) => n.data?.label === 'Supply')!

  await renameNode(page, supply.id, 'My Custom Supply') // this IS a commit (one history entry)

  await page.evaluate(() => (window as any).__loop.graph.getState().undo()) // back to pre-rename ("Supply", still managed)
  expect((await gs(page)).nodes.find((n) => n.id === supply.id)!.data?.label).toBe('Supply')
  await setLocale(page, 'ko')
  expect((await gs(page)).nodes.find((n) => n.id === supply.id)!.data?.label).toBe('공급원') // still managed at this point in history
  await setLocale(page, 'en')

  await page.evaluate(() => (window as any).__loop.graph.getState().redo()) // forward to post-rename
  expect((await gs(page)).nodes.find((n) => n.id === supply.id)!.data?.label).toBe('My Custom Supply')
  await setLocale(page, 'ja')
  expect((await gs(page)).nodes.find((n) => n.id === supply.id)!.data?.label).toBe('My Custom Supply') // preserved
})

// [P1] review round 3, 2026-09-15 — detachment must be EAGER, at the edit
// itself (`updateNodeData`), never deferred to the next locale switch: a
// lazy content-comparison can't tell "never edited" from "edited, then
// edited back to the exact same text" before any switch ever happens.
test('[P1] Supply -> My Supply -> Supply, all before any switch, stays Supply — not re-adopted', async ({ page }) => {
  await resetAll(page)
  const before = await gs(page)
  await insertViaMenu(page, 'en', 'buffered-step')
  const inserted = (await gs(page)).nodes.filter((n) => !before.nodes.some((b) => b.id === n.id))
  const supply = inserted.find((n) => n.data?.label === 'Supply')!

  await renameNode(page, supply.id, 'My Supply')
  await renameNode(page, supply.id, 'Supply') // back to the exact original text, still no switch yet
  expect((await gs(page)).nodes.find((n) => n.id === supply.id)!.data?.label).toBe('Supply')

  await setLocale(page, 'ko')
  // if this were still managed, it would now read 공급원 -- it must not
  expect((await gs(page)).nodes.find((n) => n.id === supply.id)!.data?.label).toBe('Supply')
  await setLocale(page, 'ja')
  expect((await gs(page)).nodes.find((n) => n.id === supply.id)!.data?.label).toBe('Supply')
})

test('[P1] Undo across the Supply->My Supply edit restores managed state; Redo restores detached state', async ({ page }) => {
  await resetAll(page)
  const before = await gs(page)
  await insertViaMenu(page, 'en', 'buffered-step')
  const inserted = (await gs(page)).nodes.filter((n) => !before.nodes.some((b) => b.id === n.id))
  const supply = inserted.find((n) => n.data?.label === 'Supply')!

  await renameNode(page, supply.id, 'My Supply')

  await page.evaluate(() => (window as any).__loop.graph.getState().undo())
  expect((await gs(page)).nodes.find((n) => n.id === supply.id)!.data?.label).toBe('Supply')
  await setLocale(page, 'ko')
  expect((await gs(page)).nodes.find((n) => n.id === supply.id)!.data?.label).toBe('공급원') // managed state restored
  await setLocale(page, 'en')

  await page.evaluate(() => (window as any).__loop.graph.getState().redo())
  expect((await gs(page)).nodes.find((n) => n.id === supply.id)!.data?.label).toBe('My Supply')
  await setLocale(page, 'ja')
  expect((await gs(page)).nodes.find((n) => n.id === supply.id)!.data?.label).toBe('My Supply') // detached state restored
})
