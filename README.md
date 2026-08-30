# Loop Studio

A browser-based editor and simulator for **Machinations-style diagrams** — model a
game's economy or feedback systems as resources flowing between pools, sources,
drains, gates, and converters, then run the model to see how it behaves over time.

**Live app: <https://cozy-loop-studio.pages.dev>**

> Status: **working preview** — `v0.6.0-dev`; the last tagged release is
> **v0.5.0**. **v0.6.0 is code-complete on `main` but not yet tagged.** The
> diagram editor and the simulation engine — deterministic, seeded randomness,
> Monte Carlo, and executable state connections (`trigger` / `activator` /
> `label`) — are all usable today, plus Workspace Export/Import, shareable
> `#g1=` links, an installable offline PWA, and file-based **project revisions &
> proposals** (`loop-revision/1`) for asynchronous collaboration. **Landing in
> v0.6.0** (implemented on `main`, release pending): a deterministic **model
> language** — `parameter` / `register` nodes and a safe arithmetic
> **expression** grammar (`loop-expr/1`, `loop-model/1`, `loop-revision/2`) —
> and a refreshed canvas visual grammar (zoom detail levels, a tokenised
> direction marker, reduced-motion & forced-colors support). Execution
> semantics are pinned down in frozen spec documents (see
> [Semantics](#semantics)).
>
> **Desktop-first editor.** Mobile browsers get a **view & run** layout —
> pan/zoom, play, Monte Carlo, inspect a node; editing (add / move / connect /
> delete) is desktop-only ([`docs/mobile.md`](docs/mobile.md)).

## Why

Machinations is a well-established notation (Dormans & Adams, *Game Mechanics:
Advanced Game Design*) and a commercial SaaS. Loop Studio is an independent,
open, client-only take on the same idea: nothing is uploaded, the whole app runs
in your browser, and a graph is a plain JSON file you own.

## Develop

```bash
npm install
npm run dev            # http://localhost:5173
npm run build          # -> dist/            static SPA, deploy anywhere
npm run build:portable # -> dist-portable/   single self-contained index.html (file://)
npm run lint
npm test               # vitest (engine + store unit tests)
npm run e2e            # Playwright browser end-to-end
npm run e2e:dist      # Playwright against the production build
npm run e2e:pwa       # Playwright against the PWA build (service worker, offline, update)
npm run build:pwa     # -> dist-pwa/          the PWA build (also emitted by the Cloudflare `main` build)
```

Requires **Node 22+** (`.nvmrc` pins `22`; `engines` requires `>=22.12.0`).

## Stack

- React + TypeScript + Vite
- [React Flow](https://reactflow.dev) (`@xyflow/react`) for the node canvas
- Zustand for graph + simulation state
- The simulation engine is a dependency-free TypeScript module (`src/engine/`),
  kept separate from the UI so its behaviour can be unit-tested against the
  frozen spec documents
- Monte Carlo runs on a Web Worker on a secure origin, with a cooperative
  main-thread fallback for `file://` / insecure origins
- `vite-plugin-singlefile` produces a portable, offline single-file build
- `vite-plugin-pwa` (Workbox) adds an installable service worker on the hosted
  build only — the portable build ships none
- Deployed on **Cloudflare Pages**; CI on **GitHub Actions** (`main` is
  protected — PR + green `checks` / `e2e` required)

## Semantics

Behaviour is frozen in versioned spec documents; a behavioural change means a new
spec id, never an edit to a frozen one.

| Doc | Spec id | Covers |
|---|---|---|
| [`SEMANTICS.md`](SEMANTICS.md) | — | Engine A: deterministic step / pull / push, gates, converters, conservation |
| [`SEMANTICS-B1.md`](SEMANTICS-B1.md) | `loop-rng/1` | seeded keyed RNG, random flow (`1-3`, `2D6`), probabilistic gates |
| [`SEMANTICS-B2.md`](SEMANTICS-B2.md) | `loop-mc/1`, `loop-mc-seed/1` | Monte Carlo: many runs, per-timestep bands, final-value distribution |
| [`SEMANTICS-S.md`](SEMANTICS-S.md) | `loop-state/1` | state connections: `trigger` (+ delay), `activator`, `label` — historical baseline |
| [`SEMANTICS-S2.md`](SEMANTICS-S2.md) | `loop-state/2` | current: inherits v1; changes only the `label` event report shape to `delta` + `clampAdjustment` |
| [`SEMANTICS-W.md`](SEMANTICS-W.md) | `loop-workspace/1` | Workspace Export/Import — an optional `workspace` extension on the graph doc (run config, MC result, view, verified sim snapshot) |
| [`SEMANTICS-U.md`](SEMANTICS-U.md) | `loop-share/1` | Shareable URL — a `#g1=` fragment carrying the graph doc (zlib-wrapped DEFLATE + base64url, 8 KiB cap); PWA notes in [`docs/pwa.md`](docs/pwa.md) |
| [`SEMANTICS-R.md`](SEMANTICS-R.md) | `loop-revision/1` | Project Revision / Proposal — an optional `project` key: a stable `projectId`, immutable `parentId`-chained revisions, `proposal` files carrying a full `base.content` snapshot, an id-keyed three-way diff, and `exact` / `divergent` / `unknown` apply (whole-proposal confirmed unless `exact`, or per-hunk). No accounts / server / sync. |
| [`SEMANTICS-X.md`](SEMANTICS-X.md) | `loop-expr/1` | Expression grammar & evaluation — a small deterministic arithmetic language (`+ - * /`, unary `-`, `( )`, finite literals, `@id` / `@{id}` node references); pure single-pass evaluation, `/0` and non-finite ⇒ an error; an AST-canonical text form for the `loop-revision/2` digest. Foundation for `loop-model/1`. |
| [`SEMANTICS-M.md`](SEMANTICS-M.md) | `loop-model/1` | Model language — `parameter` (a tuned numeric input) and `register` (a `loop-expr/1` readout, computed from the committed snapshot each step, stores nothing) node kinds, plus an advisory `resourceType` tag on pools / resource edges. Additive: a graph without them is byte- and digest-identical to `loop-revision/1`. Ripples into `loop-revision/2` (a wire-level v1/v2 discriminator; a new `advisory` field tag). |
| [`SEMANTICS-R2.md`](SEMANTICS-R2.md) | `loop-revision/2` | Revision projection / diff / Apply extended for the `loop-model/1` layer — a syntactic per-graph v1/v2 predicate run on the *normalised* doc (inferred, never stored), two new `FIELDS_BY_KIND` rows + a trailing `resourceType`, the `advisory` field tag, a conservative-extension guarantee with a golden vector, "verify the v1 digest, then lift" ordering, a computed cross-version whole-Apply loss report, and bidirectional v1 ↔ v2 compare/Apply. `loop-workspace/1` stays v1. |

## Project revisions & proposals

**File-based asynchronous collaboration** — no accounts, no server, no
real-time sync. A project moves between people only as JSON files you own.
([`SEMANTICS-R.md`](SEMANTICS-R.md); worked example under
[`examples/revision/`](examples/revision/README.md).)

1. **Create a Project revision** — `Export ▾ → Project revision` writes a graph
   file that also carries a stable `projectId` and this revision's lineage.
   Send it to a collaborator.
2. **Make a proposal** — they open it, choose `Export ▾ → Make a proposal`,
   edit the copy, and send the proposal file back. It carries a complete
   snapshot of the base, so the diff and apply are computable entirely offline.
3. **Review** — you `Import` the proposal. It opens a **non-destructive Review**
   panel (a bottom sheet on mobile): your graph, simulation, and undo history
   are untouched. It shows a three-way diff (`base` / `theirs` / `yours`), a
   classification (`exact` / `divergent` / `unknown`), and any structural
   conflicts.
4. **Apply** — either the **whole proposal** (replaces your graph; confirms
   unless your revision *is* the base) or **Choose changes** (per-hunk: pick
   individual adds / removes, resolve each conflicting field *take theirs* /
   *keep mine*; removing a node surfaces the incident edges to remove **or
   retarget**). Either way the result is one new local revision, one undo
   entry, and the sim reset to step 0 — a single Undo reverts everything. Apply
   writes no file; `Export ▾ → Project revision` afterward to persist it.

`meta.author` / `meta.title` / `meta.createdAt` in a shared file are
**self-reported and unverified** — the UI renders them muted, and no diff,
classification, or apply decision depends on them.

## Layout

| Path | What |
|---|---|
| `src/model/` | Graph data types, node factories, JSON load/save |
| `src/store/` | Zustand store — nodes, edges, selection, persistence, sim state |
| `src/components/` | Toolbar, canvas, inspector, custom node & edge views, Monte-Carlo dialog + charts |
| `src/engine/` | Simulation engine — deterministic step, RNG, Monte Carlo, state connections |
| `e2e/` | Playwright specs (app, portable `file://`, production build, PWA service worker, mobile view/run) |
| `examples/` | Importable graphs — `risky-factory.json`, Engine-B / State verification fixtures, the [`loop-revision/1` fixture](examples/revision/README.md) (base revision + clean / structural proposals + an apply oracle), and `revision-v2/` (the `loop-revision/2` golden vector — `G0` v1 graph, `G1` = `G0` + a model layer, `oracle.json`) |

## Roadmap

- ✅ Diagram editor — add / connect / edit nodes, JSON import/export, autosave
- ✅ Deterministic engine (Engine A) — step / play / reset, single-run timeline
- ✅ Engine B — seeded RNG, random flows, probabilistic gates
- ✅ Monte Carlo — engine, dialog UI, percentile bands, result export/import
- ✅ Cloudflare Pages deployment + GitHub Actions CI + protected `main`
- ✅ Onboarding, part 1 — starter templates, Engine-B + State verification fixtures, Risky Factory example
- ✅ State connections (`loop-state/1` + `loop-state/2`) — **v0.3.0**
  - ✅ Trigger + delay
  - ✅ Activator + comparison conditions
  - ✅ Label modifier — value semantics `loop-state/1`, event report `loop-state/2`
  - ✅ Inspector fields + in-canvas pulse / tint / flash
- ☐ Onboarding, part 2 — guided tour, inline docs, KO/EN localization
- ✅ Ship — **v0.4.0**
  - ✅ Workspace Export / Import (`loop-workspace/1`) — a graph file plus the run config, last distribution, timeline view, canvas, and a verified sim snapshot
  - ✅ Shareable URL (`loop-share/1`) — a `Share` button that copies a `#g1=` link carrying the whole diagram; opened links load defensively, always paused
  - ✅ Offline PWA — installable, works fully offline **once the service-worker install and precache complete** on the first online load; a `prompt`-style update bar, never an automatic reload ([`docs/pwa.md`](docs/pwa.md))
  - ✅ Mobile **view/run** layout — a small-screen layout to open, pan/zoom, and run a shared diagram; editing stays desktop-only ([`docs/mobile.md`](docs/mobile.md))
- ✅ Project Revision / Proposal (`loop-revision/1`, [`SEMANTICS-R.md`](SEMANTICS-R.md)) — **v0.5.0**
  - ✅ File-only async collaboration — a stable `projectId`, an immutable `parentId`-chained revision lineage, `proposal` files carrying a full `base.content` snapshot (diff + apply run offline)
  - ✅ Non-destructive Review — an id-keyed three-way diff, `exact` / `divergent` / `unknown` classification, desktop panel === mobile sheet
  - ✅ Whole-proposal Apply (confirmed unless `exact`) and per-hunk **selective Apply** — per-field `take theirs` / `keep mine`, node-removal dependencies resolved by removing **or retargeting** each incident edge, structural conflicts and invalid selections refused before anything changes
  - ✅ Atomic result — one new local revision, one undo entry, sim reset to step 0
  - ✅ Verification fixture + oracle ([`examples/revision/`](examples/revision/README.md))
  - No accounts / server / real-time sync
- ◐ Model language + Canvas Visual Refresh — **v0.6.0 · code-complete on `main`, release pending**
  - ✅ `parameter` / `register` node kinds + a safe arithmetic **expression** grammar (`loop-expr/1` [`SEMANTICS-X.md`](SEMANTICS-X.md), `loop-model/1` [`SEMANTICS-M.md`](SEMANTICS-M.md), `loop-revision/2` [`SEMANTICS-R2.md`](SEMANTICS-R2.md) — all frozen) — a Register's value `R(t)` is recomputed from the committed snapshot every step and stored nowhere; `/0`, a self / mutual cycle, an unknown ref, or a depends-on-invalid never halts the run
  - ✅ Advisory `resourceType` tag on pools / resource edges — colour, icon, legend, Inspector mismatch warning; computation-neutral (a mismatch changes nothing that runs)
  - ✅ Canvas Visual Refresh — every node/edge on one visual grammar; the v0.6.0 scope is **edge class / direction / cues + three zoom detail levels (L2/L1/L0) that elide only supplementary text + a renderer-owned tokenised direction marker + `prefers-reduced-motion` / `forced-colors` support**, locked by a committed pixel matrix. Edge **geometry stays on React Flow's Bézier path** — orthogonal routing is deferred ([`docs/visual-language.md`](docs/visual-language.md))
  - ✅ Verification fixture + oracle ([`examples/model-verification.json`](examples/README.md)) + desktop / mobile Import→Run→Timeline E2E; a `loop-workspace/1` v1 round-trip check (no `loop-workspace/2`)
  - ☐ Scenario Compare — **not in the v0.6.0 scope**; needs its own spec/design pass and a separate decision
- ☐ Advanced Monte-Carlo worker-count setting

## Releases

**v0.6.0 (release pending) — model language & canvas visual refresh.**
Implemented on `main`; the version stamp is still `0.6.0-dev` and no `v0.6.0`
tag exists yet — the `0.6.0-dev → 0.6.0` Release PR promotes this entry to
shipped. A small deterministic modelling layer on top of the engine, and one
visual grammar for the canvas.

- **Parameter & Register nodes** (`loop-expr/1` [`SEMANTICS-X.md`](SEMANTICS-X.md),
  `loop-model/1` [`SEMANTICS-M.md`](SEMANTICS-M.md)) — a `parameter` is a tuned
  numeric input; a `register` holds a `loop-expr/1` expression (`+ - * /`, unary
  `-`, `( )`, finite literals, `@id` / `@{id}` references) whose value `R(t)` is
  **recomputed from the committed snapshot each step and stored nowhere**. It
  reads on the Canvas, the Inspector, and as a dashed line in the Timeline
  (a gap where `R(t)` is invalid, never bridged). `/0`, a self / mutual cycle,
  an unknown reference, and a depends-on-invalid cascade each surface an error
  code and **never halt the run**. Registers have no ports; an edge to one is
  isolated on import with a warning.
- **Advisory `resourceType`** — a free-text tag on pools and resource edges
  (trim → NFC → ≤ 64 bytes), with a built-in palette + icon, a legend, and an
  Inspector **mismatch** note. Purely advisory: a mismatch changes nothing that
  runs, and the tag rides through Export / Import.
- **`loop-revision/2`** ([`SEMANTICS-R2.md`](SEMANTICS-R2.md)) — the revision
  projection / diff / Apply extended for the model layer: a syntactic v1/v2
  discriminator inferred from the normalised doc (never stored), an `advisory`
  field tag, and a conservative-extension guarantee — a graph with no model
  layer is byte- and digest-identical to `loop-revision/1`. `loop-workspace/1`
  stays v1.
- **Canvas Visual Refresh** ([`docs/visual-language.md`](docs/visual-language.md))
  — every node and edge on one "Vessel" grammar. The v0.6.0 scope is **edge
  class / direction / cues** and **information elision**, not edge geometry:
  three zoom detail levels (L2 / L1 / L0) that elide **only supplementary
  text** — role, edge class + direction, selection / focus, error flags, run
  cues and the accessible name survive at every level, and the node footprint
  is byte-identical across them; a renderer-owned tokenised direction marker
  (no more React Flow grey); a persistent static cue under
  `prefers-reduced-motion`; `forced-colors` support. **Edge paths stay on React
  Flow's Bézier route** — orthogonal routing is deferred. Locked by a committed
  `{light,dark} × {desktop,mobile} × {L2,L1,L0}` pixel matrix and a set of
  view-change invariants (a render never moves the GraphDoc, its digest, the
  undo stack, node geometry, edge routes, or the viewport).
- **Verification fixture** — [`examples/model-verification.json`](examples/README.md)
  + its oracle, re-derived by `test/model-verification.test.ts` and replayed by
  a desktop / mobile Import→Run→Timeline E2E; plus a `loop-workspace/1` v1
  round-trip check proving no `loop-workspace/2` is needed for the model layer.

**v0.5.0 — project revisions & proposals.** File-based **asynchronous
collaboration** (`loop-revision/1`, [`SEMANTICS-R.md`](SEMANTICS-R.md)) — **no
accounts, no server, no real-time sync**. A project moves between people only as
JSON files.

- **Project revision files** — `Export ▾ → Project revision` writes a graph doc
  that also carries a stable `projectId` and an immutable `parentId`-chained
  revision lineage.
- **Proposals** — `Export ▾ → Make a proposal` produces a file with a complete
  `base.content` snapshot, so the three-way diff and every apply are computable
  entirely offline from the proposal plus the recipient's open document.
- **Non-destructive Review** — importing a proposal opens a Review panel
  (a bottom sheet on mobile): the graph, simulation, and undo history are
  untouched. It shows an id-keyed three-way diff (`base` / `theirs` / `yours`),
  an `exact` / `divergent` / `unknown` classification, and any structural
  conflicts. Desktop and mobile use the same rules.
- **Whole-proposal Apply** — replaces the graph with the proposal's; lands with
  no prompt only when your revision *is* the base, otherwise it confirms and
  names the loss.
- **Selective (per-hunk) Apply** — pick individual adds / removes and resolve
  each conflicting field *take theirs* / *keep mine*. Removing a node surfaces
  its incident edges, each resolved by removal **or endpoint retarget**; an
  invalid selection (an edge left pointing at nothing, a node blocked by a
  locally-added edge) is refused before anything changes, and a full-GraphDoc
  check runs on the result.
- **Atomic** — either path yields one new local revision (`parentId` = your
  pre-apply revision), one undo entry, and the sim reset to step 0; a single
  Undo restores the graph and the revision header together. Apply writes no
  file.
- `meta.author` / `meta.title` / `meta.createdAt` in a shared file are
  **self-reported and unverified**; no diff, classification, or apply decision
  depends on them.
- A worked end-to-end fixture with an apply oracle lives under
  [`examples/revision/`](examples/revision/README.md).

**v0.4.0 — ship: workspace, links, offline, mobile view/run.** Four additions
around the existing editor + engine:

- **Workspace Export / Import** (`loop-workspace/1`,
  [`SEMANTICS-W.md`](SEMANTICS-W.md)) — an optional `workspace` key on the graph
  file carrying the run config, the last completed Monte-Carlo distribution
  (bound to its graph by a semantic digest), the timeline view, the canvas
  viewport, and a verified simulation snapshot. 8 MiB cap, all-or-nothing, no
  silent truncation; restore is atomic and always paused.
- **Shareable URL** (`loop-share/1`, [`SEMANTICS-U.md`](SEMANTICS-U.md)) — a
  `Share` button that copies a `#g1=<payload>` link (zlib-wrapped DEFLATE +
  strict base64url, 8 KiB cap, graph only) built on the fixed public origin.
  Opening a link validates fully before touching state, confirms before
  replacing a modified graph, and strips the fragment.
- **Installable offline PWA** ([`docs/pwa.md`](docs/pwa.md)) — a
  `vite-plugin-pwa` service worker precaches the whole app shell; after the
  first online load completes, the app runs fully offline. Updates surface a
  dismissible bar and apply only on the user's click (one reload, never
  automatic). Registered only on the production host; the portable `file://`
  build ships no service worker.

- **Mobile view/run layout** ([`docs/mobile.md`](docs/mobile.md)) — below a
  720px (or landscape-short) breakpoint the app switches to a small-screen
  layout: a full-bleed canvas with finger pan / pinch-zoom, a fixed bottom bar
  (Reset / Step / Play / Monte Carlo), a collapsible Timeline sheet, a
  read-only Inspector sheet, and Share / Import / Export / Templates / Theme in
  a `More` menu. Structural editing is locked; opening a phone browser never
  mutates the diagram. The desktop layout is unchanged above the breakpoint.

**Scope of the mobile layer.** It is a **view & run** mode, not a second
editor. There are no accounts and no cloud projects, so a diagram moves between
devices exactly two ways: a **Graph JSON / Workspace JSON** file (`Export ▾` on
desktop → `More → Import file` on the phone; a Workspace file also restores the
run position, the last distribution, and the view), or a **`#g1=` Share link**
(graph only). Each browser's autosave is local to that browser and does not
sync across devices. Asynchronous collaboration (shared project revisions /
proposals) is **not** part of `v0.4.0` — it is a separate, spec-first candidate
for a later release.

**v0.3.0 — executable state connections.** State edges (`trigger` with an
integer `delay`, AND-combined `activator` level gates, `label` Pool modifiers)
now run as a Phase 0 at the top of every step — frozen as `loop-state/1`, with
the `label` event-report shape frozen separately as `loop-state/2`
([`SEMANTICS-S.md`](SEMANTICS-S.md), [`SEMANTICS-S2.md`](SEMANTICS-S2.md)). The
Inspector edits each mode with live validation; the canvas shows a travelling
pulse on a trigger's delivery step, a steady tint for an open activator, and a
`delta` flash (plus a separate clamp note) for a label. Covered end-to-end by
`examples/state-verification.json` and its committed trace.

v0.2.0 shipped Engine B (seeded RNG, probabilistic gates) and the Monte-Carlo
engine + UI.

## Credits

By Hanrim · [Cozy Shelter](https://cozyshelter.tistory.com). Not affiliated with
Machinations.io. The diagram notation and execution model derive from the
publicly documented academic work, not from Machinations' software.
