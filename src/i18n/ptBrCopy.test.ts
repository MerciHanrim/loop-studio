import { describe, expect, it } from 'vitest'

import en from './locales/en'
import ptBR from './locales/pt-BR'
import { moduleLabelOverlay } from './moduleLabels'
import { getEntry } from './registry'
import { ptBR as ptBRTemplates, ptBRFrames } from './templateLabels/pt-BR'

// docs/localization.md §L2.14 — the mechanical half of the `pt-BR` copy
// review. `check:i18n` already proves the key set and the ICU ARGUMENT SHAPE
// match `en`; what it cannot see is the prose itself, so everything here is a
// property of the Portuguese text.
//
// SCOPE IS THE POINT — carried over from `es419Copy.test.ts`. A word is only
// rejected where it would be wrong:
//
//   - the European Portuguese forms are rejected everywhere, because there is
//     no surface in this product where `ficheiro` or `ecrã` is right;
//   - `guardar` is NOT on that list even though the SAVE sense must be
//     `salvar`: `guardar` is ordinary Brazilian Portuguese for "to hold", and
//     `palette.pool.description` legitimately says "Guarda recursos";
//   - a glossary alternate is rejected only on the keys that own the term.
//     `registro` is the wrong word for a Register node and the RIGHT word for
//     a log or a record, so it is rejected on those 10 keys and nowhere else;
//   - `quadro` (a group frame) and `tela` (the canvas) are required only where
//     English says "frame" / "canvas", never forced catalog-wide;
//   - an English token is allowed either everywhere (a product name, a file
//     format) or on named keys only (the sample CSV's own headers, the
//     resource-type tokens, the gacha and game-design vocabulary). A blanket
//     token allowlist would hide an untranslated sentence elsewhere.

type Key = keyof typeof en

const entries = Object.entries(ptBR) as [Key, string][]
const enOf = en as Record<string, string>

const moduleLabels: [string, string][] = ['buffered-step', 'reward-split'].flatMap((id) =>
  Object.entries(moduleLabelOverlay(id, 'pt-BR') ?? {}).map(
    ([node, label]) => [`module:${id}:${node}`, label] as [string, string],
  ),
)
const templateLabels: [string, string][] = [
  ...Object.entries(ptBRTemplates).flatMap(([tpl, map]) =>
    Object.entries(map).map(([node, label]) => [`tpl:${tpl}:${node}`, label] as [string, string]),
  ),
  ...Object.entries(ptBRFrames).flatMap(([tpl, map]) =>
    Object.entries(map).map(([f, label]) => [`frame:${tpl}:${f}`, label] as [string, string]),
  ),
]

/** every Portuguese string the product can show */
const surface: [string, string][] = [...entries, ...moduleLabels, ...templateLabels]

