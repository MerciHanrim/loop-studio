import { describe, expect, it } from 'vitest'

import en from './locales/en'
import es419 from './locales/es-419'
import esES from './locales/es-ES'
import { moduleLabelOverlay } from './moduleLabels'
import { getEntry } from './registry'
import { es419 as es419Templates, es419Frames } from './templateLabels/es-419'
import { esES as esESTemplates, esESFrames } from './templateLabels/es-ES'

// docs/localization.md §L2.15 — `es-ES` is a REGION AUDIT over `es-419`, so
// what this file checks is the DIFFERENCE, not the Spanish.
//
// `es419Copy.test.ts` is untouched and still owns the Latin American contract
// (it pins `Puntaje de equipo` with the note that `puntuación` is the Iberian
// form). This file pins the other side. Neither one bans the other's word
// globally: each is scoped to its own locale's data, so the two together make
// the split explicit rather than implicit.

type Key = keyof typeof en

const enOf = en as Record<string, string>
const es = es419 as unknown as Record<string, string>
const sp = esES as unknown as Record<string, string>

const moduleLabels = (loc: string): [string, string][] =>
  ['buffered-step', 'reward-split'].flatMap((id) =>
    Object.entries(moduleLabelOverlay(id, loc) ?? {}).map(
      ([node, label]) => [`module:${id}:${node}`, label] as [string, string],
    ),
  )

const templateLabels: [string, string][] = [
  ...Object.entries(esESTemplates).flatMap(([tpl, map]) =>
    Object.entries(map).map(([node, label]) => [`tpl:${tpl}:${node}`, label] as [string, string]),
  ),
  ...Object.entries(esESFrames).flatMap(([tpl, map]) =>
    Object.entries(map).map(([f, label]) => [`frame:${tpl}:${f}`, label] as [string, string]),
  ),
]

/** every Spain-Spanish string the product can show */
const surface: [string, string][] = [
  ...(Object.entries(sp) as [string, string][]),
  ...moduleLabels('es-ES'),
  ...templateLabels,
]

/** U+00A0. Named, never written as an escape: an escape in a file ABOUT an
 *  invisible character is exactly what a previous authoring layer ate. */
const NO_BREAK_SPACE = 160

