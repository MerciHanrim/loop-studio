import { describe, expect, it } from 'vitest'

import en from './locales/en'
import es419 from './locales/es-419'
import { moduleLabelOverlay } from './moduleLabels'
import { es419 as es419Templates, es419Frames } from './templateLabels/es-419'

// docs/localization.md §L2.13 — the mechanical half of the `es-419` copy
// review. `check:i18n` already proves the key set and the ICU ARGUMENT SHAPE
// match `en`; what it cannot see is the prose itself, so everything here is a
// property of the Spanish text.
//
// SCOPE IS THE POINT. A word is only banned where it would be wrong:
//
//   - the Iberian style words are rejected everywhere, because there is no
//     surface in this product where `vosotros` or `fichero` is right;
//   - a glossary alternate is rejected only on the surface that owns the term
//     (`registro` is the wrong word for a Register node and the RIGHT word for
//     a log or a record, `puntuación` for a score, `gráfico` for a chart);
//   - `grafo` vs `gráfico` is decided per key BY THE ENGLISH SOURCE — English
//     says "graph" or it says "chart", and the Spanish must follow;
//   - an English token is allowed either everywhere (a product name, a file
//     format, a Spanish/English homograph) or on named keys only (the sample
//     CSV's own headers, the resource-type tokens, the gacha vocabulary). A
//     blanket token allowlist would hide an untranslated sentence elsewhere.
//
// `móvil` is deliberately on no list. It is the ordinary Latin American word
// for a phone and the catalog uses it against `computadora`.

type Key = keyof typeof en

const entries = Object.entries(es419) as [Key, string][]

const moduleLabels: [string, string][] = ['buffered-step', 'reward-split'].flatMap((id) =>
  Object.entries(moduleLabelOverlay(id, 'es-419') ?? {}).map(
    ([node, label]) => [`module:${id}:${node}`, label] as [string, string],
  ),
)
const templateLabels: [string, string][] = [
  ...Object.entries(es419Templates).flatMap(([tpl, map]) =>
    Object.entries(map).map(([node, label]) => [`tpl:${tpl}:${node}`, label] as [string, string]),
  ),
  ...Object.entries(es419Frames).flatMap(([tpl, map]) =>
    Object.entries(map).map(([f, label]) => [`frame:${tpl}:${f}`, label] as [string, string]),
  ),
]

/** every Spanish string the product can show */
const surface: [string, string][] = [...entries, ...moduleLabels, ...templateLabels]

