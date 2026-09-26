// docs/bundled-module-label-localization.md — the node-`label` overlay for the
// bundled "Insert module" Building blocks (`src/model/modules.ts`
// `BUNDLED_MODULES`), applied when a block is freshly inserted (menu click or
// canvas drag-drop — both funnel through `cloneModuleDoc`) AND kept in sync
// afterwards on a locale switch (§MLS3.1, `./moduleLabelSync.ts`).
// Mirrors `src/i18n/templateLabels/` in shape (`id -> id -> label`) but stays a
// single small static map, not a lazy per-locale chunk: two modules, under a
// dozen nodes apiece, inserted rarely — the async `DICT_LOADERS` machinery
// Templates need for their much larger catalogs would be pure overhead here.
//
// `label` only, exactly like the Template overlay (§TLO-D4) — `kind` /
// `activation` / `expr` / `value` / edge `flow` are never touched. English
// stays the canonical value in every locale for a module NOT listed below (or
// a user-supplied "From file…" module, which this overlay never runs on at
// all — see `cloneModuleDoc`'s caller in `ModuleMenu.tsx` / `Canvas.tsx`).
//
// Keyed by each module's own CANONICAL node ids (`examples/module-*.json`,
// e.g. `supply`, `inbox`) — the ids `insertGraph` re-issues on every insert
// (docs/module-system.md §MS1.2), never the host graph's post-insert ids. That
// works because the overlay is applied INSIDE `cloneModuleDoc`, before the ids
// are re-issued.
//
// An ALREADY-INSERTED instance does follow a later locale switch: §MLS3.1's
// `relabelModuleNodesForLocale` re-reads this same map, matching on the
// provenance record of the label this feature last wrote, never on ids or on
// string content. A node the user has renamed is detached permanently and is
// never switched again. (An earlier revision of this comment claimed a switch
// only affected the NEXT insert — that stopped being true when §MLS4 shipped.)
//
// EVERY shipped locale except `en` needs an entry here. `en` is the canonical
// graph label and correctly has none; the dev pseudo-locale is out of scope.
// `moduleLabels.test.ts` derives that requirement from the registry, so a new
// language cannot ship without its overlay.

export type ModuleLabelMap = Record<string, string> // canonical node id -> localized label

const KO: Readonly<Record<string, ModuleLabelMap>> = {
  'buffered-step': {
    supply: '공급원',
    inbox: '입고 대기',
    intake: '반입',
    process: '처리',
    spoilage: '손실',
    outbox: '출고 대기',
    shipped: '출하',
    batch_size: '배치 크기',
    in_system: '시스템 내 수량',
    planned_run: '계획 처리량',
  },
  'reward-split': {
    activity: '활동',
    wallet: '지갑',
    allocate: '배분',
    spending: '지출',
    savings: '저축',
    withdrawals: '인출',
    target_savings: '저축 목표',
    net_worth: '순자산',
    progress: '목표 달성률',
  },
}

const JA: Readonly<Record<string, ModuleLabelMap>> = {
  'buffered-step': {
    supply: '供給元',
    inbox: '入荷待ち',
    intake: '搬入',
    process: '処理',
    spoilage: '損失',
    outbox: '出荷待ち',
    shipped: '出荷',
    batch_size: 'バッチサイズ',
    in_system: 'システム内数量',
    planned_run: '計画処理量',
  },
  'reward-split': {
    activity: '活動',
    wallet: '財布',
    allocate: '配分',
    spending: '支出',
    savings: '貯蓄',
    withdrawals: '引き出し',
    target_savings: '貯蓄目標',
    net_worth: '純資産',
    progress: '目標達成率',
  },
}

