import { describe, expect, it } from 'vitest'
import ptBR from './locales/pt-BR'
import ptPT from './locales/pt-PT'
import en from './locales/en'
import { ptBR as tplBR, ptBRFrames } from './templateLabels/pt-BR'
import { ptPT as tplPT, ptPTFrames } from './templateLabels/pt-PT'
import { moduleLabelOverlay } from './moduleLabels'

// docs/localization.md §L2.16 — `pt-PT` is a REGION AUDIT over `pt-BR`, not a
// second translation. These contracts are about the DIFFERENCE between the two
// Portuguese catalogs, which is the thing neither catalog can check on its own:
// `check:i18n` sees key sets and argument shapes, `icuEscaping` sees rendering,
// and `parserLocation` sees one seven-key pair. None of them can see that a
// Brazilian word survived into the European catalog.
//
// The delta is pinned by COUNT plus two DIRECTIONAL contracts rather than by a
// hand-written list of 162 key names:
//   • nothing Brazilian is left in `pt-PT` (the banned-form scan), and
//   • every `pt-BR` string carrying a Brazilian marker actually changed.
// A flat list of 162 names would restate the count without proving either.

const brValues = ptBR as Record<string, string>
const ptValues = ptPT as Record<string, string>
const enValues = en as Record<string, string>

const KEYS = Object.keys(brValues)
const DELTA = KEYS.filter((k) => brValues[k] !== ptValues[k])

/** Brazilian forms that must not survive into the European catalog, with the
 *  European form each one becomes. Accent- and case-insensitive matching, so
 *  `Arquivo` and `arquivos` are caught by the same entry. */
const BANNED: ReadonlyArray<readonly [RegExp, string]> = [
  [/\barquivo/i, 'ficheiro'],
  [/\bplanilha/i, 'folha de cálculo'],
  [/compartilh/i, 'partilhar'],
  [/\bsalv(ar|o|a|os|as|amento)\b/i, 'guardar'],
  [/\bconex[ãa]o|\bconex[õo]es/i, 'ligação'],
  [/\bpression/i, 'premir / prima'],
  [/\bexclu(ir|a|i|ído|iu)/i, 'eliminar / apagar'],
  [/\bestoque/i, 'existências'],
  [/\bcontato\b/i, 'contacto'],
  [/\baplicativo/i, 'aplicação'],
  [/\bgerenci/i, 'gerir / gestão'],
  [/\bbaixar\b|\bbaixe\b|fazer download/i, 'transferir'],
  [/\bcaractere\b/i, 'carácter'],
  [/\bcontrole\b|\bcontroles\b/i, 'controlo / controlos'],
  [/\bplanejad/i, 'planeado'],
  [/\bequipe\b/i, 'equipa'],
  [/\bpatrim[ôo]nio\b/i, 'património'],
  [/\bsaques?\b/i, 'levantamentos'],
  [/\bdetectar\b/i, 'detetar'],
  [/nova aba\b/i, 'novo separador'],
]

