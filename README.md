# Loop Studio

Loop Studio is a browser-based **visual systems editor and simulator** for
resource flows, state changes, probabilistic rules, and feedback loops. It is
designed primarily for **game economies**, while the same step-based model can
represent inventory and supply chains, production processes, service queues, cash
flows, energy systems, and other resource-flow systems. You draw the system as a
**Machinations-style diagram** — resources moving between pools, sources, drains,
gates, and converters — then run the model to see how it behaves over time.

Loop Studio currently uses a deterministic, discrete-step simulation model;
continuous-time equations and spatial physics are not directly supported (see
[Future directions](#future-directions)).

**Run it now — the live web app: <https://cozy-loop-studio.pages.dev>**

> Status: **working preview** — `v0.8.0-dev`; the last tagged release is
> **v0.7.0**. The diagram editor and the simulation engine — deterministic,
> seeded randomness, Monte Carlo, and executable state connections (`trigger` /
> `activator` / `label`) — are all usable today, plus Workspace Export/Import,
> shareable `#g1=` links, an installable offline PWA, and file-based **project
> revisions & proposals** (`loop-revision/1`) for asynchronous collaboration.
> **v0.6.0** added a deterministic **model language** — `parameter` / `register`
> nodes and a safe arithmetic **expression** grammar (`loop-expr/1`,
> `loop-model/1`, `loop-revision/2`), Register `R(t)` observation, and an
> advisory `resourceType` tag — and a **Canvas Visual Refresh** (edge class /
> direction / cues, zoom detail levels, a tokenised direction marker,
> reduced-motion & forced-colors support). **New in v0.7.0:** automatic
> **orthogonal edge routing** — right-angle segments that step around nodes
> (`route: "orthogonal"`, `loop-revision/3`), a cosmetic wire field that changes
> nothing the engine computes (manual waypoint editing is deferred) — and
> **Simulation Playback / Event Choreography**: pressing Play makes resources
> visibly depart, travel the real edge path, and arrive before the value
> updates, on a shared per-step time axis, with reduced-motion / L0 / a11y /
> forced-colors handling and a bounded on-screen token count — a display layer
> that leaves the deterministic engine result untouched. Execution semantics are
> pinned down in frozen spec documents (see [Semantics](#semantics)).
>
> **In `v0.8.0-dev`:** Onboarding, part 2 — a **KO / EN localization** base (a
> runtime language switch on a single bundle; the chosen language is a
> `localStorage`-only UI setting that never enters the GraphDoc, Workspace,
> Share link, or `loop-revision/*` digest), then a guided first-run tour and
> contextual inline help on top of it. Design doc (`docs/localization.md`)
> first, implementation after it settles.
>
> **Desktop-first editor.** Mobile browsers get a **view & run** layout —
> pan/zoom, play, Monte Carlo, inspect a node; editing (add / move / connect /
> delete) is desktop-only ([`docs/mobile.md`](docs/mobile.md)).

## Why

Game economies are the representative case: Machinations is a well-established
notation for them (Dormans & Adams, *Game Mechanics: Advanced Game Design*) and
a commercial SaaS. Loop Studio is an independent, client-only implementation with
portable files and no account lock-in — nothing is uploaded, the whole app runs
in your browser, and a graph is a plain JSON file you own — and the notation
generalises: a pool that fills and drains on probabilistic rules is a warehouse,
a queue, or a cash balance just as readily as a resource bar.

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
| [`SEMANTICS-R3.md`](SEMANTICS-R3.md) | `loop-revision/3` | Revision projection / diff / Apply extended for the **edge-routing** user-intent fields (`edge.data.route` + `waypoints`, from [`docs/edge-routing.md`](docs/edge-routing.md)) — two trailing `cosmetic` edge keys, a per-graph/per-side v3 predicate on the normalised doc with verify-own-projection-then-lift ordering, a conservative-extension golden (a v2 file's v3 digest == its v2 digest; the v2→v3→v2 round-trip is exact), a routing-only defensive-read quarantine, and lossless preservation of the routing *value* across Graph / Share / Project revision / Workspace-v1 round-trips. The **computed** path / `routeClass` / router cache are wire content in **no** projection. `loop-workspace/1` stays v1. |

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
- ◐ Onboarding, part 2 — **v0.8.0-dev** ([`docs/localization.md`](docs/localization.md)) — the localization base, full-app localization, the guided first-run tour, and the Early MMO example have all shipped; contextual inline help is the one item left, and it waits for the Productization track below to settle the app's structure first
  - ✅ Extensible localization base — registry-driven N-language structure with EN + KO as the first shipped locales; runtime language menu, atomic catalog activation, ICU formatting, EN fallback, and `localStorage`-only locale persistence. Locale state never enters GraphDoc / Workspace / Share / revision / digest / undo / simulation state
  - ✅ Full-app localization + acceptance validation — Toolbar, Canvas, Inspector, Timeline, Templates, Import / Export, Share, revision, PWA, dialogs, errors, empty states, accessibility text, KO typography, desktop / mobile visual references, invariance tests, and CI guards for catalog parity and hardcoded UI strings
  - ✅ Guided first-run tour ([`docs/guided-tour.md`](docs/guided-tour.md)) — a read-only six-step overlay (desktop + a separate mobile script), a Welcome card on the first run (`localStorage`-only, never serialized), and a Help (`?`) menu with `Take a tour` + `About Loop Studio`
  - ✅ "Early MMO progression (levels 1–15)" example ([`docs/example-mmo-progression.md`](docs/example-mmo-progression.md)) — a shipped play-economy demo graph (three zone lanes, probabilistic combat with wins / setbacks / deaths, categorised loot, a gold economy with repair and resupply costs, a rising XP curve) as the third **Templates** entry, EN + KO; generalised, not game-specific, with by-construction accounting invariants and a tuned reach-15 window
  - ☐ Contextual inline help and documentation — built on the localization base; sequenced after the Productization track below lands its structure
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
- ✅ Model language + Canvas Visual Refresh — **v0.6.0**
  - ✅ `parameter` / `register` node kinds + a safe arithmetic **expression** grammar (`loop-expr/1` [`SEMANTICS-X.md`](SEMANTICS-X.md), `loop-model/1` [`SEMANTICS-M.md`](SEMANTICS-M.md), `loop-revision/2` [`SEMANTICS-R2.md`](SEMANTICS-R2.md) — all frozen) — a Register's value `R(t)` is recomputed from the committed snapshot every step and stored nowhere; `/0`, a self / mutual cycle, an unknown ref, or a depends-on-invalid never halts the run
  - ✅ Register `R(t)` observation — Canvas, Inspector, and a dashed Timeline line (a real gap where `R(t)` is invalid, never bridged), all recomputed from the same `R(currentStep)`; a stepped Workspace still round-trips as `loop-workspace/1` (no `loop-workspace/2`)
  - ✅ Advisory `resourceType` tag on pools / resource edges — colour, icon, legend, Inspector mismatch warning; computation-neutral (a mismatch changes nothing that runs)
  - ✅ Canvas Visual Refresh — every node/edge on one visual grammar: **edge class / direction / cues + three zoom detail levels (L2/L1/L0) that elide only supplementary text + a renderer-owned tokenised direction marker + `prefers-reduced-motion` / `forced-colors` support**, locked by a committed pixel matrix. Edge **geometry is unchanged** — React Flow's Bézier path; orthogonal routing is **not** in this release ([`docs/visual-language.md`](docs/visual-language.md))
  - ✅ Verification fixture + oracle ([`examples/model-verification.json`](examples/README.md)) + desktop / mobile Import→Run→Timeline E2E
- ✅ Orthogonal edge routing — **v0.7.0** ([`docs/edge-routing.md`](docs/edge-routing.md), `loop-revision/3` [`SEMANTICS-R3.md`](SEMANTICS-R3.md) frozen)
  - ✅ Orthogonal auto routing — **Slice 1**: `route: "orthogonal"` selection + an automatic deterministic router (obstacle-avoiding A*, parallel-edge fan-out, rounded corners, L/Z fallback) + an atomic route-map that recomputes every orthogonal edge in one pass. `route` / `waypoints` are `loop-revision/3` **cosmetic** wire fields — projected / diffed / dirty-tracked, never engine- or advisory-affecting; a non-routing graph's digest is unchanged. Pure render concern (never edits `source` / `target` / handles)
- ☐ Manual waypoint editing — deferred; a separate future project. The `waypoints` wire contract is frozen and the auto router reads / writes existing waypoints losslessly, but the create / move / delete UI is not built; revisited only when there is real demand
- ✅ Simulation Playback / Event Choreography — **v0.7.0** ([`docs/simulation-playback.md`](docs/simulation-playback.md), a non-`frozen` design doc — no `loop-*/N` id): pressing Play makes the model move — departure → travel → arrival → value update along each real edge path, on a shared per-step time axis — while the engine result stays byte-for-byte deterministic and untouched (a display layer only, **no new engine oracle**)
  - ✅ Resource token choreography — `depart` → `travel` → `arrive` → `settle` on the exact rendered edge `d` (Bézier **and** orthogonal), Pause freezes / speed re-rates / discard removes; several transfers on one edge ⇒ one summed token + a capped `+N` breakdown
  - ✅ State-event choreography — a `trigger` bead rides the edge on its delivery step, an `activator` lands a target-side cue on the `arrive` beat (never travels), a signed `label` delta bead by sign; a state cue is never merged into the resource token and fires once per transition
  - ✅ Viewing conditions — `prefers-reduced-motion` (no travelling element, collapsed beats, no artificial wait), an L0 (`zoom < 0.45`) elision that keeps the ordered depart / path-pulse / arrive cues, background-tab freeze-and-recover, and a mobile view/run layout
  - ✅ Accessibility & `forced-colors` — one always-mounted polite live region announcing the committed run state; every cue distinguishable without hue by shape tells
  - ✅ Performance ceiling — one global `MAX_PLAYBACK_TOKENS_TOTAL = 60` budget across resource + `trigger` + `label` travelling cues, chosen deterministically and sorted once per transition; `MAX_PLAYBACK_TOKENS = 12` breakdown chips; an idle edge never re-renders on a τ frame
  - ✅ Reproducible demo fixture + QA checklist ([`examples/playback-choreography.json`](examples/README.md)) + `e2e/playback-fixture.spec.ts` + the acceptance matrix (`e2e/playback-*.spec.ts`)
- ☐ Scenario Compare — results per Parameter combination (save format, run budget, comparison basis, chart semantics). Its own spec-first project; not started
- ☐ Advanced Monte-Carlo worker-count setting
- ◐ Productization track — making the tool usable by a general planner, not only its author; a separate track from Onboarding. Design-first: each pass is its own doc and PR
  - ✅ Product direction ([`docs/product-direction.md`](docs/product-direction.md)) — the settled direction the passes below must not contradict: adjust-a-template / assemble-building-blocks as the default path with the blank canvas kept as an unchanged advanced one, the Example / Template / Building block editorial roles, one canvas with readability affordances first, surfaced inputs + a result Summary separated from the raw graph, and positioning as an experiment tool over a verified model. A direction doc only — no app code, no `src/` change, no wire change, no `loop-*/N`. Complete when the five decisions (§PD9) are settled; the doc is then revised only if a decision changes
  - ☐ Large-graph readability — design pass; a render-only focus view and transient connection de-emphasis / filtering over the single existing canvas, plus group frames whose persistence model (session-transient vs user-saved, and any cosmetic wire contract a saved frame needs) that pass decides — not pre-approved as render-only here
  - ☐ Small module / template system — design pass; Example / Template / Building block packaging, surfaced inputs + result Summary, a connection helper, a staged build flow, and the per-locale template label overlay. Building-block **insertion / merge** (id collisions, placement, selection / undo, connection boundary) and any save metadata are scoped **in this pass**, not in the direction doc
  - order of the two passes above is deliberately open ([`docs/product-direction.md`](docs/product-direction.md) §PD8)

## Future directions

Not on a committed schedule — directions the current model could grow toward,
recorded here so the scope boundary above is explicit rather than implied:

- Continuous-time models and numerical integration
- Region, grid, or network-based spatial models
- External-engine integration for specialized physics (rigid-body collision,
  fluids, particles)

## Releases

**v0.7.0 — orthogonal routing & simulation playback.** Two render-layer
additions on top of the same engine — the deterministic simulation result and
every serialized byte are unchanged.

- **Automatic orthogonal edge routing** (`docs/edge-routing.md`, `loop-revision/3`
  [`SEMANTICS-R3.md`](SEMANTICS-R3.md) frozen) — `route: "orthogonal"` on an edge
  swaps its Bézier curve for right-angle segments from a deterministic
  obstacle-avoiding router (parallel-edge fan-out, rounded corners, L/Z
  fallback) and an atomic route-map that recomputes every orthogonal edge in one
  pass. `route` / `waypoints` are `loop-revision/3` **cosmetic** wire fields —
  projected, diffed and dirty-tracked, but never engine- or advisory-affecting;
  a graph that uses no routing has an unchanged content digest. **Manual
  waypoint editing** (the create / move / delete UI) is deliberately deferred —
  the wire contract is frozen and existing waypoints round-trip losslessly,
  revisited only on real demand.
- **Simulation Playback / Event Choreography** (`docs/simulation-playback.md`, a
  non-`frozen` design doc — no `loop-*/N`) — pressing Play makes the model move:
  a resource visibly departs its source, travels the **exact rendered edge `d`**
  (Bézier or orthogonal), arrives, and only then does the value update, on a
  shared per-step `τ` time axis. State events choreograph too — a `trigger` bead
  rides the edge on its delivery step, an `activator` lands a target-side cue on
  the `arrive` beat (it never travels), a signed `label` delta bead reads by
  sign — and a state cue is never merged into the resource token. It handles
  `prefers-reduced-motion` (no travelling element, collapsed beats, no
  artificial wait), an L0 (`zoom < 0.45`) elision that keeps the ordered
  depart / path-pulse / arrive cues, background-tab freeze-and-recover, a mobile
  view/run layout, an always-mounted polite a11y live region, `forced-colors`
  shape tells, and a bounded on-screen token count — one global
  `MAX_PLAYBACK_TOKENS_TOTAL = 60` budget across resource + `trigger` + `label`
  cues, chosen deterministically and sorted once per transition. It is a
  **display layer only**: Play / Pause / speed / Reset move no GraphDoc bytes,
  no `loop-revision/3` digest, no undo stack, no viewport, no edge `d`, and a
  choreographed Play commits exactly what a plain `advance()` run does — so
  there is **no new engine oracle**, only the reproducible
  [`examples/playback-choreography.json`](examples/README.md) demo + its QA
  checklist and the `e2e/playback-*.spec.ts` acceptance matrix.

**Scenario Compare** and **manual waypoint editing** are deliberately *not* in
this release; each is its own later project.

**v0.6.0 — model language & canvas visual refresh.** A small deterministic
modelling layer on top of the engine, and one visual grammar for the canvas.
Edge **geometry** and **Scenario Compare** are deliberately *not* in this
release.

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

Created by Hanrim · [Cozy Shelter](https://cozyshelter.tistory.com/).

Loop Studio is an independent project and is not affiliated with or
endorsed by Machinations.io. Its modeling approach is informed by
publicly documented academic work on game-economy diagrams.

## Copyright

Copyright © 2026 Hanrim. All rights reserved.
