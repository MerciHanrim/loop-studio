import IntlMessageFormat from 'intl-messageformat'
import { describe, expect, it } from 'vitest'
import en from './locales/en'
import ru from './locales/ru'
import { moduleLabelOverlay } from './moduleLabels'
import { ru as tplRu, ruFrames } from './templateLabels/ru'

// docs/localization.md §L2.17 — `ru` is the first Cyrillic catalog and the
// first with a four-arm plural. The contracts here are the ones no other gate
// can see: `check:i18n` compares key sets and argument shapes, `icuEscaping`
// renders, `parserLocation` covers one seven-key pair. None of them knows
// which SCRIPT the text is in, whether a plural arm spells its numeral out, or
// whether a Latin token is a product name or an untranslated sentence.

const enValues = en as Record<string, string>
const ruValues = ru as Record<string, string>
const KEYS = Object.keys(enValues)

/** The Russian alphabet. Any other Cyrillic letter means a different Cyrillic
 *  LANGUAGE leaked in — `ї`, `ў`, `ђ`, `є` are all `Script=Cyrillic` and would
 *  sail through a script check. */
const RU_ALPHABET = new Set('абвгдеёжзийклмнопрстуфхцчшщъыьэюяАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ')

/** ICU structure is not prose: slot names and the plural / select keywords are
 *  syntax, and Russian legitimately has `few` and `many` arms that English
 *  does not. Strip them before looking for Latin words. */
const stripIcu = (s: string) =>
  s
    .replace(/\{[^{}]*\}/g, ' ')
    .replace(/\{[^{}]*\}/g, ' ')
    .replace(/\{[^{}]*\}/g, ' ')
    .replace(/\b(zero|one|two|few|many|other|plural|select|selectordinal|offset)\b/g, ' ')

/** Every Latin RUN, as an exact string, so a mixed-script homoglyph (Cyrillic
 *  `С` inside `CSV`, Latin `a` inside a Russian word) cannot hide — the token
 *  must match byte for byte. Internal `.`/`-`/`+`/`_` are kept only BETWEEN
 *  alphanumerics, so `Machinations.io`, `item_id`, `p50` and `Cmd+Z` survive
 *  while a sentence-final `Studio.` tokenises as `Studio`. */
const latinRuns = (s: string) =>
  stripIcu(s).match(/[A-Za-z][A-Za-z0-9]*(?:[._+-][A-Za-z0-9]+)*/g) ?? []

