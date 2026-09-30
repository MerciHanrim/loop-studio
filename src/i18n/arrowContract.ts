import type { LocaleDir } from './registry'

/** docs/localization.md §L9.3 — what a CATALOGUE must carry for an arrow unit.
 *
 *  This lives in `src/` rather than inside the checker for one reason: the rule had
 *  to be testable before the locale that exercises it existed. `ar` is registered
 *  now and its catalogue does exercise it — but the reason still holds for the NEXT
 *  RTL locale, and a rule that lives only inside a script can be verified only by
 *  the locales that happen to be registered today.
 *
 *  PRESENCE IS NOT THE RULE. It used to be: "does the value contain the glyph this
 *  unit requires". That passes a value whose SECOND arrow is wrong, and two keys
 *  carry two arrows of the same unit — `regExpr.row.cycle` renders
 *  `{name} → … → {name}` and `import.qs.sources.sheets` names a two-step menu path.
 *  MEASURED: flipping only the second `→` of the cycle row to `←` left the whole
 *  check green. So the rule counts.
 *
 *  Two axes come out of it, and they are different numbers that were being reported
 *  as one:
 *
 *    CONTRACT PAIRS    the (locale, unit, key) triples the rule is evaluated on
 *    GLYPH OCCURRENCES the arrow characters actually in those values
 *
 *  They cannot be equal: four keys are governed by two units each, and two keys
 *  carry the same unit's glyph twice. */

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

/** The arrows that are each other's mirror image.
 *
 *  Needed because a KEEPING unit's two glyphs are the SAME character, so "the other
 *  one" cannot come from the unit itself. `graph-relation` keeps `→` for every
 *  reader; what makes a stray `←` in that value wrong is that `←` is the mirror of
 *  the glyph the unit requires, and this table is the only place that says so. */
const MIRROR_PARTNER: Readonly<Record<string, string>> = {
  '→': '←',
  '←': '→',
  '↗': '↖',
  '↖': '↗',
  '▸': '◂',
  '◂': '▸',
  '↶': '↷',
  '↷': '↶',
}

/** Every glyph that belongs to the same arrow as this unit's — the two directions
 *  it can take, plus their mirror images. A value governed by the unit may contain
 *  the required one and none of the others. */
function familyOf(unit: ArrowUnitSpec): Set<string> {
  const f = new Set<string>([unit.ltr, unit.rtl])
  for (const g of [unit.ltr, unit.rtl]) {
    const m = MIRROR_PARTNER[g]
    if (m) f.add(m)
  }
  return f
}

const countOf = (value: string, glyph: string): number =>
  [...value].reduce((n, ch) => (ch === glyph ? n + 1 : n), 0)

export type ArrowCatalogInput = {
  units: Record<string, ArrowUnitSpec>
  /** the keys each unit governs, and how many of that unit's glyphs each key's value
   *  carries. One key may be governed by two units when its string carries two
   *  DIFFERENT arrows; a key may also carry the SAME unit's arrow twice, which is
   *  what `occurrences` records. Absent means one. */
  catalog: { unit: string; keys: string[]; occurrences?: Record<string, number> }[]
  /** a locale-local arrow nothing requires. `import.qs.sources.excel` has no arrow in
   *  English and the ja / ko translations use one as a menu connector. Nothing obliges
   *  another translation to; the rule applies only IF one is used. */
  conditional: { unit: string; key: string }[]
}

export type ArrowViolation = {
  locale: string
  key: string
  unit: string
  want: string
  /** what the value actually holds, as a reason rather than the whole string */
  reason: string
  found: string
}

export type ArrowCatalogResult = {
  violations: ArrowViolation[]
  missing: { key: string; unit: string }[]
  /** (unit, key) pairs evaluated — the CONTRACT axis */
  checked: number
  /** arrow characters evaluated inside those values — the OCCURRENCE axis */
  occurrences: number
  /** occurrences contributed by the conditional clause alone */
  conditionalOccurrences: number
}

export type ArrowCensus = {
  /** occurrences attributed to exactly one meaning unit */
  claimed: number
  /** an arrow in a value no unit governs — the failure a per-key contract is
   *  structurally blind to */
  unclaimed: { key: string; glyph: string }[]
  /** two units of one key requiring the SAME glyph, so attribution is ambiguous */
  multiplyClaimed: { key: string; glyph: string; units: string[] }[]
}

/** A GLOBAL census: every arrow glyph in EVERY string of one catalogue, each
 *  attributed to exactly one meaning unit.
 *
 *  `arrowCatalogViolations` answers "is each key the manifest names correct". That
 *  is per-key and therefore cannot see an arrow added to a key nobody ruled on —
 *  the total it reports is a sum over the manifest, not over the catalogue. This
 *  walks the catalogue instead, so `unclaimed 0` is a statement about the whole
 *  file rather than about the subset the manifest happens to list. */
