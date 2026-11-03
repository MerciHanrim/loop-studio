// SEMANTICS-R12.md — the icon a flow node may carry in `data.icon`: a visual
// mark shown before the node's name, with no simulation meaning. It never
// enters a calculation, a step report or a Monte Carlo run.
//
// The stored value is an id from this fixed registry (stable ASCII). The
// drawings live with the UI (`src/components/nodes/nodeIcons.tsx`); a value that
// is not a registered id is dropped on read and the node kept, as a malformed
// `accent` is, so a file from a later version that knows more ids still opens.

/** every registered icon id, in the order the picker lists them */
export const NODE_ICON_IDS = [
  // Nature and basics
  'cloud',
  'rain-cloud',
  'partly-cloudy',
  'snow',
  'lightning-risk',
  'wind',
  'strong-wind',
  'typhoon',
  'temperature',
  'sun',
  'remote',
  'tree',
  'electricity',
  'water',
  'wave',
  // Industry and life
  'airplane',
  'car',
  'cargo-ship',
  'nuclear-plant',
  'oil',
  'coal',
  'warehouse',
  'house',
  'food',
  'drink',
  'medicine',
  'game-currency',
  'cash',
  'recycling',
] as const

export type NodeIconId = (typeof NODE_ICON_IDS)[number]

const REGISTERED: ReadonlySet<string> = new Set(NODE_ICON_IDS)

/** the node kinds that carry an icon: the six flow kinds. A Parameter or a
 *  Register has no icon, and a value on one is dropped on read. */
export const NODE_ICON_KINDS: ReadonlySet<string> = new Set(['pool', 'source', 'drain', 'gate', 'converter', 'end'])

/** is `raw` a registered icon id */
export function isNodeIconId(raw: unknown): raw is NodeIconId {
  return typeof raw === 'string' && REGISTERED.has(raw)
}

/** the stored icon of a file value, or `undefined` (drop the key) */
export function readIcon(raw: unknown): NodeIconId | undefined {
  return isNodeIconId(raw) ? raw : undefined
}
