# Localization (non-frozen design doc — DRAFT)

**Status: DRAFT for review.** First cut of the Onboarding-part-2 localization
base. A **UI-chrome-only** layer: it changes the *language of the interface*,
nothing the engine computes, nothing that is serialized, and no wire contract.
It carries no `loop-*/N` id and is revised freely (like `docs/visual-language.md`,
`docs/mobile.md`, `docs/edge-routing.md`). §L14 is the decision record; §L12 the
verification set; §L13 the slices; §L15 the scope boundary.

**The project is an _extensible localization base_, not a "KO/EN translation".**
The first two shipped locales are **English** and **Korean**; the structure must
accept a third (`ja`, `de`, `fr`, …) with **no change to existing code or
catalogs — only a new locale file plus one registry line.** Any `if (lang ===
'ko') … else …` two-way branch is a bug.

**Build order:** this design doc → merge; then the base (§L2 registry + §L3
catalog + §L4 message format + §L5 switch) → surface conversion (§L6) → the
per-locale visual + regression matrix (§L12); then, on the finished base, the
guided first-run tour and contextual inline help as their own slices. **No
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
  nativeName:  'English',       // shown in the switch UI, in that language
  dir:         'ltr',           // 'ltr' | 'rtl' — metadata only in v0.8.0 (§L9)
  numberLocale:'en',            // BCP-47 tag for Intl.* when UI-chrome numbers
                                // are formatted (§L8); never touches stored data
  catalog:     () => import('./locales/en'),   // see L3.3 (static today)
}
```

Adding a language = append one entry + add one `locales/<code>.ts` file. No
existing file changes.

**L2.3 — the base and fallback locale.** `en` is the **base**: its catalog
defines the canonical key set (§L3.1) and is the **final fallback** for any key
missing from another locale. The fallback chain is `active → en`; there is no
per-region chain in this cycle (`ko-KR` resolves to `ko`, not a `ko-KR` catalog).

## L3. The string catalog

**L3.1 — one key set, defined by `en`.** Every locale's catalog has **exactly**
the keys that `en` has — no missing, no extra. This is enforced in CI for
**every registered locale** (§L12 #1), not just `ko`.

**L3.2 — keys.** Flat, dotted, namespaced by surface:
`toolbar.export`, `inspector.node.capacity`, `timeline.trackAll`,
`error.M_REG_EVAL.message`, `a11y.playback.status.stepN`. Keys are ASCII and
never built from user data or file content at a call site.

**L3.3 — per-language files.** `src/i18n/locales/en.ts`, `src/i18n/locales/ko.ts`,
… — each a typed module exporting a `Record` (or a `satisfies Catalog` object so
`tsc` flags a shape mismatch against the `en`-derived type). Catalogs as **code,
not JSON**, so the type system carries the key set and a translator edits one
self-contained file. They are **statically imported** for `en` + `ko` in
v0.8.0 (§L2.1 one bundle); the `catalog: () => import(...)` shape in the
registry is already a thunk so a later switch to **dynamic per-locale loading**
(when many locales make the bundle heavy) is a loader change **only** — it does
not touch call sites, the key set, or the GraphDoc / Workspace / Share boundary.

**L3.4 — what is *not* in the catalog.**

| category | in the catalog? | note |
|---|---|---|
| UI chrome — buttons, menus, labels, tooltips, hints, dialog copy, empty states | **yes** | the whole of §L6 |
| accessibility names + live-region text | **yes** | §L10 |
| error / warning **message text** (+ the "how to fix" line) | **yes** | keyed by code, §L7 |
| error / diagnostic **codes** (`M_REG_EVAL`, `EXPR_SYNTAX`, `M_REG_CYCLE`, …) | **no** — permanently stable | the code *is* the lookup key |
| user-authored model data — node `label`, an expression, a `unit`, a `resourceType` | **no** — verbatim | round-trips unchanged; never reformatted or machine-translated |
| example / fixture GraphDoc strings (`examples/*.json` labels) | **no** | a locale switch never rewrites `"Ore Stock"` |
| wire identifiers, the `tool` string | **no** | ASCII / English forever |

**The line:** anything the user or a file author wrote stays as written; anything
Loop Studio's own chrome says gets a key.

## L4. Message format

**L4.1 — a `t(key, params?)` helper, no concatenation.** Components call
`t('playback.status.stepN', { n })`. **Assembling a sentence from translatable
fragments in a component is forbidden** — `"Step " + n`, `t('a') + t('b')`,
`<>{t('x')} {value}</>` where word order matters — because order, particles, and
spacing differ by language. A string with a runtime value is **one key with a
named slot**: `"Step {n}"` / `"{n}단계"`.

**L4.2 — plural / select from the start.** The format supports ICU-style
`{n, plural, one {# item} other {# items}}` and `{g, select, …}` from day one
(a small formatter, or a vetted micro-dep — §L14-Q2), because Korean has no
plural but a future locale will, and retrofitting a formatter across every call
site later is exactly the kind of two-way assumption this doc bans. English +
Korean catalogs simply won't use the plural arm much; the mechanism is there.

**L4.3 — placeholder validation.** Every catalog entry's placeholder set must
match the `en` entry's placeholder set (same names, no extras); CI checks this
for every locale (§L12 #1). A call site passing an unknown param, or omitting a
required one, is a dev-time throw + a test.

**L4.4 — missing key ⇒ `en`, then the key.** `t()` for a key absent in the
active locale returns the `en` string (dev: console warn; CI: hard fail).
Absent from `en` too ⇒ the key text, visibly, with a test hook — never an empty
string.

## L5. The language switch

**Auto-generated from the registry.** The control lists `nativeName` for every
registered locale in registry order, marks the active one, and needs **no edit**
when a locale is added. It sits next to the theme toggle — desktop `Toolbar`,
mobile `MobileMoreMenu`. Changing it: writes `localStorage['loop-studio:lang']`
(§L2 persistence below), re-renders with the new catalog, sets `<html lang>` and
`<html dir>` from the entry's metadata, and announces the change once in the
live region. No reload, no run interruption, no viewport change.

**Persistence & initial resolution.** The chosen `code` is a **`localStorage`-only
UI setting** (`loop-studio:lang`), per-browser, like the theme choice — **never**
in the GraphDoc, Workspace / Share payload, revision / proposal file, the
`loop-revision/*` digest, undo, or `simulationRev`. Resolution at first paint
(before React mounts, to avoid a flash):

1. a stored `loop-studio:lang` **that is a registered `code`** wins;
2. else, the first registered locale whose `code` matches
   `navigator.languages` by primary subtag (so `ko-KR` → `ko`);
3. else the **base locale** (`en`).

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

## L7. Errors, warnings, diagnostics

- **UI-raised** (validation hints, import failures, size-cap prompts, Share
  too big) — keyed message text.
- **Engine diagnostics** (`src/engine/*` — `report.diagnostics`, thrown `Error`
  messages, the Monte-Carlo cell-limit string). The engine is deliberately
  **dependency-free and UI-agnostic** (`SEMANTICS.md`) — it must not import an
  i18n runtime. Resolution: the engine emits a **stable code + structured
  params** (`{ code: 'MC_CELL_LIMIT', limit, cells, mb }`); the UI renders a
  localized sentence keyed by the code. Where the engine returns a pre-formatted
  English string today, keep it as an **untranslated developer-facing fallback**
  and add the UI-side localized rendering. The exact engine-code list =
  §L14-Q3.

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

## L11. (reserved)

## L12. Verification — every check iterates the whole registry

1. **Catalog integrity (CI, hard fail).** For **each registered locale**: its
   key set equals `en`'s exactly (no missing, no extra); every entry's
   placeholder-name set equals the `en` entry's; no empty-string translations.
   A script (`scripts/check-i18n.mjs`, in the `checks` job) loads the registry
   and loops — it is **not** written against `ko`.
2. **No missing / unused keys (CI).** Every `t('…')` call-site key exists in
   `en`; every `en` key is referenced somewhere (grep, with an allowlist for
   dynamically-selected error codes).
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

## L13. Slices

1. **Base** — `src/i18n/` (registry, `t()` + provider, the message formatter,
   the initial-language resolver, `<html lang>` / `dir`), the auto-generated
   language switch, `en` + `ko` catalogs for **one anchor surface**
   (proposal: Toolbar + Play bar), checks #1–#3, #5–#8 wired. No behaviour
   change beyond the switch.
2. **Surface conversion** — the rest of §L6, surface by surface, each with its
   `en` + `ko` strings and matrix cells; the engine-code rework (§L7).
3. **Per-locale visual matrix** — check #4 completed and committed.
4. **Guided first-run tour** — on the finished base. Its own design pass.
5. **Contextual inline help** — on the finished base. Its own design pass.

## L14. Decisions & open questions

**Decided (Lumi, cycle kickoff + the N-language clarification):**

- an **extensible localization base**; EN + KO are the first two shipped
  locales, not the scope. No two-way `if (lang === 'ko')` anywhere.
- a **locale registry** with per-entry metadata (code, English + native name,
  `dir`, number locale, catalog thunk); the switch UI, tests, and fallback all
  read the registry.
- **`en` is the base** — canonical key set and final fallback.
- **one key set for all locales**, CI-enforced for every registered locale.
- **per-language files** (`src/i18n/locales/<code>.ts`); a new language = one
  file + one registry line, zero edits elsewhere.
- **message format with plural / select / named slots from day one**; string
  concatenation of translatable fragments is banned.
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
  matrix; locale switch + locale addition leave GraphDoc / digest / undo /
  viewport / sim state invariant (§L12).
- guided tour + inline help are later slices on the finished base (§L13).

**Open — need a call before the base slice:**

- **Q1 — catalog module shape.** A plain `export default { … } satisfies
  Catalog` object per locale, with `Catalog` derived from `typeof enCatalog` so
  `tsc` flags shape drift — vs a JSON file + a generated type. Proposal: TS
  module + `satisfies`, for compile-time key safety and translator-friendly
  single files.
- **Q2 — the formatter.** Hand-rolled ICU-subset (`{name}`, `{n, plural, …}`,
  `{g, select, …}` — ~80 lines) vs a vetted micro-dep (`@formatjs/intl`,
  `messageformat`). A dep adds bundle weight + supply-chain surface; a
  hand-rolled subset covers what KO/EN and the near-term locales need. Proposal:
  **hand-rolled ICU-subset**, with a clear seam to swap in `messageformat` if
  requirements outgrow it.
- **Q3 — engine diagnostic codes.** Rework **all** `report.diagnostics` +
  thrown engine `Error`s to `{ code, params }` now, or only the user-facing ones
  (cell-limit, import failures) this cycle and leave the long tail as English
  developer strings. Proposal: **user-facing only** now; a follow-up for the
  rest.
- **Q4 — anchor surface for Slice 1.** Toolbar + Play bar (small, high
  visibility) vs Inspector (largest, exercises field/unit/validation early).
  Proposal: Toolbar + Play bar.
- **Q5 — `localStorage` key name + shape.** `loop-studio:lang` = `"ko"` (bare
  code) vs a small JSON blob for future prefs. Proposal: bare code string,
  matching the theme key's simplicity.

## L15. Scope boundary

**In:** the `src/i18n/` registry + `t()` + formatter + resolver + `<html
lang>`/`dir`; the auto-generated switch + `localStorage` persistence; `en` + `ko`
catalogs for every §L6 surface; the engine user-facing-diagnostic rework
(§L7 / Q3); the §L12 registry-wide verification set; the per-locale visual
matrix. Then the guided tour and inline help as separate slices.

**Out (this cycle):** any RTL-correct layout (metadata only); machine
translation; translating model data, example GraphDoc strings, or wire
identifiers; changing any serialized format, digest, or `loop-*/N`; a per-locale
bundle or deploy; **actually** dynamic-loading catalogs (the seam is built, the
loader is not); reformatting stored / digested numbers; locale-aware date
rendering beyond a single `Intl.DateTimeFormat` call if a date ever surfaces; a
translation-management service or crowd workflow; a third shipped locale (the
base must *accept* one, this cycle does not *ship* one).
