# Localization (non-frozen design doc — DRAFT)

**Status: DRAFT — rev 2, for review.** Rev 1's direction was accepted; rev 2
closes the five §L14 open questions (Q1 TS-module catalogs + `satisfies`; Q2
`intl-messageformat`; Q3 user-facing diagnostics only this cycle; Q4 Toolbar +
Play bar as the Slice-1 anchor; Q5 a single `loop-studio/ui-locale/1` string
key) and pins the **catalog loader + atomic-activation** contract (§L4.5). Still
**not frozen and not implementation-approved** — rev 2 is for one more pass on
fallback, async switching, the user-input non-translation boundary, and the
slice split.

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

**L3.3 — per-language files, TS module + `satisfies` (Q1 — decided).**
`src/i18n/locales/en.ts`, `src/i18n/locales/ko.ts`, … — each a TypeScript module
default-exporting a plain object literal. `en.ts` is authored first and **is**
the canonical shape:

```ts
// locales/en.ts
const en = {
  'toolbar.export': 'Export',
  'playback.status.stepN': 'Step {n}',
  // …
} as const
export type MessageCatalog = Record<keyof typeof en, string>
export default en
```

```ts
// locales/ko.ts
import type { MessageCatalog } from './en'
const ko = {
  'toolbar.export': '내보내기',
  'playback.status.stepN': '{n}단계',
  // …
} satisfies MessageCatalog          // ← tsc errors on a missing OR an extra key
export default ko
```

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

**L4.4 — the fallback chain: `active → en → visible key`.** `t()` for a key
absent from the active locale's catalog renders the `en` string (dev: console
warn; CI: hard fail via §L12 #1, so this never ships). Absent from `en` too ⇒
the key text rendered **visibly**, with a test hook — never an empty string,
never a thrown render. A malformed ICU message (should be caught by CI) falls
back the same way: the `en` message, then the raw pattern, never a crash.

**L4.5 — catalog loading & _atomic_ locale activation (decided).** In v0.8.0 EN
and KO both ship in the one app deploy, so the "load" is synchronous today — but
the activation contract is written for the async case from the start so a later
move to dynamic chunks is a loader swap only:

- **activation is atomic and only _after_ the target catalog is fully loaded.**
  The provider exposes the *active* locale; a switch request loads the target
  catalog, then swaps in one render. There is no interval where some strings are
  new and some are old.
- **the previous locale's screen stays rendered while the target loads** — no
  spinner-blanking of the UI, no partially-translated frame.
- **stale requests are ignored.** If the user switches A→B→A (or B→C) while B is
  still loading, a late-arriving B result is dropped; only the newest request
  can activate.
- **on load failure the current locale is kept** — the switch is a no-op with a
  one-time non-blocking notice; nothing half-applies.
- **the data boundary is unchanged regardless of load strategy:** no GraphDoc,
  Workspace, Share, revision, or PWA-precache bytes depend on which catalogs are
  loaded or when. (The PWA precache set covers whatever catalogs the build
  statically includes; a future dynamic chunk is a runtime fetch cached by the
  runtime-caching rule, not part of the precache manifest — no `sw.js`
  contract change for EN/KO.)
- a test drives a **deferred** catalog loader (a controllable promise) to assert
  the four rules above without needing real chunks.

## L5. The language switch

**Auto-generated from the registry.** The control lists `nativeName` for every
registered locale in registry order, marks the active one, and needs **no edit**
when a locale is added. It sits next to the theme toggle — desktop `Toolbar`,
mobile `MobileMoreMenu`. Changing it: kicks off the atomic activation (§L4.5),
persists the new `code` (§L5.1), sets `<html lang>` / `<html dir>` from the
entry's metadata **on activation**, and announces the change once in the live
region. No reload, no run interruption, no viewport change.

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

**L5.2 — initial resolution** at first paint (before React mounts, to avoid a
flash):

1. a stored `loop-studio/ui-locale/1` **whose value is a registered `code`**
   wins;
2. else, the first registered locale whose `code` matches `navigator.languages`
   by primary subtag (so `ko-KR` → `ko`);
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

## L11. Development affordances

- **`?lang=<code>`** query param (dev + e2e only) forces a locale for a session
  without touching `localStorage` — used by the §L12 tests.
- **key-visibility mode** (a dev flag) renders every `t()` call as its raw key
  instead of a message, so an un-keyed hardcoded string on a surface is
  obvious at a glance.
- **missing-key console warnings** in dev (they are a hard CI failure, §L12 #1,
  so they never reach production).
- these are stripped from the production bundle the same way as the existing
  `import.meta.env.DEV` probes (byte-checked by `e2e/portable-file.spec.ts`).

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
- CI checks #1–#3 and #5–#8; the visual matrix (check #4) for just these two
  surfaces.
- **the invariance assertion** (§L12 #5): switching KO↔EN before, during, and
  after a run leaves the GraphDoc bytes, the `loop-revision/3` digest, undo /
  redo, the viewport, `simulationRev`, and `SimState` (values / stepIndex)
  byte-for-byte unchanged.
- **no behaviour change beyond the switch**; the Inspector, Timeline, dialogs,
  revision UI, etc. stay English until Slice 2.

**Slice 2 — full surface conversion.** The rest of §L6 — **the Inspector first**
(the largest surface: every field label, unit, activation / mode option,
validation hint, `resourceType` note), then Timeline, Monte Carlo, Import /
Export / Workspace, revision UI, PWA update bar, boot / share, Templates,
Shortcuts, and all remaining errors / empty states / a11y strings — surface by
surface, each with its `en` + `ko` catalog additions and its visual-matrix
cells. The §L7 user-facing engine-diagnostic `{ code, params }` rework lands
here.

**Slice 3 — per-locale visual matrix.** Check #4 completed across every §L6
surface and every registered locale × light/dark × desktop/mobile, committed.

**Slice 4 — guided first-run tour.** On the finished base. Its own design pass.

**Slice 5 — contextual inline help.** On the finished base. Its own design pass.

## L14. Decision record

No open questions as of rev 2. Rev 2 is still for review — fallback (§L4.4),
async / atomic activation (§L4.5), the user-input non-translation boundary
(§L3.4), and the slice split (§L13) are the parts to re-confirm before a freeze
or an implementation go.

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
  matrix; locale switch + locale addition leave GraphDoc / digest / undo /
  viewport / sim state invariant (§L12).
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
