import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// docs/bundled-module-label-localization.md — the node-label overlay for the
// two bundled "Insert module" Building blocks, applied at the moment of a
// FRESH insert (menu click or canvas drag-drop), AND (§MLS4 onward) kept in
// sync on every later locale switch for that instance's still-unedited
// official labels — never for a user-supplied "From file…" module.
//
// Every shipped locale is covered here. `zh-Hans`, `zh-Hant` and `fr` were
// RED before their overlays existed: each had a fully translated menu name
// and a fully translated catalog, and still produced English node labels on
// insert, because `moduleLabels.ts` only carried `ko` and `ja`. `de` is the
// first locale to arrive with its overlay already in place, because the
// registry-derived guard in `moduleLabels.test.ts` now fails without it.
// `en` is the canonical guard and `ko` / `ja` the invariance guards.
//
// Mobile is deliberately absent: there is no module-insert surface there at
// all (no `ModuleMenu` under `src/components/mobile/`), so there is nothing
// to assert.

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
  'zh-Hans': { menuBtn: '插入模块 ▾', bufferedStep: '带缓冲的生产环节', rewardSplit: '奖励分配循环' },
  'zh-Hant': { menuBtn: '插入模組 ▾', bufferedStep: '含緩衝的生產環節', rewardSplit: '獎勵分配迴圈' },
  fr: { menuBtn: 'Insérer un module ▾', bufferedStep: 'Étape de production tamponnée', rewardSplit: 'Boucle de répartition des récompenses' },
  de: { menuBtn: 'Modul einfügen ▾', bufferedStep: 'Gepufferter Produktionsschritt', rewardSplit: 'Schleife zur Belohnungsaufteilung' },
  'es-419': { menuBtn: 'Insertar módulo ▾', bufferedStep: 'Etapa de producción con búferes', rewardSplit: 'Ciclo de reparto de recompensas' },
  'pt-BR': { menuBtn: 'Inserir módulo ▾', bufferedStep: 'Etapa de produção com buffers', rewardSplit: 'Ciclo de divisão de recompensas' },
  'es-ES': { menuBtn: 'Insertar módulo ▾', bufferedStep: 'Etapa de producción con búferes', rewardSplit: 'Ciclo de reparto de recompensas' },
  'pt-PT': { menuBtn: 'Inserir módulo ▾', bufferedStep: 'Etapa de produção com buffers', rewardSplit: 'Ciclo de divisão de recompensas' },
  ru: { menuBtn: 'Вставить модуль ▾', bufferedStep: 'Производственный этап с буферами', rewardSplit: 'Цикл распределения награды' },
  tr: { menuBtn: 'Modül ekle ▾', bufferedStep: 'Tamponlu üretim aşaması', rewardSplit: 'Ödül paylaştırma döngüsü' },
  th: { menuBtn: 'แทรกมอดูล ▾', bufferedStep: 'ขั้นการผลิตที่มีบัฟเฟอร์', rewardSplit: 'วงจรแบ่งรางวัล' },
  vi: { menuBtn: 'Chèn mô-đun ▾', bufferedStep: 'Bước sản xuất có bộ đệm', rewardSplit: 'Vòng chia phần thưởng' },
  it: { menuBtn: 'Inserisci modulo ▾', bufferedStep: 'Fase di produzione con buffer', rewardSplit: 'Ciclo di ripartizione delle ricompense' },
  nl: { menuBtn: 'Module invoegen ▾', bufferedStep: 'Productiestap met buffers', rewardSplit: 'Kringloop voor beloningsverdeling' },
} as const
type Locale = keyof typeof STR

