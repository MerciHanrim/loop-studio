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
   Cyrillic, Thai and Arabic marks are left alone for the same reason. The
   guard is a test, not a comment: searching `ポ` must return **zero** results.

2. **Every kind of space folds to one ASCII space** — U+00A0 and U+202F
   included — so a typed space matches the typeset one French names may
   carry (§L2.8).

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
2. Else, walk `navigator.languages` **in order**. For each entry `L`:
   1. **exact match** — a registered `code` equal to `L` (e.g. a hypothetical
      `pt-BR` catalog and `navigator` `pt-BR`);
   2. else **BCP-47 base-language match** — a registered `code` equal to `L`'s
      primary subtag (`ko-KR` → `ko`, `en-GB` → `en`).
   The first entry that resolves wins; move to the next `navigator` entry only
   if the current one resolves to nothing.
3. Else, the **canonical fallback `en`**.

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