describe('es-ES — the region audit, as a contract', () => {
  // ----------------------------------------------------------- the deltas
  it('differs from es-419 on exactly the audited catalog keys', () => {
    const differing = (Object.keys(sp) as Key[]).filter((k) => sp[k] !== es[k])
    expect(differing.sort()).toEqual(
      [
        // the device: Spain says `ordenador`
        'mobile.topbar.caption',
        'mobile.inspector.roNote',
        'openhint.sub',
        'tour.mobile.inspect.body',
        // pressing a key or button: Spain says `pulsar`. The four a11y
        // strings also relabel the Enter key `Intro`, which is what a Spanish
        // keyboard is printed with.
        'import.issueSummary',
        'import.issueSummaryStale',
        'regExpr.insert.armed',
        'tour.mobile.run.body',
        'canvas.frame.a11y.desc',
        'rf.node.a11y',
        'rf.node.a11yKeyboard',
        'rf.edge.a11y',
        // typing into a field: Spain says `escribir`, not `ingresar`
        'stateExpr.activator.hint.empty',
        'stateExpr.label.hint.empty',
        // adding something: Spain says `anadir`, and `agregar` reads Latin
        // American. Found only by the SECOND review — the first pass never
        // had it on the candidate list.
        'palette.addAction',
        'import.addTable',
        'import.placement.existingFrame',
        'import.linkTables.body',
        'import.refresh.review.added',
        'import.refresh.review.newColumnValues',
        'import.refresh.review.confirmAdd',
        'stateExpr.activator.hint.opOnly',
        'regExpr.op.groupTitle',
        'modules.bufferedStep.blurb',
        'modules.rewardSplit.blurb',
        'mc.pools.none',
        'review.hunk.add',
        'review.hunk.cantRemove',
        'tour.desktop.pieces.body',
        'hint.importFirstCommit.body',
        // the formatter emits a NO-BREAK SPACE before the percent sign
        'playbar.mc.progress',
        'runbar.mc.cancel',
        // `language.spanishSpain` is deliberately NOT in this list: both
        // Spanish catalogs name Spain Spanish the same way, so the new key is
        // identical in the two and the audit did not touch it.
      ].sort(),
    )
  })

  it('leaves the es-419 catalog exactly as it was on those same keys', () => {
    // the audit must not have edited its own source
    expect(es['mobile.topbar.caption']).toContain('computadora')
    expect(es['import.issueSummaryStale']).toContain('presione')
    expect(es['stateExpr.activator.hint.empty']).toContain('ingrese')
    expect(es['playbar.mc.progress']).toBe('Monte Carlo {pct}%')
    expect(sp['mobile.topbar.caption']).toContain('ordenador')
    expect(sp['import.issueSummaryStale']).toContain('pulse')
    expect(sp['stateExpr.activator.hint.empty']).toContain('escriba')
    expect(es['rf.node.a11y']).toContain('Presione Entrar')
    expect(sp['rf.node.a11y']).toContain('Pulse Intro')
    expect(es['import.addTable']).toBe('Agregar otra tabla')
    expect(sp['import.addTable']).toBe('Añadir otra tabla')
  })

  // ------------------------------------------------------------- the NBSP
  it('puts a NO-BREAK SPACE before the percent sign, on those two keys only', () => {
    const withNbsp = surface.filter(([, v]) => [...v].some((c) => c.codePointAt(0) === NO_BREAK_SPACE))
    expect(withNbsp.map(([k]) => k).sort()).toEqual(['playbar.mc.progress', 'runbar.mc.cancel'])
    for (const k of ['playbar.mc.progress', 'runbar.mc.cancel'] as Key[]) {
      const v = sp[k]
      const i = v.indexOf('%')
      expect(i, `${k} shows a percent sign`).toBeGreaterThan(0)
      // the character immediately before `%` is U+00A0 — asserted by code
      // point, never by comparing against a literal
      expect(v.codePointAt(i - 1), `${k}: the gap before % is a NO-BREAK SPACE`).toBe(NO_BREAK_SPACE)
      // ...and it is not an ordinary space that merely looks the same
      expect(v.includes(' %'), `${k} must not use a plain space`).toBe(false)
    }
  })

  it('leaves the user-typed percent examples alone', () => {
    // `25%` is something the USER types into the flow field, and the CSV error
    // names the `%` SYMBOL — neither is a formatted number, so neither gets
    // the formatter's spacing.
    expect(sp['inspector.edge.flowPlaceholder']).toBe(enOf['inspector.edge.flowPlaceholder'])
    expect(sp['inspector.edge.flowPlaceholder']).toContain('25%')
    expect(sp['import.issue.invalid-number']).toBe(es['import.issue.invalid-number'])
    expect(sp['import.issue.invalid-number']).toContain(' el %')
  })

  // -------------------------------------------------- labels and overlays
  it('splits the score term per locale, both directions pinned', () => {
    expect(esESTemplates['mmo-progression']?.gear_score).toBe('Puntuación de equipo')
    // the Latin American contract is still exactly what it was
    expect(es419Templates['mmo-progression']?.gear_score).toBe('Puntaje de equipo')
  })

  it('says `suministro` and `previsión` where Latin America says `abasto` and `pronóstico`', () => {
    expect(esESTemplates['coffee-roastery']?.roasted_supply_margin).toBe(
      'Margen del suministro de tostado',
    )
    expect(esESFrames['coffee-roastery']?.zone_supply).toBe('Suministro e inventario')
    expect(esESFrames['coffee-roastery']?.zone_forecast).toBe('Indicadores de previsión')
    expect(es419Frames['coffee-roastery']?.zone_supply).toBe('Abasto e inventario')
  })

  it('differs from the es-419 template labels on exactly those four', () => {
    const diff: string[] = []
    for (const [tpl, map] of Object.entries(esESTemplates)) {
      for (const [id, label] of Object.entries(map)) {
        const other = (es419Templates as Record<string, Record<string, string>>)[tpl]?.[id]
        if (other !== label) diff.push(`${tpl}:${id}`)
      }
    }
    for (const [tpl, map] of Object.entries(esESFrames)) {
      for (const [id, label] of Object.entries(map)) {
        const other = (es419Frames as Record<string, Record<string, string>>)[tpl]?.[id]
        if (other !== label) diff.push(`frame:${tpl}:${id}`)
      }
    }
    expect(diff.sort()).toEqual([
      'coffee-roastery:roasted_supply_margin',
      'frame:coffee-roastery:zone_forecast',
      'frame:coffee-roastery:zone_supply',
      'mmo-progression:gear_score',
    ])
  })

  it('moves the two module labels es-419 marked as regional, and only those', () => {
    const mine = new Map(moduleLabels('es-ES'))
    const theirs = new Map(moduleLabels('es-419'))
    const diff = [...mine.entries()].filter(([k, v]) => theirs.get(k) !== v).map(([k]) => k)
    expect(diff.sort()).toEqual(['module:reward-split:wallet', 'module:reward-split:withdrawals'])
    expect(mine.get('module:reward-split:wallet')).toBe('Cartera')
    expect(mine.get('module:reward-split:withdrawals')).toBe('Retiradas')
    expect(theirs.get('module:reward-split:wallet')).toBe('Billetera')
  })

  // -------------------------------------------------------------- register
  it('keeps the `usted` register — no `tú` or `vosotros` anywhere', () => {
    // Spain uses `usted` for software too, so this is NOT a locale that was
    // supposed to switch person. A mixed screen is the real risk, so the check
    // is for the forms themselves, over every string the product can show.
    const INFORMAL: [RegExp, string][] = [
      [/\bvosotros\b/i, 'second person plural'],
      [/\bvuestr[oa]s?\b/i, 'possessive of `vosotros`'],
      [/\btú\b/, 'second person singular pronoun'],
      [/\bpuedes\b/i, '`tú` form of poder'],
      [/\btienes\b/i, '`tú` form of tener'],
      [/\bdebes\b/i, '`tú` form of deber'],
      [/\bhaz\b/i, '`tú` imperative of hacer'],
    ]
    const hits: string[] = []
    for (const [key, value] of surface) {
      for (const [re, why] of INFORMAL) if (re.test(value)) hits.push(`${key}: ${why} — ${value}`)
    }
    expect(hits).toEqual([])
  })

  // ------------------------------------------------------------- integrity
  it('carries no control character, and is Latin script only', () => {
    const control = (v: string) =>
      [...v].some((ch) => {
        const c = ch.codePointAt(0) as number
        return (c < 0x20 && ch !== '\n') || (c >= 0x7f && c <= 0x9f)
      })
    expect(surface.filter(([, v]) => control(v)).map(([k]) => k)).toEqual([])
    // NO-BREAK SPACE is U+00A0 — Script=Common, so it passes this deliberately
    const allowed = /^[\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]*$/u
    expect(surface.filter(([, v]) => !allowed.test(v)).map(([k]) => k)).toEqual([])
    const e = getEntry('es-ES')
    for (const f of [e?.code, e?.englishName, e?.nativeName, e?.displayNameKey, e?.numberLocale]) {
      expect(allowed.test(f as string), String(f)).toBe(true)
    }
    expect(e?.baseFallbackFor, 'es-ES owns no base subtag').toBeUndefined()
  })
})
