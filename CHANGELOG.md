# Changelog

All notable Loop Studio releases, newest first. Behavioral changes are pinned
in versioned spec documents (see the [README](README.md#technical-reference));
this file is the narrative history, not the contract.

## Unreleased

### Fixed

- **Share links and saved frames / data-import records** — opening a `#g1=`
  share link kept the *previous* document's group frames and data-import
  table records (they leaked into the shared graph and its next Export /
  revision digest) and dropped the frames the link itself carried. A link now
  replaces both, exactly like a file Import does.

## v0.10.1 — 2026-09-16

Patch release: Project revision / proposal files of a `@parameter` document.

### Fixed

- **Project revision / proposal files of a `@parameter` (loop-model/2)
  document** — v0.10.0 wrote every revision and proposal with the v1 envelope
  `"schema": "loop-studio/graph"` while computing `project.contentDigest`
  under the v2 projection, so such a file failed its own integrity check on
  import (the project header was dropped with a misleading "edited outside
  Loop Studio?" warning) and its graph loaded as v1 — every `@…` flow
  silently ran as the literal `1`. Both bundled v2 Templates (Coffee roastery,
  3-zone gacha) were affected. Now: the writer emits the document's real
  envelope (`loop-studio/graph/2`) and projects a proposal's first-creation
  `base` at the same version; the reader recovers an already-exported v0.10.0
  file **only** when its `project.contentDigest` verifies under the v2
  projection (digest is the proof — nothing else ever promotes a file; a file
  that matches neither projection is dropped exactly as before, and genuine v1
  files are untouched). Apply keeps the open document's model version and
  refuses a v1 ↔ v2 cross-version proposal before anything changes
  (`version-mismatch`, whole and per-hunk); "Open as a document" preserves the
  proposal's own version. A recovered legacy proposal's v1-projected `base` is
  read verbatim, so it classifies as `unknown` (confirmation kept) rather than
  being promoted to `exact`. Fixtures: `examples/revision-legacy-v0.10.0/`.

## v0.10.0 — 2026-09-16

Data import, a fifth Template, tunable activator thresholds, conditional
post-pull state updates, and a reorganized desktop toolbar.

### Added

- **Spreadsheet data import** ([`docs/data-import.md`](docs/data-import.md))
  — paste or upload a CSV/TSV snapshot across multiple linked tables (joined
  by shared key columns, no formulas). Numeric cells materialize as ordinary,
  editable Parameter nodes; import does not auto-wire them into the graph's
  flows, Registers, or activators, while source provenance is retained for
  refresh. No live connection, no OAuth, and Loop Studio never writes back to
  the source file (`#202`, `#203`).
- **Data refresh, three-way diff & change-proposal export** — re-paste the
  same binding's updated data and **Refresh** walks the full row lifecycle
  (added / missing / value-changed / key-changed) against a real base /
  local / incoming three-way diff; a genuine conflict prompts *apply
  incoming* or *keep mine*, and a foreign-key re-point is always surfaced,
  never auto-applied. A **change-proposal CSV** export lets a designer paste
  tuned values back into their own spreadsheet by hand (`#204`).
- **3-zone gacha banner comparison Template** — a fifth bundled Template
  comparing **General/Free** (base rates), **Premium Standard** (a tunable
  hard-pity ceiling), and **Premium Pickup** (hard-pity plus a pickup
  guarantee) side by side, 200 pulls per zone under identical run settings,
  with real hit-rate / pickup-rate results and a Monte Carlo outcome
  distribution (`#195`–`#199`).
- **`@parameter` activator references** ([`docs/parameter-activator.md`](docs/parameter-activator.md))
  — an activator's comparison threshold can reference a Parameter node
  (optionally ± one integer offset) instead of only a hardcoded literal, with
  a live resolved-value preview in the Inspector (`#187`–`#189`).
- **Conditional post-pull state updates** ([`docs/conditional-state-update.md`](docs/conditional-state-update.md),
  [`docs/label-timing-authoring.md`](docs/label-timing-authoring.md)) — a
  `label` modifier can now apply in a new **Phase 2.5**, immediately after
  that step's pull, conditioned on whether the specific Gate / Converter /
  Drain / End it's attached to actually fired — letting a counter update or
  reset within the very same step a hard-pity-style condition resolves,
  something a `phase0` label (evaluated before the pull) could not express.
  The Inspector offers this as two named presets — **Always** (today's
  behaviour) or **When the source fires** — that cannot construct an
  invalid `timing`/`when` combination (`#181`, `#183`).
- **Desktop two-tier toolbar** — project/app commands (Templates, Insert
  module, **File**, **Data**, Share, **Settings**, Help) collapse to one
  fixed row; the node palette keeps its own row underneath. New/Import/
  Export are unified under **File ▾**; Theme/Language move under
  **Settings ▾**.

### Changed

- **Gacha Template canvas readability** — a Parameter reference used in a
  resource flow or an activator threshold now shows its resolved current
  number instead of the raw internal id (with a translated fallback for a
  dangling/invalid reference); connector routing and label placement were
  retuned to remove overlaps in the busiest zones (`#206`).
- **Data import wizard UX** — **Next** now stays disabled until every table
  draft has both a name and pasted data, so a downstream validation error
  can no longer surface before that basic precondition is met; the
  fixable-now root causes are flagged inline on the same screen instead of
  a separate error step; the table-name field, upload/delimiter controls,
  and layout were cleaned up. Help's position among the toolbar's inline
  actions was also pinned last at the time — since superseded by this
  release's own two-tier toolbar reorganization, above (`#205`).
- **Playback default speed** — a fresh document's default step speed is now
  medium-fast (600 ms) instead of the slowest stop (`#193`).
- **Bundled module labels** — inserting a bundled Building block into a
  KO/JA document localizes its labels on that fresh insert (`#185`); a later
  EN/KO/JA switch now keeps that instance's still-unedited official labels in
  sync too, in both the menu-insert and canvas-drag-insert paths, without
  touching any label the user has since renamed
  ([`docs/bundled-module-label-localization.md`](docs/bundled-module-label-localization.md)).
- **In-app feedback** — the Help menu's `Send feedback` link now opens Tally
  instead of Typeform (`#177`).

### Fixed

- **Pull-all Converter conservation** — an all-or-nothing Converter that
  couldn't reach full flow because an upstream Gate or router only offered a
  partial amount used to silently destroy that resource instead of holding
  back; the engine now probes the full pull graph first and disables a short
  Converter before committing the step (`#179`).
- **Japanese font fallback** — corrected a CJK font-fallback issue affecting
  Han-unification rendering in the Japanese UI (`#186`).
- **Canvas edit-lock persistence** — the edit lock no longer resets on a
  page reload or a PWA update (`#192`).
- **Confirm-dialog double-click guard** — a rapid double-click on a
  `ConfirmDialog`'s Confirm button (Export, New, module promote, …) could
  run the confirmation action twice; it now fires at most once per open
  (`#210`).
- **Locale-switch stall** — a duplicate, redundant per-node re-measurement
  alongside React Flow's own automatic one turned a multi-node document's
  locale switch into a multi-second stall (worst case 6–7s); removing the
  redundant call cut that to about 1s without any loss of measurement
  correctness (`#211`).
- **Toolbar menu outside-dismiss** — an open Tier-1 menu (Templates, Insert
  module, File, Data, Settings, Help, the `⋯` overflow) no longer closed on
  a canvas node click, a canvas pan, or a scroll outside it — a regression
  from the two-tier toolbar reorganization above (`#212`).
- **Palette tooltip visibility** — the hover/keyboard-focus tooltip on any
  of the 8 node-creation chips was invisible at every desktop width,
  silently clipped by the toolbar palette's own horizontal-scroll
  container — another regression from the same reorganization (`#212`).

### Compatibility

- **`@parameter` activators** (`loop-state/4`, [`SEMANTICS-S4.md`](docs/specs/SEMANTICS-S4.md))
  need no new revision format and no migration. An **unmodified** existing
  document's projection and digest are unchanged. Committing a `@parameter`
  reference in an activator engages the existing `loop-model/2` v1→v2
  `modelVersion` latch (never on load, only on that edit) — the same
  one-way promotion a resource-edge flow already triggers. Actually editing
  an activator's `expr` or a Parameter's `value` is real content change and
  moves the digest exactly as it already does today, with or without this
  feature.
- **Conditional post-pull labels** (`loop-state/3`, `loop-revision/6`) — an
  existing label edge (which has never had a `timing`/`when`) opens and
  reads as **Always**, byte-identical to today. A document that actually
  uses the new **When the source fires** timing *does* move its revision
  content digest and workspace digest — that's real engine behaviour, not
  cosmetic, so a revision or workspace comparison correctly reports it as a
  genuine change rather than noise.

## v0.9.0 — expression authoring, ordered playback & in-app feedback

Four backward-compatible additions on top of v0.8.0 — no engine, schema,
wire-contract, or digest change, and no new `loop-*/N` id.

- **Register expression authoring & readability** ([`docs/register-expression-authoring.md`](docs/register-expression-authoring.md))
  — editing a Register formula no longer means typing raw `@pool_mttqb36u_2`
  ids. An **`@` autocomplete** lists only Pool / Parameter / Register nodes; a
  **two-line read-back** spells the expression out by name and by value
  (`Wallet + Savings` → `Wallet 3 + Savings 34 = 37`); a **`＋ Insert reference`**
  button arms a one-shot mode that inserts `@id` at the caret on the next
  canvas click; an **operator keypad** (`＋ − × ÷ ( )`) covers the rest.
  Content-aware Register / Parameter shells
  ([`docs/node-shell-content-in-vessel.md`](docs/node-shell-content-in-vessel.md))
  keep the title/value/expression line inside the drawn vessel across widths
  and locales. Presentation-only — `@id` stays the sole stored form and the
  `loop-revision/2` digest is unchanged. EN / KO / JA.
- **Ordered playback cascade + steady-state** ([`docs/simulation-playback-ordering.md`](docs/simulation-playback-ordering.md))
  — within a step, transfers now depart and arrive in **dependency order**
  (staggered by longest-predecessor depth over the graph's SCC condensation)
  instead of one simultaneous pulse, with distinct **emit / converge / absorb**
  cues by role, and a "flows continue" **steady-state** chip once a run
  settles. Still a display layer only — no engine / RNG / GraphDoc change.
- **In-app feedback** — a `Send feedback` entry in the Help menu (desktop and
  mobile) opens the feedback form in a new tab.
- **日本語 as a third shipped locale + multilingual layout** — the `ja` catalog
  loads as its own chunk on demand; two-line node titles and height-parametric
  node shells ([`docs/mmo-multilingual-layout.md`](docs/mmo-multilingual-layout.md))
  let EN / KO / JA labels fit the same graph without overlap.
- **Large-graph readability follow-ups** — a collapsible minimap and a
  Timeline series picker (a curated set of series, the rest one `+N more`
  click away). UI-only.

## v0.8.0 — Onboarding, part 2 & the Productization track

Localization, the guided first-run tour, the Early MMO example, and
contextual inline help complete Onboarding, part 2; large-graph readability, a
small module / template-composition system, dense-graph pan usability, and a
first `loop-model/2` Template complete this cycle's slice of the
Productization track. Two backward-compatible wire-contract extensions ship —
`loop-model/2` and `loop-revision/5` — neither moves a document's digest
unless it actually uses the new capability.

- **Onboarding, part 2** — an N-language-extensible **localization** base
  shipping EN + KO, full-app translation with CI drift guards, a read-only
  six-step **guided first-run tour**, the **"Early MMO progression"** example
  as a third Template, and **contextual inline help** (four one-shot
  situational hints, re-armable from a `Contextual help` menu entry).
- **Large-graph readability** ([`docs/large-graph-readability.md`](docs/large-graph-readability.md))
  — a hit-test fix + selection-driven 1-hop focus view, ephemeral filters, the
  `effective` / `evaluated` run distinction, manual **and** auto-suggested
  group frames with a five-preset accent colour, and **saved frames**
  (`loop-revision/5`) — a frame's `id`/`label`/`rect`/`color` becomes real
  document content that round-trips every export/import path.
- **Small module / template-composition system** ([`docs/module-system.md`](docs/module-system.md))
  — an **Insert module ▾** menu and **Extract selection as module…** (desktop
  only): every id re-issued, the whole candidate validated before anything
  changes, one atomic undo. A module is a plain Graph JSON — no new file kind.
  Alongside it, desktop **Inputs** and **Summary** panels read-through to the
  canvas.
- **The Coffee roastery operations flow Template** — the first bundled
  `loop-model/2` graph: a resource edge's `flow` may be a single Parameter
  reference the engine resolves once per step, so its five surfaced
  Parameters drive a real stock trajectory.
- **Dense-graph pan usability** ([`docs/dense-graph-pan.md`](docs/dense-graph-pan.md))
  — a pan-capture overlay and a self-computed two-finger pinch zoom make a
  packed graph pannable and zoomable on both desktop and mobile, real-phone
  verified.

**Known limitations in this release:** module **Insert** / **Extract** are
desktop only, with no mobile flow yet; a Graph or Workspace file re-saved by
an older build does not preserve fields it doesn't recognise. Scenario
Compare, an advanced Monte-Carlo worker-count setting, manual waypoint
editing, and the module system's later assembly-screen work were deliberately
left for later.

## v0.7.0 — orthogonal routing & simulation playback

Two render-layer additions on top of the same engine — the deterministic
simulation result and every serialized byte are unchanged.

- **Automatic orthogonal edge routing** ([`docs/edge-routing.md`](docs/edge-routing.md))
  — `route: "orthogonal"` swaps an edge's Bézier curve for right-angle
  segments from a deterministic obstacle-avoiding router. `route` /
  `waypoints` are `loop-revision/3` **cosmetic** wire fields — a graph using
  no routing has an unchanged content digest. Manual waypoint editing was
  deliberately deferred.
- **Simulation Playback / Event Choreography** ([`docs/simulation-playback.md`](docs/simulation-playback.md))
  — pressing Play makes the model move: a resource visibly departs, travels
  the exact rendered edge path, arrives, and only then does the value update,
  on a shared per-step time axis. State events choreograph too (`trigger` /
  `activator` / `label`). Handles `prefers-reduced-motion`, an L0 elision,
  background-tab freeze-and-recover, a mobile layout, an a11y live region,
  and a bounded on-screen token count. **Display layer only** — no new engine
  oracle.

## v0.6.0 — model language & canvas visual refresh

A small deterministic modelling layer on top of the engine, and one visual
grammar for the canvas. Edge geometry and Scenario Compare were deliberately
not in this release.

- **Parameter & Register nodes** — a `parameter` is a tuned numeric input; a
  `register` holds a `loop-expr/1` expression whose value `R(t)` is
  recomputed from the committed snapshot each step and stored nowhere. `/0`,
  a self/mutual cycle, an unknown reference, or a depends-on-invalid cascade
  each surface an error code and never halt the run.
- **Advisory `resourceType`** — a free-text tag on pools and resource edges
  with a built-in palette, icon, legend, and Inspector mismatch note. Purely
  advisory.
- **`loop-revision/2`** — the revision projection/diff/Apply extended for the
  model layer; a graph with no model layer is byte- and digest-identical to
  `loop-revision/1`.
- **Canvas Visual Refresh** ([`docs/visual-language.md`](docs/visual-language.md))
  — every node and edge on one "Vessel" grammar: edge class/direction/cues,
  three zoom detail levels that elide only supplementary text, a renderer-owned
  direction marker, `prefers-reduced-motion` and `forced-colors` support.
  Edge paths stayed on React Flow's Bézier route — orthogonal routing shipped
  in v0.7.0.

## v0.5.0 — project revisions & proposals

File-based **asynchronous collaboration** ([`SEMANTICS-R.md`](docs/specs/SEMANTICS-R.md))
— no accounts, no server, no real-time sync. A project moves between people
only as JSON files. See [`examples/revision/README.md`](examples/revision/README.md)
for a worked walkthrough of the create → propose → review → apply flow.

- **Project revision files** and **proposals** — `Export ▾` writes a graph
  doc carrying a stable `projectId` and revision lineage; a proposal carries a
  complete snapshot so diff and apply run entirely offline.
- **Non-destructive Review** — an id-keyed three-way diff (`base`/`theirs`/`yours`),
  `exact`/`divergent`/`unknown` classification; desktop panel === mobile sheet.
- **Whole-proposal Apply** and **selective per-hunk Apply** — per-field
  *take theirs* / *keep mine*, node-removal dependencies resolved by removal
  or retarget, invalid selections refused before anything changes.
- **Atomic** — either path yields one new local revision, one undo entry, and
  a sim reset to step 0; a single Undo restores everything.

## v0.4.0 — ship: workspace, links, offline, mobile view/run

- **Workspace Export / Import** — an optional `workspace` key carrying the
  run config, the last Monte-Carlo distribution, the timeline view, the
  canvas viewport, and a verified simulation snapshot. 8 MiB cap,
  all-or-nothing.
- **Shareable URL** — a `Share` button copies a `#g1=<payload>` link
  (zlib-wrapped DEFLATE + base64url, 8 KiB cap, graph only).
- **Installable offline PWA** ([`docs/pwa.md`](docs/pwa.md)) — precaches the
  whole app shell; updates surface a dismissible bar, applied only on click.
- **Mobile view/run layout** ([`docs/mobile.md`](docs/mobile.md)) — below a
  720px breakpoint: full-bleed canvas, finger pan/pinch-zoom, a fixed bottom
  bar, a Timeline sheet, a read-only Inspector sheet. Structural editing is
  locked; the desktop layout is unchanged above the breakpoint.

## v0.3.0 — executable state connections

State edges (`trigger` with an integer `delay`, AND-combined `activator`
level gates, `label` Pool modifiers) now run as a Phase 0 at the top of every
step — frozen as `loop-state/1`/`loop-state/2`
([`SEMANTICS-S.md`](docs/specs/SEMANTICS-S.md)). The canvas shows a travelling pulse on a
trigger's delivery step, a steady tint for an open activator, and a `delta`
flash for a label. Covered end-to-end by `examples/state-verification.json`.

## v0.2.0 and earlier

v0.2.0 shipped Engine B (seeded RNG, probabilistic gates) and the Monte-Carlo
engine + UI. Before that: the diagram editor (add / connect / edit nodes,
JSON import/export, autosave), the deterministic engine (step / play / reset,
single-run timeline), Cloudflare Pages deployment with GitHub Actions CI, and
the first onboarding pass (starter templates, verification fixtures, the
*Risky Factory* example).