/** ICU machinery out, arm BODIES kept — they are prose and must be checked */
const prose = (s: string) =>
  s
    .replace(/\{\s*[A-Za-z_][A-Za-z0-9_]*\s*\}/g, ' ')
    .replace(/\{\s*[A-Za-z_][A-Za-z0-9_]*\s*,\s*(?:plural|select|selectordinal)\s*,/g, ' ')
    .replace(/\b(?:zero|one|two|few|many|other)\s*\{/g, ' ')
    .replace(/[{}#]/g, ' ')

describe('es-419 copy — mechanical review', () => {
  it('carries no control character other than the newlines `en` also has', () => {
    // By CODE POINT, never a regex literal: a \u escape in this file is at
    // the mercy of whatever writes it, and a guard against control
    // characters must not be able to acquire one itself. Newline is the only
    // C0 this catalog is allowed — tab and CR included in the sweep.
    const control = (v: string) =>
      [...v].some((ch) => {
        const c = ch.codePointAt(0) as number
        return (c < 0x20 && ch !== '\n') || (c >= 0x7f && c <= 0x9f)
      })
    expect(
      surface.filter(([, v]) => control(v)).map(([k]) => k),
      'no C0/C1 control character anywhere on the Spanish surface',
    ).toEqual([])

    const newlines = (s: string) => (s.match(/\n/g) ?? []).length
    expect(
      entries.filter(([k, v]) => newlines(v) !== newlines(en[k])).map(([k]) => k),
      'a newline is layout, so it must survive translation exactly',
    ).toEqual([])
  })

  it('uses the same placeholder names as `en`, and no markup tags', () => {
    // a slot is `{name}` or the head of `{name, plural, …}`; an arm body such
    // as `one {se agregará # fila}` opens with a brace too and is not one
    const slots = (s: string) =>
      [
        ...s.matchAll(
          /\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:\}|,\s*(?:plural|select|selectordinal)\s*,)/g,
        ),
      ].map((m) => m[1])
    expect(
      entries
        .filter(([k, v]) => [...new Set(slots(en[k]))].sort().join() !== [...new Set(slots(v))].sort().join())
        .map(([k]) => k),
      'every `{name}` slot in `en` is present in es-419, and none is invented',
    ).toEqual([])

    expect(
      surface.filter(([, v]) => /<[a-zA-Z/]/.test(v)).map(([k]) => k),
      'this catalog carries no rich-text tags in any locale',
    ).toEqual([])
  })

  it('opens every question with `¿` and every exclamation with `¡`', () => {
    const questions = entries.filter(([, v]) => v.trim().endsWith('?'))
    expect(questions.length, 'the Spanish catalog does ask questions').toBeGreaterThan(0)
    expect(
      questions.filter(([, v]) => !v.includes('¿')).map(([k]) => k),
      'Spanish questions open with ¿',
    ).toEqual([])

    // Reported rather than assumed: the product writes no exclamations, so the
    // `¡` rule has nothing to apply to today. If a `!` is ever added, this
    // fails until it opens with `¡`.
    const exclamations = surface.filter(([, v]) => v.trim().endsWith('!'))
    expect(
      exclamations.filter(([, v]) => !v.includes('¡')).map(([k]) => k),
      'Spanish exclamations open with ¡',
    ).toEqual([])
    expect(exclamations.length, 'exclamation count on the Spanish surface').toBe(0)
  })

  // ---------------------------------------------------------------- style
  it('uses no Iberian form anywhere', () => {
    // The only list that is global: these are wrong on every surface, and none
    // of them has a second meaning that could make it right somewhere.
    const IBERIAN: [RegExp, string][] = [
      [/\bvosotros\b/i, 'second person plural; this locale uses `ustedes`'],
      [/\bvuestr[oa]s?\b/i, 'possessive of `vosotros`'],
      [/\bordenador(es)?\b/i, 'Latin America says `computadora`'],
      [/\bficheros?\b/i, 'Latin America says `archivo`'],
      [/\bcoger\b/i, 'vulgar in much of Latin America'],
    ]
    const hits: string[] = []
    for (const [key, value] of surface) {
      for (const [re, why] of IBERIAN) if (re.test(value)) hits.push(`${key}: ${why}`)
    }
    expect(hits).toEqual([])
  })

  // ------------------------------------------------------------- glossary
  it('keeps the node-kind glossary on one word each', () => {
    // the central contract: the three keys that NAME each kind
    const KINDS: [string, string][] = [
      ['pool', 'Depósito'],
      ['source', 'Fuente'],
      ['drain', 'Sumidero'],
      ['gate', 'Distribuidor'],
      ['converter', 'Convertidor'],
      ['end', 'Fin'],
      ['parameter', 'Parámetro'],
      ['register', 'Valor calculado'],
    ]
    for (const [kind, term] of KINDS) {
      for (const k of [`palette.${kind}.name`, `node.default.${kind}`, `canvas.nodeKind.${kind}`]) {
        expect(es419[k as Key], k).toBe(term)
      }
    }
  })

  it('uses the glossary term wherever English names a node kind', () => {
    // Derived from `en`, not from a hand-written key list, so a new string that
    // mentions a kind is covered the day it is added. `Source` and `End` are
    // NOT derivable — English uses "source" for an edge endpoint (`origen`) and
    // "end" for the end of a phase — so they rest on the contract above.
    // the Spanish side is a pattern, not a literal: the term inflects, and a
    // two-word term inflects in both halves (`Valores calculados`)
    const DERIVABLE: [RegExp, RegExp, RegExp | null, string][] = [
      [/\bpools?\b/i, /\bdepósitos?\b/i, /\bpiscinas?\b/i, 'a Pool is not a swimming pool'],
      [/\bgates?\b/i, /\bdistribuidor(es)?\b/i, /\bcompuertas?\b/i, '`compuerta` is a logic gate'],
      [/\bconverters?\b/i, /\bconvertidor(es)?\b/i, null, ''],
      [/\bdrains?\b/i, /\bsumideros?\b/i, /\bdesag(ü|u)es?\b/i, '`desagüe` is plumbing'],
      [
        /\bregisters?\b/i,
        /\bvalor(es)? calculad[oa]s?\b/i,
        /\bregistros?\b/i,
        '`registro` is a log or a record',
      ],
      [/\bparameters?\b/i, /\bparámetros?\b/i, null, ''],
    ]
    const missing: string[] = []
    const rejected: string[] = []
    for (const [k, enText] of Object.entries(en) as [Key, string][]) {
      for (const [enWord, term, alternate, why] of DERIVABLE) {
        if (!enWord.test(enText)) continue
        const es = es419[k]
        if (!term.test(es)) missing.push(`${k}: expected ${term.source} — ${es}`)
        if (alternate?.test(es)) rejected.push(`${k}: ${why} — ${es}`)
      }
    }
    expect(rejected, 'a rejected alternate on the surface that owns the term').toEqual([])
    expect(missing, 'English names the node kind, so Spanish must too').toEqual([])
  })

  it('keeps the ruled module and template labels exactly as decided', () => {
    const wallet = moduleLabelOverlay('reward-split', 'es-419') ?? {}
    const step = moduleLabelOverlay('buffered-step', 'es-419') ?? {}
    // regional markers the locale code entitles it to, and the one collision
    // with the app's own word for a simulation run
    expect(wallet.wallet, '`cartera` is the Iberian wallet').toBe('Billetera')
    expect(wallet.withdrawals, '`reintegro` is the Iberian withdrawal').toBe('Retiros')
    expect(step.planned_run, '`ejecución` is this app\'s word for a simulation run').toBe(
      'Producción planificada',
    )
    // `puntuación` is the Iberian score; Latin America says `puntaje`
    expect(es419Templates['mmo-progression']?.gear_score).toBe('Puntaje de equipo')
  })

  it('says `grafo` where English says graph, `gráfico` where it says chart', () => {
    // `Graph JSON` and `Graph or Workspace JSON` are FORMAT names and travel
    // verbatim; strip them from the English side when the Spanish kept them.
    const stripFormat = (enText: string, esText: string) =>
      esText.includes('Graph') ? enText.replace(/Graph/g, ' ') : enText

    const wrong: string[] = []
    for (const [k, es] of entries) {
      const source = stripFormat(en[k], es)
      const enGraph = /\bgraphs?\b/i.test(source)
      const enChart = /\bcharts?\b/i.test(source)
      const esGrafo = /\bgrafos?\b/i.test(es)
      const esGrafico = /\bgráficos?\b/i.test(es)
      if (enGraph && !esGrafo) wrong.push(`${k}: English says graph, Spanish does not say grafo — ${es}`)
      if (esGrafico && !enChart) wrong.push(`${k}: \`gráfico\` without a chart in the source — ${es}`)
      if (esGrafo && !enGraph) wrong.push(`${k}: \`grafo\` without a graph in the source — ${es}`)
    }
    expect(wrong).toEqual([])
  })

  // -------------------------------------------------------------- English
  it('leaves English standing only where the product means it to', () => {
    // allowed ANYWHERE: product names, file formats, and the Spanish words
    // that happen to be spelled like their English counterparts
    const GLOBAL = new Set(
      (
        'Loop Studio Graph JSON Workspace CSV TSV csv Monte Carlo MonteCarloResult MC GitHub id ID ' +
        'a base bytes contextual control editable error Error final literal local Local material ' +
        'no No normal panel Roles series Total use Use web zoom'
      ).split(' '),
    )
    // allowed ONLY on the surface that owns it — the key set is the contract,
    // so the same word appearing in another sentence is an untranslated string
    const SCOPED: Record<string, readonly string[]> = {
      Alex: ['author.namePlaceholder'],
      all: ['inspector.edge.flowPlaceholder'],
      D: ['inspector.edge.flowPlaceholder'],
      S: [
        'inspector.expr.labelPlaceholder',
        'stateExpr.label.hint.empty',
        'stateExpr.label.hint.notAnAssignment',
        'inspector.labelTiming.warnSForm',
      ],
      Alt: ['hint.frameMove.body'],
      Esc: ['canvas.regionSelect.on', 'canvas.frame.drawing'],
      Escape: [
        'canvas.frame.a11y.descSelected',
        'rf.node.a11y',
        'rf.node.a11yKeyboard',
        'rf.edge.a11y',
        'regExpr.insert.armed',
      ],
      Ctrl: ['toolbar.undo.title', 'toolbar.redo.title'],
      Cmd: ['toolbar.undo.title', 'toolbar.redo.title'],
      Z: ['toolbar.undo.title', 'toolbar.redo.title'],
      N: ['import.ignoreLastRows', 'import.issue.invalid-ignore-rows', 'import.issue.ragged-row'],
      // the sample CSV's own column headers, shown as data
      item: ['import.qs.mapping'],
      name: ['import.qs.mapping'],
      price: ['import.qs.mapping'],
      drop: ['import.qs.mapping'],
      rate: ['import.qs.mapping'],
      // resource-type tokens, which stay the canonical English advisory values
      Gold: ['inspector.resourceType.placeholder'],
      Energy: ['inspector.resourceType.placeholder'],
      XP: ['inspector.resourceType.placeholder'],
      Player: ['inspector.resourceType.placeholder'],
      Item: ['inspector.resourceType.placeholder'],
      // gacha vocabulary, only in the Template that is about gacha
      gacha: ['templates.gachaBannerZones.name'],
      banner: ['templates.gachaBannerZones.name'],
      banners: ['templates.gachaBannerZones.blurb'],
      pity: ['templates.gachaBannerZones.blurb'],
      MMO: ['templates.mmoProgression.name'],
      // third-party application names
      Excel: ['import.qs.sources.summary', 'import.qs.sources.excel'],
      Google: ['import.qs.sources.summary', 'import.qs.sources.sheets'],
      Sheets: ['import.qs.sources.summary', 'import.qs.sources.sheets'],
      Numbers: ['import.qs.sources.excel'],
      xlsx: ['import.qs.notImported.list'],
      Machinations: ['about.notAffiliated'],
      io: ['about.notAffiliated'],
      // single letters that are coordinates, percentiles, a version or a URL
      // fragment, never words
      g: ['openhint.sub', 'tour.mobile.open.body'],
      p: ['dist.export.seriesCsv.blurb'],
      v: [
        'toolbar.buildTitle',
        'review.gate.versionMismatch',
        'review.fail.versionMismatch',
        'modules.promote.title',
        'modules.promote.body',
      ],
      x: ['canvas.frame.a11y.moved', 'rf.node.moveCancelled', 'rf.node.moved'],
      y: ['canvas.frame.a11y.moved', 'rf.node.moveCancelled', 'rf.node.moved'],
      rev: ['revChip.rev'],
    }

    const WORD = /[A-Za-zÀ-ÖØ-öø-ÿ]+/gu
    const words = (s: string) => prose(s).match(WORD) ?? []
    const where = new Map<string, Set<string>>()
    for (const [k, enText] of Object.entries(en) as [Key, string][]) {
      const inEnglish = new Set(words(enText).map((w) => w.toLowerCase()))
      for (const w of words(es419[k])) {
        if (inEnglish.has(w.toLowerCase())) {
          if (!where.has(w)) where.set(w, new Set())
          where.get(w)!.add(k)
        }
      }
    }

    const unclassified = [...where.keys()].filter((w) => !GLOBAL.has(w) && !(w in SCOPED)).sort()
    expect(unclassified, 'unclassified English residue').toEqual([])

    // a scoped token must appear on EXACTLY the keys that own it
    const escaped: string[] = []
    for (const [w, keys] of Object.entries(SCOPED)) {
      const got = [...(where.get(w) ?? [])].sort()
      const want = [...keys].sort()
      if (got.join('|') !== want.join('|')) escaped.push(`${w}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`)
    }
    expect(escaped, 'a scoped English token appearing off its own surface').toEqual([])
  })

  it('shows the raw wire edge kind through a slot, never as hardcoded English', () => {
    // `inspector.edge.kindLink` renders `ed.kind` — the wire token `resource`
    // or `state`, untranslated in EVERY locale, exactly as `en` does. It must
    // stay a slot: hardcoding either token would be an untranslated string
    // rather than raw model data.
    expect(es419['inspector.edge.kindLink']).toContain('{kind}')
    expect(es419['inspector.edge.kindLink']).not.toMatch(/\b(resource|state)\b/)
  })
})
