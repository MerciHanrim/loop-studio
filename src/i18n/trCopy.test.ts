import { describe, expect, it } from 'vitest'
import { pluralArms, pluralBlocks } from './icuPlural'
import en from './locales/en'
import tr from './locales/tr'
import { moduleLabelOverlay } from './moduleLabels'
import { tr as tplTr, trFrames } from './templateLabels/tr'

// docs/localization.md §L2.18 — the `tr` copy contracts.
//
// WHAT THIS FILE DELIBERATELY DOES NOT LOCK
//
//   * the quotation marks. `«»` is a provisional house choice for this
//     catalog, still pending a native-speaker and screen-reader review.
//
// The word for Drain WAS provisional and is now settled on `Gider` (see that
// section below). The 8x3 surface-agreement and prose-derived contracts stay
// exactly as they were — they say the surfaces MATCH, independently of which
// word is current, so a later rename still moves all of them together.
//
// Turkish is a Latin-script language, so the `ru` trick of "a Latin run is
// only allowed where English has the same run" says nothing here. Two
// mechanical checks replace it: the alphabet (Turkish has no q, w or x, so a
// word carrying one must be a token English put there) and untranslated
// values (a value byte-identical to its English original must be on a list).

const EN = en as Record<string, string>
const TR = tr as Record<string, string>
const KEYS = Object.keys(EN)

describe('tr copy — the first Turkish catalog', () => {
  it('has exactly the base key set', () => {
    expect(Object.keys(TR).sort()).toEqual(KEYS.slice().sort())
    expect(KEYS).toHaveLength(851)
  })
})

// ------------------------------------------------------------------ script
describe('nothing from another script leaked in', () => {
  // The `pt-BR` lesson: a single Cyrillic letter passed every gate that read
  // the file and was caught only by a RUNTIME Script check on the values.
  const FOREIGN = /[\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Thai}]/u

  it('every catalog value is Latin plus shared punctuation', () => {
    const bad = KEYS.filter((k) => FOREIGN.test(TR[k])).map((k) => k + ': ' + TR[k])
    expect(bad).toEqual([])
  })

  it('every template label and module label too', () => {
    const bad: string[] = []
    for (const [tplId, map] of Object.entries(tplTr)) {
      for (const [id, v] of Object.entries(map)) if (FOREIGN.test(v)) bad.push(tplId + '/' + id + ': ' + v)
    }
    for (const [tplId, map] of Object.entries(trFrames)) {
      for (const [id, v] of Object.entries(map)) if (FOREIGN.test(v)) bad.push(tplId + '/' + id + ': ' + v)
    }
    for (const modId of ['buffered-step', 'reward-split']) {
      const map = moduleLabelOverlay(modId, 'tr') ?? {}
      for (const [id, v] of Object.entries(map)) if (FOREIGN.test(String(v))) bad.push(modId + '/' + id + ': ' + v)
    }
    expect(bad).toEqual([])
  })
})

