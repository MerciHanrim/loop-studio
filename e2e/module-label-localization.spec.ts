import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// docs/bundled-module-label-localization.md — a KO/JA node-label overlay for
// the two bundled "Insert module" Building blocks, applied only at the
// moment of a FRESH insert (menu click or canvas drag-drop), never to an
// already-inserted instance and never to a user-supplied "From file…" module.

type GS = { nodes: { id: string; data?: { label?: string } }[]; past: unknown[] }
const gs = (page: Page): Promise<GS> =>
  page.evaluate(() => {
    const g = (window as unknown as { __loop: { graph: { getState: () => GS } } }).__loop.graph.getState()
    return {
      nodes: g.nodes.map((n) => ({ id: n.id, data: { label: n.data?.label } })),
      past: g.past,
    }
  })

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

test('switching locale AFTER insert does not retranslate an already-inserted instance', async ({ page }) => {
  await resetAll(page)
  const before = await gs(page)
  await insertViaMenu(page, 'en', 'buffered-step')
  const afterEn = await gs(page)
  expect(labelsOf(afterEn, before)).toEqual([...LABELS['buffered-step'].en].sort())

  await setLocale(page, 'ko')
  const afterSwitch = await gs(page)
  // the SAME node ids, SAME (still-English) labels — only a later fresh insert
  // would ever get the KO overlay
  expect(labelsOf(afterSwitch, before)).toEqual([...LABELS['buffered-step'].en].sort())
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
})