const LABELS = {
  'buffered-step': {
    en: ['Supply', 'Inbox', 'Intake', 'Process', 'Spoilage', 'Outbox', 'Shipped', 'Batch size', 'Units in system', 'Planned run'],
    ko: ['공급원', '입고 대기', '반입', '처리', '손실', '출고 대기', '출하', '배치 크기', '시스템 내 수량', '계획 처리량'],
    ja: ['供給元', '入荷待ち', '搬入', '処理', '損失', '出荷待ち', '出荷', 'バッチサイズ', 'システム内数量', '計画処理量'],
    'zh-Hans': ['供应', '输入缓冲', '入库', '加工', '损耗', '输出缓冲', '出货', '批量大小', '系统内数量', '计划处理量'],
    'zh-Hant': ['供應', '輸入緩衝', '入庫', '加工', '損耗', '輸出緩衝', '出貨', '批次大小', '系統內數量', '計畫處理量'],
    fr: ['Approvisionnement', 'Tampon d’entrée', 'Réception', 'Transformation', 'Pertes', 'Tampon de sortie', 'Expédition', 'Taille du lot', 'Unités dans le système', 'Production prévue'],
    de: ['Nachschub', 'Eingangspuffer', 'Annahme', 'Verarbeitung', 'Ausschuss', 'Ausgangspuffer', 'Versand', 'Losgröße', 'Einheiten im System', 'Geplante Produktion'],
    'es-419': ['Suministro', 'Búfer de entrada', 'Recepción', 'Procesamiento', 'Merma', 'Búfer de salida', 'Envíos', 'Tamaño del lote', 'Unidades en el sistema', 'Producción planificada'],
    'pt-BR': ['Fornecimento', 'Fila de entrada', 'Recebimento', 'Processamento', 'Perdas', 'Fila de saída', 'Expedição', 'Tamanho do lote', 'Unidades no sistema', 'Produção planejada'],
    'es-ES': ['Suministro', 'Búfer de entrada', 'Recepción', 'Procesamiento', 'Merma', 'Búfer de salida', 'Envíos', 'Tamaño del lote', 'Unidades en el sistema', 'Producción planificada'],
    // `Receção` and `planeada` are the two European forms in this module; the
    // rest reads the same in Portugal as in Brazil.
    'pt-PT': ['Fornecimento', 'Fila de entrada', 'Receção', 'Processamento', 'Perdas', 'Fila de saída', 'Expedição', 'Tamanho do lote', 'Unidades no sistema', 'Produção planeada'],
    ru: ['Поставка', 'Входная очередь', 'Приёмка', 'Обработка', 'Потери', 'Выходная очередь', 'Отгружено', 'Размер партии', 'Единиц в системе', 'Плановый выпуск'],
    // `Kayıp` for Spoilage reads as the losses every other locale here names,
    // and leaves the manufacturing word `fire` to the Templates, which use it
    // for Scrap. `Sevkiyat` is a noun, like every other locale in this table;
    // a finite `Sevk edildi` would have been a whole sentence on a Pool.
    tr: ['Tedarik', 'Giriş kuyruğu', 'Kabul', 'İşleme', 'Kayıp', 'Çıkış kuyruğu', 'Sevkiyat', 'Parti boyutu', 'Sistemdeki birim', 'Planlanan üretim'],
    th: ['การจัดหา', 'คิวขาเข้า', 'การรับเข้า', 'การแปรรูป', 'ของเสีย', 'คิวขาออก', 'การจัดส่ง', 'ขนาดล็อต', 'หน่วยที่อยู่ในระบบ', 'ปริมาณผลิตตามแผน'],
    // `Hao hụt` for Spoilage is the loss every other locale here names, and
    // leaves `hư hỏng` (spoiled goods) to mean the goods themselves. `Đã xuất`
    // is the shipped STATE, matching the noun every other row uses.
    vi: ['Nguồn cung', 'Hàng chờ vào', 'Tiếp nhận', 'Gia công', 'Hao hụt', 'Hàng chờ ra', 'Đã xuất', 'Cỡ lô', 'Số đơn vị trong hệ thống', 'Sản lượng theo kế hoạch'],
    it: ['Fornitura', 'Coda in ingresso', 'Presa in carico', 'Lavorazione', 'Scarti', 'Coda in uscita', 'Spedito', 'Dimensione del lotto', 'Unità nel sistema', 'Produzione pianificata'],
    nl: ['Aanvoer', 'Wachtrij in', 'Inname', 'Bewerking', 'Bederf', 'Wachtrij uit', 'Verzonden', 'Batchgrootte', 'Eenheden in het systeem', 'Geplande run'],
  },
  'reward-split': {
    en: ['Activity', 'Wallet', 'Allocate', 'Spending', 'Savings', 'Withdrawals', 'Savings target', 'Net worth', 'Progress to target'],
    ko: ['활동', '지갑', '배분', '지출', '저축', '인출', '저축 목표', '순자산', '목표 달성률'],
    ja: ['活動', '財布', '配分', '支出', '貯蓄', '引き出し', '貯蓄目標', '純資産', '目標達成率'],
    'zh-Hans': ['活动', '钱包', '分配', '支出', '储蓄', '提取', '储蓄目标', '净资产', '目标达成率'],
    'zh-Hant': ['活動', '錢包', '分配', '支出', '儲蓄', '提領', '儲蓄目標', '淨資產', '目標達成率'],
    fr: ['Activité', 'Portefeuille', 'Répartir', 'Dépenses', 'Épargne', 'Retraits', 'Objectif d’épargne', 'Valeur nette', 'Progression vers l’objectif'],
    de: ['Aktivität', 'Geldbörse', 'Aufteilen', 'Ausgaben', 'Ersparnisse', 'Abhebungen', 'Sparziel', 'Nettovermögen', 'Fortschritt zum Ziel'],
    'es-419': ['Actividad', 'Billetera', 'Repartir', 'Gastos', 'Ahorros', 'Retiros', 'Meta de ahorro', 'Patrimonio neto', 'Progreso hacia la meta'],
    'pt-BR': ['Atividade', 'Carteira', 'Distribuir', 'Gastos', 'Poupança', 'Saques', 'Meta de poupança', 'Patrimônio líquido', 'Progresso até a meta'],
    'es-ES': ['Actividad', 'Cartera', 'Repartir', 'Gastos', 'Ahorros', 'Retiradas', 'Meta de ahorro', 'Patrimonio neto', 'Progreso hacia la meta'],
    // `Carteira` is already what pt-BR says, so unlike the Spanish pair there
    // is no wallet split here — the withdrawals, the patrimony spelling and
    // the `até à` contraction are what move.
    'pt-PT': ['Atividade', 'Carteira', 'Distribuir', 'Gastos', 'Poupança', 'Levantamentos', 'Meta de poupança', 'Património líquido', 'Progresso até à meta'],
    ru: ['Активность', 'Кошелёк', 'Распределить', 'Траты', 'Накопления', 'Снятия', 'Цель накоплений', 'Чистая стоимость', 'Прогресс к цели'],
    // `Dağıt` for Allocate is the verb behind `Dağıtıcı`, this node's own kind
    // name, so the label and the kind read as one word in Turkish.
    tr: ['Etkinlik', 'Cüzdan', 'Dağıt', 'Harcama', 'Birikim', 'Çekimler', 'Birikim hedefi', 'Net değer', 'Hedefe ilerleme'],
    th: ['กิจกรรม', 'กระเป๋าเงิน', 'จัดสรร', 'การใช้จ่าย', 'เงินเก็บ', 'การถอน', 'เป้าหมายเงินเก็บ', 'มูลค่าสุทธิ', 'ความคืบหน้าสู่เป้าหมาย'],
    // `Giá trị ròng` for Net worth, not `tài sản ròng`: the node holds a number,
    // and `tài sản` would name the assets rather than what they come to.
    vi: ['Hoạt động', 'Ví', 'Phân bổ', 'Chi tiêu', 'Tiết kiệm', 'Rút ra', 'Mục tiêu tiết kiệm', 'Giá trị ròng', 'Tiến độ tới mục tiêu'],
    it: ['Attività', 'Portafoglio', 'Ripartisci', 'Spesa', 'Riserve', 'Prelievi', 'Obiettivo di riserve', 'Patrimonio netto', 'Avanzamento verso l’obiettivo'],
    nl: ['Activiteit', 'Portemonnee', 'Verdelen', 'Uitgaven', 'Spaargeld', 'Opnames', 'Spaardoel', 'Nettovermogen', 'Voortgang naar het doel'],
  },
} as const