describe('pt-PT copy — the region audit over pt-BR', () => {
  // ---------------------------------------------------------------- shape
  it('has exactly the same key set as pt-BR', () => {
    expect(Object.keys(ptValues).sort()).toEqual(KEYS.slice().sort())
    expect(KEYS).toHaveLength(850)
  })

  it('differs from pt-BR on exactly the audited keys', () => {
    // 162 of 844. Large on purpose: European and Brazilian Portuguese diverge
    // far more than Spain and Latin America do (`es-ES` moved 32 of 842), and
    // most of this is the address register and progressive aspect, which touch
    // whole sentences rather than single words.
    expect(DELTA).toHaveLength(162)
    // and it is a real audit, not a rewrite — most of the catalog agrees
    expect(DELTA.length).toBeLessThan(KEYS.length / 4)
  })

  // ------------------------------------------------- direction 1: nothing left
  it('leaves no Brazilian form standing anywhere in the catalog', () => {
    const found: string[] = []
    for (const [re, european] of BANNED) {
      for (const k of KEYS) {
        if (re.test(ptValues[k]!)) found.push(`${k}: /${re.source}/ should be "${european}"`)
      }
    }
    expect(found).toEqual([])
  })

  // ------------------------------------------- direction 2: everything moved
  it('changed every pt-BR string that carried a Brazilian marker', () => {
    const missed: string[] = []
    for (const [re] of BANNED) {
      for (const k of KEYS) {
        if (re.test(brValues[k]!) && brValues[k] === ptValues[k]) {
          missed.push(`${k}: /${re.source}/ survived unchanged`)
        }
      }
    }
    expect(missed).toEqual([])
  })

  // ---------------------------------------------------------------- register
  it('addresses the reader impersonally — no você, and no tu or vós either', () => {
    // EP software uses an infinitive or a null-subject third person. `tu` and
    // `vós` are not the European alternative to `você`; introducing them would
    // change the register rather than regionalise it.
    const bad: string[] = []
    for (const k of KEYS) {
      const v = ptValues[k]!
      if (/\bvoc[êe]s?\b/i.test(v)) bad.push(`${k}: você`)
      if (/\bv[óo]s\b/i.test(v)) bad.push(`${k}: vós`)
      if (/\btu\b|\bteu\b|\btua\b|\bteus\b|\btuas\b|\bvosso/i.test(v)) bad.push(`${k}: tu/teu/vosso`)
    }
    expect(bad).toEqual([])
  })

  it('uses estar a + INFINITIVE, never estar + GERUND', () => {
    // the one grammatical (not lexical) split between the two catalogs
    const progressive = /\b(est[áaã]\w*|estava\w*|estiver\w*|continu\w*|fica\w*)\s+\w+[aei]ndo\b/i
    const bad = KEYS.filter((k) => progressive.test(ptValues[k]!))
    expect(bad).toEqual([])
    // and pt-BR really does use it, so this is a difference and not a no-op
    expect(KEYS.filter((k) => progressive.test(brValues[k]!)).length).toBeGreaterThan(5)
  })

  // ------------------------------------------------------- deliberate keeps
  it('rejects `ecrã` — every one of these keys renders English `canvas`', () => {
    // A candidate-word screen proposed `ecrã`; the meaning check rejected it,
    // because `ecrã` is a physical display. This asserts the REJECTION, so a
    // later well-meaning sweep cannot quietly apply it.
    //
    // It does NOT assert that `tela` is the best word for Portugal. Ruling out
    // the wrong word is not the same as proving the remaining one right —
    // `área de desenho` and the English `canvas` are both plausible there, and
    // `tela` is open item 1 on the §L2.16 native-review list.
    //
    // So the contract is written WORD-AGNOSTICALLY, driven off the English
    // side: whatever word this locale settles on for the canvas, it must not
    // be `ecrã`. A native review that replaces `tela` leaves this test green.
    const canvasKeys = KEYS.filter((k) => /\bcanvas\b/i.test(enValues[k] ?? ''))
    expect(canvasKeys.length).toBeGreaterThan(0)
    for (const k of canvasKeys) {
      expect(ptValues[k], `${k} renders "canvas", so it must not say ecrã`).not.toMatch(/ecrã/i)
    }
    // and `ecrã` must not appear anywhere else either — there is no `screen`
    // concept in this product for it to legitimately translate
    expect(KEYS.filter((k) => /ecrã/i.test(ptValues[k]!))).toEqual([])
    expect(KEYS.filter((k) => /\bscreen\b/i.test(enValues[k] ?? ''))).toEqual([])

    // Today's choice, pinned separately and on purpose: it is a RECORD of the
    // current word, not part of the rejection contract above. Open item 1 may
    // change it, and then this one assertion is the only thing to update.
    expect(ptValues['tour.desktop.canvas.title']).toBe('Tela')
    expect(brValues['tour.desktop.canvas.title']).toBe('Tela')
  })

  it('keeps the node-kind glossary and `quadro` and `template` identical to pt-BR', () => {
    // the NAME keys are the glossary; the `description` keys are ordinary
    // prose and are audited like any other sentence (two of them changed for
    // the address register, which is not a glossary question)
    const NAME_KEYS = KEYS.filter((k) =>
      /^palette\.(pool|source|drain|gate|converter|end|parameter|register)\.name$/.test(k),
    )
    expect(NAME_KEYS).toHaveLength(8)
    for (const k of NAME_KEYS) expect(ptValues[k], `glossary key ${k}`).toBe(brValues[k])
    expect(NAME_KEYS.map((k) => ptValues[k])).toEqual([
      'Reservatório',
      'Fonte',
      'Sumidouro',
      'Distribuidor',
      'Conversor',
      'Fim',
      'Parâmetro',
      'Valor calculado',
    ])
    // `moldura` was rejected for pt-BR as the wrong word and is not
    // reintroduced here; `modelo` stays the simulation model, so a Template is
    // a `template` in both locales.
    for (const k of KEYS) {
      expect(ptValues[k], `${k}: moldura`).not.toMatch(/\bmoldura/i)
      expect(ptValues[k], `${k}: modelo for Template`).not.toMatch(/\bmodelo de documento/i)
    }
  })

  // ----------------------------------------------------------------- plural
  it('selects `other` at zero, where pt-BR selects `one`', () => {
    // MEASURED, and the only behavioural difference between the two: CLDR
    // gives pt-BR 0 -> `one` and pt-PT 0 -> `other`. Neither catalog gains or
    // loses an arm; only the selection moves.
    expect(new Intl.PluralRules('pt-PT').select(0)).toBe('other')
    expect(new Intl.PluralRules('pt-BR').select(0)).toBe('one')
    // and both keep the same three categories, so no key needs a fourth arm
    expect(new Intl.PluralRules('pt-PT').resolvedOptions().pluralCategories.slice().sort()).toEqual(
      new Intl.PluralRules('pt-BR').resolvedOptions().pluralCategories.slice().sort(),
    )
    const plurals = KEYS.filter((k) => /,\s*plural\s*,/.test(ptValues[k]!))
    expect(plurals).toHaveLength(19)
    for (const k of plurals) {
      expect(ptValues[k], `${k} needs a many arm`).toMatch(/\bmany\s*\{/)
    }
  })

  // ------------------------------------------------------------------ NBSP
  it('writes no NO-BREAK SPACE — pt-PT gets its from the FORMATTER, not the catalog', () => {
    // `Intl.NumberFormat('pt-PT')` groups with U+00A0 (`1 234 567`), so the
    // character does reach the DOM through ICU `#`. It must never be typed
    // into a string: unlike `es-ES`, percent takes no space here, so a NBSP in
    // the catalog would be an invisible accident rather than a decision.
    const NO_BREAK_SPACE = 160
    const bad = KEYS.filter((k) => [...ptValues[k]!].some((c) => c.codePointAt(0) === NO_BREAK_SPACE))
    expect(bad).toEqual([])
    // the percent strings stay exactly as pt-BR writes them
    expect(ptValues['playbar.mc.progress']).toBe(brValues['playbar.mc.progress'])
    expect(ptValues['runbar.mc.cancel']).toBe(brValues['runbar.mc.cancel'])
  })

  // -------------------------------------------------------------- integrity
  it('contains no control characters beyond the line breaks `en` itself has', () => {
    // code points U+0000..U+001F and U+007F, named rather than written. U+000A
    // is legitimate — `import.structuralWarning` carries one in every locale
    // including `en` — so it is allowed ONLY where the English original has it
    // at the same key, which keeps the exemption from widening.
    const bad: string[] = []
    for (const k of KEYS) {
      for (const ch of ptValues[k]!) {
        const c = ch.codePointAt(0)!
        if (c > 31 && c !== 127) continue
        if (c === 10 && (enValues[k] ?? '').includes('\n')) continue
        bad.push(`${k}: U+${c.toString(16).padStart(4, '0')}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('is written in Latin script throughout', () => {
    // pt-BR shipped with a Cyrillic `не` that passed every other gate; only a
    // runtime script scan caught it
    const bad: string[] = []
    const LETTER = /\p{L}/u
    for (const k of KEYS) {
      for (const ch of ptValues[k]!) {
        if (LETTER.test(ch) && !/\p{Script=Latin}/u.test(ch)) {
          bad.push(`${k}: ${ch} U+${ch.codePointAt(0)!.toString(16).padStart(4, '0')}`)
        }
      }
    }
    expect(bad).toEqual([])
  })

  // ---------------------------------------------------------- surface markers
  it('names the feedback form English and calls a browser tab a separador', () => {
    expect(ptValues['tour.help.feedback']).toMatch(/inglês/i)
    expect(ptValues['tour.help.feedbackAria']).toMatch(/inglês/i)
    expect(ptValues['tour.help.feedbackAria']).toMatch(/separador/i)
    // `aba` is the Brazilian word and is `pt-BR`'s marker; it must not appear
    expect(ptValues['tour.help.feedbackAria']).not.toMatch(/\baba\b/i)
    expect(brValues['tour.help.feedbackAria']).toMatch(/\baba\b/i)
  })

  it('splits the parser CHARACTER offset from a table COLUMN', () => {
    const PARSER = KEYS.filter((k) => /^error\.EXPR_.*\.message$/.test(k) || k === 'import.parseError')
    const charKeys = PARSER.filter((k) => /\{column\}/.test(ptValues[k]!))
    expect(charKeys).toHaveLength(7)
    for (const k of charKeys) expect(ptValues[k], k).toMatch(/carácter \{column\}/)
    const tableKeys = KEYS.filter((k) => k.startsWith('import.loc.') && /\{column\}/.test(ptValues[k]!))
    expect(tableKeys).toHaveLength(3)
    for (const k of tableKeys) expect(ptValues[k], k).toMatch(/coluna \{column\}/)
  })

  // ------------------------------------------------- the other two surfaces
  it('differs from pt-BR on exactly 24 template labels', () => {
    const flat = (nodes: Record<string, Record<string, string>>, frames: Record<string, Record<string, string>>) => {
      const out: Record<string, string> = {}
      for (const [tpl, map] of Object.entries(nodes)) for (const [id, v] of Object.entries(map)) out[`n:${tpl}.${id}`] = v
      for (const [tpl, map] of Object.entries(frames)) for (const [id, v] of Object.entries(map)) out[`f:${tpl}.${id}`] = v
      return out
    }
    const a = flat(tplBR, ptBRFrames)
    const b = flat(tplPT, ptPTFrames)
    expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort())
    const diff = Object.keys(b).filter((k) => a[k] !== b[k])
    expect(diff).toHaveLength(24)
    // and each one carries a European form, not a synonym chosen for variety
    for (const k of diff) {
      expect(b[k], k).toMatch(
        /Existências|existências|Equipa|planeado|online|[Rr]eparação|[Tt]reino|[Pp]reparação|Procura|Encomendas|grosso|retalho/,
      )
    }
  })

  it('differs from pt-BR on exactly 5 module labels', () => {
    const diff: string[] = []
    for (const moduleId of ['buffered-step', 'reward-split']) {
      const a = moduleLabelOverlay(moduleId, 'pt-BR')!
      const b = moduleLabelOverlay(moduleId, 'pt-PT')!
      expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort())
      for (const id of Object.keys(b)) if (a[id] !== b[id]) diff.push(`${moduleId}.${id}`)
    }
    expect(diff.sort()).toEqual([
      'buffered-step.intake',
      'buffered-step.planned_run',
      'reward-split.net_worth',
      'reward-split.progress',
      'reward-split.withdrawals',
    ])
    // the wallet does NOT split the way the Spanish pair did — `Carteira` is
    // already what pt-BR says, so there is nothing regional to change
    expect(moduleLabelOverlay('reward-split', 'pt-PT')!['wallet']).toBe('Carteira')
    expect(moduleLabelOverlay('reward-split', 'pt-BR')!['wallet']).toBe('Carteira')
  })

  // --------------------------------------------------------- pt-BR untouched
  it('leaves pt-BR alone apart from the one new display-name key', () => {
    const changed = KEYS.filter((k) => brValues[k] !== ptValues[k] && k === 'language.portuguesePortugal')
    expect(changed).toEqual([])
    expect(brValues['language.portuguesePortugal']).toBe('Português (Portugal)')
    expect(ptValues['language.portugueseBrazil']).toBe('Português (Brasil)')
    expect(ptValues['language.portuguesePortugal']).toBe('Português (Portugal)')
  })
})