/** ICU machinery out, arm BODIES kept — they are prose and must be checked */
const prose = (s: string) =>
  s
    .replace(/\{\s*[A-Za-z_][A-Za-z0-9_]*\s*\}/g, ' ')
    .replace(/\{\s*[A-Za-z_][A-Za-z0-9_]*\s*,\s*(?:plural|select|selectordinal)\s*,/g, ' ')
    .replace(/\b(?:zero|one|two|few|many|other)\s*\{/g, ' ')
    .replace(/[{}#]/g, ' ')

describe('pt-BR copy — mechanical review', () => {
  // ------------------------------------------------------- integrity
  it('carries no control character other than the newlines `en` also has', () => {
    // by CODE POINT, never by an escape literal — an escape in this file is
    // exactly what a previous authoring layer ate (docs/localization.md §L2.13)
    const control = (v: string) =>
      [...v].some((ch) => {
        const c = ch.codePointAt(0) as number
        return (c < 0x20 && ch !== '\n') || (c >= 0x7f && c <= 0x9f)
      })
    expect(surface.filter(([, v]) => control(v)).map(([k]) => k)).toEqual([])
    // and a newline only where `en` has one
    const nl = entries.filter(([k, v]) => v.includes('\n') !== (enOf[k] ?? '').includes('\n'))
    expect(nl.map(([k]) => k)).toEqual([])
  })

  it('is written in Latin script only', () => {
    // the runtime data, not the source file: this is the check that catches a
    // Cyrillic letter sitting inside a Portuguese word, which every other gate
    // accepts as a valid string
    const allowed = /^[\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]*$/u
    expect(surface.filter(([, v]) => !allowed.test(v)).map(([k]) => k)).toEqual([])
  })

  // ------------------------------------------------- European Portuguese
  //
  // GLOBAL only for a form that can never be right here. Three near-misses are
  // deliberately NOT global, for the same reason `registro` and `guardar` are
  // not: they are ordinary Brazilian words in another sense.
  it('never uses a European Portuguese form — the ones that are always wrong', () => {
    const GLOBAL: [RegExp, string][] = [
      [/\bficheiros?\b/i, '`ficheiro` is European \u2014 Brazil writes `arquivo`'],
      [/\becr\u00e3s?\b/i, '`ecr\u00e3` is European \u2014 Brazil writes `tela`'],
      [/\butilizador(es|a|as)?\b/i, '`utilizador` is European \u2014 Brazil writes `usu\u00e1rio`'],
      // the pre-AO90 spelling with the acute on the SECOND `a`; no Brazilian
      // word is spelt this way. `car\u00e1ter` is a different matter \u2014 see below.
      [/\bcar\u00e1cteres?\b/i, '`car\u00e1cter` is European \u2014 Brazil writes `caractere`'],
      [/\bregistos?\b/i, '`registo` is the European spelling of `registro`'],
      [/\btelem\u00f3(vel|veis)\b/i, '`telem\u00f3vel` is European \u2014 Brazil writes `celular`'],
      [/\bplanead[oa]s?\b/i, '`planeado` is European \u2014 Brazil writes `planejado`'],
    ]
    const hits: string[] = []
    for (const [key, value] of surface) {
      for (const [re, why] of GLOBAL) if (re.test(value)) hits.push(`${key}: ${why}`)
    }
    expect(hits).toEqual([])
  })

  it('says `caractere` for a parser position, without banning `car\u00e1ter` elsewhere', () => {
    // `car\u00e1ter` is ordinary Brazilian Portuguese for a nature or a quality
    // (`de car\u00e1ter permanente`), so it is rejected ONLY where the string
    // means a character OFFSET \u2014 the 7 keys of the §L2.11 contract.
    const PARSER_KEYS = Object.keys(enOf).filter(
      (k) => (k.startsWith('error.EXPR_') || k === 'import.parseError') && /\{column\}/.test(enOf[k] ?? ''),
    )
    expect(PARSER_KEYS.length, 'character-offset keys').toBe(7)
    const wrong: string[] = []
    for (const k of PARSER_KEYS) {
      const v = ptBR[k as Key]
      if (!/\bcaracteres?\b/i.test(v)) wrong.push(`${k}: no \`caractere\` \u2014 ${v}`)
      if (/\bcar\u00e1(cter|ter)(es)?\b/i.test(v)) wrong.push(`${k}: European/abstract form \u2014 ${v}`)
    }
    expect(wrong).toEqual([])
  })

  it('says `estoque` where English means stock, without banning `exist\u00eancias`', () => {
    // `exist\u00eancias` is the European word for stock AND the ordinary plural of
    // `exist\u00eancia`, so it is only wrong where English says stock / inventory.
    const wrong: string[] = []
    for (const [key, value] of entries) {
      const src = prose(enOf[key] ?? '')
      if (!/\b(stock|inventory)\b/i.test(src)) continue
      if (!/\bestoques?\b/i.test(value)) wrong.push(`${key}: English says stock \u2014 ${value}`)
      if (/\bexist\u00eancias\b/i.test(value))
        wrong.push(`${key}: the European word for stock \u2014 ${value}`)
    }
    expect(wrong).toEqual([])
  })

  it('says `equipe` for a team, without banning the verb form `equipa`', () => {
    // `equipa` is also the third person of `equipar`, which this product uses
    // (`Equipar`, `equip drops`), so a global ban would forbid correct prose.
    const wrong: string[] = []
    for (const [key, value] of surface) {
      const src = prose(enOf[key as Key] ?? '')
      if (/\b(team|teams|staff)\b/i.test(src) && /\bequipas?\b/i.test(value))
        wrong.push(`${key}: the European word for a team \u2014 ${value}`)
    }
    expect(wrong).toEqual([])
  })

  it('keeps the registry display fields in Latin script too', () => {
    // the picker shows `nativeName` verbatim and `englishName` reaches logs and
    // docs; neither is a catalog string, so nothing above covers them
    const e = getEntry('pt-BR')
    expect(e, 'pt-BR is registered').toBeDefined()
    const latin = /^[\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]*$/u
    const fields: [string, string | undefined][] = [
      ['code', e?.code],
      ['englishName', e?.englishName],
      ['nativeName', e?.nativeName],
      ['displayNameKey', e?.displayNameKey],
      ['numberLocale', e?.numberLocale],
      ['baseFallbackFor', e?.baseFallbackFor],
    ]
    expect(fields.filter(([, v]) => v != null && !latin.test(v)).map(([k]) => k)).toEqual([])
    expect({
      code: e?.code,
      englishName: e?.englishName,
      nativeName: e?.nativeName,
      displayNameKey: e?.displayNameKey,
      numberLocale: e?.numberLocale,
      baseFallbackFor: e?.baseFallbackFor,
    }).toEqual({
      code: 'pt-BR',
      englishName: 'Portuguese (Brazil)',
      nativeName: 'Portugu\u00eas (Brasil)',
      displayNameKey: 'language.portugueseBrazil',
      numberLocale: 'pt-BR',
      baseFallbackFor: 'pt',
    })
  })

  // ------------------------------------------------------------ glossary
  it('keeps the node-kind glossary on one word each', () => {
    // the central contract: the three keys that NAME each kind
    const KINDS: [string, string][] = [
      ['pool', 'Reservatório'],
      ['source', 'Fonte'],
      ['drain', 'Sumidouro'],
      ['gate', 'Distribuidor'],
      ['converter', 'Conversor'],
      ['end', 'Fim'],
      ['parameter', 'Parâmetro'],
      ['register', 'Valor calculado'],
    ]
    for (const [kind, term] of KINDS) {
      for (const k of [`palette.${kind}.name`, `node.default.${kind}`, `canvas.nodeKind.${kind}`]) {
        expect(ptBR[k as Key], k).toBe(term)
      }
    }
  })

  it('uses the glossary term wherever English names a node kind', () => {
    // Derived from `en`, not from a hand-written key list, so a new string that
    // mentions a kind is covered the day it is added. `Source` and `End` are
    // NOT derivable — English uses "source" for an edge endpoint and "end" for
    // the end of a phase — so they rest on the contract above.
    const DERIVABLE: [RegExp, RegExp, RegExp | null, string][] = [
      [/\bpools?\b/i, /\breservatóri[oa]s?\b/i, /\bpiscinas?\b/i, 'a Pool is not a swimming pool'],
      [/\bgates?\b/i, /\bdistribuidor(es)?\b/i, /\bcomportas?\b/i, '`comporta` is a floodgate'],
      [/\bconverters?\b/i, /\bconversor(es)?\b/i, null, ''],
      [/\bdrains?\b/i, /\bsumidouros?\b/i, /\b(ralos?|escoadouros?)\b/i, '`ralo` is plumbing'],
      [
        /\bregisters?\b/i,
        /\bvalor(es)? calculad[oa]s?\b/i,
        /\bregistrador(es)?\b/i,
        '`Registrador` is not this product’s word for the kind',
      ],
    ]
    const missing: string[] = []
    for (const [key, value] of entries) {
      const src = enOf[key] ?? ''
      for (const [enRe, ptRe, banned, why] of DERIVABLE) {
        if (!enRe.test(src)) continue
        if (!ptRe.test(value)) missing.push(`${key}: English names the kind, pt-BR does not — ${value}`)
        if (banned && banned.test(value)) missing.push(`${key}: ${why} — ${value}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('names the Register with one term on all ten keys that show it', () => {
    // English shows `Register` / `Registers` on exactly these; `Computed value`
    // is not an English UI string anywhere (docs/localization.md §L2.14).
    const REGISTER_KEYS = Object.keys(enOf).filter((k) => /\bRegisters?\b/.test(enOf[k] ?? ''))
    expect(REGISTER_KEYS.length, 'the English surface for the Register kind').toBe(10)
    const wrong: string[] = []
    for (const k of REGISTER_KEYS) {
      const v = ptBR[k as Key]
      if (!/\bvalor(es)? calculad[oa]s?\b/i.test(v)) wrong.push(`${k}: no glossary term — ${v}`)
      if (/\bregistrador(es)?\b/i.test(v)) wrong.push(`${k}: uses \`Registrador\` — ${v}`)
      if (/\bregistros?\b/i.test(v)) wrong.push(`${k}: uses \`registro\` for the kind — ${v}`)
    }
    expect(wrong).toEqual([])
    // ...and `registro` is NOT banned anywhere else: nothing here asserts its
    // absence from the rest of the catalog, so a future log / record string is
    // free to use it.
  })

  it('says `quadro` for a group frame and `tela` for the canvas, by the English source', () => {
    const wrong: string[] = []
    for (const [key, value] of entries) {
      // the English PROSE — `Not enough free space in "{frame}"` names no
      // frame, it interpolates one, and must not demand the word
      const src = prose(enOf[key] ?? '')
      if (/\bframes?\b/i.test(src) && !/\bquadros?\b/i.test(value))
        wrong.push(`${key}: English says frame — ${value}`)
      if (/\bframes?\b/i.test(src) && /\bmoldura?s?\b/i.test(value))
        wrong.push(`${key}: \`moldura\` is a picture frame — ${value}`)
      if (/\bcanvas\b/i.test(src) && !/\btelas?\b/i.test(value))
        wrong.push(`${key}: English says canvas — ${value}`)
    }
    expect(wrong).toEqual([])
  })

  it('says `grafo` for the node-edge graph and `gráfico` only for a chart', () => {
    const wrong: string[] = []
    for (const [key, value] of entries) {
      const src = enOf[key] ?? ''
      if (/\bgraphs?\b/i.test(src) && /\bgráficos?\b/i.test(value))
        wrong.push(`${key}: the node-edge graph is \`grafo\` — ${value}`)
      if (/\bcharts?\b/i.test(src) && /\bgrafos?\b/i.test(value))
        wrong.push(`${key}: a chart is \`gráfico\` — ${value}`)
    }
    expect(wrong).toEqual([])
  })

  // -------------------------------------------------------------- plurals
  it('writes an explicit `many` arm in every plural', () => {
    // `Intl.PluralRules('pt-BR')` has one / other / many, and `many` is
    // reachable (1e6). A plural without it renders the `other` arm there,
    // which drops the `de` Portuguese requires: `1.000.000 de linhas`.
    const plurals = entries.filter(([k]) => /,\s*plural\s*,/.test(enOf[k] ?? ''))
    expect(plurals.length, 'plural keys in `en`').toBe(19)
    const missing = plurals.filter(([, v]) => !/\bmany\s*\{/.test(v)).map(([k]) => k)
    expect(missing).toEqual([])
  })

  it('leaves a plain `{n}` slot invariable rather than inventing a plural', () => {
    // `check:i18n` rejects giving a plural to a key whose `en` has a bare slot
    const bare = entries.filter(
      ([k]) => /\{\s*n\s*\}/.test(enOf[k] ?? '') && !/,\s*plural\s*,/.test(enOf[k] ?? ''),
    )
    expect(bare.length).toBeGreaterThan(0)
    expect(bare.filter(([, v]) => /,\s*plural\s*,/.test(v)).map(([k]) => k)).toEqual([])
  })

  // ------------------------------------------------------- English residue
  it('leaves no untranslated English behind', () => {
    // GLOBAL — a product name, a format, or a token that is the same word in
    // both languages and is not evidence of an untranslated sentence.
    const GLOBAL = new Set([
      'Loop', 'Studio', 'Monte', 'Carlo', 'CSV', 'TSV', 'JSON', 'GitHub', 'Google',
      'Excel', 'Numbers', 'Sheets', 'Ctrl', 'Ctrl', 'Cmd', 'Shift', 'Alt', 'Esc',
      'Escape', 'Enter', 'Delete', 'Backspace', 'Tab', 'id', 'ID', 'XP', 'SSR',
      'SR', 'R', 'MC', 'PWA', 'bytes', 'byte', 'kg', 'workers', 'Machinations',
      'Pity', 'pity', 'UP', 'Hard', 'Drops', 'Loot', 'drop', 'loot', 'Tickets',
      'buffer', 'buffers', 'MonteCarloResult', 'p10', 'p50', 'p90',
    ])
    // KEY-SCOPED — allowed only where the key owns the token
    const SCOPED: Record<string, string[]> = {
      'inspector.resourceType.placeholder': ['Gold', 'Energy', 'Player', 'Item'],
      'inspector.edge.flowPlaceholder': ['all'],
      'inspector.expr.labelPlaceholder': ['S'],
      'stateExpr.label.hint.empty': ['S'],
      'stateExpr.label.hint.notAnAssignment': ['S'],
      'inspector.labelTiming.warnSForm': ['S'],
      'import.qs.mapping': ['item_id', 'item_name', 'price', 'drop_rate'],
      'author.namePlaceholder': ['Alex'],
    }
    // A Latin-script word INCLUDING its diacritics. `[A-Za-z]` cuts a
    // Portuguese word at every accent and invents English from the pieces:
    // `at` out of `ate`, `is` out of `Papeis`, `in` out of `inicio`.
    const WORD = /[\p{Script=Latin}][\p{Script=Latin}\p{M}0-9_]*/gu
    // a word that is English-only: no Portuguese diacritic and not in the
    // Portuguese lexicon we can prove from `en` — kept deliberately crude, the
    // point is to surface anything that looks copied rather than translated
    const ENGLISH_ONLY =
      /^(?:the|and|of|to|an|are|was|were|be|been|this|that|these|those|with|from|by|it|its|not|yes|you|your|will|can|cannot|click|drag|drop|press|open|close|save|load|export|import|run|step|steps|row|rows|column|columns|table|tables|node|nodes|edge|edges|frame|frames|graph|chart|charts|value|values|name|names|label|labels|key|keys|number|numbers|parameter|parameters|register|registers|pool|pools|source|sources|gate|gates|drain|drains|end|canvas|timeline|settings|language|theme|light|dark|auto|show|hide|search|cancel|apply|update|dismiss|retry|error|errors|warning|warnings|missing|invalid|empty|unknown|select|selected|removed|add|added|change|changed|choose|chosen)$/i
    const bad: string[] = []
    for (const [key, value] of entries) {
      const allow = SCOPED[key] ?? []
      for (const w of prose(value).match(WORD) ?? []) {
        if (GLOBAL.has(w) || allow.includes(w)) continue
        if (ENGLISH_ONLY.test(w)) bad.push(`${key}: "${w}" — ${value.slice(0, 70)}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('scopes every allowed token to a key that still exists', () => {
    // a stale entry in SCOPED would silently widen the allowlist
    const SCOPED_KEYS = [
      'inspector.resourceType.placeholder',
      'inspector.edge.flowPlaceholder',
      'inspector.expr.labelPlaceholder',
      'stateExpr.label.hint.empty',
      'stateExpr.label.hint.notAnAssignment',
      'inspector.labelTiming.warnSForm',
      'import.qs.mapping',
      'author.namePlaceholder',
    ]
    expect(SCOPED_KEYS.filter((k) => !(k in enOf))).toEqual([])
  })

  // ------------------------------------------------------ punctuation / shape
  it('keeps every `{slot}` the English string has, and adds none', () => {
    const slots = (s: string) =>
      [...s.matchAll(/\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?=\}|,\s*plural)/g)]
        .map((m) => m[1])
        .sort()
    const bad = entries.filter(([k, v]) => {
      const a = slots(enOf[k] ?? '')
      const b = slots(v)
      return a.join('|') !== [...new Set(b)].sort().join('|') && a.join('|') !== b.join('|')
    })
    expect(bad.map(([k]) => k)).toEqual([])
  })

  it('counts the template and module overlays the checkpoint promised', () => {
    const slotCount = Object.values(ptBRTemplates).reduce((n, m) => n + Object.keys(m).length, 0)
    const frameCount = Object.values(ptBRFrames).reduce((n, m) => n + Object.keys(m).length, 0)
    const ids = new Set(Object.values(ptBRTemplates).flatMap((m) => Object.keys(m)))
    expect({ slotCount, frameCount, ids: ids.size, modules: moduleLabels.length }).toEqual({
      slotCount: 196,
      frameCount: 7,
      ids: 190,
      modules: 19,
    })
  })
})
