import type { LocaleDir } from './registry'

/** docs/localization.md §L9.3 — the arrow meaning units that MIRROR with the reader.
 *
 *  MEASURED, and it is the finding the whole arrow layer rests on: none of these
 *  glyphs mirrors on its own. Unicode mirrors only characters carrying
 *  `Bidi_Mirrored` — brackets and relational operators — so an arrow keeps pointing
 *  the same way while the layout mirrors around it. Every arrow in the chrome is
 *  therefore a product decision, not something the renderer settles.
 *
 *  Each one is decided by what its sense is relative to. An arrow whose meaning is
 *  defined by the reading flow mirrors; one that names a relation in the model graph
 *  does not, because the canvas that draws that graph is itself pinned `ltr`
 *  (§L9.2) — a panel describing an edge right to left would contradict the picture
 *  the reader is looking at. The units that KEEP their glyph are deliberately not in
 *  this table: there is nothing to choose.
 *
 *  A DIRECTION-AWARE CHARACTER, never `transform: scaleX(-1)`. The opposite
 *  characters were measured to exist in the shipping font stack, so a real glyph is
 *  available; a transform would flip the box rather than change the character, which
 *  means it also flips anything that shares the element, it does not reach the
 *  accessible name, and it cannot be read back as text by a test. */
export const MIRRORED_ARROWS = {
  /** this opens something outside the app */
  'external-link': { ltr: '↗', rtl: '↖' },
  /** a submenu or sheet opens on the inline-end side */
  'submenu-disclosure': { ltr: '▸', rtl: '◂' },
  /** a value changes from one thing to another */
  'before-after': { ltr: '→', rtl: '←' },
  /** step back through the edit history */
  undo: { ltr: '↶', rtl: '↷' },
  /** step forward through the edit history */
  redo: { ltr: '↷', rtl: '↶' },
} as const

export type MirroredArrow = keyof typeof MIRRORED_ARROWS

/** The glyph this unit uses for a reader of `dir`.
 *
 *  `undo` and `redo` swap into each other, which is the point: under an rtl reader
 *  undo curves the other way, and it must still be the OPPOSITE of redo rather than
 *  equal to it. Reading the pair out of one table is what makes that true by
 *  construction instead of by two edits staying in step. */
export function arrowGlyph(unit: MirroredArrow, dir: LocaleDir): string {
  return MIRRORED_ARROWS[unit][dir]
}
