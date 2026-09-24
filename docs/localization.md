# Localization (non-frozen design doc — DRAFT)

**Status: settled design — implementation pending.** rev 3. Rev 1's direction
was accepted; rev 2 closed the five open questions (Q1 TS-module catalogs +
`satisfies`; Q2 `intl-messageformat`; Q3 user-facing diagnostics only this
cycle; Q4 Toolbar + Play bar as the Slice-1 anchor; Q5 a single
`loop-studio/ui-locale/1` string key) and pinned the catalog loader +
atomic-activation contract; rev 3 pins the four pre-implementation boundaries:
the **fully deterministic locale-decision order** (§L5.2), the **async
activation state machine + race rules** (§L4.5), the **creation-time**
extent of "user data is not translated" (§L3.4), and **catalog / ICU
validation + the slice split** (§L12, §L13).

This is a **non-frozen** design doc — no `loop-*/N`, no `Frozen` marker — and it
merges as *settled design, implementation pending*. Implementation starts from
Slice 1 (§L13) after that merge; nothing in `src/i18n/` and no
`intl-messageformat` dependency lands before it.

A **UI-chrome-only** layer: it changes the *language of the interface*, nothing
the engine computes, nothing that is serialized, and no wire contract. It
carries no `loop-*/N` id and is revised freely (like `docs/visual-language.md`,
`docs/mobile.md`, `docs/edge-routing.md`). §L14 is the decision record; §L12 the
verification set; §L13 the slices; §L15 the scope boundary.

**The project is an _extensible localization base_, not a "KO/EN translation".**
The first two shipped locales are **English** and **Korean**; the structure must
accept a third (`ja`, `de`, `fr`, …) with **no change to existing code or
catalogs — only a new locale file plus one registry line.** Any `if (lang ===
'ko') … else …` two-way branch is a bug.

**Build order:** this design doc → merge (settled design, implementation
pending); then Slice 1 (base + Toolbar/Play bar) → Slice 2a (model surface) →
Slice 2b (app surface) → Slice 3 (acceptance validation); then, on the finished
base, the guided first-run tour and contextual inline help as their own slices
(§L13). **No
locale library, string extraction, or language-switch UI is started before this
doc settles.**

## L0. Why

The app already ships a Korean-speaking audience Share links and a Korean team
works on it, but every label, hint, error, and accessibility name is
English-only. "Onboarding, part 2" needs an i18n base before a guided tour or
inline help can exist in more than one language — and it should be built once,
for N languages, not retrofitted per language.

## L1. The hard boundary — localization is presentation only

A locale switch, at any time, and **adding a locale**, ever, must move
**nothing** in these lists:

- **Engine / result:** `SimState`, the timeline series, `R(t)`, Monte-Carlo
  output, RNG draws, `fired`, `stateEvents` — a run is byte-identical in every
  locale.
- **Serialized bytes:** the GraphDoc, the Workspace payload (`loop-workspace/1`),
  the Share `#g1=` fragment, `proposal` / revision files, the `loop-revision/*`
  content digest.
- **Editor state a spec or test observes:** `simulationRev`, the undo / redo
  stack, the React Flow viewport, selection.
- **Wire identifiers:** `schema` id (`loop-studio/graph`), node `kind`, edge
  `mode` / `route`, the `tool` string, every JSON key in every file format,
  error / diagnostic **codes** (§L3.4).

The **supported-language list is fully decoupled from every product-data
format.** Registering `ja` changes what the UI *can say*, never what any file
*contains*.

## L2. The locale registry

**L2.1 — a registry, not a pair.** `src/i18n/registry.ts` holds an ordered list
of registered locales. `en` and `ko` are simply its first two entries. Every
part of the system that needs "the set of languages" — the switch UI, the
tests, the fallback chain — reads the registry; none of them names `en` / `ko`
literally (except `en` as the designated base, §L3.1).

**L2.2 — per-locale metadata.** Each registry entry is:

```
{
  code:        'en',            // BCP-47 primary subtag; the catalog key
  englishName: 'English',       // for docs / logs
  nativeName:  'English',       // the endonym — the switch UI's primary label,
                                // stable regardless of the active UI language
  direction:   'ltr',           // 'ltr' | 'rtl' — metadata only in v0.8.0 (§L9)
  numberLocale:'en',            // BCP-47 tag for Intl.* when UI-chrome numbers
                                // are formatted (§L8); never touches stored data
  enabled:     true,            // offered in the switch UI; false = registered
                                // but hidden. All shipped locales are true today.
  catalog:     () => import('./locales/en'),   // see L3.3 (static today)
}
```

Adding a language = append one entry + add one `locales/<code>` catalog
(either a single `locales/<code>.ts` file or a `locales/<code>/` folder of
domain slices, §L3.3). No existing file changes.

**L2.3 — the base and fallback locale.** `en` is the **base**: its catalog
defines the canonical key set (§L3.1) and is the **final fallback** for any key
missing from another locale. The fallback chain is `active → en`; there is no
per-region chain in this cycle (`ko-KR` resolves to `ko`, not a `ko-KR` catalog).

**L2.4 — Chinese: the script decides, and no browser sends it.** `zh-Hans`
(简体中文) and `zh-Hant` (繁體中文) both ship from 2026-09-21. Simplified and
Traditional are **separate locales, never a conversion of one another** — the
terminology differs, not only the glyphs (软件 / 軟體, 默认 / 預設), and one
pair is outright **inverted**: a spreadsheet ROW is 行 in Simplified but 列 in
Traditional, where 列 means COLUMN in Simplified and 欄 in Traditional. A
mechanical script conversion of either catalog would silently swap the two
throughout the data-import wizard, which is why neither is ever generated from
the other. The registry code therefore carries
the script subtag, which creates the one gap the ordinary §L5.2 order cannot
close: a browser reports a REGION (`zh-CN`, `zh-TW`, `zh-HK`), the base-subtag
rule looks for a `zh` entry, finds none, and hands a Chinese reader English.
`chineseScript()` sits between the exact match and the base match:

| browser reports | resolves to |
|---|---|
| `zh-Hans`, `zh-Hans-*` | `zh-Hans` |
| `zh-Hant`, `zh-Hant-*` | `zh-Hant` |
| `zh-CN`, `zh-SG`, `zh-MY` | `zh-Hans` |
| `zh-TW`, `zh-HK`, `zh-MO` | `zh-Hant` |
| bare `zh` | `zh-Hans` (the larger population) |

It only ever returns a code the registry actually has; an unregistered target
falls through to the ordinary rules and, ultimately, to English — the guard
that kept Traditional readers on English rather than Simplified before
`zh-Hant` shipped, and that will do the same for the next script that is
mapped before it is registered. A stored value is unaffected: it is still
accepted only when it is exactly a registered code, is never rewritten, and a
value that is not registered (yet, or any more) simply falls through and
recovers on its own.

**`zh-Hant` is Taiwan Traditional.** The catalog follows Taiwan convention
(軟體 · 資料 · 網路 · 專案 · 範本 · 匯入／匯出 · 設定). `zh-HK` and `zh-MO`
resolve to the same catalog: the divergences from Hong Kong usage in this
product's vocabulary are lexical (軟體 / 軟件, 網路 / 網絡, 專案 / 項目,
範本 / 模板) rather than semantic, and no per-region catalog is planned.
**This is not a Hong Kong localisation**, and no claim is made about Hong Kong
usability beyond that the terms are legible.

**L2.5 — the per-locale font contract.** The bundle ships Latin subsets of IBM
Plex only; every CJK glyph comes from a system font, and a downloaded CJK face
would break the offline and portable contracts. The base `--font-sans` ends in
`'Noto Sans KR'`, so a locale whose Han characters must NOT be drawn with
Korean shapes needs a `:lang()` override of the custom property — which every
`font-family: var(--font-sans)` consumer then inherits for free. Measured with
CDP `CSS.getPlatformFontsForNode` on 2026-09-21, identically on the dev server,
the served PWA build and the portable single file:

| `lang` | before | after |
|---|---|---|
| `zh-Hant` | Malgun Gothic × 8 — every glyph Korean | Microsoft JhengHei UI × 8 |
| `zh-Hans` | Microsoft YaHei × 4 + Malgun Gothic × 3 + Noto Sans KR × 1 — wrong **mid-word** | Microsoft YaHei UI × 8 |

Re-measured on 2026-09-21 when `zh-Hant` was registered, with a sample that
also carries Traditional-only Han, the corner brackets 「」 and full-width
punctuation: Microsoft JhengHei UI × 19 on every surface across all three
artefacts, 微軟正黑體 in the `<input>`, all 21 characters resolved, and no
Korean, Japanese or Simplified-only family anywhere.

**L2.5a — the Chinese em dash needs a face of its own.** `'IBM Plex Sans'`
leads both Chinese stacks and it COVERS U+2014, so until 2026-09-21 a LATIN
font drew the Chinese double dash `——` while the Han around it came from the
CJK font. That is not a "different font was picked" quibble; the shape is
wrong. Measured at 22px, identically on the dev server, the served PWA build
and the portable single file:

| | advance | ink | inked runs |
|---|---|---|---|
| `——` on IBM Plex Sans | 34.33 px | 32.75 px | **2** — two short strokes with a gap |
| `——` on the CJK font | 47.53 px | 47.50 px | **1** — one continuous full-width rule |

A Chinese dash occupies one full-width slot per character and the pair joins
into an unbroken line. The Latin em dash is 0.74 em and leaves a visible gap,
so the pair reads as two dashes rather than one. Inside a Han run the same
thing is countable: four inked runs instead of three.

The fix is two `@font-face` rules — `LS CJK Punct SC` and `LS CJK Punct TC`,
separate so one Chinese locale can never borrow the other's dash — each with
`unicode-range: U+2014` and `local()` candidates drawn from the same families
as the stack below it. Each is placed at the FRONT of its `:lang()` stack.

**Why the range is exactly one codepoint.** `unicode-range` is the whole
mechanism: it is what stops the family being consulted for anything else.
Latin letters, digits and code tokens therefore stay on IBM Plex Sans —
`Ag07` measures 52.13 px, `資CSV源` 83.84 px and `資 4900 源` 107.19 px
before and after, with byte-identical font attribution. Leading the stacks
with a whole CJK family instead was measured and rejected: it moves those same
runs to 55.36 / 86.30 / 108.63 px, changing Latin glyphs the UI wants to keep.

**U+201C / U+201D and U+2026 were audited the same way and deliberately left
out.** Neither system font draws them full-width either, so switching would
have bought a ~2 px narrower quote (10.45 → 8.30 px) and an ellipsis that
differs by ≤0.5 px — a different font, not a repaired defect. Every other
Chinese mark in the catalogs (，。、：；？（）／「」) is a full-width codepoint
IBM Plex does not cover, so it already resolved to the CJK font and is
untouched. `·` (U+00B7) and `–` (U+2013) stay on IBM Plex on purpose: the
English source uses the same characters in the same role, and the UI should
read the same in both.

**Contracts.** `en`, `ko` and `ja` never reference these families and are
unchanged; an `<input>` does not inherit `--font-sans` at all (the UA
stylesheet resets it to Arial + the system CJK face), and no affected mark
appears in any placeholder or input value. `src` lists `local()` candidates
only, so no font file is downloaded, nothing is added to the production bundle
or the portable single file, and rendering Chinese costs no extra request. On
a machine where none of the candidates is installed the face contributes
nothing and U+2014 falls straight through to `'IBM Plex Sans'` — exactly the
previous rendering, no tofu. `e2e/cjk-punctuation-font.spec.ts` pins all of
it by measurement (platform font, advance width, and an off-screen canvas scan
that counts the inked runs).

No tofu in either state: the defect is regional-shape substitution, invisible
to a "does it render" check, so the contract is verified against the platform
font and never against `getComputedStyle().fontFamily` (which only echoes the
declared stack) or `document.fonts.check()` (which only says a face *could* be
used). `--font-mono` is a separate variable and stays untouched, and an
`<input>` does not inherit `--font-sans` at all — the UA stylesheet resets it —
so an input is never evidence that the override works.

**L2.6 — descriptive copy wraps by the rules of its own language.** The two
multi-line descriptive surfaces — `.menu__blurb` (menu descriptions, clamped
to two lines) and `.palette-tip__desc` (palette tooltips) — both carried a bare
`word-break: keep-all`. It was added for **Korean**: a particle otherwise
breaks mid-word and strands a single character on the next line, which six of
the eight Korean tooltip descriptions did (measured with a `Range` per
어절, 2026-09-15). The declaration was never scoped, and `keep-all` removes
**every** break opportunity inside a space-less CJK sentence — so Japanese and
Chinese copy could not use its second line at all and spilled sideways
instead. Measured 2026-09-22, before the fix:

| locale | overflowing elements | worst |
|---|---|---|
| `en` | 0 | — |
| `ko` | 0 | — |
| `ja` | **5** | **104 px** |
| `zh-Hans` | 3 | 31 px |
| `zh-Hant` | 2 | 31 px |

The line clamp was never the cause: a 232 px box was holding a 250 px
**single** line with the second line free. The text simply had nowhere legal
to break.

The rule now states what it means — Korean asks for `keep-all`, nobody else
does:

```css
:lang(ko)  :is(.menu__blurb, .palette-tip__desc) { word-break: keep-all; }
:lang(ja)  :is(...), :lang(zh) :is(...)          { word-break: normal; }
@supports (word-break: auto-phrase) {
  :lang(ja) :is(...), :lang(zh) :is(...)         { word-break: auto-phrase; }
}
```

That normal-then-`auto-phrase` shape is the same one `.nodef__title` already
uses (§MML1): plain breaking as the floor, phrase-aware breaking where the
engine ships a line-break dictionary, so Chinese and Japanese break on meaning
units rather than between arbitrary characters. Scoping it this way also means
a future CJK locale is not trapped behind a shared default that was only ever
right for Korean. `:lang(zh)` matches both `zh-Hans` and `zh-Hant` — pinned by
test, since the script subtag must not stop it.

English keeps the initial value: its computed `keep-all` was incidental, not a
contract, and the rendered line count is unchanged (40 before and after).
Korean is unchanged on every axis that matters — `keep-all` still computed, 38
lines, and zero mid-syllable breaks, all measured.
`e2e/descriptive-copy-wrapping.spec.ts` holds the contracts.

**L2.7 — French: two glossary terms split by CONTEXT, not by word.** Most of
the French glossary is a one-to-one substitution. Two are not, and translating
them by word rather than by meaning produces text that is grammatical and
wrong:

| English | French | when |
|---|---|---|
| step | **`pas`** | a SIMULATION timestep — `Pas 12 / 30`, `Pas écoulés`, playback |
| step | **`étape`** | a STAGE of a procedure — a production line's shipment step, a wizard's step |
| spreadsheet | **`feuille de calcul`** | the DOCUMENT the user imports |
| spreadsheet | **`tableur`** | the APPLICATION (Excel, Sheets) that produced it |

`pas` is the unit the engine advances; `étape` is a position in a sequence a
person carries out. Using `étape` for the simulation would tell a French
reader the model has a fixed script, which is the opposite of what a Loop
Studio graph is. `tableur` for the document is the same class of error in the
other direction — it names the software where the sentence means the file.
`données tabulaires` stays available for the abstract shape of the data,
where neither the file nor the app is meant.

**L2.8 — French typography is part of the string, not of the CSS.** French
inserts a space before some punctuation, and that space must not break:

| context | character | example |
|---|---|---|
| before `;` `?` `!` | U+202F NARROW NO-BREAK SPACE | `Charger ce modèle\u202F?` |
| inside `«` `»` | U+202F | `«\u202FFichier ▾\u202F»` |
| before `:` | U+00A0 NO-BREAK SPACE | `remplacé par\u00A0: {name}` |
| between a number and its unit | U+00A0 | `82\u00A0%`, `5\u00A0kg` |
| apostrophe | U+2019 RIGHT SINGLE QUOTATION MARK | `d’entrée`, `l’or` |

These are **codepoints in the catalog**, never a CSS or runtime rule: a
`text-spacing` property cannot know whether a `?` belongs to French prose or
to a code sample, and a runtime pass would have to re-decide on every render.
Two consequences follow:

- a string that is **syntax** — an expression placeholder, a URL, a filename,
  a key path, an operator hint — keeps ASCII throughout. Typesetting a
  `@ref : 2` hint would make the hint wrong.
- an automated check for "an ASCII space before `?`" must use a **literal
  ASCII space**, not `\s`: Python's `\s` and JavaScript's `\s` both match
  U+202F and U+00A0, so the naive pattern reports every correctly typeset
  string as a defect.

`e2e/i18n-fr.spec.ts` reads the replace-template dialog and asserts the exact
codepoints, so a later copy edit cannot quietly downgrade them to ASCII.

**L2.9 — French is ONE localisation, and `fr-CA` is not a second one.** The
registry entry is `fr`, with no script and no region. `fr-FR`, `fr-BE`,
`fr-CH`, `fr-LU` and `fr-CA` all reach it through the ordinary base-subtag
step of the §L5.2 order — French needs none of the script mapping Chinese
does (§L2.4), because there is no script ambiguity to resolve.

Canadian French is deliberately **not** split out. The divergences that would
justify a separate catalog in a consumer product — `courriel` vs `e-mail`,
anglicism tolerance, some UI verbs — are lexical, and this product's
vocabulary is a closed technical glossary (§L2.7) whose terms are the same on
both sides of the Atlantic: `réservoir`, `aiguillage`, `convertisseur`,
`valeur calculée`. A second catalog would double the review surface of every
future string for no semantic gain. If a Canadian reviewer later reports a
term that genuinely misreads there, the answer is a term change in `fr`, or a
`fr-CA` entry at that point — not one held open speculatively now.

One consequence is pinned by test: a stored value of `fr-CA` is **not** a
code. `localStorage` holds a registry `code`, so an unregistered value is
ignored and the browser list decides, exactly as `zh-Hant-XX` already is.

**L2.10 — French length, and where it actually bit.** French runs ~15–20%
longer than English. The surface that could not absorb it was the one with a
hard two-line clamp, `.menu__blurb` (§L2.6). Measured 2026-09-22 on the first
complete French catalog, at the shipped 272 px / 232 px menu widths:

| locale | blurbs over the clamp | worst |
|---|---|---|
| `en` `ko` `ja` `zh-Hans` `zh-Hant` | 0 | — |
| `fr` | **4 of 12** | 3 lines shown as 2 — 17 px cut |

The fix is **the copy, not the box**. Widening the menu was already rejected
on its own merits (the 300 px measurement in `src/index.css`) — an open popover covers the
palette row beneath it, and every extra 40 px hides another chip — and
raising the clamp would relayout all six languages to accommodate one. The
four sentences were shortened until each fit two lines at its real width,
with the meaning kept:

| key | change |
|---|---|
| `templates.equilibrium.blurb` | `produits finis en sortie — une ligne qui se stabilise en quelques pas` → `produits en sortie — stable en quelques pas` |
| `templates.mmoProgression.blurb` | `combien de temps faut-il pour atteindre` → `le temps qu’il faut pour atteindre` |
| `modules.rewardSplit.blurb` | dropped `reçues` |
| `export.projectRevision.blurb` | dropped two articles and `sa` |

The guard is differential rather than absolute: `e2e/i18n-fr.spec.ts` runs the
same sweep in English and in French and fails only on what **French adds**.
That is what makes it trustworthy — a glyph span whose ascender exceeds its
line box reports a 2 px vertical overflow in all six languages, and an
absolute threshold would either flag it forever or be loosened until it
stopped catching real defects.

**L2.11 — `{column}` names two different things, and a translation must tell
them apart.** The placeholder name is an internal contract and never changes;
what it MEANS at each call site does. Ten keys carry it, in two groups:

| group | keys | what `{column}` is |
|---|---|---|
| parser position | the six `error.EXPR_*.message` + `import.parseError` | a **1-based CHARACTER offset** |
| table column | `import.loc.tableColumnHeader`, `import.loc.tableRowColumn`, `import.loc.tableRowColumnHeader` | a **1-based table COLUMN index** |

The first group is character offsets, in the code's own words:

- `src/model/expr/errors.ts` — `ExprParseError` "carries a 1-based `column`
  into the raw text"; `tokenize.ts` computes it as `i + 1` over string
  indices, and `parse.test.ts` pins ``err('@{a\b}').column === 4`` — the
  4th character is the backslash.
- `src/model/csv.ts` — the field's doc comment is "1-based character offset
  within that row"; the scanner does `col++` per character and `col = 1` at
  each newline. `csv.test.ts` pins "the opening quote is the 3rd char of
  line 1".

The second group really is a table column: `DataImportWizard.tsx` passes
`issue.columnIndex + 1` next to that column's own `header`.

English is the origin of the drift — it says "at column {column}" for the
character offsets too, which is defensible in English (a "column" in a text
editor is a character position) but reads as a spreadsheet column in a dialog
that is full of real spreadsheet columns. Rather than reword the base and
churn six catalogs, each locale says what it means in its own terms:

| locale | parser position | table column |
|---|---|---|
| `en` | `at column {column}` (base, unchanged) | `column {column}` |
| `ko` | `{column}번째 문자` | `{column}열` |
| `ja` | `{column}文字目` | `{column}列目` |
| `zh-Hans` | `第 {column} 个字符` | `第 {column} 列` |
| `zh-Hant` | `第 {column} 個字元` | `第 {column} 欄` |
| `fr` | `caractère {column}` | `colonne {column}` |

`fr` and `zh-Hant` already drew the distinction and were the control group;
`ko` / `ja` / `zh-Hans` used their table-column word for both and were
corrected (2026-09-22, 21 strings). `src/i18n/parserLocation.test.ts` holds
both directions — a parser message must carry the character wording and must
not carry the column wording, and `import.loc.*` must keep the column wording
and must not borrow the character one. It also asserts the two groups are
disjoint and together are every `{column}` key, so a new one cannot be added
without being classified.

**For German, when `de` ships:** `Zeichen {column}` where the position sits
next to the thing at it (`„(" an Zeichen {column} wird nie geschlossen`), and
`an Zeichenposition {column}` where the sentence wants a position phrase of
its own (`Syntaxfehler an Zeichenposition {column}`). The CSV message reads
`… in Zeile {line}, Zeichen {column}`. The table-column group takes
`Spalte {column}` — never `Zeichen`.

**L2.11a — the checklist for adding a language.** A catalog is not the whole
job. `zh-Hans`, `zh-Hant` and `fr` each shipped with every catalog gate green
and still inserted bundled modules whose node labels were English, because the
module overlay is a separate data source that nothing tied to the registry
(docs/bundled-module-label-localization.md §MLS4.5). Everything a new locale
needs, in one place:

| # | what | where | enforced by |
|---|---|---|---|
| 1 | registry entry | `src/i18n/registry.ts` | `registry.test.ts` |
| 2 | 5 catalog slices | `src/i18n/locales/<code>/` | `tsc` + `check:i18n` |
| 3 | `language.<name>` in **every** catalog | all `locales/*/ui.ts` | `check:i18n` dead-key guard |
| 4 | Template label dict + `DICT_LOADERS` entry | `templateLabels/<code>.ts`, `dicts.ts` | `check:template-labels` |
| 5 | regenerated known labels | `templateLabels/known.generated.ts` | `gen:known-labels` + `check:template-labels` |
| 6 | **bundled-module overlay** | `src/i18n/moduleLabels.ts` | `moduleLabels.test.ts` (registry-derived) |
| 7 | production locale count + list | `e2e/dist.spec.ts` | `npm run e2e:dist` |
| 8 | dev picker option count **and every earlier locale's spec** | `e2e/i18n.spec.ts` + `e2e/i18n-<code>.spec.ts` | the default e2e run |
| 9 | rendered-string guards | `icuEscaping.test.ts`, `parserLocation.test.ts` | the unit suite |
| 10 | **the English-form marker on the feedback link** | `locales/<code>/ui.ts` — `tour.help.feedback` **and** `tour.help.feedbackAria` | `localeSurfaceCopy.test.ts` (registry-derived, exhaustive) |

Items 6 and 9 are the ones a locale PR forgets, because nothing about writing
a catalog points at them. Each is now derived from the shipped-locale set
rather than listed by hand, so the suite goes red on the omission instead of
the product going half-English.

