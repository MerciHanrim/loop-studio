// docs/localization.md §L3.3 — Templates & modules slice of the canonical `en` catalog.
// The four domain files (ui / canvas / inspector / templates) are merged in
// `./index.ts`; that merged object is the key-set authority. Split is by first
// key namespace; an ambiguous shared string lives in `ui`. Keys and text are
// unchanged from the pre-split single file.

const templates = {
  'templates.button': 'Templates ▾',
  'templates.menuLabel': 'Templates',
  'templates.equilibrium.name': 'Balanced production line',
  'templates.equilibrium.blurb': 'Material in, processing and scrap, finished goods out — a line that settles within a few steps.',
  'templates.deadlock.name': 'Capacity deadlock',
  'templates.deadlock.blurb': 'The same line with no shipment step: stock fills to capacity and everything stops.',
  'templates.mmoProgression.name': 'Early MMO progression (levels 1–15)',
  'templates.mmoProgression.blurb': 'Three zones of quests, hunts and rewards — how long reaching level 15 takes.',
  'templates.coffeeRoastery.name': 'Coffee roastery operations flow',
  'templates.coffeeRoastery.blurb': 'How roasting, sales and stock pull against each other over a day of trading.',
  'templates.gachaBannerZones.name': '3-zone gacha banner comparison',
  'templates.gachaBannerZones.blurb': 'Three banners on one budget, to see what pity and a pickup guarantee change.',
  'templates.replace.title': 'Load this template?',
  'templates.replace.body': 'Your current work will be replaced with: {name}',
  'templates.replace.confirm': 'Load template',
  'modules.button': 'Insert module ▾',
  'modules.menuLabel': 'Insert module',
  'modules.fromFile': 'From file…',
  'modules.extract': 'Extract selection as module…',
  'modules.bufferedStep.name': 'Buffered production step',
  'modules.bufferedStep.blurb': 'Adds a production step with an input and an output buffer.',
  'modules.rewardSplit.name': 'Reward split loop',
  'modules.rewardSplit.blurb': 'Adds a loop that splits incoming rewards into spending and savings.',
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
