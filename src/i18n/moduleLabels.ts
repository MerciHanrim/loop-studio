// docs/bundled-module-label-localization.md — a KO/JA node-`label` overlay for
// the bundled "Insert module" Building blocks (`src/model/modules.ts`
// `BUNDLED_MODULES`), applied ONLY at the moment a block is freshly inserted
// (menu click or canvas drag-drop — both funnel through `cloneModuleDoc`).
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
// (docs/module-system.md §MS1.2), never the host graph's post-insert ids. An
// already-inserted instance is plain graph JSON on reload (`loadDoc` never
// re-runs the insert path), so it is never retranslated after the fact — a
// later locale switch only affects the NEXT insert, by design.

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

const OVERLAYS: Readonly<Record<string, Readonly<Record<string, ModuleLabelMap>>>> = { ko: KO, ja: JA }

/** The `nodeId -> label` overlay for `moduleId` in `locale`, or `undefined` if
 *  `locale` has none (English, or a module not listed above) — the caller
 *  keeps the canonical English labels in that case. */
export function moduleLabelOverlay(moduleId: string, locale: string): ModuleLabelMap | undefined {
  return OVERLAYS[locale]?.[moduleId]
}