type SwitchResult =
  | { status: 'ready'; active: string; lang: string }
  | { status: 'failed'; requested: string; active: string; lang: string; failed: string }

/** Wait for the switch INSIDE the page, in one call.
 *
 *  The previous shape polled `document.documentElement.lang` from Node with
 *  `expect.poll`, which failed a main CI run (`1a3eaba`) for `ko` and `ja`. The
 *  trace showed why, and it was not the catalog: every `ko` / `ja` module
 *  answered 200 in 3-11 ms, no request failed, and no error reached the
 *  console. What stalled was the OBSERVATION — one `page.evaluate` sample took
 *  10.1 s (`ja`) and 17.9 s (`ko`). `expect.poll` cannot interrupt a pending
 *  sample, so the 8 s budget (the project-wide `expect.timeout`, not a choice
 *  made here) expired around it, and the value it reported was the FIRST
 *  sample, taken 11 ms after `setLocale` and therefore still `en`. The `ja`
 *  sample eventually returned `"ja"`: the product had switched correctly and
 *  the assertion gave up ~2.3 s too early.
 *
 *  So: one `waitForFunction` instead of repeated Node->browser round trips,
 *  and a real failure is reported as one — `loadError` is the product's own
 *  signal (`src/i18n/store.ts`, surfaced as `.boot-notice[role="status"]`), so
 *  an aborted catalog fails here immediately with the requested / active /
 *  lang triple rather than burning the whole timeout. Success requires BOTH
 *  `<html lang>` and `activeLocale`, so a half-applied switch cannot pass.
 *
 *  The 20 s belongs to this observation only; the test timeout stays 30 s. */