**Item 10 is a different shape, and `es-419` is what exposed it** (#266,
fixed in #267). The linked feedback form exists only in English, so every
non-English catalog says so inside the link — `영문 양식`, `英語フォーム`,
`英文表单`, `英文表單`, `formulaire en anglais`, `englisches Formular`,
`formulario en inglés` — and `en` says nothing, because `en` **is** the form.
That makes it invisible to every check we had: `check:i18n` compares key sets
and ICU argument shapes, and a translation review reads the catalog against
`en`. A locale that drops the marker matches the English source *perfectly*
and still misinforms its reader. **A rule that lives in the translations and
not in the source needs a test that compares locales to EACH OTHER**, which is
what `src/i18n/localeSurfaceCopy.test.ts` is for. Its marker map is asserted
exhaustive over the registry's translated locales, so language *N+1* fails
until it has decided how it says "English form" and "new tab".

**`pt-PT` is the case that proves the map cannot be inherited.** It is the
same LANGUAGE as `pt-BR`, so the obvious move was to copy its row. That would
have been wrong: a browser tab is a `separador` in Portugal, and `aba` there
is a flap or a brim. A sibling locale of an existing language still has to
decide its own markers — the only row in the map so far that had to differ
from its own language's other row.

The same file holds the other member of that class. Item 3 makes
`check:i18n` prove the `language.<name>` key EXISTS in every catalog; nothing
proves it is *right*, and `es-419` shipped into the Korean picker as
`스페인어(라턴아메리카)` — one stroke off a word that does not exist, in the one
catalog whose readers are least likely to recognise the language being named.
A display name is read by people who do not read the language it names, so it
gets an explicit expectation rather than a shape check.

**Item 8 is the one that bites in the opposite direction**, and `de` proved it
(#262, CI red on the first push). A per-locale spec written at language *N*
records what was true then: `i18n-fr.spec.ts` asserted `de-DE` reaches `en`
("still unregistered — French must not have widened this") and counted 7
picker options. Both were correct when French shipped and both were wrong the
moment German did — **the product was right and the test was stale.** So
language *N+1* must revisit every earlier `i18n-<code>.spec.ts`, not just
`i18n.spec.ts`. Two rules make that cheap:

- an "unregistered" probe tag must be a language **not on the roadmap** — the
  `de` spec uses `nl-NL`, and `i18n-fr.spec.ts` now does too, because picking
  the next language to ship guarantees the row rots;
- the picker option count is written as `<shipped> + the dev pseudo-locale`,
  so a stale number is visible in the comment rather than only in the failure.

The count still lives in three specs by hand. Deriving it from `LOCALES` would
need the runner to import product code, which no e2e file does today; that is
a recorded follow-up, not something this checklist pretends is solved.

**The shipping order, so "not on the roadmap" means something.** Twelve
languages ship today: `en` `ko` `ja` `zh-Hans` `zh-Hant` `fr` `de` `es-419`
`pt-BR` `es-ES` `pt-PT` `ru`. The remaining order, set 2026-09-23, is

> **`tr` -> `th` -> `vi`**, with `pl-PL` and `it-IT` added after them

Three changes are worth recording rather than absorbing silently. `ru` moved
ahead of `th` / `vi`; **`tr` (Turkish) is new** — it appears in no earlier
roadmap, so it is written down here to stop it being dropped again; and
**`pl-PL` and `it-IT` joined the tail**, Polish first on market size and
Italian after it on translation cost. Both mainland variants came directly
after their base locale because each is a regional audit over a finished
catalog rather than a new translation, and because a Spain reader could
already read `es-419` while a Portuguese reader fell all the way to English
until `pt-BR` shipped.

**Both regional-variant probes are now spent.** `es-ES` stopped being a safe
"unregistered" tag in #270 and `pt-PT` stops being one here. The Portuguese
rows that never rot are `pt-AO` / `pt-MZ` / `pt-CV` / `pt-TL`, and
`i18n-pt-br.spec.ts` now uses `pt-AO` for its stored-value probe as well as
its navigator probe — a registered code cannot stand in for an unregistered
stored value.

**Arabic stays out of this line.** It is a separate stage gated on an
RTL-infrastructure audit: the registry carries `direction` and `<html dir>` is
set from it, but no layout, canvas or baseline has ever been exercised RTL.

A probe tag must therefore avoid all of the above. `nl-NL` is still safe;
`pt-PT` is **not** (and `es-ES` stopped being a safe probe the moment it
registered — `i18n-es-419.spec.ts` had asserted it reached `es-419`, and that
row flipped exactly as the file predicted it would) — `i18n-pt-br.spec.ts` uses `pt-AO` / `pt-MZ`
and says in the file which of its rows are expected to flip when `pt-PT`
registers.

**L2.12 — German is ONE catalog, in Germany Standard German, and says so.**
The registry entry is `de`, with no region. `de-DE`, `de-AT`, `de-CH`,
`de-LI`, `de-LU` and every other `de-*` reach it through the ordinary
base-subtag step of the §L5.2 order; German needs no mapping of its own, and
a stored `de-AT` is not a code, so it is ignored like any unregistered value.

The trade-off is stated rather than hidden: **Swiss German does not use `ß`**,
writing `ss` everywhere this catalog writes `ß`, so a `de-CH` reader sees
spelling that is not theirs. Splitting `de-CH` off would not be a mechanical
`ß`→`ss` pass either — the vocabulary diverges too — so it stays one catalog
until someone reports a term that genuinely misreads there.

**German plural is `one` / `other`, and 0 takes `other`.**
`Intl.PluralRules('de')` has exactly two categories, no `many`, and
`select(0)` is `other` — the **opposite** of French, where 0 takes `one`
(§L4.6). So German writes `0 Zeilen`, not `0 Zeile`. All 19 plural messages
are rendered at 0, 1, 2 and 1,000,000 by `parserLocation`-style tests and by
the checkpoint measurement.

**`Schritt` covers both senses of "step".** French needed `pas` for a
simulation timestep and `étape` for a stage of a procedure (§L2.7). German
does not: `Schritt 12 von 30` and `Produktionsschritt` are both idiomatic, and
`Schritt` carries none of the "fixed position in a sequence" connotation that
made `étape` wrong for the engine. Where a procedural sense needs naming, the
compound does it — `Arbeitsschritt`, `Produktionsschritt`.

**The spreadsheet vocabulary splits three ways**, one more than French needed:

| English | German | what it is |
|---|---|---|
| spreadsheet (the file) | **`Tabellenblatt`** | the document the user imports |
| spreadsheet (the app) | **`Tabellenkalkulation`** | Excel, Google Sheets |
| table | **`Tabelle`** | the data table inside the import wizard |

Collapsing any two would make `Tabellenname` ambiguous in a dialog that shows
all three at once.

**Core glossary.** `Speicher` Pool · `Quelle` Source · `Senke` Drain ·
`Verteiler` Gate · `Konverter` Converter · `Ende` End · `Parameter` ·
`Berechneter Wert` Register · `Knoten` node · `Verbindung` connection ·
`Wegpunkt` waypoint · `Gruppenrahmen` group frame · `Linienführung` route ·
`Lauf` run · `Schritt` step · `Auslöser` trigger · `Aktivator` activator ·
`Kapazität` capacity · `Rückstau` backpressure · `Startwert` seed ·
`Verteilung` distribution · `Ausdruck` expression · `Zeitverlauf` timeline ·
`Eigenschaften` Inspector · `Vorlage` template · `Modul` module ·
`Zuordnung` mapping · `Vorschlag` proposal · `Projektstand` project revision ·
`Zeile` row · `Spalte` column · `Zeichen` character position.

`Quelle`/`Senke` is the German flow-theory pair, so the two read as a pair.
`Verteiler` says what a Gate does — `Gatter` would be a logic gate.
`Berechneter Wert` is spelled out rather than compressed to `Rechenwert` so a
first-time reader knows what the node is; `Register` in German means an index
or a ledger and would mislead. `Linienführung` names how a connection is
routed and keeps `Verlauf` free for `Zeitverlauf`. `Projektstand` says "the
project as it stood", which is what the file is; `Projektversion` was rejected
as confusable with the app version.

**Gacha** follows the `fr` ruling: the mechanism names stay in the English
players use — `Pity`, `Hard Pity`, `UP`, and the rarity letters SSR / SR / R
— while the actions and rates are German (`Ziehung`, `Getätigte Ziehungen`,
`Ziehungsrate`). `Trefferquote` was rejected: it reads as an accuracy or
hit-to-miss ratio, not as the chance of drawing a rarity.

**Style.** Impersonal or infinitive wherever it reads naturally
(`Vorlage laden`, `Modul einfügen`), formal `Sie`/`Ihr` when a sentence needs
a subject, never `du`. German noun capitalisation only — English Title Case is
not copied. Quotation marks are `„…“`. Numbers, decimals and units come from
the locale formatter (`numberLocale: 'de'` → `1.234.567,89`), never hardcoded
into a string. Compounds are written naturally; where one does not fit, the
SENTENCE is shortened rather than the compound hyphenated.

**Fonts need no work.** ä ö ü Ä Ö Ü ß all resolve from the bundled IBM Plex
Sans Latin subset — measured 7/7 glyphs with `CSS.getPlatformFontsForNode` in
dev, in the production bundle and in the portable single file, with zero
third-party font requests in all three. No `@font-face` and no
`unicode-range` work, unlike Chinese (§L2.5a).

**The bundled-module overlay (§L2.11a item 6) takes the dict word three times
and refuses it three times.** `Verarbeitung` / `Versand` / `Ausschuss` come
straight from the production-line Template dict, and `Eingangspuffer` /
`Ausgangspuffer` are the exact words the German module blurb already uses.
The three refusals are the interesting ones:

| node | German | why not the obvious word |
|---|---|---|
| `planned_run` | `Geplante Produktion` | `Lauf` is the app's own word for a simulation run, so `Geplanter Lauf` would read as a scheduled run |
| `savings` | `Ersparnisse` | the blurb's `Sparen` is an infinitive inside a verb phrase; a Pool holds a stock, so it needs the noun. `Sparziel` keeps the stem |
| `supply` | `Nachschub` | the dict's `Materialnachschub` asserts the contents are material, and the bundled module is generic |

`Abhebungen` for `withdrawals` is the German banking usage, the same
reasoning that gave `zh-Hant` its `提領`.

**L2.13 — Spanish is `es-419`, and it is the first locale whose CODE is not
its own base subtag.** Every earlier Latin locale (`fr`, `de`) was reached by
the ordinary base-subtag step because its code *was* the subtag a browser
sends. No browser sends `es-419`: it sends `es-MX`, `es-AR`, `es`, `es-ES`.
Registering `es-419` and nothing else therefore hands **every** Spanish reader
English — and, through `navigator.languages`, sometimes an unrelated language
that merely sits later in their list. Measured before the fix, with the real
resolver: all fourteen probed Spanish tags returned `en`, and
`["es-MX", "de-DE"]` returned `de`.

So the registry gained **`baseFallbackFor`** and §L5.2 gained a fourth step.
See §L5.2 for the order and the three structural guards.

**One catalog, and the code says which one.** `es-ES` and `es-GQ` land here
too. Peninsular and Latin American Spanish are mutually intelligible — a Spain
reader sees `computadora` and `ustedes` where they would write `ordenador` and
`vosotros`, which is a stated trade-off, not a hidden one, and English would be
strictly worse. Naming the code `es-419` rather than a bare `es` is what keeps
that honest: the picker reads `Español (Latinoamérica)`, so a Spain reader
knows what they are getting, and a later `es-ES` can be registered **without
renaming this locale or migrating anyone's stored value** — step 1 gives it
its own tag automatically.

**Plural is `one` / `other` / `many`, and 0 takes `other`.** Same shape as
French, same zero as German. `many` IS reachable — `select(1_000_000)` returns
it — so every one of the 19 plural messages writes an **explicit `many` arm
even where it matches `other`**: leaving it out would be a silent gap rather
than a decision. All 19 were rendered at 0, 1, 2 and 1,000,000 with the real
formatter.

**Numbers follow the code, not the majority.** `Intl.NumberFormat('es-419')`
gives `1,234,567.89` and `83%`. Latin America is **not** uniform here —
Argentina, Colombia, Chile and Peru write `1.234.567,89`, and between them
they outnumber Mexico. The formatter still stays `es-419`, because a catalog
registered under that code must not quietly format under a different one; the
divergence is recorded here rather than papered over with `numberLocale: 'es'`.

**The spreadsheet vocabulary splits four ways**, one more than German:

| English | Spanish | what it is |
|---|---|---|
| spreadsheet (the file) | **`archivo de hoja de cálculo`** | what the user exports |
| spreadsheet (the sheet) | **`hoja de cálculo`** / `hoja` | the sheet itself |
| spreadsheet (the app) | **`aplicación de hojas de cálculo`** | Excel, Google Sheets |
| table | **`tabla`** | the rows and columns once imported |

Microsoft's own Spanish Excel documentation draws the same line — `libro` for
the workbook, `hoja de cálculo` for a sheet inside it, `fila` / `columna` for
the structure — so this is the vocabulary a reader already has.

**`paso` and `etapa` split by context.** `paso` is the simulation timestep and
its commands (`Avanzar un paso`, `paso 12`); `etapa` is a stage of a
production process (`Etapa de producción con búferes`). German needed only
`Schritt`; Spanish reads wrong if a production stage is called a `paso`.

**Core glossary.** `Depósito` Pool · `Fuente` Source · `Sumidero` Drain ·
`Distribuidor` Gate · `Convertidor` Converter · `Fin` End · `Parámetro` ·
`Valor calculado` Register · `grafo` graph · `nodo` node · `conexión`
connection · `Trazado`
route · `ejecución` run · `paso` step · `disparador` trigger · `activador`
activator · `capacidad` capacity · `Contrapresión` backpressure · `semilla`
seed · `Línea de tiempo` timeline · `Propiedades` Inspector · `plantilla`
template · `módulo` module · `Estado del proyecto` project revision · `fila`
row · `columna` column · `carácter` character position.

`Fuente`/`Sumidero` is the Spanish flow-theory pair. `Distribuidor` says what
a Gate does, where `Compuerta` is also the word for a logic gate. `Valor
calculado` is spelled out rather than `Registro`, which in Spanish means a
record or a ledger and would mislead — the same trap German avoided with
`Register`. `Propiedades` over `Inspector`: the surface edits the properties
of the current selection, which is how Unity's own Spanish manual describes an
inspector window.

**§L2.11 is honoured**: a parser position is `carácter {column}`, a real table
column is `columna {column}`, and the two never borrow each other's word.

**Style.** Neutral Latin American Spanish: `ustedes`, never `vosotros`.
Impersonal infinitives for commands (`Cargar plantilla`, `Insertar módulo`),
which sidesteps the `tú`/`usted` choice entirely; `usted` where a sentence
needs a subject. Sentence case, never English Title Case. `¿` and `¡` opening
marks. Quotation marks are `“…”`. Numbers and units come from the formatter,
never hardcoded. Code, ids, file extensions and key names stay verbatim.
`ordenador`, `fichero` and `coger` are avoided as peninsular; **`móvil` is
not** — it is ordinary in Latin America, and `dispositivo móvil` is used where
a sentence would otherwise be ambiguous.

**Gacha** follows the `fr` and `de` ruling: the mechanism names stay in the
English players use — `Pity`, `Hard Pity`, `UP`, and the rarity letters
SSR / SR / R — while the actions and rates are Spanish (`Tirada` for both a
roll and a pull, `Tiradas realizadas`, `Tasa de aciertos` for *hit rate* —
the rate of hits, not the rate of pulls).

**Fonts needed no work.** `¿ ¡ ñ Ñ á í ó ú` are all Latin-1 Supplement, the
same block `fr` and `de` already proved, and the bundled IBM Plex Sans Latin
subset carries no `unicode-range` restriction. Measured all the same, in dev,
the production bundle and the portable single file.

**A second pass read all 840 strings against `en` alone**, with no other
translation in view, and changed 78 of them, plus 31 of the bundled-Template
node labels. Five of its findings are rules, not one-off wordings:

- **The graph is `el grafo`, never `el gráfico`.** The same catalog needs
  `gráficos` for English *charts* (`import.qs.notImported.list`), and this
  product has both a node graph and timeline charts — one word cannot carry
  both. `gráfico` also made `Al archivo de gráfico le faltan sus nodos` read
  as *the chart file is missing its nodes*. 29 strings moved.
- **One quotation style.** `en` mixes `“…”` and `"…"`, and the first draft
  inherited the mix, curling the quotes around UI labels and leaving them
  straight around interpolated values. Both are user-facing prose here, so
  every one is now `“…”`.
- **Spanish agrees where English does not.** `'{n} hidden'` is fine at
  `n = 1`; `'{n} ocultos'` renders `1 ocultos`. The obvious repair — wrap it
  in a plural — is **refused by `check:i18n`**, which requires the ICU argument
  shape to match `en` (a plain slot cannot become a plural). The fix is an
  invariable phrase, `{n} sin mostrar`. Any locale with adjective agreement
  will hit this class of gap on a base key that has no plural.
- **Watch the words a term collides with in Spanish, not in English.**
  `seguidos` for *tracked* reads first as *consecutive*; `Equipo` for *Staff*
  reads as *equipment* in a roastery; `nombre propio` is a *proper noun*, not
  a custom name; `procesos` for Web Workers claimed OS processes. All four
  parse fine and all four say something else.
- **Read a label in the box it is rendered into, not in the catalog.**
  `dist.ended` is `Ended` in English and sits in front of a figure the
  component supplies: `{label} <b>43%</b>`. English gets away with a bare
  participle there; Spanish needs agreement *and* a colon, so the label is
  `Finalizadas:` — feminine plural, because what ended is `ejecuciones`, and
  the sparkline caption right below shows the same number the other way round
  (`43% finalizadas`) and now uses the same word. Measured in the real row at
  0 %, 43 % and 100 %: no overflow, 78–92 px. The `%` is glued to the figure
  by the component, and `Intl.NumberFormat('es-419', {style: 'percent'})`
  agrees — `83%`, no space — so the catalog does not add one.

The wording fixes with a measurement behind them: `templates.equilibrium.blurb`
was re-written from a noun-phrase list into an action sentence and re-measured
in the real 272 px box (line-height 16.875, clamp 2) — **2 lines, 0 px of
overflow**, menu not widened, clamp not raised.

**`src/i18n/es419Copy.test.ts` holds the mechanical half of that review** so it
cannot rot — control characters, newline parity with `en`, `{name}` slot
parity, markup tags, `¿` on every question and `¡` on every exclamation (0
today, so the rule is asserted over the empty set and the count is pinned).

**Each of its guards is scoped to where the word would actually be wrong.** A
catalog-wide banned-word list is the wrong instrument: it would forbid
`registro` for a *log*, `puntuación` for *punctuation*, `gráfico` for a
*chart* — all of which this product may legitimately need later.

| guard | scope | why |
|---|---|---|
| `vosotros` `vuestro` `ordenador` `fichero` `coger` | **global** | no surface in this product makes an Iberian form right |
| `piscina` `compuerta` `desagüe` `registro` | **only where `en` names that node kind** | outside that surface each word has an ordinary, correct meaning |
| `cartera` `reintegro` `puntuación` | **only the three ruled labels** | asserted as equalities on `wallet`, `withdrawals` and `gear_score` |
| `grafo` vs `gráfico` | **decided per key by the English source** | `en` says *graph* or it says *chart*; the format name `Graph JSON` is stripped first |
| node-kind glossary | **derived from `en`** | if English names a kind, Spanish must use the glossary term — so a new string is covered the day it is written |

`Source` and `End` are deliberately **not** derived: English uses *source* for
an edge endpoint (`origen`) and *end* for the end of a phase, so those two rest
on the central contract — the three keys that NAME each of the eight kinds.

**The English allowlist is scoped the same way.** Tokens that are obvious
anywhere (`Loop Studio`, `Graph JSON`, `CSV`, `Monte Carlo`, and the
Spanish/English homographs like `material`, `normal`, `local`) are allowed
globally. Everything else is pinned to **the exact keys that own it**: the
sample CSV's headers (`item` `name` `price` `drop` `rate`) to
`import.qs.mapping`, the resource-type tokens (`Gold` `Energy` `XP` `Player`
`Item`) to `inspector.resourceType.placeholder`, the gacha vocabulary
(`gacha` `banner` `pity`) to the gacha Template's two keys, and so on. A
global token list would have hidden an untranslated sentence elsewhere;
the scoped one catches it — verified by leaving `import.qs.result` in English
and watching the guard name `Number`, `Parameters`, `columns`, `rows`.
The raw wire edge kind is checked separately: `inspector.edge.kindLink` must
keep the `{kind}` slot and must never hardcode `resource` or `state`.

`móvil` is on none of these lists, deliberately.

**No Latin American native-speaker or professional translation review was
performed.** The low-confidence terms are listed in the PR body rather than
hidden.

**L2.14 — Brazilian Portuguese is `pt-BR`, the second locale to own a base
subtag, and the first whose PLURAL rules differ from its own mainland
variant.** Shipped as the ninth language. What it decided, and why.

**The resolver.** Like `es-419`, the code is not its own base subtag: a browser
sends `pt`, `pt-BR`, `pt-PT`, `pt-AO`. Measured with the real
`resolveInitialLocale` before the entry existed, all of `pt`, `pt-BR`, `pt-PT`,
`pt-AO`, `pt-MZ`, `pt-CV`, `pt-GW`, `pt-ST`, `pt-TL`, `pt-MO` resolved to `en`
— and two multi-tag lists resolved to an unrelated language outright:
`["pt-AO","de-DE"]` gave **German** and `["pt","es-MX"]` gave **Spanish**. The
entry therefore declares `baseFallbackFor: 'pt'` (§L5.2 step 4). No resolver
code changed; the field and the per-TAG walk already existed for `es-419`.

**`pt-PT` USED TO land here too, and that trade-off was bigger than the
Spanish one.** European Portuguese differs in vocabulary (`ficheiro` /
`guardar` / `partilhar` / `carácter`) *and* in grammar: CLDR gives `pt-BR`
**0 -> `one`** and `pt-PT` **0 -> `other`**, so a Portugal reader saw a plural
form their own variant would not use. Brazilian Portuguese was still far closer
to them than English, which was the only other option at the time.

**That trade-off is now closed:** `pt-PT` shipped as its own locale (§L2.16),
and registering it made §L5.2 step 1 (exact code) win its own tag with no
resolver change, exactly as predicted here and exactly as `es-ES` did beside
`es-419`. The `pt-PT` row in `e2e/i18n-pt-br.spec.ts` flipped by design; the
rows that never rot are `pt-AO`, `pt-MZ`, `pt-CV` and `pt-TL`, and that spec's
stored-value probe moved to `pt-AO` as well, because a registered code cannot
stand in for an unregistered stored value.

One prediction in this section did NOT survive contact: `ecrã` was listed
above as a European word this catalog lacks. It is — but it is not the
European word for anything `pt-BR` says `tela` for. Every one of those keys
renders English `canvas`, not `screen`, so `pt-PT` keeps `tela` too (§L2.16).

**Plural: `one` / `other` / `many`, with 0 in `one`.** Measured in node and in
the production Chromium runtime, identically. That is the FRENCH shape, the
opposite of `es-419` and `de`, so copying the Spanish plural arms would have
mis-rendered every zero. `many` is reachable at 1e6, and Portuguese puts `de`
before the noun there — `1.000.000 de linhas` — so all 19 plural keys write an
explicit `many` arm. The inverse constraint also applies: `check:i18n` requires
the ICU argument shape to match `en`, so a key whose base has a plain `{n}`
slot cannot be given a plural. `canvas.filter.hiddenCount` and
`regExpr.pick.more` are therefore invariable phrases.

**Numbers: `1.234.567,89`.** The first shipped locale whose decimal separator
is a comma and whose group separator is a period. This turned out to be a much
smaller risk than it looks, and the audit is worth not repeating: the product
has **no `Intl.NumberFormat` call site at all** (§L8 leaves `numberLocale` for
strings that read wrong, and none have), so the only live number path is ICU
`#`, which takes the locale CODE and renders integer counts — the group
separator can appear, the decimal separator cannot. A user-typed number goes
through `<input type="number">`, whose `.value` is always the standard `.`
form, and the CSV rule (`dataImportValidate.ts`) explicitly rejects a thousands
separator. The expression grammar's `.` is product syntax and is unchanged
(§L8: never reformat stored, digested or canonical content).

**Glossary, and the one term that had to be an anglicism.** Pool
`Reservatório` (not `depósito`, which in Brazil is also a bank deposit and
would collide with the reward-split module's `Carteira` / `Poupança`), Source
`Fonte`, Drain `Sumidouro` (the standard Portuguese term for a flow-network
SINK; `ralo` and `escoadouro` are plumbing), Gate `Distribuidor`, Converter
`Conversor`, End `Fim`, Parameter `Parâmetro`, Register `Valor calculado`.

A group frame is a `quadro`: the product defines one as "a labelled box that
groups nodes on the canvas", which is what Miro's Brazilian UI calls a
`quadro`. `moldura` is a picture frame in Portuguese and would name the border
rather than the grouping; `área` and `grupo` are already taken by this
feature's own default labels. The canvas is the `tela`, which is unambiguous
here because the English catalog never says "screen".

**A Template is a `template`, deliberately not a `modelo`.** `Modelo` is the
standard Brazilian word for a document template — and `modelo` is already this
product's word for the simulation MODEL, in 10 keys and 14 occurrences ("run
the model", "a v2 model", "model versions"). One word for both would make
`modules.promote.*` read as though loading a Template changed the model
version. It is an ordinary common noun, not a proper name: `Template` /
`Templates` only where UI context capitalises the first word, `template` /
`templates` inside a sentence.

**`Register` has ONE Portuguese surface.** English shows `Register` /
`Registers` on exactly **10 keys** (3 that name the kind, 7 prose); `Computed
value` is **not** an English UI string anywhere in the catalog. All 10 read
`Valor calculado` / `Valores calculados`. `Registrador` is never used —
`registro` stays free for its ordinary log / record senses, and nothing bans it
elsewhere.

**Guard scope — the rule that keeps being relearned.** A word is rejected only
where it would be wrong. `src/i18n/ptBrCopy.test.ts` splits them:

| scope | forms |
|---|---|
| **global** (never right in Brazil) | `ficheiro` · `ecrã` · `utilizador` · `carácter` · `registo` · `telemóvel` · `planeado` |
| **parser character-offset keys only** | `caráter` — ordinary Brazilian for a nature or quality (`de caráter permanente`) |
| **keys where English says stock / inventory** | `existências` — also the plain plural of `existência` |
| **keys where English says team / staff** | `equipa` — also the third person of `equipar`, which this product uses |
| **never banned** | `registro`, `guardar` — `palette.pool.description` legitimately says "Guarda recursos" |

The parser key list is derived from `en` (the `error.EXPR_*` and
`import.parseError` keys carrying `{column}`) and its size is asserted, so it
cannot drift from §L2.11's 7-and-3 split.

**Two defects the guards caught that no other gate could.**

1. **A Cyrillic letter inside a Portuguese word.** `import.error.notLoopStudio`
   shipped `Isto не parece…` — U+043D U+0435 where `não` belongs. `tsc`,
   oxlint and `check:i18n` all accept it: it is a valid string. The guard is a
   **Unicode Script** check over the `pt-BR` RUNTIME data (catalog, template
   labels, module overlay and the registry's display fields), allowing only
   `Latin`, `Common` and `Inherited`. It is a cross-script contamination
   contract, NOT a homoglyph detector — a Latin look-alike is `Script=Latin`
   and passes. Scanning source FILES was tried first and abandoned: the moment
   `known.generated.ts` was regenerated it held every locale's labels and
   reported 3,780 "violations".
2. **The guard's own tokenizer inventing English.** `[A-Za-z]+` cuts a
   Portuguese word at every accent, so `até` yielded `at`, `Papéis` yielded
   `is`, `início` yielded `in` and `orçamento` yielded `or` — 219 false
   positives. The word pattern is now `\p{Script=Latin}` plus combining marks,
   and the English-residue list drops every Portuguese homograph (`a`, `no`,
   `for`, `converter`, `remove`).

**Measured overflow: 3 blurbs, fixed by wording.** In the real 272 px
`.menu__blurb` box (line-height 16.875, clamp 2, max height 34 px),
`templates.equilibrium.blurb`, `templates.coffeeRoastery.blurb` and
`modules.rewardSplit.blurb` each needed a third line. Candidates were measured
in that box rather than estimated — Portuguese does not fit where Spanish does
at the same character count — and the chosen wordings land at 2 lines with
`ovY = 0` while keeping every beat of the English. The full shipped-locale
sweep is then 0.

**The second review changed 29 strings**, none of them in the template-label
dictionary or the module overlay. Five were gender/number agreement that
`{label}` and `{name}` make structurally impossible — a frame called `Área 1`
rendered as `Área 1 movido`, and `Parênteses` as `Parênteses inserido` — and
were fixed by choosing a phrasing that needs no agreement at all. One was a
term collision the guards could not see: the mobile timeline sheet had been
called an `aba`, which is this catalog's word for a BROWSER tab and the marker
`localeSurfaceCopy.test.ts` looks for. One was a dangling `de` in a `many` arm
with no noun after it (`… e mais # de`) — the plural rule applied mechanically
where it does not hold.

**No Brazilian native-speaker or professional translation review was
performed.** The low-confidence terms are listed in the PR body rather than
hidden. Three items stay open and are stated rather than buried:

1. `completion` is `Progresso` in the MMO template and `conclusão` in the
   gacha one. English uses one word; the two templates mean different things
   (progress toward the level goal vs the run finishing), so the split is
   deliberate — but it wants a native reader's confirmation.
2. `drop` and `loot` are kept in English in the MMO template, as the Brazilian
   game-design register uses them. Scoped to that template's keys.
3. `workers` in `mc.cost.parallel` stays English: it names Web Workers.


**L2.15 — Spain Spanish is `es-ES`, and it is the first locale that is a REGION
AUDIT rather than a translation.** Shipped as the tenth language, over the
finished `es-419` catalog. **38 strings differ out of 1,064** (842 catalog +
203 template labels + 19 module labels). That number is the point: a locale
that mostly agrees with its sibling is the correct outcome, not an unfinished
one, and nothing was changed to make the difference look larger.

**The resolver needed no new machinery.** Unlike `es-419` and `pt-BR`, this
code IS a tag browsers send, so it declares **no `baseFallbackFor`**. §L5.2
step 1 (exact code) runs before step 4 (base owner), which is exactly the
property the `es-419` work asserted against a hypothetical registry — that
test now runs against the real entry, and the prediction held.

| navigator | resolves to |
|---|---|
| `es-ES`, `ES-es` | **`es-ES`** |
| `es`, `es-419`, `es-MX`, `es-AR`, `es-CO`, `es-CL`, `es-PE`, `es-US` | `es-419` |
| **`es-GQ`** | `es-419` — see below |
| `ca-ES`, `eu-ES`, `gl-ES` | `en` (Catalan, Basque and Galician are not Spanish) |

**`es-GQ` stays with `es-419`, and that is a stated trade-off.** Equatorial
Guinea's usage is historically closer to Spain, so the tempting move is to
point it here. Nothing in this catalog is written for it either way, and
re-pointing it would be a guess dressed up as a decision — it is left where it
already resolved, and written down so the next person finds a choice rather
than an oversight.

**What differs, in full.**

| area | n | what |
|---|---|---|
| catalog | 4 | the device is an `ordenador`, not a `computadora` |
| catalog | 8 | you `pulsa` a key or button (`presionar` is Latin American); the same four a11y strings relabel the Enter key **`Intro`**, which is what a Spanish keyboard is printed with |
| catalog | 2 | you `escribes` into a field; `ingresar` is Latin American |
| catalog | 16 | you `anades` something — `agregar` reads Latin American |
| catalog | 2 | a NO-BREAK SPACE before the percent sign |
| template labels | 1 | `Puntuación de equipo` — `puntuación` is the Iberian score, `puntaje` the Latin American one |
| template labels | 2 | `suministro` for supply; `abasto` survives in Spain mainly in the idiom `no dar abasto` |
| template labels | 1 | a business forecast is a `previsión`, not a `pronóstico` |
| module labels | 2 | `Cartera` for a wallet and `Retiradas` for withdrawals — both were flagged as deliberate regional markers when `es-419` shipped |

**What deliberately does NOT differ**, and why each was considered and left:

- **the `usted` register.** Spain uses `usted` for software too. Switching to
  `vosotros` would be a change of tone, not a correction, and the catalog's
  impersonal and infinitive command forms are natural in both. `esEsCopy.test.ts`
  asserts no `tú` or `vosotros` form reaches any surface, so a later edit
  cannot mix registers on one screen by accident.
- **`archivo`.** Entirely natural in Spain; `fichero` is not required, and
  forcing it would be regional display, not translation.
- **`coger`.** Deliberately not introduced. `es419Copy.test.ts` bans it for
  Latin America because it is vulgar there — that is not a reason to add it
  here, where the UI idiom is `seleccionar` / `elegir` anyway.
- **the whole node-kind glossary**, and `Botín`, `Tirada`, `Vender al
  mercader`, `Tickets`, `Merma`, `Reveses`: identical in both.

**The percent gap is a NO-BREAK SPACE (U+00A0), on two keys.**
`Intl.NumberFormat('es-ES')` emits one before the sign and `es-419` emits
none — the Latin American catalog wrote `Monte Carlo {pct}%` precisely to
match its own formatter, so Spain has to move with its own. The two keys are
`playbar.mc.progress` and `runbar.mc.cancel`. Everything else that shows a `%`
is left alone: `inspector.edge.flowPlaceholder`'s `25%` is what a USER types,
and `import.issue.invalid-number` names the SYMBOL.

The character is invisible in review, so it is pinned three ways and never
written as an escape: `esEsCopy.test.ts` asserts the code point before `%` is
160 and that no ordinary space is used, that exactly those two strings contain
it, and `e2e/i18n-es-es.spec.ts` renders the string into a deliberately narrow
box and reads per-character line boxes — the text wraps, and the number and
the `%` stay on the same line. The accessible-name string is checked for the
same gap.

**Two Spanish locales, two guards, neither banning the other's word.**
`es419Copy.test.ts` is untouched and still pins `Puntaje de equipo`;
`esEsCopy.test.ts` pins `Puntuación de equipo` and asserts the `es-419` value
alongside it, so the split is visible from either side. `esEsCopy.test.ts`
also asserts the delta LISTS themselves — which catalog keys, which template
labels, which module labels differ — so a future edit that quietly diverges
the two catalogs has to say so.

**What the independent second review added, and how it found it.** The first
pass screened for a candidate list of Latin American words and found 12
catalog strings. The second pass did something different: it extracted the
LEADING WORD of all 842 values (390 distinct) and read the vocabulary itself.
That found three groups the first pass could not:

1. **`Presione` at the start of a sentence** — four a11y strings. The first
   screen was case-SENSITIVE, so sentence-initial forms never appeared in it.
2. **`Entrar` for the Enter key**, in those same four strings. Keyboard key
   names were not on the candidate list at all; a Spanish keyboard is printed
   `Intro`.
3. **`agregar` in sixteen strings** — the largest single group in the locale,
   and simply absent from the candidate list. Spain says `anadir`.

The lesson is recorded because it generalises: a candidate-word screen finds
what you already suspected, and a region audit needs at least one pass that
reads the locale's own vocabulary back to you.

`esEsCopy.test.ts` asserts the resulting delta LISTS — which catalog keys,
which template labels, which module labels differ — so a later edit that
quietly diverges the two Spanish catalogs has to say so in the diff.

**No Spain native-speaker or professional translation review was performed.**
Two items stay open rather than being smoothed over: `tomar cualquiera` /
`tomar todo` for the flow modes (understood in Spain, but `extraer` may be the
more idiomatic UI verb there — not a regional error, so it was left), and
`Vender al mercader` (a fantasy register that reads the same in both).

**A coverage gap this work closed.** `icuEscaping.test.ts` (§L2.11a item 9)
keeps a hand-written `CATALOGS` map, because its rendering has to be
synchronous while the registry's catalogs are lazy `import()` chunks. That
made it the one item-9 guard a locale could join the product without: **`pt-BR`
shipped in #268 and was simply absent from it**, so its ICU quoting and plural
fallback went unchecked. Adding it showed no defect — a coverage gap, not a
bug — and the map is now asserted **exhaustive over the registry**, which
caught `es-ES` immediately on its first run.

**L2.16 — European Portuguese is `pt-PT`, the second REGION AUDIT, and the
first one where the two catalogs differ in GRAMMAR.** Shipped as the eleventh
language, over the finished `pt-BR` catalog. **191 strings differ out of
1,065** (843 catalog + 203 template labels + 19 module labels): 162 catalog,
24 template labels, 5 module labels. Five times what `es-ES` moved, and that
is the finding rather than a failure of restraint — European and Brazilian
Portuguese diverge further than Spain and Latin America do.

**The resolver needed no new machinery, again.** Like `es-ES` and unlike
`es-419` / `pt-BR`, this code IS a tag browsers send, so it declares **no
`baseFallbackFor`**: §L5.2 step 1 (exact code) runs before step 4 (base
owner), so `pt-BR` keeps owning `pt`. Measured with the real resolver before
the entry existed and again after:

| navigator tag | resolves to |
|---|---|
| `pt-PT`, `PT-pt`, `pt-pt` | **`pt-PT`** |
| `pt`, `pt-BR`, `pt-AO`, `pt-MZ`, `pt-CV`, `pt-GW`, `pt-ST`, `pt-TL`, `pt-MO`, `pt-CH`, `pt-LU` | `pt-BR` |
| `pt-Latn-PT`, `pt-PT-u-ca-gregory` | `pt-BR` — see the limit below |

**A known resolver limit, recorded rather than fixed here.** A tag carrying a
SCRIPT or an EXTENSION subtag misses step 1 and falls to the base owner.
BCP 47 permits both and `navigator.languages` returns BCP 47 tags, so this is
not "a tag no browser sends" — it is a normalisation the resolver does not do.
`es-ES` has the identical limit. Fixing it means changing tag matching for
every locale at once, which does not belong in a locale PR; `registry.test.ts`
and `i18n-pt-pt.spec.ts` both pin the current behaviour so the next reader
finds a decision instead of a surprise.

**§L5.1 stays deliberately stricter than §L5.2.** `pt-pt` as a NAVIGATOR tag
reaches `pt-PT` because step 1 lowercases both sides; as a STORED value it
does not, because a stored value is matched exactly with no case repair. Both
directions are asserted.

### What differs

| area | n | what |
|---|---|---|
| catalog | 41 | a file is a `ficheiro`, not an `arquivo` |
| catalog | 24 | a connection is a `ligação`, not a `conexão` |
| catalog | 16 | spreadsheets: `folha de cálculo`, not `planilha` |
| catalog | 14 | sharing is `partilhar`, not `compartilhar` |
| catalog | 13 | saving is `guardar`, not `salvar` |
| catalog | 10 | you `prima`/`premir` a key, not `pressione`/`pressionar` |
| catalog | 8 | the parser offset is a `carácter`, not a `caractere` |
| catalog | 7 | deleting is `eliminar`, not `excluir` |
| catalog | 21 | the address register — see below |
| catalog | 15 | progressive aspect — see below |
| catalog | rest | `separador` (browser tab) not `aba`; `existências` not `estoque`; `controlo` not `controle`; `aplicação` not `aplicativo`; `transferir` not `baixar`; `gerir`/`gestão` not `gerenciar`; `contacto` not `contato`; `detetar` not `detectar`; `por isso` not `então`; `num`/`numa` contractions; the article before a possessive |
| template labels | 24 | `Existências` · `Equipa` · `planeado` · `online` · `treino` · `reparação` · `preparação` · `procura` · `encomendas` · `por grosso` · `retalho` |
| module labels | 5 | `Receção` · `Produção planeada` · `Levantamentos` · `Património líquido` · `Progresso até à meta` |

**The two that are not vocabulary.**

- **Address register.** `pt-BR` speaks to `você` in 21 strings. European
  Portuguese software does not; it uses an infinitive, an impersonal
  construction or a null-subject third person. `tu` and `vós` are **not** the
  European alternative and are never introduced — `ptPtCopy.test.ts` bans all
  three, so a later edit cannot mix registers on one screen.
- **Progressive aspect.** Brazilian `estar + GERUND` becomes European
  `estar a + INFINITIVE` — `está a bloquear`, `não estão a ser guardadas`,
  `estava a editar`. 15 occurrences across 12 keys. Standalone gerunds were
  judged one at a time rather than swept: `a carregar…` and `a estimar…` moved,
  `incluindo` did not.

### What deliberately does NOT differ

- **`tela`.** The candidate-word screen proposed `ecrã`; the meaning check
  rejected it. All 24 of those keys render English **`canvas`**, not
  **`screen`** — `ecrã` is a physical display, so applying it would have been a
  mistranslation dressed up as a regionalisation. The test asserts the
  REJECTION, key by key against the English original, so a later well-meaning
  sweep cannot quietly apply it. **This is not the same as proving `tela` is
  the best word for Portugal** — it stays on the native-review list (open item
  1), against `área de desenho` and the English `canvas`.
- **the node-kind glossary** — `Reservatório` · `Fonte` · `Sumidouro` ·
  `Distribuidor` · `Conversor` · `Fim` · `Parâmetro` · `Valor calculado`. None
  of the eight is regional.
- **`quadro`** for a group frame. `moldura` was rejected during the `pt-BR`
  audit as the wrong word and is not reintroduced; it stays on the
  native-review list.
- **`template`.** Kept for the same non-regional reason as `pt-BR`: `modelo` is
  already this product's word for the simulation MODEL in 10 keys.
- **`Carteira`.** Unlike the Spanish pair, there is no wallet split — Portugal
  and Brazil both say `Carteira`, so nothing moves.
- **the percent strings.** MEASURED: `Intl.NumberFormat('pt-PT')` emits `84%`
  with **no** space, exactly as `pt-BR` does. Unlike `es-ES`, this locale adds
  no NO-BREAK SPACE to any string.

### Two measured behaviours, and where each one comes from

**Plural at zero.** CLDR gives `pt-BR` 0 → `one` and `pt-PT` 0 → `other`:
"0 linha" against "0 linhas". Both keep the same three categories
(`one` / `many` / `other`), so **no key gains or loses an arm** — only the
selection moves. All 19 plural keys already carried `many`, which Portuguese
reaches at 1e6 and writes with `de` before the noun.

**The group separator is a NO-BREAK SPACE.** `pt-PT` groups with U+00A0
(`1 234 567`) where `pt-BR` uses a period (`1.234.567`), and CLDR's
`minimumGroupingDigits: 2` means a bare `1000` carries no separator at all.
Nothing calls `Intl.NumberFormat` (§L8); the live path is ICU `#`, which
delegates to exactly that formatter with the locale CODE. So this locale's
NBSP reaches the DOM **from the formatter, never from the catalog** — and
`ptPtCopy.test.ts` asserts the catalog contains none, which is the opposite of
the contract `es-ES` needed.

**An honest limit on how far that is tested.** No product surface can show a
four-digit count today: every `#` key counts nodes, rows or tables, and
reaching 1000 of any of them is not a state a spec can set up cheaply. The
e2e therefore renders the same formatter the ICU path uses, in the same page,
for the live `<html lang>`, and reads the result back out of the DOM. It does
not claim to exercise a product call site, and it says so.

### The method, and the same lesson twice

The candidate-word screen found the first four groups. Reading the catalog's
**leading word back** — 412 distinct words over 843 values — found
`compartilhar` (14 strings), which was not on the list at all. That is the
`es-ES` lesson repeating.

It then repeated a **second** time on a surface small enough to feel safe. The
template labels — **203 slots: 196 node labels + 7 frame titles** — had been
screened for the same candidate list and looked done at 10 deltas; reading
their 206 distinct words back found seven more groups — `treino`,
`reparação`, `preparação`, `procura`, `encomendas`, `por grosso`, `retalho` —
and took the count to 24. **A small surface does not earn an exemption from
the vocabulary read-back.**

### How the delta is pinned

`ptPtCopy.test.ts` pins the count (162 / 24 / 5) plus two DIRECTIONAL
contracts, rather than a hand-written list of 162 key names: nothing Brazilian
survives in `pt-PT`, and every `pt-BR` string carrying a Brazilian marker
actually changed. A flat list would restate the count without proving either.
`ptBrCopy.test.ts` is untouched.

### Open items

**No Portugal native-speaker or professional translation review was
performed.** Five items stay open rather than smoothed over:

1. **`tela` for the canvas.** Rejecting `ecrã` is well founded — those keys
   render `canvas`, not `screen`, so `ecrã` would be a mistranslation. But
   ruling out the wrong word does not prove the remaining one is the **best**
   word. `tela`, `área de desenho` and the English `canvas` are all plausible
   in Portugal, and which reads most naturally there is exactly the kind of
   question this audit cannot answer from the outside. The guard pins the
   rejection of `ecrã`, not the superiority of `tela`.
2. `quadro` for a group frame — kept from `pt-BR`, where `moldura` was
   rejected as the wrong word.
3. `Rolagem` for a loot roll — used in both, but a Portuguese designer may say
   `sorteio`.
4. `Receção` for goods intake in the module overlay — `Recebimento` is
   understood but is not what a Portuguese warehouse screen says.
5. `drop` / `loot`, kept in English exactly as `pt-BR` keeps them because the
   game-design register is the same on both sides of the Atlantic.

**L2.17 — Russian is `ru`, the first Cyrillic catalog and the first four-arm
plural.** Shipped as the twelfth language, translated from `en` rather than
audited over a sibling. **844 keys**, plus 203 template-label slots and 19
module labels.

**The resolver got SIMPLER, not harder.** `ru` IS its own base subtag, so
§L5.2 step 3 (a registered code that IS the base subtag) carries every `ru-*`
tag and no `baseFallbackFor` is needed. Measured with the real resolver before
the entry existed:

| navigator tag | resolves to |
|---|---|
| `ru`, `ru-RU`, `ru-BY`, `ru-KZ`, `ru-KG`, `ru-MD`, `ru-UA`, `RU-ru`, `ru-ru` | **`ru`** |
| **`ru-Cyrl`, `ru-Cyrl-RU`, `ru-RU-u-ca-gregory`** | **`ru`** |
| `uk`, `be`, `bg`, `kk`, `sr`, `mk` | `en` — not Russian, not captured |

**That third row is the interesting one.** §L2.15 and §L2.16 both record a
known limit: a tag carrying a script or extension subtag misses `es-ES` /
`pt-PT` and falls to the base owner. `ru` does not have that limit, and the
reason is worth stating because the two cases look identical from outside: the
limit only exists for a locale whose CODE IS NOT ITS OWN BASE SUBTAG. Those
can only be reached by step 1, which matches the whole tag; `ru` is reached by
step 3, which splits on the first subtag and therefore ignores everything
after it. Nothing was changed in the resolver to get this.

§L5.1 stays stricter than §L5.2: `ru-RU` as a NAVIGATOR tag reaches `ru`, but
as a STORED value it is not a registered code and is ignored outright.

### Plural: four arms, and `other` is unreachable from an integer

`Intl.PluralRules('ru')` has `one` / `few` / `many` / `other`. Measured:

| n | 0 | 1 | 2 | 5 | 11 | 20 | 21 | 22 | 25 | 101 | 111 | 1e6 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| | many | one | few | many | many | many | **one** | **few** | many | **one** | many | many |

Two consequences that shaped every one of the 19 plural keys.

**`one` is not "one".** It selects 1, 21, 101 and 1 000 001. An arm that spelled
the numeral out — `one {одна строка}` — would render "21 одна строка". Every
arm keeps `#`, and `ruCopy.test.ts` asserts it arm by arm.

**`other` is unreachable from a non-negative integer.** Sweeping 0..3000 plus
1e6 reaches only `one`, `few` and `many`. It is kept because ICU requires it
and because a DECIMAL reaches it (`1.5` → `other`), so its wording is the
decimal-agreeing form and not a copy of `few`. This is the first locale where
an arm that can never render in today's product still had to be written
correctly.

### Numbers: U+00A0 twice over

MEASURED: `Intl.NumberFormat('ru')` groups with a NO-BREAK SPACE and uses a
comma for the decimal mark — `1 234 567,89` — and `{style:'percent'}` puts
U+00A0 before the sign (`84 %`).

So this locale needs **both** halves of what the earlier ones needed
separately: the formatter's grouping character, like `pt-PT`, AND the two
`{pct}` catalog strings carrying U+00A0, like `es-ES`. Unlike `pt-PT`, a bare
`1000` does keep its separator. The character is never written as an escape;
the guard asserts the code point before `%` is 160 and that exactly two
strings contain it.

### Script: what the check catches, and what it cannot

The catalog is Cyrillic plus `Script=Common` / `Inherited`. Two limits are
recorded rather than implied:

1. **A script check cannot tell Russian from another Cyrillic language.**
   Ukrainian `ї`, Belarusian `ў`, Serbian `ђ` and Bulgarian text are all
   `Script=Cyrillic` and would pass. So there is a SECOND check against the
   Russian alphabet by name, which rejects them.
2. **Homoglyphs are invisible.** `а е о р с у х А В Е К М Н О Р С Т У Х` are
   identical in shape to their Latin counterparts. A Cyrillic `С` inside `CSV`
   or a Latin `a` inside a Russian word cannot be seen. So Latin runs are
   compared as EXACT strings against the English source of the SAME key: a
   homoglyph changes the bytes and fails.

**The Latin allowlist is derived, not written.** An early attempt listed 47
tokens by hand (`CSV`, `JSON`, `Enter`, `p50`, `item_id`, `Machinations.io`,
`Alex`, …) after measuring what `ko`, `ja` and `zh-Hans` — already non-Latin —
all keep. That list was thrown away: the rule that actually holds is *a Latin
run may stay only where the English original of that key contains the same
run*, which needs no list, cannot rot, and is what shipped. A separate check
catches the complement — a value that is all Latin and no Cyrillic is an
untranslated sentence even if every token appears in `en`.

### The font was already wrong, and the fix had two traps

The app imported only `@fontsource/ibm-plex-sans/latin-400.css` and its 600
sibling. Those files declare the family with **no `unicode-range` at all**, so
the browser considered `IBM Plex Sans` a candidate for every code point —
including Cyrillic — while the woff2 behind it carried only Latin glyphs.
Measured on production before the change: `document.fonts.check(…, 'Привет')`
returned true and Cyrillic rendered 617.25px against 633.89px for the bare
system stack. The family claimed the glyphs; the engine then fell back **per
glyph** to whatever the OS had. Same class as the `:lang(ja)` Han-unification
defect.

Two traps, both measured:

1. **Adding `cyrillic-400.css` does not work.** It declares the same family,
   weight and style, also with no `unicode-range`, so the last rule wins for
   every code point — importing it after the Latin file moves Latin onto a
   Cyrillic-only woff2 and breaks the whole UI. The per-subset files cannot be
   combined.
2. **The combined `400.css` / `600.css` carry correct ranges but pull greek,
   vietnamese, latin-ext and cyrillic-ext too** — built and counted at 13 woff2
   files / 208 KB against today's 3 / ~60 KB, every one of which the PWA
   precache glob would then precache.

So `index.css` declares two faces itself, with the range fontsource uses for
its own `cyrillic` subset (`U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1,
U+2116` — it covers `ё` and `№`), sourced from the subset woff2. `cyrillic-ext`
is historic and Slavic-extended and is deliberately excluded. Result: **5 woff2
/ 96 KB, +29.2 KB**, and a production-build measurement confirming Latin still
comes from Plex (352.66 vs 363.05 system) while Cyrillic now does too
(708.25 vs 732.22 at 400, 729.75 vs 773.67 at 600).

### `ё` was a search defect too, and it was measured before it was fixed

The same letter the font work had to cover turned out to break the language
picker. MEASURED on `foldForSearch` before any change:

| fold input | fold output | |
|---|---|---|
| `ё` (U+0451) | U+0451 | |
| `е` (U+0435) | U+0435 | **not equal** |
| `Ё` (U+0401) | U+0451 | case folds, spelling does not |

So the two were different strings. That matters for exactly one row, and the
row is not the Russian one: `ru` is `Русский` / `Russian` / `ru`, none of which
carries `ё`, so Russian was always findable. The entry that was not findable is
**Simplified Chinese**, which the Russian UI spells `Китайский (упрощённый)` —
typing `упрощенный`, which is how the word is normally typed, returned nothing.
It was the only one of the twelve `language.*` values in the `ru` catalog with
`ё` in it.

The fix is in §L5.5 item 3 and is one letter wide. It was falsified twice: with
the rule removed the two new tests go red, and with it widened to all Cyrillic
the `й`/`и` guard and the untouched-Cyrillic test go red instead. The contract
is pinned in both places it can break — `languageOptions.test.ts` on the
predicate, and `e2e/i18n-ru.spec.ts` against the real picker, where the e2e case
first asserts the row really is spelled with `ё` so the search assertion cannot
pass for the wrong reason.

### Three blurbs did not fit, and the budget is a measurement not a rule

The shipped-locale sweep in `descriptive-copy-wrapping.spec.ts` caught three
`.menu__blurb` values at three lines in a two-line clamp: `templates.equilibrium`,
`modules.rewardSplit` and `export.projectRevision`. Russian is wider per
character than the Romance catalogs, and the English source fits at 95
characters where Russian did not fit at 91. The budget was read off the ru
blurbs that already passed — the longest is `templates.deadlock` at 79
characters — and the three were rewritten to 71, 60 and 61. Nothing was
loosened; the box is the same box every other locale passes in.

### Decisions, and what stays open

| item | decision |
|---|---|
| node kinds | `Накопитель` · `Источник` · `Сток` · `Распределитель` · `Преобразователь` · `Конец` · `Параметр` · `Вычисляемое значение`. **`Регистр` is never used** — it reads as a CPU register, and in another sense as letter case |
| keyboard keys | Latin keycaps kept: `Enter`, `Space`, `Delete`, `Backspace`, `Esc`, `Shift`, `Alt`, `Ctrl`, `Cmd+Z`. A Russian keyboard is printed with them, and `ko` / `ja` / `zh` make the same call |
| `ё` | written where the standard spelling has it, not flattened to `е` |
| register | impersonal or infinitive first; lowercase polite `вы` where a sentence must address the reader. `ты` / `твой` never introduced, and a capitalised mid-sentence `Вы` is rejected |
| Template / model | `Шаблон` and `Модель`. Russian has two words and neither is taken, so the anglicism the Romance catalogs had to keep is not needed here |

**`ё` is pinned, not automated.** Nothing can prove a catalog spells every
ё-word correctly without a dictionary. What the guard pins is the EXPLICIT
LIST of the 36 words that carry it today, so flattening one shows up in the
diff and has to be argued for. That is a smaller claim than "the catalog is
checked", and it is the true one.

### The read-back, and a second review that changed nothing

The vocabulary read-back was run twice, separately — 844 catalog values (429
distinct leading words, 1 394 distinct words) and 203 template-label slots (95
leading, 187 distinct) — because §L2.16 recorded that skipping it on the
smaller surface is exactly how seven groups were missed there.

A concept-consistency pass then asked whether one English term had picked up
two Russian words. Five splits were flagged and **all five turned out to be
driven by the English source**, so nothing was changed:

- `связь` (27) vs `соединение` (1) — the one is `Connection point`, a place
  where things join, not the edge object;
- `выполнение` / `прогон` / `запуск` — execution, one Monte-Carlo run, and
  `view & run`'s imperative, three different English senses;
- `шаг` vs `этап` — the simulation timestep vs a production stage, the same
  split `etapa` / `passo` makes in the Romance catalogs;
- `метка` vs `подпись` — the Label field vs `a device-local label attached to
  the file`, which is a signature;
- `выражение` vs `формула` — `regExpr.op.inserts` renders English `formula`.

**That pass finding nothing was a measurement of the pass, not of the
catalog.** A vocabulary read-back and a concept-consistency screen both ask one
question — *has one English term picked up two Russian words* — and Russian
breaks in ways that question cannot see. A second, grammatical pass over all
844 pairs, reading the English beside the Russian, found **28 defects across
28 keys**, and a quote convention that needed applying to 12 more.

### The grammar pass, and the seven things it asked

| dimension | found |
|---|---|
| case government after a preposition or a governing noun | 12 |
| a slot whose gender or number is unknown | 2 |
| a transitive verb left without an object | 4 |
| a count with no agreement (`{n} столбцов` is wrong for 2–4) | 4 |
| term and style agreement between button, title and description | 3 |
| meaning dropped or blurred against the English | 3 |
| quote convention (separate from the 28) | 12 keys |
| aspect (perfective vs imperfective imperative) | 0 |
| `вы` register | 0 |

**The biggest group has one shape: a slot cannot inflect.** `{label}`,
`{name}`, `{header}`, `{param}` and `{table}` carry user text, so any Russian
that governs a case around them is wrong — `Значение {label}` needs the
genitive, `поток через {param}` the accusative, `создаст цикл с {name}` the
instrumental. All 39 slot occurrences were listed with the word on each side
and read one by one; ten needed the fix, and the fix is the standard one:
**guillemets license the nominative**, so `Значение «{label}»` is correct for
any label. Where a nominative classifier noun already precedes the slot —
`Таблица {table}`, `Рамка {label}` — nothing is needed, and that is why the
rule is stated as a condition rather than applied everywhere.

**Two arms that could never agree.** `import.summary` read
`будет создано {parameters, plural, …}`, with the verb OUTSIDE the block, so
the `one` arm rendered `будет создано 1 Параметр` — neuter verb, masculine
noun. The sibling key `import.placement.framePerTableResult` already put its
verb inside the arms; that is what made the defect visible. `regExpr.op.
inserted` was `{name} вставлен`, and `{name}` can be `Скобки` (plural) or an
infinitive, so it became `Вставлено: {name}`.

**Three counts had no plural block, and could not be given one.** `check:i18n`
requires the argument KIND to match `en` (§L12 #2), so a locale cannot turn a
plain `{n}` into a plural where English does not need one. German, French and
Spanish never hit this because their plural is uniform; Russian needs
`столбца` for 2–4 and `столбцов` for 5+. The answer is to reword so the number
never governs a noun: `отмечено больше одного столбца ({n})`, `ячеек: {actual}`,
`предел таблиц: {max}`. The third one was not hypothetical — `DI_TABLES_MAX`
is 64, so `предел в 64 таблиц` was always wrong.

**Quotes.** Russian quotes with « », and the catalog already did in 16 places
while 12 others kept the ASCII quotes of the English source. `fr` quotes the
same keys with « », `ja` with 「」 and `zh` with “ ”, so the convention is
per-locale and the mixture was simply a gap. The three parser messages keep
their `“ ”` deliberately: they quote a literal syntax character and they carry
ICU apostrophe escapes (§L4.1) that are not worth disturbing for typography.

**Two dimensions came back clean, and that is a result too.** Aspect is
principled throughout: imperfective only where the action is durative
(`тяните`, `Удерживайте Alt`, `продолжайте вводить`, and the tour bodies that
describe habitual work), perfective for every one-off command. And a
mechanical check — *same English value, different Russian value* — returned
four groups, all of them senses English merges and Russian must split:
`Import` as a menu noun vs a button verb, `Add` as a hunk action vs the `+`
operator, and `Label` as a node's caption vs a spreadsheet column's role.

### The second coverage gap of the same shape

`parserLocation.test.ts` is the other item-9 guard with a hand-written
`CATALOGS` map, for the same reason: `render()` is synchronous and the
registry's catalogs are lazy chunks. The gap `icuEscaping.test.ts` closed for
`pt-BR` (§L2.15) was still open here, and this was measured rather than
assumed — **with `ru`'s import, its `CATALOGS` entry and its `VOCAB` row all
removed, `tsc -b` exits 0 and the file passes 23/23.**

The type system does not help, and it is worth saying why, because the map
*looks* type-checked: `VOCAB` is keyed on `Exclude<Loc, 'en'>` and `Loc` is
`keyof typeof CATALOGS`, so a locale absent from `CATALOGS` is also absent
from the type it would have to satisfy. Every test in the file then iterates
`LOCS`, which is derived from that same map, so a missing locale is not a
failure — it is simply not tested.

Both maps are now asserted exhaustive over the registry, `CATALOGS` including
the base locale and `VOCAB` excluding it, plus an assertion that `LOCS` really
is the full set. Removing `ru` again turns those two green tests red.

### Open items

**No Russian native-speaker or professional translation review was performed.**
Six items stay open rather than smoothed over:

1. the node-kind glossary, especially `Распределитель` and `Преобразователь` —
   both are long and both press on the node box;
2. `ё` spelling across the 36 pinned words;
3. `Гарант` vs the kept English `Pity` / `Hard pity` in the gacha Template;
4. `дроп` / `лут`, kept as the Russian game-design register uses them;
5. `Кошелёк` / `Снятия` / `Приёмка` in the module overlay;
6. whether `вы` should appear at all, or every such sentence be rewritten
   impersonally. The grammar pass counted them: **9 keys**, every one a
   sentence where English distinguishes the reader's side from the other
   party's — *your* graph against the module file, *your* changes against the
   collaborator's, `yours` against `theirs` — and all lowercase. That is why
   they survived; a native reviewer may still prefer full impersonality.

**L2.18 — Turkish is `tr`, the first locale to put the percent sign FIRST and
the first agglutinative one.** Shipped as the thirteenth language, translated
from `en`. **845 keys** (the 844 of v0.13.0 plus `language.turkish`), plus 203
template-label slots and 19 module labels.

**Counting, stated once so it is not re-derived three ways.** Each of the
twelve existing locale dicts carries **203** slots; the new `tr` dict carries
**203**; after registration all **thirteen** carry the same **196 nodes + 7
frames**, derived from `examples/*.json` and checked by
`check:template-labels` for every locale including `tr`.

### The resolver, again simpler than the region pairs

`tr` IS its own base subtag, so §L5.2 step 3 carries every `tr-*` tag and no
`baseFallbackFor` is needed — the same shape as `ru`. MEASURED before the
entry existed, when every one of these fell to `en`:

| navigator tag | resolves to |
|---|---|
| `tr`, `tr-TR`, `tr-CY`, `tr-Latn`, `tr-Latn-TR`, `tr-TR-u-ca-gregory`, `TR-tr` | **`tr`** |
| `az`, `az-Latn`, `kk`, `uz` | `en` — close, but different languages |

A STORED value stays stricter: only the exact code `tr` is registered, so a
stored `tr-TR` is ignored and the app opens in English.

### The percent sign comes first, and nothing sits between

MEASURED: `Intl.NumberFormat('tr', {style:'percent'}).format(0.84)` is
`%84` — `U+0025 U+0038 U+0034`. Numbers group with a PERIOD and take a comma
decimal mark (`1.234.567,89`). There is no no-break space anywhere in this
catalog.

Every other shipped locale puts the sign after the number, four of them with
U+00A0. That made the old guard — "this catalog has U+00A0 before `%` in
exactly two keys", repeated inside `esEsCopy`, `ptPtCopy` and `ruCopy` — unable
to express Turkish at all, so it was replaced by `percentContract.test.ts`: a
registry-derived map of `{position, gap}` per locale, asserted exhaustive, then
checked against `Intl` itself and against the two catalog strings.

**That generalisation found a real defect in two shipped locales.** `fr` and
`de` had a PLAIN space between `{pct}` and `%` while their own formatters
produce U+00A0, so the number and the sign could land on different lines. Four
characters fixed it. `e2e/percent-affix.spec.ts` now measures the rendered
result rather than the string: it forces a wrap in a 58px box and asserts, by
client rect, that the digit and the sign stay on one line for `fr` / `de` /
`es-ES` / `ru`, and that `tr` puts the sign immediately before the number with
no space of any kind.

An earlier draft of the shared contract also pinned how many catalog values
carry U+00A0 anywhere. That tied a percent test to French punctuation — `fr`
sets a no-break space in ordinary prose (27 keys today) and a NARROW one
(U+202F) before `: ; ! ?` (64 keys) — so one new French sentence would have
failed it. A whole-catalog character budget, where a locale wants one, belongs
in that locale's own copy test.

### Plural has two arms, and both carry the same noun

`Intl.PluralRules('tr')` has `one` and `other`; 1 is `one` and everything
else measured (0, 2, 5, 11, 21, 100, 1.5, 1e6) is `other`. The ICU shape is
therefore identical to English.

The trap is in the words, not the shape: **Turkish does not pluralise a noun
after a numeral** — `3 satır`, never `3 satırlar` — so the two arms of a
counted message usually read the SAME. That looks like a copy-paste slip and
is not one. `trCopy.test.ts` pins what actually matters: both arms exist, and
every arm keeps `#`.

### The font was broken for Turkish before Turkish existed

Same class as the Cyrillic defect, found the same way. The app imports only
`@fontsource/ibm-plex-sans/latin-400.css` and its 600 sibling; those declare
the family with **no `unicode-range`**, so the browser treats IBM Plex Sans as
a candidate for every code point while the woff2 carries the `latin` subset
only. Measured at 64px over 20 repetitions, three ways — the Plex stack, the
system stack, and a deliberately absent family that forces the fallback:

| | before | after |
|---|---|---|
| `Ç ö ü` (Latin-1), dotless `ı` | Plex | Plex |
| **`İ` `Ş` `ş` `Ğ` `ğ`** | **byte-identical to the forced fallback** | **Plex** |

`document.fonts.check()` answered **true for all five** both before and after,
which is why the width comparison is the method and the check is not.

The fix declares two faces in `index.css` over
`U+011E-011F, U+0130, U+015E-015F`, sourced from the `latin-ext` subset woff2.
The fontsource `latin-ext` CSS is not imported, for the same reason its
`cyrillic` sibling is not: it redeclares the same family with no range and the
last such rule wins for every code point.

**That range is a measurement of today's content, not an invariant.**
Enumerating every code point outside the `latin` subset across the 13
catalogs, the template labels and the module overlay currently yields exactly
those five, all Turkish. Polish alone would add U+0104-0107, U+0118-0119,
U+0141-0144, U+015A-015B and U+0179-017C; when a locale like that arrives,
re-run the enumeration rather than assuming five.

Cost, measured against the same tree with the faces removed: **+32,838 bytes
(+32.1 KB)**, woff2 files 5 → 7. Both files land in `dist`, both are in the
PWA precache manifest, and both are inlined as base64 in the portable
single-file build.

**On the pixel baselines.** This change IS a visual change — a Turkish UI and
two new font faces both alter what the product paints. The baselines did not
move anyway, and the reason is a property of the baseline set rather than of
the change: **0 of the 52 baseline scenarios changed**, because none of them
renders a Turkish string, none contains a character in the new
`U+011E-011F, U+0130, U+015E-015F` range, and none captures the language
picker in its open state. A scenario that did any of those three would have
to be re-baselined, so this is a fact to re-check when adding one, not a
guarantee that a locale never moves pixels.

### `ı` folds to `i` for SEARCH, and for nothing else

MEASURED: `İ` already folded to `i` (it decomposes to `I` plus a combining
dot, which the Latin-mark rule drops), but `ı` has no decomposition, so with
the UI in Turkish the French row — `Fransızca` — could not be reached by
typing `fransizca`. That was the only failing case; `Ç ç Ö ö Ü ü` already fold.

The fix is one character wide and search-only. It is deliberately NOT
`toLocaleLowerCase('tr')`, which would also map `I` to `ı` and break every
other language's search. Turkish treats `ı` and `i` as different letters — the
same reason `й` is not folded to `и` for Russian — so nothing here changes
rendering, stored values or a catalog string.

### A slot cannot take a suffix

Turkish is agglutinative: a case suffix attaches to the word, and its vowel
harmony and buffer consonant both depend on the last sound of that word. A
slot carrying user text is unknown at authoring time, so `{label}'i sil` would
be wrong for half the labels a user can type.

The rule applied is that a CLASSIFIER NOUN takes the suffix instead, chosen
per slot kind and never globally: `«{label}» çerçevesini` for a frame,
`«{name}» düğümüne` for a node, `«{label}» parametresinin` for a parameter,
`«{header}» sütununun` for a column, `«{table}» tablosunun` for a table.

**The contract is two invariants, and neither is a count:**

1. no slot is followed directly by a letter (`{label}i`);
2. no slot is followed by an apostrophe and a letter (`{label}'in`,
   `{label}’ın`).

`trCopy.test.ts` fails on either form, and falsifies both inside the test so
the guards cannot go quietly vacuous.

As a MEASUREMENT OF THIS AUDIT — a description of today's catalog, not a
budget and not something to keep in step — the catalog held 182 plain slots
across 127 keys, 67 of them followed by a word, and 0 violations of either
invariant. Those three numbers will move with any new string; the two
invariants will not. An earlier draft quoted 59 slot occurrences of which 38
were mid-sentence, which could not be re-derived under any stated definition
and is the reason this section now states what it counted.

### What the guards lock, and what they deliberately do not

`trCopy.test.ts` holds the contracts a search cannot:

- **cross-script**, at runtime, over the catalog AND the template labels AND
  the module overlay — the `pt-BR` lesson, where one Cyrillic letter passed
  every gate that read the file;
- **the alphabet**: Turkish has no `q`, `w` or `x`, so a word carrying one
  must be a token the English value of the SAME key also contains. ICU slot
  names and plural keywords are stripped from both sides first, but **each
  arm's sentence is not** — an earlier version stripped whole `{...}` groups
  and a `qwerty` injected inside a plural arm passed;
- **untranslated values**: the set identical to English must be exactly the
  declared fourteen, all product names, placeholders or symbol-only strings;
- **the node kinds**, as a shape rather than a spelling: the three surfaces
  that name a kind must agree with each other, AND every prose key whose
  English mentions that kind must use the same word. The prose keys are
  derived from English, so a new sentence joins the check by itself;
- **Drain is `Gider`**, on the five keys derived from the English originals
  that name Drain, with `Yutak` and `Çıkış` refused there — and bare
  capitalised `Gider` banned everywhere else, in the catalog and in the
  template and module overlays, so an expense label can never read as the
  node kind (see below);
- **a slot never carries a suffix**, neither attached directly (`{label}i`)
  nor behind an apostrophe (`{label}'in`, `{label}’ın`). Both patterns are
  falsified inside the test itself, and a third assertion keeps the guards
  from going vacuous if the catalog ever stopped using slots.

One thing is deliberately NOT locked, because it is not decided: `«»` as the
quotation mark.

### Open items

**No Turkish native-speaker or professional translation review was performed.**

1. **`Kaynak` is both `Source` and `resource`.** That ambiguity is Turkish's
   own and was not worked around with an invented term. The one sentence that
   would have read "Kaynak … kaynaklar" is `palette.source.description`, and
   it drops the subject — which is also what `fr`, `de` and `ru` do there,
   since the palette shows the name directly above the description.
2. **`Dağıtıcı`** for Gate — `Kapı` is the literal word and names a door.
3. **`«»`** as the quotation mark: whether it reads naturally in the
   accessibility strings and what a screen reader does with the guillemets at
   its default punctuation level, which was NOT measured here. The system
   itself is consistent and was audited: 34 keys use `«»`, 29 of them around
   a runtime slot and 5 around a static label that matches a real product or
   external string exactly; `“ ”` appears only in the three
   expression-grammar keys, byte-identical to English; there are no ASCII
   double quotes, and the only ASCII apostrophes are the two ICU escapes.
4. **`Pity` / `Hard pity` / `Pickup`** kept in English in the gacha Template,
   and `drop` / `loot` kept as the Turkish game-design register uses them.
   The blurb agrees with the labels: `templates.gachaBannerZones.blurb` says
   `pity`, the way `es-419` and `pt-BR` do, rather than translating it.
5. **`Hesaplanan değer`** for Register is decided — `Kayıt` is refused in
   those ten keys and legal everywhere else — but its length against the node
   box is worth a look.

### The second review

The first pass shipped a catalog that every gate accepted. A second pass read
all **845 en↔tr pairs in order** — not a term search, because the `ru` arc had
already shown that a vocabulary screen measures the screen rather than the
catalog — and every suspicion was then checked against the other twelve
locales. That check killed four of the findings: `Play` / `Replay` diverging
at the root (`ru` does the same), `iş parçacığı` for `workers` (so do `es`,
`ru` and `zh`), `Ad` for the `Label` column role (so do `fr`, `de` and `ru`),
and `kendi adınız` for `a custom name` (so does `ru`).

What survived was **20 fixes over 32 keys** — the two numbers differ because
one fix can span a run of keys: 10 vocabulary, 1 external-UI string, 15
template and module labels, 6 meaning and register. The widest single fix is
`Etek arazi` → `Dağ eteği` for the Foothills zone, which is **10 keys**,
`z2_enc_src` `z2_enc` `z2_combat` `z2_win` `z2_winamp` `z2_lootroll`
`z2_loot` `z2_xp_meter` `z2_xp2lvl` `z2_training`, all in
`templateLabels/tr.ts` under `mmo-progression`. Three of the fixes are worth
recording, because each is a kind of defect a guard could not have found:

- **`Eşleme` for "Don't map"** is the negative imperative AND the noun
  "mapping". As a dropdown option it reads as the opposite of what it does.
  All six comparable locales use an explicit negative; this now says
  `Eşlenmesin`.
- **`General / Free`** was the only frame label of eleven locales left in
  English. `Premium Standard` and `Premium Pickup` stay English on purpose —
  they are the mechanism names — but this one is a description.
- **`«Web'de yayımla»`** quoted Google Sheets' menu item with the wrong verb.
  Google's own Turkish documentation says `Dosya → Paylaş → Web'de yayınla`,
  measured against that page rather than assumed.

### Drain is `Gider`

TDK gives `gider` two senses: the channel a liquid flows away through, and an
expense. That is the same pair English `Drain` carries, and it matches the
register English chose when it picked `Drain` over `Sink`. `Yutak` is the
engineering rendering of `Sink` and pairs with `Kaynak` the way Turkish
engineering pairs source/sink, but its everyday sense is the pharynx.
`Çıkış` was refused by measurement: it already means the output buffer, in
`modules.bufferedStep.blurb` and in the module overlay's `Çıkış kuyruğu`.

The cost of `Gider` is that `gider` is an ordinary noun as well, and three
template labels use it that way — `Toplam gider`, `Su gideri`,
`Yiyecek gideri`. The measured distinction is case plus a modifier: the node
kind is always the bare capitalised `Gider` (5 keys), an expense is always
lowercase and modified (3 labels). `trCopy.test.ts` pins both halves, and
also pins that the 5 keys are exactly the ones whose English original names
Drain — so a new English sentence about Drain cannot quietly skip the term.

## L3. The string catalog

**L3.1 — one key set, defined by `en`.** Every locale's catalog has **exactly**
the keys that `en` has — no missing, no extra. This is enforced in CI for
**every registered locale** (§L12 #1), not just `ko`.

**L3.2 — keys.** Flat, dotted, namespaced by surface:
`toolbar.export`, `inspector.node.capacity`, `timeline.trackAll`,
`error.M_REG_EVAL.message`, `a11y.playback.status.stepN`. Keys are ASCII and
never built from user data or file content at a call site.

**L3.3 — per-language catalog, TS module + `satisfies` (Q1 — decided).**
`src/i18n/locales/<code>` — a TypeScript module default-exporting a plain
object literal. Two forms, both valid and detected by the CI script (§L12):

- **single file** — `locales/<code>.ts`;
- **domain folder** — `locales/<code>/{ui,canvas,inspector,templates}.ts`
  merged by `locales/<code>/index.ts` (spread in that order). Split is by
  the first key namespace (`toolbar.*` → `ui`, `canvas.*` → `canvas`,
  `inspector.*` / `enum.*` → `inspector`, `templates.*` / `modules.*` →
  `templates`); a genuinely shared string lives in `ui`. `en` and `ko` use
  this form. The four slices merge to **exactly** the flat key set — a key
  in two slices, or dropped from all four, fails CI (§L12 #1).

`en` is authored first and **is** the canonical shape:

```ts
// locales/en/ui.ts
const ui = { 'toolbar.export': 'Export', /* … */ } as const
export type UiKey = keyof typeof ui
export default ui

// locales/en/index.ts
import ui from './ui'; import canvas from './canvas'
import inspector from './inspector'; import templates from './templates'
const en = { ...ui, ...canvas, ...inspector, ...templates } as const
export type MessageKey = keyof typeof en
export type MessageCatalog = Record<MessageKey, string>
export default en
```

```ts
// locales/ko/ui.ts — one slice; the same for canvas / inspector / templates
import type { UiKey } from '../en/ui'
const ui = { 'toolbar.export': '내보내기', /* … */ } satisfies Record<UiKey, string>
export default ui

// locales/ko/index.ts
import type { MessageCatalog } from '../en'
import ui from './ui' /* … */
const ko = { ...ui, ...canvas, ...inspector, ...templates } satisfies MessageCatalog
export default ko
```

Each `ko` slice `satisfies Record<<Domain>Key, string>` against its
`../en/<domain>` counterpart, so `tsc` fails on a per-slice missing / extra
key; the merged `ko` also `satisfies MessageCatalog` as a whole.

- **compile-time key parity:** `satisfies MessageCatalog` on every non-`en`
  catalog makes `tsc` fail the build on a missing or an extra key in the object
  literal — the CI script (§L12 #1) then adds the runtime / cross-locale checks
  (empty strings, placeholder-set match, "add a locale" smoke).
- **catalog keys are flat, stable IDs** (§L3.2) — never the English text, never a
  key derived from user data. Translated message *text* never becomes a type
  identifier or a lookup key in product code.
- catalogs are **code, not JSON**, this cycle. A JSON extraction / import
  pipeline is added only when a real translation-management tool needs it — a
  separate, later decision.
- `en` + `ko` are **statically imported** in v0.8.0 (§L2.1, one bundle); the
  registry's `catalog: () => import(...)` thunk (§L2.2) is the seam for later
  dynamic loading (§L4.5) — a loader change **only**, touching no call site, no
  key, and no GraphDoc / Workspace / Share boundary.

**L3.4 — what is *not* in the catalog — and the GraphDoc is locale-independent
at _creation_, not just across a switch.** A task done in the Korean UI and the
same task done in the English UI must produce a **byte-identical GraphDoc**. The
UI language never leaks into model data — not on switch, and not on create.

| category | in the catalog? | note |
|---|---|---|
| UI chrome — buttons, menus, labels, tooltips, hints, dialog copy, empty states | **yes** | the whole of §L6 |
| accessibility names + live-region text | **yes** | §L10 |
| error / warning **message text** (+ the "how to fix" line) | **yes** | via a `error.<code>.message` key, §L7 |
| error / diagnostic **codes** (`M_REG_EVAL`, `EXPR_SYNTAX`, `M_REG_CYCLE`, …) | **no** — permanently stable | data, not text |
| node / edge **`label`** | **no** — verbatim | round-trips unchanged; never reformatted or machine-translated |
| a Register / edge **expression** and any **`format`** string | **no** | `loop-expr/1` content |
| **`unit`** and **`resourceType`** strings | **no** | advisory model data |
| the **document title** and any **user description** | **no** | user prose |
| the **raw model value** shown in the Inspector (a number, an expression result) | **no** | it is data being displayed, not chrome — only its *label* is keyed |
| a **wire enum's `<option value>`** (`automatic`, `pushAny`, `deterministic`, `int`, …) | **no** — verbatim token | GraphDoc / digest unchanged; a locale switch fires no `change` |
| a **wire enum's OPTION LABEL** — the human-readable text of that `<select>` | **yes** | `enum.<group>.<token>` — `자동`, `아무 경로로 보내기`, … (§L3.4a) |
| the **`label` a template writes into the GraphDoc** (`Templates.tsx`) | **no** | a template's *menu name / description* is chrome (keyed); the labels it seeds into nodes are model defaults. **One bounded exception:** [`docs/template-label-overlay.md` §TLO11](template-label-overlay.md) — a *bundled* template's OFFICIAL node labels (an exact string match against the shipped-locale dictionaries) follow a later UI-language change; a user rename never does |
| the **default `label` / value `defaultData()` produces** on "add node" (`src/model/factory.ts`) | **no** — a fixed English/ASCII default (`"Source"`, `"Pool"`, …) | in the `src/model/` layer, independent of the UI locale; the user renames it if they want |
| example / fixture GraphDoc strings (`examples/*.json` labels) | **no** | a locale switch never rewrites `"Ore Stock"` |
| `schema` id, `kind`, `mode`, wire keys, file metadata, the `tool` string | **no** | ASCII / English forever |

**Palette display name vs model default are separate.** The Toolbar's "Source"
button *can* read `소스` under a Korean UI (it is `t('toolbar.node.source')`),
but pressing it still creates a node whose stored `label` is the
locale-independent `defaultData()` default — **not** `소스`. The palette label
and the seeded model label come from two different places on purpose.

**The line:** anything the user or a file author wrote — or that Loop Studio
*seeds as model data* — stays as written / as a fixed default; only what Loop
Studio's own chrome *says about* it gets a key. The lone bounded exception is a
*bundled* template's own OFFICIAL node labels, which follow a UI-language change
by exact string match ([`template-label-overlay.md` §TLO11](template-label-overlay.md));
a user's own label — even inside a template graph — never does.

**L3.4a — wire enum: stored value vs displayed label.** A wire enum's
**stored value, its code, and any raw display of it** (the raw-data fallback
textarea, a diagnostic `{code}`, the Canvas node's `automatic · pushAny`
state readout) **never change** — those are the frozen token. But the
**human-readable label of the `<select>` a person reads and picks from** is UI
chrome and **is** localized, via an `enum.<group>.<token>` key, with the
`<option value>` left as the bare token:

```jsx
<option value="automatic">{t('enum.activation.automatic')}</option>  // → "자동"
<option value="pushAny">{t('enum.flowMode.pushAny')}</option>        // → "아무 경로로 보내기"
```

So: `value` = `automatic` / `pushAny` (GraphDoc + digest identical, a locale
switch fires no `change` and no edit); displayed label = translated; the
current selection, undo, and `simulationRev` are unaffected by the switch.
A `<select>` that already shows `token — localized description` (edge **Type**,
state **Mode**) is *already* value-separated and stays as it is.

## L4. Message format & the catalog runtime

**L4.1 — `intl-messageformat` (FormatJS) is the formatter (Q2 — decided).** No
hand-rolled ICU subset — nested plural/select, escaping, the `other` rule, and
per-language CLDR plural categories are not something to re-implement and keep
correct long-term. Use FormatJS's [`intl-messageformat`](https://formatjs.github.io/docs/intl-messageformat/)
directly:

- full [ICU Message syntax](https://formatjs.github.io/docs/core-concepts/icu-syntax/)
  — `{name}`, `{n, plural, …}`, `{g, select, …}`, `{n, selectordinal, …}`,
  `{n, number}`, `{d, date, …}` backed by `Intl.NumberFormat` /
  `Intl.DateTimeFormat`;
- a `t(key, params?)` wrapper compiles an `IntlMessageFormat(message, locale)`
  and **caches the compiled formatter keyed by `(locale, key, message)`**;
- the dependency version is **pinned in the lockfile**;
- **rich-text tag syntax (`<b>…</b>` callbacks) is forbidden in Slice 1** —
  string output only. If a surface genuinely needs inline markup, that is a
  separate decision, not a Slice-1 freedom.

**L4.2 — no concatenation.** Components call `t('playback.status.stepN', { n })`.
**Assembling a sentence from translatable fragments in a component is
forbidden** — `"Step " + n`, `t('a') + t('b')`, `<>{t('x')} {value}</>` where
order matters — because word order, particles, and spacing differ by language.
A string with a runtime value is **one ICU message with a named slot**:
`"Step {n}"` / `"{n}단계"`.

**L4.3 — placeholder validation.** Every catalog entry's placeholder set must
match the `en` entry's (same names, no extras); CI checks this for every
registered locale (§L12 #1). A call site passing an unknown param, or omitting a
required one, is a dev-time throw + a test.

**L4.4 — the fallback chain, applied per `t()` call, and it NEVER exposes a raw
ICU pattern.** `format.ts`'s `tryFormat` returns `null` on any failure — a bad
pattern **or** a missing / wrong-shape runtime parameter (CI §L12 #1 blocks bad
patterns and cross-catalog argument drift, but cannot see what a call site
passes). `render()` then walks:

1. **the active-locale message** formatted with the given params;
2. if that returns `null` → **the same key's `en` message**, same params;
3. if that also returns `null` → a **stable localised failure notice carrying
   the key** (`i18n.messageError` → `"text unavailable ({key})"` /
   `"문구를 표시할 수 없음 ({key})"`);
4. last resort (the notice key itself unusable) → the **bare key text**.

Never a throw, never an empty string, and **never the raw ICU message or the
user parameters** in the rendered output, an error UI, or a production log. The
only diagnostic is a **dev-mode** `console.warn` naming the **key, the locale,
and the error class** — not `err.message` (FormatJS embeds the pattern in it),
not the params.

**L4.5 — catalog loading & _atomic_ locale activation (shipped, now async).**
Only the base (`en`) catalog is statically bundled — it is the fallback and must
never fail to load. Every other locale is a **dynamic `import()` of its own
chunk**: the UI message catalog (`assets/locale-<code>-<hash>.js`, from
`registry.ts`'s `catalog()`) and the template-label dictionary
(`assets/tmpl-labels-<code>-<hash>.js`, `templateLabels/dicts.ts`
`ensureTemplateLabelDict`). Adding FR / zh is "add the locale files" — the
loader map + the codegen pick them up, no cache-structure change.

**A switch loads BOTH halves before it commits.** `setLocale(code)` waits on
`Promise.all([entry.catalog(), ensureTemplateLabelDict(code)])`, so when
`activeLocale` flips, the §TLO11 relabel (which runs synchronously off the
`useI18n.subscribe` in `graphStore.ts`) always finds the target dictionary
resident. `initI18n()` does the same before `createRoot().render()`. The one
`import('./<code>')` now yields BOTH the node-label map and the group-frame
title map (`<code>` + `<code>Frames`; `dicts.ts` composes `{ nodes, frames }`) —
so §TLO12 (frame-title overlay) adds no new chunk and rides the same atomic load.

**Provenance-agnostic §TLO11 under lazy dicts.** `relabelNodesForLocale` needs,
synchronously, "is this current label an official string in *some* shipped
locale?". That classification set comes from a **build-time seed**,
`src/i18n/templateLabels/known.generated.ts` (`npm run gen:known-labels`;
`check:template-labels` fails on drift, so a newly-registered locale forces a
regen). Only the *target* string is read from the lazily-loaded dictionary. The
`known` set therefore stays complete no matter which chunks have loaded — an
imported graph carrying a never-visited locale's official labels still relabels.

**`preloadLocale(code)`** is a seam for future eager pre-loading (FR / zh) — it
calls the real loaders and only fetches for a not-yet-resident locale; nothing
calls it today.

**Failure notice.** A failed catalog *or* dict load raises `loadError` on the
i18n store; `src/components/LocaleLoadNotice.tsx` shows a dismissible
`role="status"` banner (mirrors `BootNotice`) so a language that will not load
does not read as a silent bug. Cleared on `dismissLoadError()` and on the next
successful switch. The failure contract is otherwise unchanged (see Rules).

**State (the minimum the provider holds):**

```
{
  activeLocale,        // the code whose strings are on screen right now
  activeCatalog,       // its loaded catalog object (never null after boot)
  requestedLocale,     // the code the user last asked for (may === activeLocale)
  requestGeneration,   // monotonic counter, bumped on every switch request
  loading,             // bool — a request's catalog load is in flight
  loadError,           // { code, current } | null — a failed load, for the notice
}
```

**Rules:**

- **selecting a locale = (a) persist the preference (§L5.1) + (b) start an
  activation request** — two distinct steps. (a) is synchronous and
  unconditional (it records intent); (b) may take time and may fail.
- an activation request bumps `requestGeneration`, sets `requestedLocale`, sets
  `loading = true`, and starts the catalog load.
- **on load success**, and **only if the completing request's generation is
  still the current `requestGeneration`**, one commit changes `activeLocale`,
  `activeCatalog`, `<html lang>`, and `<html dir>` **together**, sets
  `loading = false`, and announces once. Nothing about the UI language changes
  before this commit.
- **a late success or failure whose generation ≠ the current
  `requestGeneration` is ignored entirely** — no state change, no `<html>`
  change, no announce.
- **on load failure** of the current request: keep `activeLocale`,
  `activeCatalog`, and `<html lang>` / `dir` as they are; `loading = false`; a
  one-time non-blocking notice; the persisted preference is **left as the user
  set it** (§L5.2) — a retry / reload can still honour it.
- **initial boot:** the resolver (§L5.2) picks a locale; if it is `en`, boot is
  synchronous on the embedded catalog. If it is a non-`en` locale whose catalog
  load fails, **boot proceeds on the embedded `en`** with the notice; the
  preference is untouched.
- **during `loading`:** the previous locale's screen stays fully rendered — no
  blank screen, no spinner over the whole app, **no mixed-language frame, no
  partial catalog**. (A tiny "switching…" affordance on the language control
  itself is fine.)
- **re-selecting `activeLocale` is a no-op** — no generation bump, no load, no
  announce.
- **a fast `ko → en → ko`** (or any burst) settles on **the last request**: each
  bumps the generation, only the newest can commit, earlier completions are
  dropped by the generation check. The end state is exactly as if only the last
  selection happened.
- **the data boundary is unchanged regardless of load strategy:** no GraphDoc,
  Workspace, Share, revision bytes depend on which catalogs are loaded or when.
  The PWA **precaches only EN + the app shell**; each non-EN `locale-*` /
  `tmpl-labels-*` chunk is `CacheFirst` runtime-cached (`loop-locale-chunks`),
  fetched on first `setLocale` / boot. See `docs/pwa.md` §P8 for the offline
  guarantee. The shared name pattern lives in `scripts/locale-chunk.mjs`
  (`LOCALE_CHUNK_RE`) so the Workbox rule and `check:pwa-closure` never drift.
- a test drives a **deferred** catalog loader (a controllable promise) to assert
  every rule above — atomic commit (catalog **and** dict), generation-drop of a
  stale completion, failure keeps the screen + raises `loadError`, a later
  success clears it, boot-on-`en` fallback, no-op re-select, last-request-wins
  burst. The production-bundle / PWA e2e specs assert the chunk shape (EN
  first-load fetches no `locale-*`; a switch fetches exactly its chunk once;
  runtime cache; offline reboot) — dev-server module URLs differ from the
  Production output, so those live outside the unit + dev-e2e layer.

**L4.6 — an omitted plural arm is a decision about wording, not about reach.**
French cardinal plural rules can select `many` for exact multiples such as
1,000,000 — `Intl.PluralRules('fr').select(1_000_000) === 'many'`, and so does
2,000,000, while 1,000,001 is `other`. The French catalog intentionally omits
an explicit `many` arm because its wording would be identical to `other`; the
ICU fallback to `other` is part of the tested contract, not an accident.
`src/i18n/icuEscaping.test.ts` renders every French plural at 1,000,000 and
asserts it comes out as the `other` arm with no ICU error, so if a future
message ever does need a distinct `many` the guard is already in place to
notice that the two arms have to differ.

The consequence worth stating is the one that differs from English: **French
puts 0 in `one`**. `{n, plural, one {# ligne sera ajoutée} other {# lignes
seront ajoutées}}` renders `0 ligne sera ajoutée` — singular noun, singular
verb — where English renders `0 rows`. Every French plural was formatted at
0, 1, 2 and 1,000,000 with the real `intl-messageformat` and read back,
because gender and past-participle agreement ride on that same `one` arm:
`0 valeur a été supprimée`, `0 paramètre ajouté`,
`0 clé étrangère a changé`. A checker that only diffs placeholder names
cannot see any of that.

## L5. The language switch

**Auto-generated from the registry.** The control is driven entirely by
`LOCALES` and needs **no edit** when a locale is added. It sits next to the theme
toggle — desktop `Toolbar`, mobile `MobileMoreMenu`. Activating it kicks off the
atomic activation (§L4.5), persists the new `code` (§L5.1), sets `<html lang>` /
`<html dir>` from the entry's metadata **on activation**, and announces the
change once. No reload, no run interruption, no viewport change.

**Form — a trigger button + a registry-driven overlay menu.** The Toolbar
control is a plain `.btn` (identical height to the sibling controls, so it shifts
**no** committed visual baseline) showing the active locale's `nativeName`.
Pressing it — mouse, **Enter, Space, or ↓** — opens an **absolutely-positioned
popover** (`.lang-menu__pop`) that lists **every** registered locale in registry
order; the popover is an overlay, so it changes neither the Toolbar height nor
any Canvas geometry. On mobile the **same component** is rendered inside
`MobileMoreMenu`.

- each item is a `role="menuitemradio"`; the active locale carries
  `aria-checked="true"` and a `✓`; `nativeName` is primary, `englishName` a
  secondary line when it differs;
- the trigger carries `aria-haspopup="menu"` + `aria-expanded`;
- keyboard: **Enter / Space / ↓** open; **↑ / ↓** move; **Home / End** jump;
  **Escape** closes and returns focus to the trigger; selecting an item closes
  and returns focus;
- while the chosen catalog loads, the item shows a `lang.loading` note and the
  trigger a `data-loading` flag; a failed load leaves the current selection
  (`aria-checked` follows `activeLocale`, §L4.5);
- **adding a locale needs no change to `LanguageSwitch.tsx`** — the menu is a
  `.map` over `LOCALES`. The dev-only `en-XA` pseudo-locale (§L11) exercises the
  ≥3-locale menu today.

A dedicated Settings screen (theme + motion + language + …) is deferred until
there are enough preferences to justify the information-architecture work; it is
**not** part of this cycle.

**L5.4 — the search box counts LANGUAGES, not options.** The picker renders a
search field from `LANGUAGE_SEARCH_THRESHOLD` (6) locales up, via
`shouldShowLanguageSearch()`. That predicate counts entries with no `pseudo`
flag, so the dev-only `en-XA` (§L11) never pushes the count over the line.
Counting raw options instead would have made the box appear in dev — and only
in dev — one real language early, pinning its layout and keyboard model in a
release that did not ship it.

French is that sixth language, so the box now renders in **production**: six
options and a search box there, seven options and the same one search box in
dev. It is the same control either way — `en-XA` is searchable but never
counts. The threshold has not moved and nothing about the predicate changed
to ship it; the count simply reached 6.

**L5.5 — the search folds diacritics, and only Latin ones.** With the box now
shipped (§L5.4), the first language behind it is one most keyboards cannot
type: `Français` needs a `ç`. `foldForSearch()` therefore normalises both
sides of the comparison, over four fields — code, English name, endonym, and
the name in the active UI language — so `fr`, `French`, `Français`,
`francais` and `franc` all find it, from any of the six UI languages.

The folding is deliberately narrow, in two ways.

1. **A combining mark is dropped only when it sits on a LATIN letter.** The
   obvious one-liner is wrong here:

   ```js
   value.normalize('NFD').replace(/\p{M}/gu, '')   // NEVER
   ```

   Japanese dakuten and handakuten are combining marks. That line folds
   `ポ` → `ホ` and `が` → `か`, so one query would match two different kana and
   a Japanese reader's search would return the wrong language. Hangul jamo,
   Thai and Arabic marks are left alone for the same reason, and so is every
   Cyrillic mark but one (item 3). The guard is a test, not a comment:
   searching `ポ` must return **zero** results.

2. **Every kind of space folds to one ASCII space** — U+00A0 and U+202F
   included — so a typed space matches the typeset one French names may
   carry (§L2.8).

3. **One Cyrillic letter folds: `ё` searches as `е`.** Added with `ru` (§L2.17)
   and MEASURED first — before it, the two were different strings, so with the
   UI in Russian the Simplified Chinese row, `Китайский (упрощённый)`, could
   not be found by typing `упрощенный`. Russian substitutes the two letters
   freely in running text and `ё` is a separate key, so the spelling in the
   catalog is not the spelling that gets typed. It is exactly one letter wide
   on purpose: under NFD `й` is also `и` plus a combining mark, and `й` is a
   distinct letter no Russian reader substitutes, so the rule rejected for
   dakuten in item 1 would be wrong here too. Both guards are tests — folding
   `ё`/`е` together, and keeping `й`/`и` apart — and both were falsified, by
   removing the rule and by widening it to all Cyrillic.

A ligature that decomposition does not reduce to ASCII (`œ`, `æ`) is left as
it is. Transliterating it would be a rule about French orthography rather
than about search, and the cheaper answer if it is ever needed is an explicit
alias on the one entry that needs it.

The box is a **combobox**, so `aria-activedescendant` moves to the input when
the input owns focus, and the listbox must not also claim it. Below the
threshold the listbox itself is focused and carries the attribute. Both
arrangements are pinned in `e2e/i18n.spec.ts`.

The popover is sized by the language names, never by the box: an `<input>`
carries an intrinsic `size=20` width, which measured 206 px against the
menu's own 150 px minimum, so the field is `min-width: 0; width: 100%;
box-sizing: border-box` and a long placeholder wraps inside it instead of
pushing the menu open.

**L5.1 — persistence: one named string key (Q5 — decided).**

```
localStorage["loop-studio/ui-locale/1"] = "ko"
```

- the value is a **bare locale `code` string**, not a JSON blob — no premature
  preferences schema, no migration.
- on read it is **validated against the registry**; a corrupt, empty, or
  unregistered value is **ignored** (fall through to browser locale → `en`).
- reading a bad value **never throws and never rewrites stored data** — a
  garbage value is simply not honoured; it is left untouched or overwritten only
  by the next explicit switch.
- a locale change updates **only this one key**.
- it is **never** copied into the GraphDoc, the Workspace / Share payload, a
  revision / proposal file, the `loop-revision/*` digest, undo, or
  `simulationRev`. Per-browser, like the theme choice.
- future UI settings (if any) each get their **own** `loop-studio/<thing>/<n>`
  key — this doc introduces exactly one.

**L5.2 — the locale-decision order is fully deterministic** (run once at first
paint, before React mounts, to avoid a flash — and reused verbatim by the
switch's "browser default" path):

1. **stored preference.** If `localStorage["loop-studio/ui-locale/1"]` is
   **exactly** a registered `code` (no normalisation — see below), use it.
2. Else, walk `navigator.languages` **in order**. For each entry `L`, apply
   **every** step below before moving to the next entry:
   1. **exact match** — a registered `code` equal to `L` (`es-419`, `zh-Hans`);
   2. else **Chinese script** (§L5.2a) — `zh-CN` → `zh-Hans`, `zh-TW` → `zh-Hant`;
   3. else **BCP-47 base-language match** — a registered `code` equal to `L`'s
      primary subtag (`ko-KR` → `ko`, `en-GB` → `en`, `de-AT` → `de`);
   4. else **`baseFallbackFor` owner** — the registered locale that explicitly
      declares `L`'s primary subtag (`es-MX` → `es-419`).
   The first entry that resolves wins; move to the next `navigator` entry only
   if the current one resolves to nothing.
3. Else, the **canonical fallback `en`**, only after every entry is exhausted.

**The walk is per ENTRY, not per step.** Sweeping the whole array once per
step would let a later tag's exact match beat an earlier tag's base fallback —
`["es-MX", "de-DE"]` would resolve to German. The user put their first tag
first, so `["es-MX", "de-DE"]` is `es-419` and `["de-DE", "es-MX"]` is `de`.

**`baseFallbackFor` (step 4)** exists because a locale's code is not always
the subtag a browser sends. `fr`, `de`, `ko` and `ja` are reached by step 3
and declare nothing; `es-419` declares `'es'`, and a later `pt-BR` would
declare `'pt'`. It is deliberately **after** the exact match, so registering
`es-ES` later gives `es-ES` its own tag with no change to the resolver.

Three structural guards in `registry.test.ts` keep it from becoming a second,
competing resolver:

- **at most one locale owns a base subtag** — two owners of `es` fails;
- **a declared base is the locale's own language subtag** — `es-419` cannot
  declare `'pt'`;
- **an exact code always beats an owner**, including one registered later.
  That last one is checked by calling **the production function itself** with a
  hypothetical registry list (`resolveInitialLocale` takes the locale array as
  a defaulted parameter), never a test-only copy of the algorithm.

Additional rules:

- **no input repair.** Case and `_`/`-` are **not** normalised on the stored
  value: `"KO"`, `"ko_KR"`, `" ko "` are **not** a registered `code` and are
  ignored. (A stored value only ever gets there via the switch, which writes an
  exact `code`; anything else is corruption and is not silently fixed.)
  `navigator.languages` entries are matched case-insensitively on the base
  subtag only, per BCP-47, because the browser controls their shape.
- an **unregistered / corrupt stored value is ignored on read only** — it is
  **not** deleted, rewritten, or "corrected"; it is simply skipped, and the next
  explicit switch overwrites it.
- a **catalog load failure does not touch the stored preference** — the
  preference records intent; a failed load is a runtime condition, not a reason
  to forget the user's choice (§L4.5).
- the **fallback is always `requested locale → en`** — one hop, no chain of
  intermediate locales.
- the **`en` catalog is required for boot.** It is statically bundled and is
  **never** a failable remote resource — if the *initially chosen* non-`en`
  locale's catalog fails to load, the app boots on the embedded `en`
  (§L4.5). There is always a working catalog.


**L5.6 — the picker's display order, and why the registry array is not it.**
The list is sorted at the PRESENTATION layer, over a copy
(`languageOptions.ts`'s `displayLocaleOrder`). The registry array is DATA: its
order is the order languages happened to ship.

**Sorting `LOCALES` itself would have been a silent defect.** `BASE_ENTRY` was
`LOCALES[0]`. Alphabetically the first entry is `zh-Hans`, so an ordered
registry would have made `store.ts`'s `getEntry(code) ?? BASE_ENTRY` hand an
unknown locale a CHINESE entry — its `direction`, its `numberLocale` — while
`BASE_CATALOG` stayed `en`. Nothing asserted that pairing, and nothing would
have reported it. `BASE_ENTRY` is therefore now looked up by `BASE_LOCALE`,
and the array is read as an unordered set.

**The key is `englishName`, under `Intl.Collator('en')`, with `code` as a
deterministic tiebreak.** It is the one label that does not move when the UI
language changes. The alternatives were rejected on exactly that ground:

| candidate key | why not |
|---|---|
| the localized display name | the list would re-order **under the user at the moment they are changing language** — the one moment the picker is open |
| the endonym | cross-script collation groups by script (Latin, then Cyrillic, then CJK); nobody asked for that grouping, and `한국어` vs `日本語` is still arbitrary within it |
| registry order (the status quo) | every new language lands at the bottom, and regional variants never sit beside their base |

Its weakness is stated rather than hidden: the sort key is a third string that
is **not on screen** — the rows show the endonym and the display name. That is
the price of an order that never moves.

Shipped order today:

> Chinese (Simplified) · Chinese (Traditional) · English · French · German ·
> Japanese · Korean · Portuguese (Brazil) · Spanish (Latin America)

**A DEV pseudo-locale stays selectable, out of the sorted set, and last.** It
is not a language a user has (§L5.4), so it must not sort in among them —
`en-XA` under `English` would put a QA entry between two shipped languages.
Production ships none, which `e2e/dist.spec.ts` asserts as an exact ordered
list rather than a set.

The contracts live in `src/i18n/localeOrder.test.ts`: the shipped order, the
pseudo tail, purity over five shuffles of the input, non-mutation of the
caller's array, the `code` tiebreak, and no drops or duplicates.

## L6. Surface inventory (the sweep)

Every string-bearing surface, enumerated key-by-key in the base + conversion
slices:

- **Toolbar** (`Toolbar.tsx`) — node-add buttons, Export menu (`ExportMenu.tsx`),
  Share (`ShareButton.tsx`), Import, theme + language controls, the build stamp.
- **Inspector** (`Inspector.tsx`) — every field label, unit label, activation /
  mode option, validation hint, state-edge mode copy, the `resourceType`
  mismatch note.
- **Timeline** (`TimelineChart.tsx`) — "track all", per-pool legend controls, the
  Register dashed-line note, axis affordances.
- **Play / run** (`PlayBar.tsx`, `MobileRunBar.tsx`) — Play / Pause / Step /
  Reset labels + titles, speed control, seed field.
- **Monte Carlo** (`MonteCarloDialog.tsx`, `DistributionPanel.tsx`,
  `BandChart.tsx`, `TerminationSparkline.tsx`) — dialog copy, run-config labels,
  LIVE / DISTRIBUTION, percentile legend, the cell-limit error (§L7).
- **Import / Export / Workspace** (`ExportMenu.tsx`, `ConfirmDialog.tsx`) — menu
  items, the Workspace summary confirm, size-cap prompts.
- **Revision UI** (`ReviewOverlay.tsx`, `RevisionChip.tsx`, `AuthorDialog.tsx`) —
  Review panel, `exact` / `divergent` / `unknown` labels, Apply / per-hunk copy,
  conflict `base` / `yours` / `theirs`, the unverified-author note.
- **PWA update bar** (`PwaUpdateBar.tsx`) — "a new version is ready", Update /
  Dismiss, the "run in progress" re-confirm.
- **Boot / share loading** (`BootNotice.tsx`, `ShareLoader.tsx`,
  `MobileOpenFileHint.tsx`).
- **Templates** (`Templates.tsx`) — starter-template names / descriptions are
  Loop Studio's copy → translated; a template's GraphDoc labels are model data
  (§L3.4) → not.
- **Shortcuts** (`Shortcuts.tsx`) — the keyboard-help sheet.
- **Errors / warnings / empty states** — everywhere (§L7).
- **Accessibility** — every `aria-label`, `title`, `role="status"` text,
  `PlaybackAnnouncer.tsx`, dialog titles (§L10).

## L7. Errors, warnings, diagnostics (Q3 — decided: user-facing only this cycle)

This cycle does **not** restructure the whole engine error system. It touches
**only the diagnostics that reach the UI.**

- **UI-raised** (validation hints, import failures, size-cap prompts, Share too
  big) — keyed message text, straightforwardly.
- **Engine diagnostics that surface in the UI** (`report.diagnostics` entries
  shown to the user, the Monte-Carlo cell-limit message, import-refusal
  reasons). The engine is deliberately **dependency-free and UI-agnostic**
  (`SEMANTICS.md`) — it must not import an i18n runtime. So:
  - the engine hands the UI a **`{ code, params }`** boundary object
    (`{ code: 'MC_CELL_LIMIT', limit, cells, mb }`); the pre-formatted English
    string stays as an **untranslated developer-facing fallback**.
  - the diagnostic **codes** (`M_REG_EVAL`, `EXPR_SYNTAX`, `M_REG_CYCLE`,
    `MC_CELL_LIMIT`, …) are **unchanged and stay stable**.
  - the translation catalog is keyed by a **separate message key**
    (`error.MC_CELL_LIMIT.message`), *derived from* but not *equal to* the code
    — the code is data, the message key is a catalog lookup. A renamed catalog
    key never implies a renamed engine code and vice-versa.
  - an **unrecognised code** (an engine version ahead of the catalog, or a code
    with no `error.<code>.message` entry) renders a **stable generic localized
    message** ("Something went wrong while running the model.") **with the raw
    code shown** alongside for a bug report — never a blank, never the English
    dev string as the primary text.
- **Out of scope this cycle:** structuring internal assertions, developer-only
  errors, and every remaining `throw new Error(...)` in `src/engine/**` into
  `{ code, params }`. That is its own follow-up.
- **Unchanged:** the frozen engine results, `report.diagnostics` *contents*
  (which conditions produce a diagnostic), and evaluation precedence. Adding a
  `code` field to a diagnostic object is additive metadata, not a semantics
  change; if any consumer test pins the exact English `diagnostics` strings,
  it moves to asserting the `code` instead.

## L8. Numbers, dates, units

- **Never reformatted:** anything stored, digested, or part of an expression's
  canonical form (`loop-expr/1` §X8), a `data.format` result, or a user `unit` —
  model / wire content, not UI chrome.
- **Locale-formatted via `Intl.*` with the entry's `numberLocale`:** only plain
  counts in UI chrome (cell count, run / step counters, byte sizes). For `en` /
  `ko` the output is identical (`1,234`, `.` decimal), so the safe default is
  **leave as-is** and add `Intl.NumberFormat` only where a specific string reads
  wrong in a locale. No dates are rendered today; if one appears, format with
  `Intl.DateTimeFormat(entry.numberLocale)`.

## L9. Layout, mobile, and RTL

- Every converted surface is checked in **every shipped locale** at the mobile
  breakpoint and the desktop Inspector's 300 px column, light and dark — Korean
  and future languages run longer or wrap differently. Buttons use `min-width` +
  `text-overflow`, not fixed widths, where a translation would clip.
- **RTL:** the `dir` metadata field exists so a future RTL locale can set
  `<html dir="rtl">`, **but v0.8.0 does not promise an RTL-correct layout** —
  no bidi CSS audit, no logical-property sweep in this cycle. Registering an RTL
  locale before that work lands is explicitly unsupported.

## L10. Accessibility

- `<html lang>` (and `dir`) follow the active registry entry.
- Every `aria-label` / `title` / `role="status"` string is a key.
- `PlaybackAnnouncer.tsx` — "Step N" / "Paused at step N" / "Reset to step 0" /
  "Ended at step N" become keyed templates; the throttle / latest-wins /
  generation-guard logic (Slice 3c-a) is **unchanged**.
- The language switch has an accessible name per locale and announces the change
  once.

## L11. Development affordances — strictly dev-only, byte-gated

Every item here is read **only inside `import.meta.env.DEV`**, which is
statically `false` in the production and portable builds, so the code, the query
key, and the identifiers are **tree-shaken out entirely**.
`e2e/portable-file.spec.ts` asserts their absence at the byte level
(`devLocaleOverride`, `devPseudoLocales`, `en-XA`, `__formatCacheSize`, `?lang`).

- **`?lang=<code>`** — a debugging / e2e convenience, **not a product feature**.
  It forces a *registered* locale for the session and then stops: it does **not**
  enter the §L5.2 order, does **not** write `localStorage`, and does **not**
  propagate to a Workspace / Share payload. In a production build the query
  string has no effect — a `?lang=ko` there still resolves by the stored
  preference / browser rule.
- **the `en-XA` pseudo-locale** — a dev-only registry entry (catalog = `en`
  verbatim) so the switch, the resolver, and every check exercise an *Nth*
  locale without special-casing `en` / `ko`. Not shipped.
- **`missing-key` / `format-failed` console warnings** in dev (both are hard CI
  failures, §L12 #1, so they never reach production).
- (a later **key-visibility mode** — render every `t()` as its bare key to spot
  an un-keyed string — is noted for Slice 2/3, not built here.)

## L12. Verification — every check iterates the whole registry

1. **Catalog + ICU integrity (CI, hard fail).** `tsc` + `satisfies` (§L3.3)
   already blocks a missing/extra key; TS key parity is **not enough to make the
   ICU messages safe**, so `scripts/check-i18n.mjs` (in the `checks` job) loads
   the **whole registry** and, for **every** registered locale, asserts:
   - every message **parses** as ICU (no syntax error);
   - every `plural` / `select` / `selectordinal` block has an **`other` arm**;
   - the **argument-name set** of each message equals the `en` message's;
   - the **argument _kind_** of each shared argument matches `en`'s — a plain
     slot vs `number` vs `date` vs `plural` vs `select` — not just the name;
   - **no rich-text tag syntax** (`<tag>…</tag>`) in any message (§L4.1);
   - **no empty-string** values;
   - after the `active → en` fallback, **no key referenced by a call site is
     unresolved** (against the full registry).
   The script is written against the registry loop, never against `ko`.
2. **No missing / unused keys (CI).** Every `t('…')` call-site key exists in
   `en`; every `en` key is referenced somewhere (grep, with an allowlist for
   dynamically-selected `error.<code>.message` keys).
3. **No hardcoded UI text (lint/CI).** Flags English-sentence literals in
   `src/components/**` outside the i18n layer (heuristic + allowlist).
4. **Per-locale visual matrix (Playwright).** Key surfaces (Toolbar, Inspector,
   Timeline, Play bar, one dialog, one error, one empty state) captured for
   **every shipped locale × light / dark × desktop / mobile**. Extends the
   `*-visual.spec.ts` pattern; parametrized over the registry.
5. **Locale-switch invariance (Playwright).** Import, run several steps,
   snapshot `{ GraphDoc bytes, loop-revision/3 digest, canUndo/canRedo,
   viewport, simulationRev, values, stepIndex }`; cycle through **every**
   registered locale twice; the snapshot is **byte-for-byte equal**. A Workspace
   / Share round-trip is identical across a switch.
6. **Initial-language resolution (Playwright).** `navigator.languages` mocked
   per registered `code` with no stored key ⇒ that locale; an unknown tag ⇒ base;
   a stored value wins over the navigator; a stored value **not** in the
   registry is ignored ⇒ base.
7. **Fallback (unit).** A key present only in `en` renders the `en` string under
   every other locale; a key absent everywhere renders visibly with a test hook.
8. **"Add a locale" smoke (unit).** A throwaway `xx` locale registered in a test
   with a partial catalog: checks #1 fails loudly on the gaps, the switch UI
   lists `xx`, `t()` falls back to `en`, and **no product-data snapshot moves**.
9. **Locale-independent toolbar layout (Playwright).** At a fixed viewport the
   desktop toolbar's row count and the Canvas top are **identical for every
   shipped locale** — a longer katakana palette collapses more controls into the
   `⋯` overflow menu, but does not add a row. See
   [`docs/toolbar-responsive.md`](toolbar-responsive.md); tested by
   `e2e/toolbar-responsive.spec.ts` at 1920 / 1600 / 1280 / 820 px and across a
   resize sweep.

## L13. Slices

**Slice 1 — the base + the Toolbar + Play bar anchor (Q4 — decided).** The
smallest surface that exercises the whole mechanism end to end. It lands:

- `src/i18n/` — the **locale registry** + metadata, the `t()` provider, the
  `intl-messageformat` wrapper with the `(locale, key, message)` compiled-formatter
  cache, the **atomic-activation loader** (§L4.5, synchronous today, async-shaped),
  the **initial-language resolver** (§L5.2), `<html lang>` / `<html dir>`.
- the **auto-generated language-select control** — desktop `Toolbar`, mobile
  `MobileMoreMenu` — with save / restore / browser-locale fallback and
  **immediate** (atomic) switching.
- `en` + `ko` catalogs for **Toolbar + Play bar only**: every button name,
  tooltip, and `aria-label`; Play / Pause / Step / Reset; the step-announcement
  templates in `PlaybackAnnouncer` (logic unchanged).
- the **registry / ICU / invariance CI guards** — checks #1–#3 and #5–#8 wired;
  the visual matrix (check #4) for just these two surfaces.
- **the invariance assertion** (§L12 #5): switching KO↔EN before, during, and
  after a run leaves the GraphDoc bytes, the `loop-revision/3` digest, undo /
  redo, the viewport, `simulationRev`, and `SimState` (values / stepIndex)
  byte-for-byte unchanged.
- **no behaviour change beyond the switch**; the Canvas / Inspector / Timeline,
  dialogs, revision UI, etc. stay English until Slice 2a / 2b.

**Slice 2a — the model work surface.** **Canvas, Inspector, Timeline** — every
field label, unit label, activation / mode option, validation hint, the
`resourceType` mismatch note, node-kind captions, the Register dashed-line note,
the timeline legend controls. This is where the **user-data non-translation
boundary** (§L3.4) is enforced in code — palette label vs `defaultData()`
default kept separate, a byte-identical-GraphDoc-across-locales test — and where
the **§L7 user-facing engine-diagnostic `{ code, params }` mapping** lands
(the Inspector / Timeline are where those diagnostics show).

> **Implemented (`feat/i18n-slice2a`).** `en` + `ko` for Canvas (`ariaLabel`),
> the Inspector (every field label, note, hint, empty state, the `resourceType`
> mismatch note, Parameter / Register advisory notes), the Timeline chrome
> (`timeline` caption, `LIVE` / `DISTRIBUTION`, legend show/hide + Register
> titles, CSV, the `step N` axis text), the mobile read-only Inspector sheet,
> and the node-face *unreadable / invalid* synthetic cues. The **node-palette
> two-layer tip** — `palette.<kind>.name` (also the button's accessible name) /
> `palette.<kind>.description` (semantic, matched to `SEMANTICS-*`) /
> `palette.addAction`, three separate DOM lines, an absolutely-positioned
> overlay shown on hover **and** keyboard focus, `aria-describedby`-linked.
> **§L7 diagnostics:** the register `M_REG_*` codes and the `EXPR_*` parse codes
> are shown verbatim by the caller with the prose from `error.<code>.message`
> (params carry only atoms — a column number); an unknown code falls back to
> `error.unknownCode`. **Not translated** (raw model data, shown as-is): every
> node/edge `label`, expression text, `unit`, `resourceType`, an Inspector raw
> value, a wire enum's `<option value>` and its raw display (the raw-data
> textarea, a `{code}`, the Canvas node's `automatic · pushAny` readout), and
> the node-kind chip. A **follow-up** (`feat/i18n-inspector-enum-labels`)
> localizes the *displayed label* of the Inspector's enum `<select>`s via
> `enum.<group>.<token>` while keeping `value` = the token (§L3.4a).
> **Deviations:** three edit-time hint notes
> (trigger `delay`, Register canonical form, the deprecated `node`-mode note)
> lose a decorative inline `<code>` box — an ICU message cannot carry markup
> (§L4.1); text and values are preserved. The palette has no mobile surface
> (editing is desktop-only), so the "mobile inline description instead of a
> tooltip" clause has no target this slice. `Close` on the mobile Timeline /
> sheets and React Flow's own zoom controls stay English — a cross-cutting
> concern for Slice 2b.

**Slice 2b — the app work surface.** **Import / Export / Workspace, revision UI,
the Templates picker UI, the PWA update bar, every remaining empty / error
state, and the accessibility names + live-region text** app-wide. Each surface
with its `en` + `ko` catalog additions. **Also: retire `window.confirm()` — every
confirm becomes the shared in-app `ConfirmDialog`** (one system, desktop +
mobile), under this contract:

- no external effect (share URL build, clipboard, download, import, GraphDoc
  swap) runs before **Confirm**; Cancel / Escape / backdrop are one identical
  cancel path (backdrop-dismiss is *allowed* — every Slice-2b cancel is safe);
- focus is trapped while open and returns to the trigger on close; **initial
  focus is Cancel** so Enter never fires a destructive confirm;
- a double-click on Confirm runs the effect once (caller `busy` guard);
- a locale switch while a dialog is open re-renders it in the new locale;
- opening + closing a dialog leaves digest / undo / viewport / SimState
  unchanged; user-activation work (clipboard, download) runs inside the Confirm
  button's click handler.

Split into two PRs (size / review):

> **2b-1 (`feat/i18n-slice2b`) — implemented.** The shared `ConfirmDialog`
> hardening (`useId` for the aria ids, `dismissOnBackdrop`, `dialog.cancel`
> key), **Share** (`ShareButton` + the mobile More sheet: the §U4 disclosure is
> now the dialog; export + link build + clipboard run only from Confirm),
> **PWA update bar** (`pwa.*` strings + the "run in progress" confirm → dialog),
> **import replace-confirm** (`MobileTopBar` → dialog; `Toolbar` had no confirm,
> its error `alert()` body is keyed), **RevisionChip** + **BootNotice**
> (`projectStore.bootNotice` now emits a code, `BootNotice` localizes it), and
> the **React Flow a11y layer** (`<ReactFlow ariaLabelConfig>` — Controls
> buttons, the node / edge keyboard hints, the handle label). `<strong>` in the
> PWA-bar text and `<code>` in the legacy note become plain text (ICU has no
> markup, §L4.1). Still native, deferred to 2b-2: the Templates replace-confirm
> and the Export **project-revision** disclosure. `routeImport` warning strings
> stay English for now (no `{code}` — a later pass).
>
> **2b-2a (`feat/i18n-slice2b2`) — implemented.** Templates (button + the two
> template names / blurbs, keyed by `id` in `templateKeys.ts`; the replace
> confirm → `ConfirmDialog`, `loadGraph` only from Confirm), the whole Export
> menu (items + blurbs), the **Project-revision disclosure** and the
> **Workspace-JSON summary** (all three `confirm` branches — save / omit /
> reject; the download runs inside the Confirm click, the reject stays a keyed
> native `alert`), `AuthorDialog`, and the mobile More-sheet rows +
> Templates / Export sheets. `PROJECT_REVISION_DISCLOSURE` /
> `AUTHOR_DISCLOSURE` consts removed. One E2E per destructive flow proves
> nothing runs before Confirm (`confirm-dialog.spec.ts`).
>
> **2b-2b (`feat/i18n-slice2b2b`) — implemented.** `MonteCarloDialog` (title,
> field labels, tracked-pool head / select-all / empty state, the cost readout
> labels — *Measured (last run)* / *Local benchmark* / *Execution* / *Parallel,
> N workers* / *Memory* / over-limit note, the run / cancel / close buttons)
> and `ReviewOverlay` (title + Close, the gate / classification messages, the
> §R7A whole-apply confirmation copy — `confirmationText()` retired to
> `review.confirm.default` / `.unknown`, the apply-fail messages, the diff
> summary labels *Nodes* / *Edges* / *run config* / *No graph changes*, the
> hunk verbs *Add* / *Remove* / *Change* + tags, the field-choice labels
> *take theirs* / *keep mine* / *base* / *yours* / *theirs*, every action
> button, the footer). **Not translated** (shown verbatim): every diff hunk id
> and `elementType`, all `shortVal()` field values, the time / memory / run
> numbers, the parent revision id, the author name / note, and the
> `invalid-selection` structural specifics (`res.reasons` / `res.detail` from
> the model layer). Catalogs → 343 keys.

**Slice 3 — acceptance validation.** The **full string inventory** reconciled
(every surface accounted for); the **KO / EN × desktop / mobile visual matrix**
completed across every §L6 surface; **long-Korean / overflow / LOD /
`forced-colors` / `reduced-motion`** all exercised; and the
**GraphDoc / digest / undo / viewport / simulation invariance** asserted across
the whole app, not just Slice 1's two surfaces.

> **Implemented (`feat/i18n-slice3`).** Form: **functional / DOM tests as the
> gate + a few KO reference screenshots** (chosen over a ~30-image KO pixel
> matrix — that is brittle and high-maintenance; the EN visual baselines are
> untouched, so whole-design regression cover is not lost).
>
> - **Inventory reconcile.** `scripts/check-i18n-surface.mjs` (new; wired into
>   the `checks` CI job as `check:i18n-surface`) — a conservative static scan of
>   every `src/components/**` file for a user-facing English string not wrapped
>   in `t()` (a static JSX text node, or an `aria-label` / `title` /
>   `placeholder` literal), with a small allowlist for format tokens shown
>   verbatim by design. Mop-up it forced: `DistributionPanel`,
>   `TerminationSparkline`, `BandChart`, `MobileOpenFileHint`, the shared
>   `dialog.close` (mobile sheet + timeline sheet `✕`), the `LoopEdge`
>   state / playback edge-label cues (`clamp` / `blocked` + their `title`
>   tooltips + the transfer-breakdown tooltip), the orthogonal-route
>   `invalidWaypoint` `!` badge name, and the `ReviewOverlay` "nothing new to
>   apply" stamp. Catalogs → **374 keys**.
> - **Functional KO acceptance** (`e2e/i18n-acceptance.spec.ts`) — per-surface,
>   in KO: no document x-scroll, the container inside the viewport, a 60-char
>   Korean label ellipsizes without widening the Inspector; every dialog / menu /
>   overlay contained; the Review overlay; the mobile (390px) app + More sheet +
>   Monte Carlo; an app-wide `en→ko→en` (×N, and again with each dialog open —
>   switched through `i18n.setLocale` since a modal scrim covers the menu) that
>   leaves the GraphDoc / digest / undo / redo / viewport / `simulationRev` /
>   `SimState` byte-identical; `forced-colors` + `reduced-motion` KO spot checks.
> - **KO typography of the small-caps semantic labels** (§L13 fix). The EN UI
>   sets eyebrow / field / metric labels in `uppercase` + a small monospace face
>   + wide `letter-spacing`; on Hangul that shrinks stroke-dense glyphs and
>   splits a word into `실 행 횟 수`. A `:lang(ko)`-scoped block in `index.css`
>   (so **no EN pixel moves**) gives those specific labels — Monte Carlo
>   head / field / pools-head / cost labels, Review head / field labels / tags,
>   the mobile sheet title, the play-strip + timeline-head labels — the sans
>   face, `letter-spacing: 0`, `text-transform: none`, and (dialogs / overlays /
>   sheet only) a 11–12px size bump. Numbers, seeds, memory values, raw enum
>   tokens, the toolbar, and the Inspector body are untouched.
> - **Representative KO screenshots** (`e2e/i18n-visual.spec.ts`, chromium +
>   an inline-mobile block) — desktop full screen, mobile full screen, Inspector
>   (node selected), Monte Carlo (metric labels shown, machine-specific values
>   masked), Review overlay, a long Korean node label + a palette tooltip, the
>   Export menu open. The build stamp / minimap / attribution are masked; the
>   canvas transform is pinned so a fitView frame can't shift the shot.
> - **README / positioning** — separate, non-localization, bundled here per
>   Lumi. The repo's GitHub *About* + *Topics* were updated first (by the
>   maintainer): About → "Browser-based visual systems editor and simulator for
>   resource flows, state changes, probabilistic rules, and feedback loops.";
>   Topics now carry `systems-modeling` / `discrete-simulation` / `resource-flow`
>   alongside `game-economy-tools` / `game-design-tools` / `machinations`
>   (`system-dynamics` deliberately left off — not a current capability). The
>   README intro is aligned to that: first sentence mirrors the About, then
>   "designed primarily for **game economies**, while the same step-based model
>   can represent inventory / supply chains / production / queues / cash flows /
>   energy / other resource-flow systems", then a one-line scope boundary
>   ("deterministic, discrete-step … continuous-time equations and spatial
>   physics are not directly supported") and a `Future directions` section
>   (continuous-time / spatial / external-engine) that is explicitly **not** a
>   committed roadmap. `Why` reframes game economies as the *representative*
>   case. The `preview` badge is kept as-is (it reads as "pre-stable", not
>   "demo").

**Follow-up slices** — **guided first-run tour**, then **contextual inline
help**, each on the finished base with its own design pass.

## L14. Decision record

**No open questions.** rev 3 pinned the four pre-implementation boundaries;
Lumi pre-approved merging this doc as **settled design / implementation
pending** (no `Frozen` marker — it is not a semantic wire spec) once CI is
green. Implementation begins at Slice 1 (§L13) after that merge.

**Decided in rev 3 (the four pre-implementation boundaries):**

- **deterministic locale-decision order** (§L5.2) — stored exact `code` →
  `navigator.languages` in order (exact, then BCP-47 base) → `en`. No case /
  separator repair; an unregistered stored value is ignored on read only, never
  deleted or corrected; a load failure never rewrites the preference; fallback
  is always one hop `requested → en`; the `en` catalog is a mandatory bundled
  resource, never a failable remote fetch.
- **async activation state machine** (§L4.5) — `{ activeLocale, activeCatalog,
  requestedLocale, requestGeneration, loading }`; persist-preference and
  activate-catalog are separate steps; `activeLocale` / catalog / `<html lang>`
  / `dir` change in **one commit only after** the target catalog is ready;
  late completions with a stale generation are dropped; a failure keeps the
  current screen and `<html lang>`; initial non-`en` load failure boots on
  embedded `en`; no blank / mixed-language / partial-catalog frame; re-select is
  a no-op; a `ko→en→ko` burst settles on the last request.
- **creation-time non-translation** (§L3.4) — a task done in a KO UI vs an EN UI
  produces a **byte-identical GraphDoc**. Not translated: node/edge `label`,
  expression / `format`, `unit` / `resourceType`, document title / user
  description, the raw model value shown in the Inspector, the `label` a
  template seeds, `defaultData()`'s default `label` / value, and every wire
  identifier / diagnostic code / file-metadata key. Palette display name and
  model default are separate code paths.
- **catalog + ICU validation + the slice split** (§L12 #1, §L13) — CI over the
  whole registry checks: all messages parse; every `plural` / `select` has an
  `other` arm; argument **name** sets match `en`; argument **kind** (slot /
  number / date / plural / select) matches `en`; no rich-text tags; no empty
  strings; no unresolved key after fallback. Slices: **1** base +
  Toolbar/Play bar; **2a** model surface (Canvas / Inspector / Timeline +
  the non-translation boundary + diagnostic mapping); **2b** app surface
  (Import/Export, revision UI, templates UI, PWA bar, empty/error states,
  a11y/live region); **3** acceptance validation (full inventory + the
  KO/EN × device visual matrix + long-Korean/overflow/LOD/forced-colors/
  reduced-motion + app-wide invariance); then **guided tour**, then
  **inline help**.

**Decided (Lumi, cycle kickoff + the N-language clarification):**

- an **extensible localization base**; EN + KO are the first two shipped
  locales, not the scope. No two-way `if (lang === 'ko')` anywhere.
- a **locale registry** with per-entry metadata (code, English + native name,
  `direction` `ltr`/`rtl`, number locale, `enabled`, catalog thunk); the switch
  UI, tests, and fallback all read the registry. `enabled` is `true` for every
  shipped locale today — the selector work is what consumes it. The language's
  name *in the active UI language* is a separate, later addition alongside that
  selector work.
- **`en` is the base** — canonical key set and final fallback.
- **one key set for all locales**, CI-enforced for every registered locale.
- **per-language catalog** (`src/i18n/locales/<code>.ts`, or a
  `locales/<code>/` domain folder — §L3.3); a new language = one catalog +
  one registry line, zero edits elsewhere.
- **message format with plural / select / named slots from day one** (the
  formatter itself is decided in rev 2, Q2); string concatenation of
  translatable fragments is banned.
- **tests iterate the whole registry** — missing keys, extra keys, empty
  translations, placeholder mismatch, fallback.
- **language switch auto-generated from the registry.**
- `<html lang>` + `dir` + a11y text track the active locale.
- **RTL:** metadata field open; **no** RTL layout promise in v0.8.0.
- **one bundle for EN + KO**; the registry's catalog thunk keeps the door open
  for later **dynamic per-locale loading** with no effect on call sites or the
  GraphDoc / Workspace / Share boundary.
- chosen locale is `localStorage`-only, never serialized (§L5).
- model data / example strings / wire identifiers / error codes not translated
  (§L3.4).
- stored / digested / canonical-form numbers never reformatted; only UI-chrome
  numbers via `Intl` and only where needed (§L8).
- scope surfaces (§L6); CI blocks missing **and** unused keys; per-locale visual
  matrix; locale switch + locale addition leave viewport / sim state / undo
  invariant (§L12) — a switch's one write is the bounded §TLO11 official-
  bundled-template-label re-seed, which is label-only and touches no sim / undo
  step ([`template-label-overlay.md`](template-label-overlay.md)).
- guided tour + inline help are later slices on the finished base (§L13).

**Decided in rev 2 (Lumi — the five questions + the loader):**

- **Q1 — catalog module shape → TS module + `satisfies`** (§L3.3). `en.ts` is
  the canonical shape; `type MessageCatalog = Record<keyof typeof en, string>`;
  every other locale is `… satisfies MessageCatalog`, so `tsc` blocks a missing
  **or** an extra key at compile time. Keys are flat, stable IDs — translated
  text is never a type identifier or a lookup key. A JSON extraction pipeline
  comes only when a real translation-management tool needs it (separate, later).
- **Q2 — the formatter → `intl-messageformat` (FormatJS), used directly**
  (§L4.1). No hand-rolled ICU subset — nested plural/select, escaping, the
  `other` rule, and per-language CLDR plural categories are not worth
  re-implementing. Full ICU Message syntax (plural / select / selectordinal /
  `{n, number}` / `{d, date}` via `Intl.*`); the `t()` wrapper caches the
  compiled formatter keyed by `(locale, key, message)`; the dependency version
  is pinned in the lockfile; **rich-text tag callbacks are forbidden in
  Slice 1** (string output only — a separate decision if a surface needs
  markup).
- **Q3 — engine diagnostics → user-facing only this cycle** (§L7). Only
  UI-exposed diagnostics get the `{ code, params }` boundary. Codes
  (`M_REG_EVAL`, `EXPR_SYNTAX`, …) stay stable. The catalog is keyed by a
  **separate `error.<code>.message` key**, not the code itself. An unknown code
  ⇒ a stable generic localized message **with the raw code shown**. Structuring
  every internal assertion / dev error / `throw` is a separate follow-up. The
  frozen engine results and evaluation precedence do **not** change.
- **Q4 — Slice-1 anchor → Toolbar + Play bar** (§L13). The Inspector — the
  largest string / field / validation surface — is the start of Slice 2's full
  surface conversion.
- **Q5 — persistence key → one named bare string** (§L5.1):
  `localStorage["loop-studio/ui-locale/1"] = "ko"`. Validated against the
  registry on read; a corrupt / unregistered value is ignored (→ browser locale
  → `en`) and reading it never throws or mutates stored data; a switch updates
  only this key; never copied into Workspace / Share / GraphDoc; future UI
  settings each get their own key. No preferences schema or migration now.
- **Catalog loader & atomic activation** (§L4.5). EN + KO ship in one app
  deploy; activation is atomic and happens **only after** the target catalog is
  fully loaded — never a partially-translated frame. The contract is written for
  the async case from the start: the previous locale's screen stays up while the
  target loads; stale late-arriving requests are ignored; a load failure keeps
  the current locale; and no GraphDoc / Workspace / Share / PWA-data boundary
  depends on which catalogs are loaded or when, whatever the load strategy
  becomes.

## L15. Scope boundary

**In:** the `src/i18n/` registry + `t()` (`intl-messageformat` + compiled-formatter
cache) + the initial-language resolver + `<html lang>`/`dir`; the atomic-activation
loader (§L4.5, synchronous today, async-shaped); the auto-generated switch +
the single `loop-studio/ui-locale/1` key; `en` + `ko` catalogs for every §L6
surface; the §L7 user-facing engine-diagnostic `{ code, params }` rework; the
§L12 registry-wide verification set + the per-locale visual matrix. Then the
guided tour and inline help as separate slices.

**Out (this cycle):** any RTL-correct layout (`dir` metadata only); rich-text
tag callbacks in messages; machine translation; translating model data, example
GraphDoc strings, wire identifiers, or diagnostic codes; changing any serialized
format, digest, or `loop-*/N`; a per-locale bundle or deploy; **actually**
dynamic-loading catalogs (the thunk seam is built, real chunks are not);
restructuring internal / developer-only engine errors; reformatting stored /
digested / canonical-form numbers; locale-aware date rendering beyond a single
`Intl.DateTimeFormat` call if a date ever surfaces; a translation-management
service or crowd workflow; a third **shipped** locale (the base must *accept*
one; this cycle does not *ship* one).