// Written from the ENGLISH canonical labels, not converted from Traditional.
// `输入缓冲` / `输出缓冲` are the same words this locale's own module blurb
// already uses ("带输入缓冲与输出缓冲的生产环节"), and `供应` / `加工` / `出货`
// match its production-line Template dict — the concepts are identical there.
const ZH_HANS: Readonly<Record<string, ModuleLabelMap>> = {
  'buffered-step': {
    supply: '供应',
    inbox: '输入缓冲',
    intake: '入库',
    process: '加工',
    spoilage: '损耗',
    outbox: '输出缓冲',
    shipped: '出货',
    batch_size: '批量大小',
    in_system: '系统内数量',
    planned_run: '计划处理量',
  },
  'reward-split': {
    activity: '活动',
    wallet: '钱包',
    allocate: '分配',
    spending: '支出',
    savings: '储蓄',
    withdrawals: '提取',
    target_savings: '储蓄目标',
    net_worth: '净资产',
    progress: '目标达成率',
  },
}

// Written from the ENGLISH canonical labels, independently of Simplified.
// `輸入緩衝` / `輸出緩衝` match this locale's own module blurb
// ("帶有輸入緩衝與輸出緩衝的生產環節"), and `供應` / `加工` / `出貨` match its
// production-line Template dict.
const ZH_HANT: Readonly<Record<string, ModuleLabelMap>> = {
  'buffered-step': {
    supply: '供應',
    inbox: '輸入緩衝',
    intake: '入庫',
    process: '加工',
    spoilage: '損耗',
    outbox: '輸出緩衝',
    shipped: '出貨',
    batch_size: '批次大小',
    in_system: '系統內數量',
    planned_run: '計畫處理量',
  },
  'reward-split': {
    activity: '活動',
    wallet: '錢包',
    allocate: '分配',
    spending: '支出',
    savings: '儲蓄',
    withdrawals: '提領',
    target_savings: '儲蓄目標',
    net_worth: '淨資產',
    progress: '目標達成率',
  },
}

// `Tampon d'entrée` / `Tampon de sortie` are the exact words this locale's
// module blurb uses ("avec un tampon d'entrée et un tampon de sortie"), and
// `Approvisionnement` / `Transformation` / `Expédition` match its
// production-line Template dict. Apostrophes are U+2019 (§L2.8).
const FR: Readonly<Record<string, ModuleLabelMap>> = {
  'buffered-step': {
    supply: 'Approvisionnement',
    inbox: 'Tampon d’entrée',
    intake: 'Réception',
    process: 'Transformation',
    spoilage: 'Pertes',
    outbox: 'Tampon de sortie',
    shipped: 'Expédition',
    batch_size: 'Taille du lot',
    in_system: 'Unités dans le système',
    planned_run: 'Production prévue',
  },
  'reward-split': {
    activity: 'Activité',
    wallet: 'Portefeuille',
    allocate: 'Répartir',
    spending: 'Dépenses',
    savings: 'Épargne',
    withdrawals: 'Retraits',
    target_savings: 'Objectif d’épargne',
    net_worth: 'Valeur nette',
    progress: 'Progression vers l’objectif',
  },
}

// `Eingangspuffer` / `Ausgangspuffer` are the exact words this locale's module
// blurb uses ("mit Eingangs- und Ausgangspuffer"), and `Verarbeitung` /
// `Versand` / `Ausschuss` match its production-line Template dict
// (`templateLabels/de.ts` `tpl-conv` / `tpl-consume` / `tpl-spill`).
//
// Three places German does NOT take the obvious word:
//   - `planned_run` is `Geplante Produktion`, never `Geplanter Lauf` — `Lauf`
//     is the app's own word for a simulation run (§L2.12 glossary) and would
//     read as a scheduled simulation, not as planned output. Every other
//     locale avoided the literal here too.
//   - `savings` is `Ersparnisse`, the accumulated amount, where the blurb says
//     `Sparen`; the blurb needs the infinitive inside a verb phrase ("in
//     Ausgaben und Sparen"), but a Pool holds a stock, so it takes the noun.
//     `Sparziel` keeps the two tied to the same stem.
//   - `supply` is `Nachschub`, the head of the dict's `Materialnachschub`; the
//     bundled module is a generic production step, so it must not assert that
//     what flows through it is material.
const DE: Readonly<Record<string, ModuleLabelMap>> = {
  'buffered-step': {
    supply: 'Nachschub',
    inbox: 'Eingangspuffer',
    intake: 'Annahme',
    process: 'Verarbeitung',
    spoilage: 'Ausschuss',
    outbox: 'Ausgangspuffer',
    shipped: 'Versand',
    batch_size: 'Losgröße',
    in_system: 'Einheiten im System',
    planned_run: 'Geplante Produktion',
  },
  'reward-split': {
    activity: 'Aktivität',
    wallet: 'Geldbörse',
    allocate: 'Aufteilen',
    spending: 'Ausgaben',
    savings: 'Ersparnisse',
    withdrawals: 'Abhebungen',
    target_savings: 'Sparziel',
    net_worth: 'Nettovermögen',
    progress: 'Fortschritt zum Ziel',
  },
}

