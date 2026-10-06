// docs/flow-colour-and-compact-nodes.md FC-2 — the flow colour a node or an
// edge may carry in `data.accent`: a decorative grouping aid with no
// simulation meaning (FC-0).
//
// The one stored spelling is upper-case `#RRGGBB` (FC-2.1), so equal colours
// give equal revision digests. A file value that is not a six-digit hex is
// dropped and the element kept (FC-2.3); typed input is more forgiving
// (FC-2.2) but never accepts alpha, a colour name or a CSS function.

/** the only form `data.accent` is ever written in */
export const ACCENT_STORED = /^#[0-9A-F]{6}$/

const FILE_FORM = /^#[0-9A-Fa-f]{6}$/

/** FC-2.3 — the stored accent of a file value, or `undefined` (drop the key). */
export function readAccent(raw: unknown): string | undefined {
  return typeof raw === 'string' && FILE_FORM.test(raw) ? raw.toUpperCase() : undefined
}

export type AccentInput =
  | { ok: true; value: string }
  | { ok: false; reason: 'empty' | 'alpha' | 'format' }

/** FC-2.2 — what the hex field accepts: `#rgb` or `#rrggbb`, with or without
 *  the `#`, any case, surrounding white space ignored. */
export function parseAccentInput(text: string): AccentInput {
  const t = text.trim()
  if (t === '') return { ok: false, reason: 'empty' }
  const h = t.startsWith('#') ? t.slice(1) : t
  if (!/^[0-9A-Fa-f]+$/.test(h)) return { ok: false, reason: 'format' }
  if (h.length === 6) return { ok: true, value: `#${h.toUpperCase()}` }
  if (h.length === 3) {
    const [r, g, b] = h.toUpperCase()
    return { ok: true, value: `#${r}${r}${g}${g}${b}${b}` }
  }
  if (h.length === 4 || h.length === 8) return { ok: false, reason: 'alpha' }
  return { ok: false, reason: 'format' }
}

/** Copy `raw.accent` onto `out` when it reads, so a field-by-field reader
 *  keeps it and never carries an invalid one. */
export function carryAccent(raw: Record<string, unknown>, out: { accent?: string }): void {
  const a = readAccent(raw.accent)
  if (a !== undefined) out.accent = a
}
