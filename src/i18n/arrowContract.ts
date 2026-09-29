import type { LocaleDir } from './registry'

/** docs/localization.md §L9.3 — what a CATALOGUE must carry for an arrow unit.
 *
 *  This lives in `src/` rather than inside the checker for one reason: the rule has
 *  to be testable before the locale that exercises it exists. No non-pseudo RTL
 *  catalogue is registered yet — the Arabic one is PR C — so the only way to know
 *  that registering it ARMS the contract is to call the rule with a locale that
 *  looks like it. A rule that lives only inside a script can be verified only by the
 *  locales that happen to be registered today, which is the set that cannot fail it. */

export type ArrowVerdict = 'mirror' | 'keep'

export type ArrowUnitSpec = {
  /** the meaning this glyph carries, and what its sense is relative to */
  meaning?: string
  verdict: ArrowVerdict
  ltr: string
  rtl: string
}

export type LocaleFacts = {
  code: string
  direction: LocaleDir
  /** §L9.2 — a pseudo locale ships another catalogue VERBATIM, to exercise direction
   *  and not translation. `ar-XB` is rtl and its catalogue is `en` word for word, so
   *  a catalogue-CONTENT rule cannot apply to it: it would fail the locale for being
   *  exactly what it was built to be. */
  pseudo: boolean
}

/** The glyph a catalogue in this locale must carry for this unit.
 *
 *  A mirroring unit takes the mirrored character for a real RTL reader. A keeping
 *  unit takes the same character for everyone — and that is the case a translator is
 *  most likely to "fix", which is why it is a rule and not a default. */
export function requiredArrowGlyph(unit: ArrowUnitSpec, loc: LocaleFacts): string {
  const rtlReader = loc.direction === 'rtl' && !loc.pseudo
  return rtlReader && unit.verdict === 'mirror' ? unit.rtl : unit.ltr
}

export type ArrowCatalogInput = {
  units: Record<string, ArrowUnitSpec>
  /** the keys each unit governs; one key may be governed by two units when its string
   *  carries two different arrows */
  catalog: { unit: string; keys: string[] }[]
  /** a locale-local arrow nothing requires. `import.qs.sources.excel` has no arrow in
   *  English and the ja / ko translations use one as a menu connector. Nothing obliges
   *  another translation to; the rule applies only IF one is used. */
  conditional: { unit: string; key: string }[]
}

export type ArrowViolation = { locale: string; key: string; unit: string; want: string; found: string }

/** Every way a catalogue breaks the arrow contract. Pure, so the checker and its test
 *  ask the same question of the same code. */
export function arrowCatalogViolations(
  loc: LocaleFacts,
  catalogue: Readonly<Record<string, unknown>>,
  input: ArrowCatalogInput,
): { violations: ArrowViolation[]; missing: { key: string; unit: string }[]; checked: number } {
  const violations: ArrowViolation[] = []
  const missing: { key: string; unit: string }[] = []
  let checked = 0

  for (const group of input.catalog) {
    const unit = input.units[group.unit]
    if (!unit) {
      missing.push({ key: '(unit)', unit: group.unit })
      continue
    }
    const want = requiredArrowGlyph(unit, loc)
    for (const key of group.keys) {
      const value = catalogue[key]
      if (typeof value !== 'string') {
        missing.push({ key, unit: group.unit })
        continue
      }
      checked++
      if (!value.includes(want)) {
        violations.push({ locale: loc.code, key, unit: group.unit, want, found: value })
        continue
      }
      // a mirroring unit must not ALSO still carry the unmirrored character
      const rtlReader = loc.direction === 'rtl' && !loc.pseudo
      if (rtlReader && unit.verdict === 'mirror' && value.includes(unit.ltr)) {
        violations.push({ locale: loc.code, key, unit: group.unit, want, found: value })
      }
    }
  }

  for (const c of input.conditional) {
    const unit = input.units[c.unit]
    const value = catalogue[c.key]
    if (!unit || typeof value !== 'string') continue
    if (!value.includes(unit.ltr) && !value.includes(unit.rtl)) continue
    checked++
    const want = requiredArrowGlyph(unit, loc)
    if (!value.includes(want)) violations.push({ locale: loc.code, key: c.key, unit: c.unit, want, found: value })
  }

  return { violations, missing, checked }
}