describe('ru copy — the first Cyrillic catalog', () => {
  // ------------------------------------------------------------------ shape
  it('has exactly the base key set', () => {
    expect(Object.keys(ruValues).sort()).toEqual(KEYS.slice().sort())
    expect(KEYS).toHaveLength(848)
  })

  // ----------------------------------------------------------------- script
  it('is written in Cyrillic, with Common and Inherited allowed', () => {
    const bad: string[] = []
    for (const k of KEYS) {
      for (const ch of ruValues[k]!) {
        if (ch.codePointAt(0)! < 128) continue
        if (/\p{Script=Cyrillic}|\p{Script=Common}|\p{Script=Inherited}/u.test(ch)) continue
        bad.push(`${k}: ${ch} U+${ch.codePointAt(0)!.toString(16).toUpperCase()}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('uses only letters of the RUSSIAN alphabet', () => {
    // A script check cannot tell Russian from Ukrainian, Belarusian, Bulgarian
    // or Serbian — they are all `Script=Cyrillic`. This is the part that can:
    // `ї` / `ў` / `ђ` / `є` are rejected by name.
    const bad: string[] = []
    for (const k of KEYS) {
      for (const ch of ruValues[k]!) {
        if (!/\p{Script=Cyrillic}/u.test(ch)) continue
        if (!RU_ALPHABET.has(ch)) {
          bad.push(`${k}: ${ch} U+${ch.codePointAt(0)!.toString(16).toUpperCase()}`)
        }
      }
    }
    expect(bad).toEqual([])
  })

  it('keeps every Latin run on a key whose ENGLISH source has the same run', () => {
    // The general contract, which needs no hand-written list: a Latin token may
    // stay only where the English original contains that exact token. That
    // covers `CSV`, `JSON`, `Enter`, `p50`, `item_id`, `Alex` and the rest
    // without ever forgiving an English WORD that the translation simply left
    // behind, because an untranslated sentence would carry runs the English
    // source has in a DIFFERENT key — and matching is exact, so a homoglyph
    // fails too.
    const stray: string[] = []
    for (const k of KEYS) {
      // hyphenation is orthography, not a different token: `en` writes
      // `Monte-Carlo` and `Shift-drag` where the Russian sentence writes
      // `Monte Carlo` and `Shift+перетаскивание`, so each English run also
      // contributes its parts.
      const allowed = new Set<string>()
      for (const tok of latinRuns(enValues[k] ?? '')) {
        allowed.add(tok)
        for (const part of tok.split(/[-+._]/)) if (part) allowed.add(part)
      }
      for (const tok of latinRuns(ruValues[k]!)) {
        if (!allowed.has(tok)) stray.push(`${k}: ${JSON.stringify(tok)}`)
      }
    }
    expect(stray).toEqual([])
  })

  it('leaves no English SENTENCE standing', () => {
    // the complement of the rule above: a key whose Russian value is mostly
    // Latin words is an untranslated string even if every token also appears
    // in `en`
    const untranslated = KEYS.filter((k) => {
      // measured on the STRIPPED form: `{pct}` and the plural keywords are
      // syntax, and counting their letters made `Monte Carlo {pct} %` look
      // like an English sentence
      const v = stripIcu(ruValues[k]!)
      const cyr = (v.match(/\p{Script=Cyrillic}/gu) ?? []).length
      const lat = (v.match(/[A-Za-z]/g) ?? []).length
      return lat > 12 && cyr === 0 && ruValues[k] !== enValues[k]
    })
    expect(untranslated).toEqual([])
  })

  // ----------------------------------------------------------------- plural
  it('gives every plural four arms, and never spells the numeral out', () => {
    const plurals = KEYS.filter((k) => /,\s*plural\s*,/.test(ruValues[k]!))
    expect(plurals).toHaveLength(19)

    for (const k of plurals) {
      for (const arm of ['one', 'few', 'many', 'other']) {
        expect(ruValues[k], `${k} needs a ${arm} arm`).toMatch(new RegExp(`\\b${arm}\\s*\\{`))
      }
      // `one` selects 1, 21, 101 and 1 000 001 — an arm that wrote `одна`
      // instead of `#` would render "21 одна строка"
      for (const m of ruValues[k]!.matchAll(/\b(one|few|many|other)\s*\{([^{}]*)\}/g)) {
        expect(m[2], `${k} / ${m[1]} must keep #`).toContain('#')
      }
    }
  })

  it('selects the arm CLDR says, at the values that separate them', () => {
    const pr = new Intl.PluralRules('ru')
    expect(pr.resolvedOptions().pluralCategories.slice().sort()).toEqual([
      'few',
      'many',
      'one',
      'other',
    ])
    // the four that matter, measured rather than asserted from memory
    expect([0, 1, 2, 5, 21, 22, 25, 101, 1000000].map((n) => pr.select(n))).toEqual([
      'many',
      'one',
      'few',
      'many',
      'one',
      'few',
      'many',
      'one',
      'many',
    ])
    // and `other` is UNREACHABLE from a non-negative integer — it exists for
    // decimals, which is why its wording is not a copy of `few`
    const reachable = new Set<string>()
    for (let n = 0; n <= 3000; n++) reachable.add(pr.select(n))
    expect(reachable.has('other')).toBe(false)
    expect(pr.select(1.5)).toBe('other')
  })

  it('renders the four arms correctly through the real formatter', () => {
    const f = new IntlMessageFormat(ruValues['import.refresh.rowCount']!, 'ru')
    expect(f.format({ n: 1 })).toBe('1 строка')
    expect(f.format({ n: 2 })).toBe('2 строки')
    expect(f.format({ n: 5 })).toBe('5 строк')
    expect(f.format({ n: 21 })).toBe('21 строка') // `one`, not "одна"
    expect(f.format({ n: 22 })).toBe('22 строки')
    expect(f.format({ n: 0 })).toBe('0 строк')
  })

  // ------------------------------------------------------------------- NBSP
  it('writes a NO-BREAK SPACE before the percent sign, in exactly two keys', () => {
    // MEASURED: `Intl.NumberFormat('ru', {style:'percent'})` emits `84 %` with
    // U+00A0. Asserted by CODE POINT so the source never has to contain an
    // escape sequence.
    const NO_BREAK_SPACE = 160
    const withNbsp = KEYS.filter((k) =>
      [...ruValues[k]!].some((c) => c.codePointAt(0) === NO_BREAK_SPACE),
    )
    expect(withNbsp.sort()).toEqual(['playbar.mc.progress', 'runbar.mc.cancel'])
    for (const k of withNbsp) {
      const i = ruValues[k]!.indexOf('%')
      expect(ruValues[k]!.codePointAt(i - 1), `${k}: code point before %`).toBe(NO_BREAK_SPACE)
      expect(ruValues[k], `${k} must not use an ordinary space`).not.toContain(' %')
    }
    // and the user-typed example is untouched — `25%` is what a user types
    expect(ruValues['inspector.edge.flowPlaceholder']).toBe(
      enValues['inspector.edge.flowPlaceholder'],
    )
  })

  // --------------------------------------------------------------------- ё
  it('writes ё where the standard spelling has it', () => {
    // NOT a claim of full automation: without a dictionary nothing can prove a
    // catalog spells every ё-word correctly. What IS pinned is the explicit
    // list of words that carry it today, so flattening one to `е` shows up in
    // the diff and has to be argued for (§L2.17 open items).
    const yo = new Set<string>()
    for (const k of KEYS) {
      for (const w of ruValues[k]!.match(/\p{Script=Cyrillic}+/gu) ?? []) {
        if (w.includes('ё') || w.includes('Ё')) yo.add(w.toLowerCase())
      }
    }
    expect([...yo].sort()).toEqual([
      'введённое',
      'включён',
      'всё',
      'даёт',
      'ещё',
      'её',
      'завершённый',
      'задаёт',
      'задаётся',
      'заменён',
      'идёт',
      'изменён',
      'моё',
      'надёжного',
      'несохранённые',
      'несёт',
      'неё',
      'обновлён',
      'объединённые',
      'остаётся',
      'передаётся',
      'перемещён',
      'подключён',
      'прервёт',
      'прошёл',
      'разделённые',
      'своё',
      'создаёт',
      'сохранённые',
      'сохранённый',
      'трёх',
      'тёмная',
      'удалён',
      'упрощённый',
      'ёмкости',
      'ёмкость',
    ])
  })

  // ---------------------------------------------------------------- register
  it('addresses the reader politely — no ты, and вы stays lowercase', () => {
    const bad: string[] = []
    for (const k of KEYS) {
      const v = ruValues[k]!
      if (/\bты\b|\bтвой\b|\bтвоя\b|\bтвоё\b|\bтвои\b|\bтебе\b|\bтебя\b/i.test(v)) {
        bad.push(`${k}: ты/твой`)
      }
      // `Вы` capitalised mid-sentence is the letter-writing register, not UI
      if (/[^.!?…]\s+Вы\b/.test(v)) bad.push(`${k}: capitalised Вы mid-sentence`)
    }
    expect(bad).toEqual([])
  })

  // --------------------------------------------------------------- glossary
  it('fixes one word per node kind', () => {
    const NAME_KEYS = KEYS.filter((k) =>
      /^palette\.(pool|source|drain|gate|converter|end|parameter|register)\.name$/.test(k),
    )
    expect(NAME_KEYS).toHaveLength(8)
    expect(NAME_KEYS.map((k) => ruValues[k])).toEqual([
      'Накопитель',
      'Источник',
      'Сток',
      'Распределитель',
      'Преобразователь',
      'Конец',
      'Параметр',
      'Вычисляемое значение',
    ])
    // `Регистр` would read as a CPU register (or as letter case) — never used
    expect(KEYS.filter((k) => /\bРегистр/i.test(ruValues[k]!))).toEqual([])
    // and the kind names agree across the three surfaces that repeat them
    for (const kind of ['pool', 'source', 'drain', 'gate', 'converter', 'end', 'parameter', 'register']) {
      expect(ruValues[`canvas.nodeKind.${kind}`], kind).toBe(ruValues[`palette.${kind}.name`])
      expect(ruValues[`node.default.${kind}`], kind).toBe(ruValues[`palette.${kind}.name`])
    }
  })

  it('keeps Шаблон and Модель apart', () => {
    // Unlike Portuguese and Spanish, Russian has two separate words and
    // neither is taken, so the anglicism those catalogs had to keep is not
    // needed here.
    expect(ruValues['templates.button']).toContain('Шаблон')
    expect(ruValues['modules.promote.title']).toContain('модель')
    expect(KEYS.filter((k) => /\bTemplate\b/.test(ruValues[k]!))).toEqual([])
  })

  // ------------------------------------------------------- parser vs column
  it('splits the parser CHARACTER offset from a table COLUMN', () => {
    const parser = KEYS.filter(
      (k) => /^error\.EXPR_.*\.message$/.test(k) || k === 'import.parseError',
    ).filter((k) => /\{column\}/.test(ruValues[k]!))
    expect(parser).toHaveLength(7)
    for (const k of parser) expect(ruValues[k], k).toMatch(/символ(е)? \{column\}/)

    const table = KEYS.filter(
      (k) => k.startsWith('import.loc.') && /\{column\}/.test(ruValues[k]!),
    )
    expect(table).toHaveLength(3)
    for (const k of table) expect(ruValues[k], k).toMatch(/столбец \{column\}/)

    // and neither group borrows the other's word
    for (const k of parser) expect(ruValues[k], k).not.toMatch(/столбец/)
    for (const k of table) expect(ruValues[k], k).not.toMatch(/символ/)
  })

  // -------------------------------------------------------------- integrity
  it('contains no control characters beyond the line breaks `en` itself has', () => {
    const bad: string[] = []
    for (const k of KEYS) {
      for (const ch of ruValues[k]!) {
        const c = ch.codePointAt(0)!
        if (c > 31 && c !== 127) continue
        if (c === 10 && (enValues[k] ?? '').includes('\n')) continue
        bad.push(`${k}: U+${c.toString(16).padStart(4, '0')}`)
      }
    }
    expect(bad).toEqual([])
  })

  // --------------------------------------------------- the other two surfaces
  it('translates every template-label slot into Cyrillic, keeping the token set', () => {
    const flat: Record<string, string> = {}
    for (const [tpl, map] of Object.entries(tplRu)) {
      for (const [id, v] of Object.entries(map)) flat[`n:${tpl}.${id}`] = v
    }
    for (const [tpl, map] of Object.entries(ruFrames)) {
      for (const [id, v] of Object.entries(map)) flat[`f:${tpl}.${id}`] = v
    }
    expect(Object.keys(flat)).toHaveLength(203)

    // the gacha mechanism names and rarity letters stay Latin on purpose
    const LATIN_LABEL_OK = /^(SSR|SR|R|XP|Pity|Premium|Standard|Pickup|Hard|pity|вес|Доля)$/
    const stray: string[] = []
    for (const [k, v] of Object.entries(flat)) {
      const hasCyr = /\p{Script=Cyrillic}/u.test(v)
      const runs = latinRuns(v)
      if (!hasCyr && runs.length && !runs.every((t) => LATIN_LABEL_OK.test(t))) {
        stray.push(`${k}: ${v}`)
      }
    }
    expect(stray).toEqual([])
  })

  it('ships a module overlay in Cyrillic', () => {
    for (const moduleId of ['buffered-step', 'reward-split']) {
      const map = moduleLabelOverlay(moduleId, 'ru')
      expect(map, moduleId).toBeTruthy()
      for (const [id, v] of Object.entries(map!)) {
        expect(v, `${moduleId}.${id}`).toMatch(/\p{Script=Cyrillic}/u)
      }
    }
    expect(moduleLabelOverlay('reward-split', 'ru')!['wallet']).toBe('Кошелёк')
    expect(moduleLabelOverlay('buffered-step', 'ru')!['intake']).toBe('Приёмка')
  })

  // ------------------------------------------------------ feedback markers
  it('names the feedback form English and calls a browser tab a вкладка', () => {
    expect(ruValues['tour.help.feedback']).toMatch(/английск/i)
    expect(ruValues['tour.help.feedbackAria']).toMatch(/английск/i)
    expect(ruValues['tour.help.feedbackAria']).toMatch(/вкладк/i)
  })
})
