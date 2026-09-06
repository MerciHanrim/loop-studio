// docs/localization.md §L3.3 — the CANONICAL catalog, assembled from its four
// domain slices. This merged object defines the key set and the message shape;
// every other locale is `… satisfies MessageCatalog` so `tsc` fails on a
// missing or an extra key. Keys are flat, stable, ASCII IDs — never the English
// text, never derived from user data. Values are ICU messages
// (`intl-messageformat`); a `{name}` slot is a runtime value, never a
// concatenated translatable fragment (§L4.2).
//
// NOT translated (raw model data): node/edge `label`, expression text, `unit`,
// `resourceType`, an Inspector raw value, and every wire enum token
// (`pullAny`, `deterministic`, `passive`, …), shown as-is.

import ui from './ui'
import canvas from './canvas'
import inspector from './inspector'
import templates from './templates'

const en = { ...ui, ...canvas, ...inspector, ...templates } as const

/** the canonical key set — every catalog is `Record<MessageKey, string>` */
export type MessageKey = keyof typeof en
export type MessageCatalog = Record<MessageKey, string>

export default en
