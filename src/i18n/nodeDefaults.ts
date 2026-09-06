// docs/localization.md §L3.4a — the default NAME a freshly placed node gets,
// in the UI language at the moment of placement. Distinct from the palette
// button label (`palette.<kind>.name`, e.g. KO 풀) — a new node reads more
// naturally with a descriptive name (KO 저장소). Switching the UI language
// later never renames a placed node (§L3.4); a mixed-language graph is fine.
//
// This is the ONE shared resolver for a node-creation path. Canvas drop, the
// toolbar palette, and any shortcut all reach `addNodeAt`, which calls this with
// the LIVE `activeCatalog` (so "the current UI language", registry-driven, no
// `if (locale === …)` branch) then `uniqueNodeLabel` (src/model/nodeLabel.ts).
// Import / template-open / duplicate / paste never call it — they keep the
// stored name.

import type { NodeKind } from '../model/types'
import type { MessageCatalog, MessageKey } from './locales/en'

/** `NodeKind` → its default-name catalog key. Written out (not built from a
 *  template literal) so the `check-i18n` dead-key scan sees every key. */
export const NODE_DEFAULT_KEY = {
  pool: 'node.default.pool',
  source: 'node.default.source',
  drain: 'node.default.drain',
  gate: 'node.default.gate',
  converter: 'node.default.converter',
  end: 'node.default.end',
  parameter: 'node.default.parameter',
  register: 'node.default.register',
} satisfies Record<NodeKind, MessageKey>

/** the default display name for a new `kind` node — pass the active catalog. */
export function defaultNodeLabel(kind: NodeKind, catalog: MessageCatalog): string {
  return catalog[NODE_DEFAULT_KEY[kind]]
}