// `Búfer de entrada` / `Búfer de salida` are the words this locale's own module
// blurb uses, and `Procesamiento` / `Envíos` / `Merma` match its production-line
// Template dict. Neutral Latin American Spanish throughout (§L2.13):
//
//   - `Billetera` for `wallet` and `Retiros` for `withdrawals` are deliberate
//     regional markers — Spain would say `cartera` and `reintegros`. The
//     catalog is registered as `es-419`, so it says so rather than hedging.
//   - `planned_run` is `Producción planificada`, never `ejecución`: that is the
//     app's own word for a simulation run, the same collision German avoided
//     with `Lauf`.
//   - `supply` is `Suministro`, which does not assert what flows through a
//     generic module the way a material-specific compound would.
const ES_419: Readonly<Record<string, ModuleLabelMap>> = {
  'buffered-step': {
    supply: 'Suministro',
    inbox: 'Búfer de entrada',
    intake: 'Recepción',
    process: 'Procesamiento',
    spoilage: 'Merma',
    outbox: 'Búfer de salida',
    shipped: 'Envíos',
    batch_size: 'Tamaño del lote',
    in_system: 'Unidades en el sistema',
    planned_run: 'Producción planificada',
  },
  'reward-split': {
    activity: 'Actividad',
    wallet: 'Billetera',
    allocate: 'Repartir',
    spending: 'Gastos',
    savings: 'Ahorros',
    withdrawals: 'Retiros',
    target_savings: 'Meta de ahorro',
    net_worth: 'Patrimonio neto',
    progress: 'Progreso hacia la meta',
  },
}

// Brazilian Portuguese. `Carteira`, `Saques` and `Poupança` are the everyday
// Brazilian words for a wallet, withdrawals and savings — the same kind of
// deliberate regional marker `es-419` carries with `Billetera` / `Retiros`.
// `planejada` (not `planeada`) and `estoque` (not `existências`) are the
// Brazilian spellings.
const PT_BR: Readonly<Record<string, ModuleLabelMap>> = {
  'buffered-step': {
    supply: 'Fornecimento',
    inbox: 'Fila de entrada',
    intake: 'Recebimento',
    process: 'Processamento',
    spoilage: 'Perdas',
    outbox: 'Fila de saída',
    shipped: 'Expedição',
    batch_size: 'Tamanho do lote',
    in_system: 'Unidades no sistema',
    planned_run: 'Produção planejada',
  },
  'reward-split': {
    activity: 'Atividade',
    wallet: 'Carteira',
    allocate: 'Distribuir',
    spending: 'Gastos',
    savings: 'Poupança',
    withdrawals: 'Saques',
    target_savings: 'Meta de poupança',
    net_worth: 'Patrimônio líquido',
    progress: 'Progresso até a meta',
  },
}