async function setLocale(page: Page, code: Locale) {
  await page.evaluate((c) => (window as unknown as { __loop: { i18n: { getState: () => { setLocale: (c: string) => void } } } }).__loop.i18n.getState().setLocale(c), code)

  const handle = await page.waitForFunction(
    (c) => {
      const state = (
        window as unknown as {
          __loop: { i18n: { getState: () => { activeLocale: string; loadError: { code: string } | null } } }
        }
      ).__loop.i18n.getState()
      const lang = document.documentElement.lang

      if (state.loadError?.code === c) {
        return { status: 'failed', requested: c, active: state.activeLocale, lang, failed: state.loadError.code }
      }
      if (lang === c && state.activeLocale === c) {
        return { status: 'ready', active: state.activeLocale, lang }
      }
      return false as const
    },
    code,
    { timeout: 20_000 },
  )

  const result = (await handle.jsonValue()) as SwitchResult
  if (result.status === 'failed') {
    throw new Error(
      `locale load failed: requested ${result.requested}, active ${result.active}, html lang ${result.lang}`,
    )
  }
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

const SHIPPED = ['en', 'ko', 'ja', 'zh-Hans', 'zh-Hant', 'fr', 'de', 'es-419', 'pt-BR', 'es-ES', 'pt-PT', 'ru', 'tr', 'th', 'vi', 'it', 'nl'] as const

for (const loc of SHIPPED) {
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

// the same §MLS4 sync, across the three locales that used to stay English,
// plus `de`, which shipped with its overlay from the start
test('an already-inserted instance follows a switch into zh-Hans, zh-Hant, fr and de', async ({ page }) => {
  await resetAll(page)
  const before = await gs(page)
  await insertViaMenu(page, 'en', 'buffered-step')
  expect(labelsOf(await gs(page), before)).toEqual([...LABELS['buffered-step'].en].sort())

  for (const loc of ['zh-Hans', 'zh-Hant', 'fr', 'de', 'es-419', 'pt-BR', 'es-ES', 'pt-PT', 'ru', 'tr', 'th', 'vi', 'it', 'nl'] as const) {
    await setLocale(page, loc)
    expect(labelsOf(await gs(page), before), `switch to ${loc}`).toEqual(
      [...LABELS['buffered-step'][loc]].sort(),
    )
  }

  // and back to the canonical English
  await setLocale(page, 'en')
  expect(labelsOf(await gs(page), before)).toEqual([...LABELS['buffered-step'].en].sort())
})

// A user rename must survive every one of the newer locales too. `Mein Konto`
// is deliberately German and deliberately NOT this node's official German
// label (`Geldbörse`): switching into `de` must not adopt it just because it
// looks like the right language.
test('a renamed node is never relabeled by a zh-Hans / zh-Hant / fr / de switch', async ({ page }) => {
  await resetAll(page)
  const before = await gs(page)
  await insertViaMenu(page, 'en', 'reward-split')
  const inserted = (await gs(page)).nodes.filter(
    (n) => !before.nodes.some((b) => b.id === n.id),
  )
  const mine = inserted.find((n) => n.data?.label === 'Wallet')!
  await renameNode(page, mine.id, 'Mein Konto')

  for (const loc of ['zh-Hans', 'zh-Hant', 'fr', 'de', 'es-419', 'pt-BR', 'es-ES', 'pt-PT', 'ru', 'tr', 'th', 'vi', 'it', 'nl', 'en'] as const) {
    await setLocale(page, loc)
    const now = (await gs(page)).nodes.find((n) => n.id === mine.id)
    expect(now?.data?.label, `${loc} must not overwrite a user rename`).toBe('Mein Konto')
  }
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