export function arrowCensus(
  loc: LocaleFacts,
  catalogue: Readonly<Record<string, unknown>>,
  input: ArrowCatalogInput,
): ArrowCensus {
  const tracked = new Set<string>()
  for (const u of Object.values(input.units)) {
    tracked.add(u.ltr)
    tracked.add(u.rtl)
  }

  /** what the manifest claims of each key: a MULTISET of glyphs with their units */
  const claims = new Map<string, { glyph: string; unit: string }[]>()
  const add = (key: string, glyph: string, unit: string, times: number) => {
    const list = claims.get(key) ?? []
    for (let i = 0; i < times; i++) list.push({ glyph, unit })
    claims.set(key, list)
  }
  for (const g of input.catalog) {
    const unit = input.units[g.unit]
    if (!unit) continue
    for (const key of g.keys) add(key, requiredArrowGlyph(unit, loc), g.unit, g.occurrences?.[key] ?? 1)
  }
  // the conditional clause claims whatever that key actually uses of its own unit
  for (const c of input.conditional) {
    const unit = input.units[c.unit]
    const value = catalogue[c.key]
    if (!unit || typeof value !== 'string') continue
    const family = new Set([unit.ltr, unit.rtl])
    const used = [...value].reduce((n, ch) => (family.has(ch) ? n + 1 : n), 0)
    if (used > 0) add(c.key, requiredArrowGlyph(unit, loc), c.unit, used)
  }

  const multiplyClaimed: ArrowCensus['multiplyClaimed'] = []
  for (const [key, list] of claims) {
    const byGlyph = new Map<string, string[]>()
    for (const w of list) byGlyph.set(w.glyph, [...(byGlyph.get(w.glyph) ?? []), w.unit])
    for (const [glyph, units] of byGlyph) {
      const distinct = [...new Set(units)]
      if (distinct.length > 1) multiplyClaimed.push({ key, glyph, units: distinct })
    }
  }

  let claimed = 0
  const unclaimed: ArrowCensus['unclaimed'] = []
  for (const [key, value] of Object.entries(catalogue)) {
    if (typeof value !== 'string') continue
    const remaining = [...(claims.get(key) ?? [])]
    for (const ch of value) {
      if (!tracked.has(ch)) continue
      const i = remaining.findIndex((w) => w.glyph === ch)
      if (i === -1) unclaimed.push({ key, glyph: ch })
      else {
        claimed++
        remaining.splice(i, 1)
      }
    }
  }
  return { claimed, unclaimed, multiplyClaimed }
}

/** Every way a catalogue breaks the arrow contract. Pure, so the checker and its test
 *  ask the same question of the same code. */
export function arrowCatalogViolations(
  loc: LocaleFacts,
  catalogue: Readonly<Record<string, unknown>>,
  input: ArrowCatalogInput,
): ArrowCatalogResult {
  const violations: ArrowViolation[] = []
  const missing: { key: string; unit: string }[] = []
  let checked = 0
  let occurrences = 0
  let conditionalOccurrences = 0

  /** every glyph any tracked unit could use, for the "an arrow nobody ruled on"
   *  check below */
  const tracked = new Set<string>()
  for (const u of Object.values(input.units)) for (const g of familyOf(u)) tracked.add(g)

  /** how many glyphs each key is expected to carry in total, across all the units
   *  that govern it — so an EXTRA arrow of some other unit's family is caught too */
  const expectedPerKey = new Map<string, number>()
  for (const group of input.catalog) {
    for (const key of group.keys) {
      const n = group.occurrences?.[key] ?? 1
      expectedPerKey.set(key, (expectedPerKey.get(key) ?? 0) + n)
    }
  }

  for (const group of input.catalog) {
    const unit = input.units[group.unit]
    if (!unit) {
      missing.push({ key: '(unit)', unit: group.unit })
      continue
    }
    const want = requiredArrowGlyph(unit, loc)
    const family = familyOf(unit)
    for (const key of group.keys) {
      const value = catalogue[key]
      if (typeof value !== 'string') {
        missing.push({ key, unit: group.unit })
        continue
      }
      checked++
      const need = group.occurrences?.[key] ?? 1
      const got = countOf(value, want)
      occurrences += got
      if (got !== need) {
        violations.push({
          locale: loc.code,
          key,
          unit: group.unit,
          want,
          reason: `expected ${need} \`${want}\`, found ${got}`,
          found: value,
        })
      }
      // no other glyph of the same arrow may appear — this is what catches a value
      // whose FIRST arrow is right and whose second is not
      for (const other of family) {
        if (other === want) continue
        const n = countOf(value, other)
        if (n > 0) {
          violations.push({
            locale: loc.code,
            key,
            unit: group.unit,
            want,
            reason: `carries ${n} \`${other}\`, which is the same arrow pointing the other way`,
            found: value,
          })
        }
      }
    }
  }

  // an arrow nobody ruled on, inside a value the contract already governs
  for (const [key, need] of expectedPerKey) {
    const value = catalogue[key]
    if (typeof value !== 'string') continue
    const total = [...value].reduce((n, ch) => (tracked.has(ch) ? n + 1 : n), 0)
    if (total !== need) {
      violations.push({
        locale: loc.code,
        key,
        unit: '(any)',
        want: String(need),
        reason: `carries ${total} tracked arrow glyph(s); the contract accounts for ${need}`,
        found: value,
      })
    }
  }

  for (const c of input.conditional) {
    const unit = input.units[c.unit]
    const value = catalogue[c.key]
    if (!unit || typeof value !== 'string') continue
    const family = familyOf(unit)
    const total = [...value].reduce((n, ch) => (family.has(ch) ? n + 1 : n), 0)
    if (total === 0) continue // no arrow at all — nothing to rule on
    checked++
    const want = requiredArrowGlyph(unit, loc)
    const got = countOf(value, want)
    occurrences += got
    conditionalOccurrences += got
    if (got !== total) {
      violations.push({
        locale: loc.code,
        key: c.key,
        unit: c.unit,
        want,
        reason: `uses ${total} arrow(s) of this unit but only ${got} point the way this locale requires`,
        found: value,
      })
    }
  }

  return { violations, missing, checked, occurrences, conditionalOccurrences }
}
