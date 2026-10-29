// Node structure — the ROLE SYMBOL inside a value-less body (Lumi, 2026-10-12;
// scratch/share/connection-editing-2/17-implementation-rules.md §2).
//
// Three layers carry a node's role: the OUTER silhouette tells the big kind
// (Source, Drain, Gate, Converter, End — silhouette.ts); the INNER symbol adds
// only what the silhouette cannot show (which Gate: deterministic or
// probabilistic; how a Source / Drain acts: automatic, on start, interactive,
// passive); COLOUR is an aid, never the tell. A kind whose silhouette already
// says everything (Converter, End) gets NO symbol — repeating the outer shape's
// meaning inside it adds nothing. A kind with a value (Pool, Parameter,
// Register) shows the value.
//
// Symbols are primitive descriptors (not markup), so the product renderer and
// the study's comparison board draw exactly the same thing. 22 × 22 viewBox,
// stroke = currentColor (the text colour), 1.8 px, round joins and caps.
// The Gate pair: Lumi chose set A on 2026-10-12 from the comparison boards
// (`scratch/share/connection-editing-2/19-role-symbols-*.png`) — the split
// says "one flow divides", the die says "chance", and neither suggests a
// behaviour the Gate does not have; B (two equal arrows) could read as an
// EQUAL split or a copy, C ("=" / "?") as "equals" and "unknown / help". Sets
// B and C stay here as the record the board was made from, not as candidates.
// If the split reads weak at 20 px in real screens, its line spacing or
// length may be tuned — not replaced. The Source / Drain activation symbols are
// the study's set v2 (NS9); their meaning is also carried by the accessible
// name and the Inspector (a small symbol tells apart, it does not teach).

import type { NodeData, NodeKind } from '../../model/types'

export type SymbolPrim = { tag: 'path' | 'rect' | 'circle'; attrs: Record<string, string> }
export type SymbolSet = 'A' | 'B' | 'C'

const p = (d: string, fill = false): SymbolPrim => ({ tag: 'path', attrs: fill ? { d, fill: 'currentColor', stroke: 'none' } : { d } })
const dot = (cx: number, cy: number, r = 1.4): SymbolPrim => ({ tag: 'circle', attrs: { cx: String(cx), cy: String(cy), r: String(r), fill: 'currentColor', stroke: 'none' } })

/** Source / Drain — how the node acts (set v2 of the study, NS9) */
const ACTIVATION: Record<string, SymbolPrim[]> = {
  automatic: [p('M6 4 L17 11 L6 18 Z', true)],
  onStart: [p('M4 4 V18'), p('M8 4 L18 11 L8 18 Z', true)],
  interactive: [p('M7 3 L7 16 L10.5 13 L13 19 L15.5 18 L13 12 L17.5 12 Z', true)],
  passive: [{ tag: 'circle', attrs: { cx: '11', cy: '11', r: '6' } }],
}

/** the die — one unit takes one branch by weight */
const DIE: SymbolPrim[] = [{ tag: 'rect', attrs: { x: '4', y: '4', width: '14', height: '14', rx: '3' } }, dot(8, 8), dot(11, 11), dot(14, 14)]

/** Gate — the inner symbol per candidate set: [deterministic, probabilistic] */
const GATE: Record<SymbolSet, [SymbolPrim[], SymbolPrim[]]> = {
  // A — the study's v2: one input split into two right-angled outputs (fixed
  // ratios) vs the die. Risk noted in NS9: the fork reads close to 人.
  A: [[p('M3 11 H10 M10 6 V16 M10 6 H18 M10 16 H18'), p('M18 4 L20 6 L18 8 M18 14 L20 16 L18 18')], DIE],
  // B — NS9's second candidate: two EQUAL arrows (every unit goes the same,
  // fixed way) vs the die
  B: [[p('M4 7.5 H16 M13 4.5 L16 7.5 L13 10.5'), p('M4 14.5 H16 M13 11.5 L16 14.5 L13 17.5')], DIE],
  // C — a glyph pair with the most different outlines: "=" (fixed ratios) vs
  // "?" (chance); both colour-free, both legible at 20 px
  C: [[p('M5 8 H17 M5 14 H17')], [p('M7.5 8 A3.5 3.5 0 1 1 11 11.5 V13.5'), dot(11, 17.2, 1.3)]],
}

/** the inner symbol of a node, or null where the silhouette already tells the
 *  role (Converter, End) or a value is shown (Pool, Parameter, Register) */
/** the set the product draws (Lumi's decision, 2026-10-12) */
export const ROLE_SYMBOL_SET: SymbolSet = 'A'

export function roleSymbol(kind: NodeKind, data: Partial<NodeData> | undefined, set: SymbolSet = ROLE_SYMBOL_SET): SymbolPrim[] | null {
  const d = (data ?? {}) as Record<string, unknown>
  if (kind === 'source' || kind === 'drain') return ACTIVATION[String(d.activation ?? 'automatic')] ?? ACTIVATION.automatic
  if (kind === 'gate') return GATE[set][d.distribution === 'deterministic' ? 0 : 1]
  return null
}
