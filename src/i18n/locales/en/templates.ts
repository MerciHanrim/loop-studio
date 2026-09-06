// docs/localization.md §L3.3 — Templates & modules slice of the canonical `en` catalog.
// The four domain files (ui / canvas / inspector / templates) are merged in
// `./index.ts`; that merged object is the key-set authority. Split is by first
// key namespace; an ambiguous shared string lives in `ui`. Keys and text are
// unchanged from the pre-split single file.

const templates = {
  'templates.button': 'Templates ▾',
  'templates.menuLabel': 'Templates',
  'templates.equilibrium.name': 'Balanced production line',
  'templates.equilibrium.blurb': 'Material flows in, production is split between processing and scrap, and finished goods ship out. Run it: raw and finished-goods inventory settle within a few steps and the Timeline holds flat.',
  'templates.deadlock.name': 'Capacity deadlock',
  'templates.deadlock.blurb': 'The same line with no shipment step, so finished goods have nowhere to go. Run it: finished-goods inventory fills to capacity, raw inventory backs up to its ceiling, supply is throttled to zero, and the whole line stops.',
  'templates.mmoProgression.name': 'Early MMO progression (levels 1–15)',
  'templates.mmoProgression.blurb': 'A connected play economy: three zone lanes (1–5 / 5–10 / 10–15), probabilistic combat with wins, setbacks and deaths, categorised loot, a gold economy with repair and resupply costs, and a rising XP-per-level curve. Run it or Monte-Carlo it to see how wide the time-to-15 spreads.',
  'templates.coffeeRoastery.name': 'Coffee roastery operations flow',
  'templates.coffeeRoastery.blurb': 'An operating-flow simulation for looking at how roasting, sales and stock relate, simplified: green beans arrive, some are sold on, the rest are roasted and sold through cafe / online / retail. Change five daily operating values and watch the stock trajectories and the projected results move. A simplified simulation example — not an ERP or real-time monitoring system.',
  'templates.replace.title': 'Load this template?',
  'templates.replace.body': 'Your current work will be replaced with: {name}',
  'templates.replace.confirm': 'Load template',
  'modules.button': 'Insert module ▾',
  'modules.menuLabel': 'Insert module',
  'modules.fromFile': 'From file…',
  'modules.extract': 'Extract selection as module…',
  'modules.bufferedStep.name': 'Buffered production step',
  'modules.bufferedStep.blurb': 'Supply into an inbox pool, an intake gate that splits into a 2→1 converter and a spoilage drain, then an outbox pool that ships out — with readouts for units in system and a planned run size.',
  'modules.rewardSplit.name': 'Reward split loop',
  'modules.rewardSplit.blurb': 'Activity feeds a wallet; an allocate gate splits it 2:1 into spending and savings, savings bleeds through withdrawals, and two registers track net worth and progress toward a target.',
  'modules.error.title': 'Could not insert the module',
  'modules.promote.title': 'Make this a parameter-driven (v2) model?',
  'modules.promote.body': 'Inserting this block turns the document into a v2 model and the model-semantics digest changes. A single undo reverses the model change and the insert together.',
  'modules.promote.confirm': 'Promote and insert',
  'modules.frames.title': 'Saved frames are not included',
  'modules.frames.insertBody': 'This file has saved group frames. Inserting it as a module does not bring frames into your graph — everything else is inserted as usual.',
  'modules.frames.extractBody': 'Your graph has saved group frames. They are not written into the module file — only the selected nodes and their internal connections are.',
  'modules.frames.continue': 'Continue',
} as const

export type TemplatesKey = keyof typeof templates
export default templates