// Spain Spanish. A REGION AUDIT over `ES_419` (§L2.15): 2 of the 19 labels
// differ. `Cartera` is the Spain word for a wallet where Latin America says
// `Billetera`, and a bank withdrawal is a `Retirada` there, not a `Retiro` —
// both were flagged as deliberate regional markers when `es-419` shipped, so
// both have to move here. Everything else, including `Búfer`, `Merma` and
// `Producción planificada`, reads the same in Spain and is left alone.
const ES_ES: Readonly<Record<string, ModuleLabelMap>> = {
  'buffered-step': {
    supply: 'Suministro',
    inbox: 'Búfer de entrada',
    intake: 'Recepción',
    process: 'Procesamiento',
    spoilage: 'Merma',
    outbox: 'Búfer de salida',
    shipped: 'Envíos',
    batch_size: 'Tamaño del lote',
    in_system: 'Unidades en el sistema',
    planned_run: 'Producción planificada',
  },
  'reward-split': {
    activity: 'Actividad',
    wallet: 'Cartera',
    allocate: 'Repartir',
    spending: 'Gastos',
    savings: 'Ahorros',
    withdrawals: 'Retiradas',
    target_savings: 'Meta de ahorro',
    net_worth: 'Patrimonio neto',
    progress: 'Progreso hacia la meta',
  },
}

// European Portuguese. A REGION AUDIT over `PT_BR` (§L2.16): 5 of the 19
// labels differ, and every one of them is a form Portugal writes differently,
// not a synonym chosen for variety.
//   `planeada`   — EP drops the `j`; `planejada` is Brazilian.
//   `Levantamentos` — a bank withdrawal in Portugal; `Saques` is Brazilian.
//   `Património` — EP takes an acute accent where Brazil writes `Patrimônio`.
//   `Receção`    — the EP spelling and the EP word for goods intake;
//                  `Recebimento` is understood but is not what a Portuguese
//                  warehouse screen says. Listed for native review.
//   `até à meta` — EP contracts `a` + `a`; Brazil writes `até a meta`.
// Everything else — `Fornecimento`, `Carteira`, `Poupança`, `Perdas`,
// `Expedição`, `Tamanho do lote` — reads the same in Portugal and is left
// alone. `Carteira` is already the word `pt-BR` uses, so unlike the
// Spanish pair there is no wallet split here.
const PT_PT: Readonly<Record<string, ModuleLabelMap>> = {
  'buffered-step': {
    supply: 'Fornecimento',
    inbox: 'Fila de entrada',
    intake: 'Receção',
    process: 'Processamento',
    spoilage: 'Perdas',
    outbox: 'Fila de saída',
    shipped: 'Expedição',
    batch_size: 'Tamanho do lote',
    in_system: 'Unidades no sistema',
    planned_run: 'Produção planeada',
  },
  'reward-split': {
    activity: 'Atividade',
    wallet: 'Carteira',
    allocate: 'Distribuir',
    spending: 'Gastos',
    savings: 'Poupança',
    withdrawals: 'Levantamentos',
    target_savings: 'Meta de poupança',
    net_worth: 'Património líquido',
    progress: 'Progresso até à meta',
  },
}

// Russian, translated from the canonical English labels in
// `examples/module-*.json` rather than from another locale's overlay.
// `Кошелёк` / `Снятия` are the ordinary Russian words for a wallet and for
// withdrawals; `Накопления` matches the `Накопитель` glossary without
// colliding with it, since the node kind is a common noun here and this is a
// plural mass noun. `Приёмка` is the warehouse sense of `Intake`.
const RU: Readonly<Record<string, ModuleLabelMap>> = {
  'buffered-step': {
    supply: 'Поставка',
    inbox: 'Входная очередь',
    intake: 'Приёмка',
    process: 'Обработка',
    spoilage: 'Потери',
    outbox: 'Выходная очередь',
    shipped: 'Отгружено',
    batch_size: 'Размер партии',
    in_system: 'Единиц в системе',
    planned_run: 'Плановый выпуск',
  },
  'reward-split': {
    activity: 'Активность',
    wallet: 'Кошелёк',
    allocate: 'Распределить',
    spending: 'Траты',
    savings: 'Накопления',
    withdrawals: 'Снятия',
    target_savings: 'Цель накоплений',
    net_worth: 'Чистая стоимость',
    progress: 'Прогресс к цели',
  },
}