// ------------------------------------------------------- the Turkish alphabet
describe('q, w and x only appear inside a token English put there', () => {
  // Turkish has no q / w / x. A word carrying one is either a borrowed token
  // (`Workspace`, `Excel`, `xlsx`) or a mistake, and the difference is decided
  // by the ENGLISH value of the SAME key — never by a hand-kept allowlist,
  // which would rot.
  //
  // SYNTAX IS NOT PROSE. ICU argument names (`{workers}`, `{max}`, `{rows}`,
  // `{when}`) and plural keywords are removed from BOTH sides first: they are
  // the message's machinery, they are identical in every locale, and leaving
  // them in would let a genuinely stray word hide behind a slot that happens
  // to share its spelling. MEASURED before this was tightened: 35 of the 35
  // q/w/x words in the catalog were slot names or English tokens.
  // Remove the GRAMMAR, keep the PROSE. An earlier version deleted every
  // `{...}` group, which also deleted the body of each plural arm — the check
  // then said nothing about the sentence a reader of a counted message sees.
  // MEASURED: with that version, `qwerty` injected inside an arm passed.
  const stripSyntax = (s: string) =>
    s
      // a plain slot carries no prose
      .replace(/\{\s*[A-Za-z0-9_]+\s*\}/g, ' ')
      // the header of a plural / select block, and any offset
      .replace(/\{\s*[A-Za-z0-9_]+\s*,\s*(?:plural|select|selectordinal)\s*,/g, ' ')
      .replace(/\boffset\s*:\s*-?\d+/g, ' ')
      // an arm keyword, but NOT the arm's body
      .replace(/(?:^|[\s}])(?:zero|one|two|few|many|other|=\d+)\s*\{/g, ' ')
      // whatever braces are left are structure, not words
      .replace(/[{}]/g, ' ')

  /** Case fold that also handles `İ`: `'İ'.toLowerCase()` is `i` + U+0307 and
   *  NFC does not recompose it, so a bare `toLowerCase()` comparison would
   *  miss a match. Decompose, drop a combining mark that sits on a Latin
   *  letter, recompose. */
  const LATIN = /[A-Za-zÀ-ɏ]/
  const fold = (s: string) => {
    const d = s.normalize('NFD').toLowerCase()
    let out = ''
    for (const ch of d) {
      if (/\p{M}/u.test(ch) && LATIN.test(out.slice(-1))) continue
      out += ch
    }
    return out.normalize('NFC')
  }

  const WORDS = (s: string) => stripSyntax(s).match(/[\p{L}\p{N}][\p{L}\p{N}._+-]*/gu) ?? []
  const HAS_QWX = /[qwxQWX]/

  it('each one is a word the English original of that key also contains', () => {
    const stray: string[] = []
    for (const k of KEYS) {
      const enWords = new Set<string>()
      for (const w of WORDS(EN[k])) {
        enWords.add(fold(w))
        for (const part of w.split(/[._+-]/)) enWords.add(fold(part))
      }
      for (const w of WORDS(TR[k])) {
        if (!HAS_QWX.test(w)) continue
        const folded = fold(w)
        const parts = w.split(/[._+-]/).map(fold)
        if (enWords.has(folded) || parts.some((p) => enWords.has(p))) continue
        stray.push(k + ': ' + w)
      }
    }
    expect(stray).toEqual([])
  })

  it('the body of a plural arm is prose, and IS checked', () => {
    // The hole this closes: stripping every `{...}` group also strips each
    // arm's sentence, and the check then passes over the copy a reader of a
    // counted message actually sees.
    const msg = '{n, plural, one {# qwerty seçildi} other {# düğüm seçildi}}'
    expect(WORDS(msg)).toContain('qwerty')
    expect(WORDS(msg)).toContain('seçildi')
    // …while the grammar around it is gone
    expect(WORDS(msg)).not.toContain('plural')
    expect(WORDS(msg)).not.toContain('one')
    expect(WORDS(msg)).not.toContain('other')
    expect(WORDS(msg)).not.toContain('n')
  })

  it('a URL, an ICU slot and a code token are not read as ordinary words', () => {
    // These three shapes are what a naive word split gets wrong. `stripSyntax`
    // removes the slot; the other two are single tokens that must match the
    // English side as a whole or by part.
    expect(WORDS('görmek için {workers} kişi')).toEqual(['görmek', 'için', 'kişi'])
    expect(WORDS('https://tally.so/r/9qkk6Y adresinde')).toContain('9qkk6Y')
    expect(WORDS('`loop-model/2` sürümü')).toContain('loop-model')
    // and the fold is what makes the dotted capital comparable
    expect(fold(String.fromCharCode(0x130))).toBe('i')
    expect(fold('WORKSPACE')).toBe('workspace')
  })
})

// ------------------------------------------------------------ untranslated
describe('a value left in English is declared, not accidental', () => {
  /** Keys whose Turkish value is byte-identical to English ON PURPOSE, each
   *  for one of three reasons: a file-format or product name that is not
   *  translated anywhere (`Graph JSON`, `Workspace JSON`, `Monte Carlo`,
   *  `CSV`), a placeholder or example the user types verbatim, or a string
   *  made only of symbols and slots. MEASURED, then declared: a fourteenth
   *  entry appearing here means a sentence was left untranslated. */
  const SAME_AS_ENGLISH = [
    'export.graphJson.name', // Graph JSON
    'export.workspaceJson.name', // Workspace JSON
    'help.contextual.hint.mc.name', // Monte Carlo
    'import.qs.mapping', // the worked example's column mapping, typed verbatim
    'inspector.edge.flowParam.resolved', // = {value}
    'inspector.edge.flowPlaceholder', // 1, all, 2D6, 1-3, 25%
    'inspector.expr.activatorPlaceholder', // >= 5
    'inspector.expr.labelPlaceholder', // +1 · -2 · =S
    'mc.title', // Monte Carlo
    'playbar.mc', // Monte Carlo
    'playbar.mc.withNote', // Monte Carlo · {note}
    'regExpr.row.generic', // — {code}
    'timeline.csv', // CSV
    'tour.nav.position', // {n} / {total}
  ]

  it('the identical-to-English set is exactly the declared one', () => {
    const same = KEYS.filter((k) => TR[k] === EN[k]).sort()
    expect(same).toEqual(SAME_AS_ENGLISH.slice().sort())
  })
})

// ------------------------------------------------------------------ plural
describe('every plural keeps its ICU shape', () => {
  const PLURAL_KEYS = KEYS.filter((k) => /\{\s*\w+\s*,\s*plural\s*,/.test(EN[k]))

  it('there are as many plural messages as in English', () => {
    const trPlural = KEYS.filter((k) => /\{\s*\w+\s*,\s*plural\s*,/.test(TR[k]))
    expect(trPlural.sort()).toEqual(PLURAL_KEYS.slice().sort())
  })

  // The walk lives in `icuPlural.ts`, with its fixtures. It used to be
  // `split(/(?=\{…plural,)/).slice(1)` inline here, and that was WRONG: a
  // zero-width match at index 0 does not split in JavaScript —
  // `'abc'.split(/(?=a)/)` is `['abc']` — so `.slice(1)` threw away the only
  // block whenever the message STARTED with its plural. MEASURED when the same
  // idiom was copied into `thCopy.test.ts` and a deliberately broken plural
  // passed: this guard was seeing 6 blocks across 19 keys and examining the
  // other 14 as nothing. It was green because there was nothing left to fail.

  it('each key has exactly as many blocks as its English original', () => {
    const bad: string[] = []
    for (const k of PLURAL_KEYS) {
      const want = pluralBlocks(EN[k]).length
      const got = pluralBlocks(TR[k]).length
      if (got !== want) bad.push(k + ': en=' + want + ' tr=' + got)
    }
    expect(bad).toEqual([])
  })

  it('the walk reaches 19 keys and 23 blocks', () => {
    // MEASURED, and the reason it is not `blocks >= keys`: three keys carry
    // more than one block, so a counter that stopped at the first block of a
    // multi-block message would still clear a per-key floor.
    expect(PLURAL_KEYS).toHaveLength(19)
    expect(PLURAL_KEYS.reduce((n, k) => n + pluralBlocks(TR[k]).length, 0)).toBe(23)
    expect(PLURAL_KEYS.filter((k) => pluralBlocks(TR[k]).length > 1)).toHaveLength(3)
  })

  it('each plural block has exactly the `one` and `other` arms, and every arm keeps `#`', () => {
    const bad: string[] = []
    for (const k of PLURAL_KEYS) {
      for (const block of pluralBlocks(TR[k])) {
        const arms = pluralArms(block)
        const selectors = arms.map(([s]) => s)
        if (selectors.length !== 2 || !selectors.includes('one') || !selectors.includes('other')) {
          bad.push(k + ': arms ' + selectors.join(','))
        }
        // Turkish does not pluralise a noun after a numeral, so the two arms
        // may read the same — but both must still carry the count.
        for (const [sel, body] of arms) if (!body.includes('#')) bad.push(k + ': `' + sel + '` without #')
      }
    }
    expect(bad).toEqual([])
  })
})

// --------------------------------------------------- node kinds, 8 x 3 shape
describe('the eight node kinds name themselves the same way on every surface', () => {
  const KINDS = ['pool', 'source', 'drain', 'gate', 'converter', 'end', 'parameter', 'register'] as const

  it('palette, canvas and default label agree, kind by kind', () => {
    // This is the contract that survives the Drain decision: it says the three
    // surfaces MATCH, not what the word is.
    const mismatched: string[] = []
    for (const kind of KINDS) {
      const a = TR['palette.' + kind + '.name']
      const b = TR['canvas.nodeKind.' + kind]
      const c = TR['node.default.' + kind]
      if (!(a && b && c && a === b && b === c)) mismatched.push(kind + ': ' + [a, b, c].join(' | '))
    }
    expect(mismatched).toEqual([])
  })

  it('the eight names are distinct', () => {
    const names = KINDS.map((k) => TR['canvas.nodeKind.' + k])
    expect(new Set(names).size).toBe(KINDS.length)
  })

  it('a kind named in PROSE uses the same word as the kind itself', () => {
    // The 8x3 check above covers the three keys that ARE the name. A kind is
    // also named inside running sentences, and those are where a rename leaks:
    // settling Drain on `Yutak` and changing only the three names would leave
    // `Gider` in the tour and in the label-timing warning.
    //
    // The prose keys are DERIVED from English, not listed by hand, so a new
    // sentence that mentions a kind joins this check automatically.
    const EN_NAME: Record<(typeof KINDS)[number], string> = {
      pool: 'Pool',
      source: 'Source',
      drain: 'Drain',
      gate: 'Gate',
      converter: 'Converter',
      end: 'End',
      parameter: 'Parameter',
      register: 'Register',
    }
    const NAME_KEYS = new Set(
      KINDS.flatMap((k) => ['palette.' + k + '.name', 'canvas.nodeKind.' + k, 'node.default.' + k]),
    )
    const missing: string[] = []
    for (const kind of KINDS) {
      const word = TR['canvas.nodeKind.' + kind]
      // `End` is a common English word; require the capitalised node sense and
      // a neighbouring kind name so an ordinary "end" does not match.
      const re = new RegExp('(^|[^A-Za-z])' + EN_NAME[kind] + 's?([^A-Za-z]|$)')
      for (const k of KEYS) {
        if (NAME_KEYS.has(k)) continue
        if (!re.test(EN[k])) continue
        if (kind === 'end' && !/Gate|Converter|Drain/.test(EN[k])) continue
        if (!TR[k].includes(word)) missing.push(kind + ' -> ' + k + ': ' + TR[k])
      }
    }
    expect(missing).toEqual([])
  })
})

// ------------------------------------------------------------------ Register
describe('Register is one term, and never `Kayıt`', () => {
  // DECIDED: `Hesaplanan değer`. `Kayıt` means a record or a registration and
  // would contradict this node's defining property — it stores nothing.
  const REGISTER_TERM = 'Hesaplanan değer'
  const KEYS_NAMING_REGISTER = [
    'palette.register.name',
    'canvas.nodeKind.register',
    'node.default.register',
    'inspector.register.noStore',
    'panels.empty.summary',
    'regExpr.pick.listLabel',
    'regExpr.row.wrongKind',
    'regExpr.insert.hint',
    'regExpr.insert.wrongKind',
    'hint.importFirstCommit.body',
  ]

  it('every key that names it uses the one term', () => {
    const missing = KEYS_NAMING_REGISTER.filter(
      (k) => !TR[k].toLocaleLowerCase('tr').includes(REGISTER_TERM.toLocaleLowerCase('tr')),
    )
    expect(missing).toEqual([])
  })

  it('`Kayıt` appears in none of them', () => {
    const KAYIT = /(^|[^\p{L}])kay[ıi]t/iu
    const bad = KEYS_NAMING_REGISTER.filter((k) => KAYIT.test(TR[k]))
    expect(bad).toEqual([])
  })

  it('the ban is scoped — it is not a global forbidden word', () => {
    // `Kayıtlı çerçeveler` (saved frames) is correct Turkish and must stay
    // legal outside the Register keys.
    const elsewhere = KEYS.filter((k) => !KEYS_NAMING_REGISTER.includes(k) && /kay[ıi]t/i.test(TR[k]))
    expect(elsewhere.length).toBeGreaterThan(0)
  })
})

// --------------------------------------------------------------------- Drain
describe('Drain is `Gider`, and only the node kind is bare `Gider`', () => {
  // DECIDED by the full-catalog second review. `gider` is the one candidate
  // that carries BOTH senses English `Drain` carries: TDK sense 1 is the
  // channel a liquid flows away through, sense 2 is an expense. `Yutak` is the
  // engineering rendering of `Sink`, and English chose the concrete `Drain`
  // over `Sink` on purpose. `Çıkış` was rejected by measurement — it already
  // means the output buffer, in `modules.bufferedStep.blurb` and in the module
  // label overlay (`Çıkış kuyruğu`).
  //
  // The cost of `Gider` is that `gider` is also an ordinary noun, and three
  // template labels use it that way. The measured distinction is CASE plus a
  // modifier: the node kind is always the bare capitalised `Gider`, an expense
  // is always lowercase and modified (`Toplam gider`, `Su gideri`). That is
  // what this section pins, so a future label cannot blur the two.
  const DRAIN_TERM = 'Gider'
  const KEYS_NAMING_DRAIN = [
    'palette.drain.name',
    'canvas.nodeKind.drain',
    'node.default.drain',
    'inspector.labelTiming.warnSourceNotRouter',
    'tour.desktop.pieces.body',
  ]
  // whole word, so `Giderilen` (from `gidermek`, to clear) is not a match
  const BARE = /(^|[^\p{L}])Gider([^\p{L}]|$)/u

  it('the English original of each of these keys mentions Drain', () => {
    // derived, not asserted by hand — a new sentence that names Drain in
    // English and is missed here makes this list wrong and the next test fail
    const derived = KEYS.filter((k) => /(^|[^A-Za-z])Drains?([^A-Za-z]|$)/.test(EN[k]))
    expect(derived.slice().sort()).toEqual(KEYS_NAMING_DRAIN.slice().sort())
  })

  it('every key that names it uses the one term', () => {
    const missing = KEYS_NAMING_DRAIN.filter((k) => !TR[k].includes(DRAIN_TERM))
    expect(missing).toEqual([])
  })

  it('`Yutak` and `Çıkış` appear in none of them', () => {
    const REJECTED = /(^|[^\p{L}])(Yutak|Çıkış)([^\p{L}]|$)/u
    expect(KEYS_NAMING_DRAIN.filter((k) => REJECTED.test(TR[k]))).toEqual([])
  })

  it('bare `Gider` appears nowhere else in the catalog', () => {
    const stray = KEYS.filter((k) => !KEYS_NAMING_DRAIN.includes(k) && BARE.test(TR[k]))
    expect(stray).toEqual([])
  })

  it('no template or module label is a bare `Gider` either', () => {
    const bad: string[] = []
    for (const [tpl, map] of Object.entries({ ...tplTr, ...trFrames })) {
      for (const [id, v] of Object.entries(map)) if (BARE.test(v)) bad.push(tpl + '/' + id + ': ' + v)
    }
    for (const id of ['buffered-step', 'reward-split']) {
      for (const [k, v] of Object.entries(moduleLabelOverlay(id, 'tr') ?? {})) {
        if (BARE.test(v)) bad.push(id + '/' + k + ': ' + v)
      }
    }
    expect(bad).toEqual([])
  })

  it('the ban is on the bare capitalised form, not on the root', () => {
    // `Toplam gider` / `Su gideri` are correct Turkish for an expense and must
    // stay legal — otherwise this section would be a global forbidden word.
    const asExpense = Object.values(tplTr).flatMap((m) =>
      Object.values(m).filter((v) => /\p{L}\s+gider/u.test(v)),
    )
    expect(asExpense.length).toBeGreaterThan(0)
  })
})

// ------------------------------------------------------- a slot takes no suffix
describe('a runtime slot never carries a Turkish suffix', () => {
  // Turkish is agglutinative and the suffix's vowel harmony and buffer
  // consonant both depend on the last sound of the word it attaches to. A slot
  // holds text the user typed, so `{label}i sil` is wrong for half of what a
  // user can type and `{label}'in` only moves the same error behind an
  // apostrophe. The rule is that a CLASSIFIER NOUN takes the suffix instead
  // (`«{label}» çerçevesini`), and this is the invariant that enforces it.
  //
  // A plain slot only — `{n, plural, …}` opens with a comma, so the pattern
  // below cannot match it.
  const SLOT = '\\{\\s*[A-Za-z0-9_]+\\s*\\}'
  // ASCII ', RIGHT SINGLE QUOTATION MARK, MODIFIER LETTER APOSTROPHE — all
  // three are used to attach a Turkish suffix to a name in the wild.
  const APOS = [0x27, 0x2019, 0x02bc].map((c) => String.fromCharCode(c)).join('')
  const DIRECT = new RegExp(SLOT + '\\p{L}', 'u')
  const VIA_APOSTROPHE = new RegExp(SLOT + '[' + APOS + ']\\p{L}', 'u')

  it('no slot is followed directly by a letter', () => {
    expect(KEYS.filter((k) => DIRECT.test(TR[k]))).toEqual([])
  })

  it('no slot is followed by an apostrophe and a letter', () => {
    expect(KEYS.filter((k) => VIA_APOSTROPHE.test(TR[k]))).toEqual([])
  })

  it('the two patterns actually fire — both forms of the mistake are caught', () => {
    // Falsification in the test itself: the guards above only mean something
    // if these are the strings they would have rejected.
    const RSQ = String.fromCharCode(0x2019)
    expect(DIRECT.test('«{label}» çerçevesini sil')).toBe(false)
    expect(DIRECT.test('{label}i sil')).toBe(true)
    expect(DIRECT.test('{label} sil')).toBe(false)
    expect(VIA_APOSTROPHE.test('{label}' + RSQ + 'ın değeri')).toBe(true)
    expect(VIA_APOSTROPHE.test("{label}'in değeri")).toBe(true)
    expect(VIA_APOSTROPHE.test('{label}i sil')).toBe(false)
    // an ICU plural opener is not a slot
    expect(DIRECT.test('{n, plural, one {# düğüm} other {# düğüm}}')).toBe(false)
  })

  it('the catalog really does use slots, so the guards are not vacuous', () => {
    const withSlot = KEYS.filter((k) => new RegExp(SLOT).test(TR[k]))
    expect(withSlot.length).toBeGreaterThan(100)
  })
})

// ------------------------------------------------ parser position vs column
describe('a parser position is a character, a table column is a column', () => {
  const PARSER_KEYS = [
    'error.EXPR_SYNTAX.message',
    'error.EXPR_UNCLOSED_PAREN.message',
    'error.EXPR_UNCLOSED_REF.message',
    'error.EXPR_BAD_ESCAPE.message',
    'error.EXPR_NUMBER_RANGE.message',
    'error.EXPR_BAD_TOKEN.message',
    'import.parseError',
  ]
  const TABLE_KEYS = [
    'import.loc.tableColumnHeader',
    'import.loc.tableRowColumn',
    'import.loc.tableRowColumnHeader',
  ]

  it('the parser messages say `karakter` and never `sütun`', () => {
    for (const k of PARSER_KEYS) {
      expect(TR[k], k).toContain('karakter')
      expect(TR[k].includes('sütun'), k).toBe(false)
    }
  })

  it('the table messages say `sütun` and never `karakter`', () => {
    for (const k of TABLE_KEYS) {
      expect(TR[k], k).toContain('sütun')
      expect(TR[k].includes('karakter'), k).toBe(false)
    }
  })
})