const TR: Readonly<Record<string, ModuleLabelMap>> = {
  'buffered-step': {
    supply: 'Tedarik',
    inbox: 'Giriş kuyruğu',
    intake: 'Kabul',
    process: 'İşleme',
    spoilage: 'Kayıp',
    outbox: 'Çıkış kuyruğu',
    shipped: 'Sevkiyat',
    batch_size: 'Parti boyutu',
    in_system: 'Sistemdeki birim',
    planned_run: 'Planlanan üretim',
  },
  'reward-split': {
    activity: 'Etkinlik',
    wallet: 'Cüzdan',
    allocate: 'Dağıt',
    spending: 'Harcama',
    savings: 'Birikim',
    withdrawals: 'Çekimler',
    target_savings: 'Birikim hedefi',
    net_worth: 'Net değer',
    progress: 'Hedefe ilerleme',
  },
}

// `th` — §L2.19. `ขั้นตอน` is a stage of a process; `ขั้น` alone is the
// simulation timestep, so the production step keeps the longer word. `ดรอป`
// and `ลูท` are not needed here — this module is a factory, not a loot table.
const TH: Readonly<Record<string, ModuleLabelMap>> = {
  'buffered-step': {
    supply: 'การจัดหา',
    inbox: 'คิวขาเข้า',
    intake: 'การรับเข้า',
    process: 'การแปรรูป',
    spoilage: 'ของเสีย',
    outbox: 'คิวขาออก',
    shipped: 'การจัดส่ง',
    batch_size: 'ขนาดล็อต',
    in_system: 'หน่วยที่อยู่ในระบบ',
    planned_run: 'ปริมาณผลิตตามแผน',
  },
  'reward-split': {
    activity: 'กิจกรรม',
    wallet: 'กระเป๋าเงิน',
    allocate: 'จัดสรร',
    spending: 'การใช้จ่าย',
    savings: 'เงินเก็บ',
    withdrawals: 'การถอน',
    target_savings: 'เป้าหมายเงินเก็บ',
    net_worth: 'มูลค่าสุทธิ',
    progress: 'ความคืบหน้าสู่เป้าหมาย',
  },
}

const VI: Readonly<Record<string, ModuleLabelMap>> = {
  'buffered-step': {
    supply: 'Nguồn cung',
    inbox: 'Hàng chờ vào',
    intake: 'Tiếp nhận',
    process: 'Gia công',
    spoilage: 'Hao hụt',
    outbox: 'Hàng chờ ra',
    shipped: 'Đã xuất',
    batch_size: 'Cỡ lô',
    in_system: 'Số đơn vị trong hệ thống',
    planned_run: 'Sản lượng theo kế hoạch',
  },
  'reward-split': {
    activity: 'Hoạt động',
    wallet: 'Ví',
    allocate: 'Phân bổ',
    spending: 'Chi tiêu',
    savings: 'Tiết kiệm',
    withdrawals: 'Rút ra',
    target_savings: 'Mục tiêu tiết kiệm',
    net_worth: 'Giá trị ròng',
    progress: 'Tiến độ tới mục tiêu',
  },
}

const OVERLAYS: Readonly<Record<string, Readonly<Record<string, ModuleLabelMap>>>> = {
  ko: KO,
  ja: JA,
  'zh-Hans': ZH_HANS,
  'zh-Hant': ZH_HANT,
  fr: FR,
  de: DE,
  'es-419': ES_419,
  'pt-BR': PT_BR,
  'es-ES': ES_ES,
  'pt-PT': PT_PT,
  ru: RU,
  tr: TR,
  th: TH,
  vi: VI,
}

/** The `nodeId -> label` overlay for `moduleId` in `locale`, or `undefined` if
 *  `locale` has none (English, or a module not listed above) — the caller
 *  keeps the canonical English labels in that case. */
export function moduleLabelOverlay(moduleId: string, locale: string): ModuleLabelMap | undefined {
  return OVERLAYS[locale]?.[moduleId]
}

/** The locales this overlay covers, for the registry-derived completeness
 *  guard in `moduleLabels.test.ts`. Not used by the product. */
export function moduleLabelLocales(): readonly string[] {
  return Object.keys(OVERLAYS)
}
