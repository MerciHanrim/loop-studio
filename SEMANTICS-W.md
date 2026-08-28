# Workspace Export / Import

```
Spec ID: loop-workspace/1
Status:  Frozen
```

**Frozen** (2026-08-28). This document is the fixed target for the
implementation. A behavioural change after this is a new spec id in a new
document (`loop-workspace/2`), exactly as with `loop-state/1 → loop-state/2`;
this file only takes typo / clarifying-prose fixes.

Defines *what a Workspace file is*, *what it carries*, and *how it is restored*.

Independent of, and layered on top of, the graph / engine / Monte-Carlo specs. It
never changes how a diagram *runs* — it only saves and restores app state around
a run. `SEMANTICS.md`, `SEMANTICS-B1.md`, `SEMANTICS-B2.md`, `SEMANTICS-S.md`,
`SEMANTICS-S2.md` are unaffected.

---

## W0. Scope

**Added**

- A **Workspace file** — the same `loop-studio/graph` document with one extra
  optional top-level key, `workspace`, holding the run configuration, the last
  **completed** Monte-Carlo result, the timeline view state, the canvas
  viewport, and a **verified simulation snapshot**.
- **`Export ▾` gains a second item** — `Graph JSON` (today's behaviour, byte-for-
  byte) and `Workspace JSON`.
- **Import auto-detects.** One file input, one code path: a file with no
  `workspace` key loads exactly as today; a file with a `workspace` key also
  restores the workspace, defensively.

**Out of scope for v1** — multi-document / project files; embedded external
assets; cross-version migration of `workspace` payloads (`loop-workspace/2` will
define its own reader); cloud sync, shareable URLs, autosave of the workspace
(localStorage still persists the **graph only**).

**Unchanged** — the graph half is written by the *same* `serialize()` path as a
Graph Export (schema, handle ids, `recommendedRunConfig` identical). Graph schema
stays `version: 1`; `workspace` is additive and optional; older builds ignore an
unknown top-level key.

---

## W1. File shape

```jsonc
{
  "schema": "loop-studio/graph",
  "version": 1,
  "nodes": [ /* … */ ],
  "edges": [ /* … */ ],
  "recommendedRunConfig": { /* … optional, as today … */ },

  "workspace": {
    "schema": "loop-workspace/1",
    "version": 1,

    "mc": {
      "config": { "baseSeed": 1, "runs": 200, "steps": 30, "tracked": ["pool_x"] },
      "result": { /* a MonteCarloResult — omitted if none, or per §W4 */ },
      "resultOmitted": "size-limit",        // present ONLY when a result existed but was left out; see §W4
      "resultGraphDigest": "<sha-256 hex — semantic digest of the graph that PRODUCED the result; §W3>",
      "stale": false
    },

    "view": {
      "timeline": "distribution",           // "live" | "distribution"
      "distributionPoolId": "pool_x",       // selected Pool in the band chart, or null
      "showMean": false
    },

    "canvas": { "x": -120.5, "y": 40, "zoom": 1.25 },

    "simulation": {
      "seed": 1,                            // uint32 — the PlayBar single-run seed (simStore.seed), NOT mc.config.baseSeed
      "step": 7,
      "ended": false,
      "values": { "pool_x": 12, "pool_y": 0 },
      "fired": ["pool_x_drain"],
      "triggerQueue": [ { "edgeId": "t1", "target": "d", "deliveryStep": 9 } ],
      "stateEvents": [ /* the StateEvent[] from the step that produced `step` */ ],
      "series": [ { "step": 0, "values": { /* … */ } } /* … ≤ MAX_SERIES entries … */ ]
    }
  }
}
```

Why a nested key rather than a new container schema: today's Import reads
`nodes` / `edges` unchanged; an older build ignores `workspace` and still opens
the graph; a new build tells a plain graph from a workspace by the key's
presence — no schema bump, no `version` collision. A Workspace file **is** a
valid Graph file.

---

## W2. Save scope

### Included

| group | fields | source |
|---|---|---|
| **graph** | the whole `GraphDoc` (`nodes`, `edges`, `recommendedRunConfig`) | `serialize()` — identical to Graph Export |
| **MC config** | `baseSeed`, `runs`, `steps`, `tracked` | `mcStore.config` |
| **MC result** | the last **completed** `MonteCarloResult` + `stale` + `resultGraphDigest` (§W3); or none; or omitted with `resultOmitted` (§W4) | `mcStore.result` / `mcStore.stale` / digest of `mcStore.runGraph` |
| **view** | timeline mode, selected Distribution Pool, mean-line toggle | `mcStore.view` + the band-chart selection (**lifted into a store — §W7**) |
| **canvas** | viewport `{ x, y, zoom }` | React Flow `getViewport()` |
| **simulation snapshot** | **`seed`** (the PlayBar single-run seed), `step`, `values`, `ended`, `fired`, `triggerQueue`, `stateEvents` (of the step that produced `step`), `series` (bounded timeline, ≤ `MAX_SERIES`) | `simStore` |

The `seed` is the **live single-run seed** (`simStore.seed`), the one the PlayBar
edits — separate from `mc.config.baseSeed`. Without it, continuing a run past a
random step could not reproduce the same draws. It is the second field of the
snapshot, alongside `step`.

The snapshot is a **verified `SimState` snapshot, not a step number to be
replayed.** Replay-from-0 cannot reconstruct a hand-delivered `interactive`
pulse, a partially-consumed `triggerQueue`, or a mid-run seed change; a snapshot
of `{ seed, step, values, ended, fired, triggerQueue }` (the `SimState` shape
from `loop-state/1` §S8, plus `seed`) with `stateEvents` and `series` restores the
run bit-for-bit and lets `step()` continue from it. (§W10 D1, D9.)

### Excluded

| group | why |
|---|---|
| `running` / `playing` status, the **play timer** | transient control state; a restored workspace is always **paused / idle** (§W2.1); the timer is **never** restored |
| `AbortController`, Worker handles, an in-flight / provisional MC result, `completedRuns` mid-run | not a result; §W3 forbids saving a provisional run |
| Undo / redo history (`graphStore.past` / `future`) | session-local editing history; a restored file starts a fresh history |
| open dialog / menu, keyboard focus, node / edge **selection** | transient UI |
| pulse / tint / flash animation state | re-derives from the restored `stateEvents` + `step`; **the animation itself is not replayed on restore** |
| `lastThroughput` | an in-memory perf hint keyed to the session |
| **theme, language**, any user-global preference | belongs to the user / device (their own `localStorage` keys), not to a shared document |

### W2.1 Restore is always paused; nothing auto-runs

After Import, regardless of the state the file was saved in:

- the live sim is **`paused`** if a snapshot restored (Step / Play resume from
  `simulation.step` using the restored `seed` / `fired` / `triggerQueue`), or
  **`idle`** at step 0 if there was no snapshot;
- Monte-Carlo status is **`idle`**, or **`done`** if a valid `result` restored —
  **never `running`**;
- **no run — live or Monte-Carlo — starts automatically**; **no timer is
  started**;
- restored `stateEvents` are available as data (Inspector, `report`) but the
  travelling pulse / tint / flash is **not** re-played for the restored step.

---

## W3. Result consistency — semantic digest, computed from `runGraph`

A `MonteCarloResult` is only meaningful against the graph it ran on. The file
binds them with a **semantic digest** — a hash of only the fields that change
what the engine computes, so a cosmetic edit (move, rename) does **not** stale a
result (matching `simulationRev`, which a pure `label` change already does not
bump).

### W3.1 The semantic digest

`semanticDigest(graph)` =

1. **Project** each node to `{ id, kind, activation?, mode?, distribution?,
   initial?, capacity?, … }` — every engine-relevant field (see §W11 for the
   exact list), **dropping** `position`, `label`, `selected`, and any
   presentation-only field.
2. **Project** each edge to `{ id, source, target, sourceHandle, targetHandle,
   kind, flow? | weight?, mode?, delay?, expr? }` — every field that affects
   routing, flow, RNG keying, or state semantics; **dropping** presentation-only
   fields.
3. **Drop** `recommendedRunConfig` and any other doc-level advisory metadata.
4. **Sort** nodes and edges by `id`; within each object, emit keys in a **fixed
   order** (defined in §W11).
5. `SHA-256` (lowercase hex) of the UTF-8 bytes of that canonical JSON.

RNG determinism depends on element **ids** (`sample(seed, step, elementId, …)`),
so every id that keys a draw is in the projection.

### W3.2 Which graph is hashed

- **`resultGraphDigest` is bound to the *run*, not to any later export.** It is
  generated **only when a Monte-Carlo run completes** — `semanticDigest(runGraph)`
  where `runGraph` is the exact graph that run executed against — and then
  travels with the result unchanged.
- On **Export**: the stored `resultGraphDigest` is written **verbatim**. It is
  **never recomputed against the current graph on export.** In particular, when a
  result was *restored from a Workspace file*, its original `resultGraphDigest` is
  carried straight through to the next `Workspace JSON` — re-saving a
  stale-loaded result must not relabel it with the current graph's digest (that
  would make it look fresh on the next Import).
- On **Import**: recompute `semanticDigest(file.nodes, file.edges)` — the
  current graph — and compare it to the file's `resultGraphDigest`:
  - **equal** → the result is attached; `stale` = whatever the file recorded (a
    file may legitimately carry a stale result the user kept);
  - **different** → the result is attached but forced **`stale: true`**, with a
    one-line notice ("the saved distribution is from an earlier version of this
    graph");
  - the graph always loads either way.

So the digest has exactly one origin (a completed run's `runGraph`) and exactly
one consumer (the Import-time comparison). Neither export nor restore ever
rewrites it.

### W3.3 Corrupt / provisional

- A structurally invalid `result` (missing `pools`; `series` length ≠
  `steps + 1`; `runSeeds` length ≠ `runs`; non-finite numbers; ids absent from
  the graph) → **discarded** with a warning; graph + rest of the workspace load
  normally.
- A **provisional / in-progress** result is **never written**. `Workspace JSON`
  is unavailable (or omits `mc.result`) while `mcStore.status === 'running'`;
  only `status === 'done'` is eligible.

---

## W4. Size limits — measured, all-or-nothing, no truncation

Monte-Carlo results dominate file size. Truncating the arrays breaks §W3
invariants, so **silent truncation is forbidden** and **no partial result is
ever written**.

`WORKSPACE_MAX_BYTES = 8 * 1024 * 1024` (8 MiB) — a hard cap on the serialized
**file**, measured (not estimated) as UTF-8 byte length.

**Processing order on `Workspace JSON`:**

1. Serialize the full payload **with the result** and measure its byte length.
2. **≤ cap** → write it. Done.
3. **> cap** → do not write silently. Show the user the file would be *N* MiB
   (cap 8 MiB, mostly the *R*-run distribution) and offer:
   **Save without the result**, or **Cancel**.
4. On "save without the result": drop `mc.result`, set
   **`mc.resultOmitted: "size-limit"`**, re-serialize, and **measure again**.
5. **Graph + snapshot alone still > cap** → **hard reject** with a clear message
   (the graph / timeline history is itself too large for a Workspace file; a
   plain **Graph JSON** still works).

`resultOmitted` is metadata only — on Import it produces the notice "the saved
workspace left its distribution out because the file was too large; re-run Monte
Carlo to regenerate it." It is absent whenever a result is present or was simply
never run.

§W11 records the measured bytes-per-cell so a UI can warn before Export. The
result-eligibility pre-check still mirrors the engine's `CELL_LIMIT`
(5 000 000 cells), but step 1's byte measurement is authoritative.

---

## W5. Import safety

The graph must always survive a bad `workspace`. **Atomic restore order** (§W5.1)
matters as much as per-field validation.

1. **Parse + load the graph first** via the existing `deserialize()` path. If it
   throws, the whole Import fails as today — `workspace` is not consulted.
2. `workspace` absent → done (plain graph, fresh session state). **A plain-graph
   Import does not touch the current Monte-Carlo / view / sim state beyond what
   graph Import already does** (`simulationRev` bump → sim reset, MC stale) —
   the existing rules are unchanged.
3. `workspace.schema !== 'loop-workspace/1'` **or** `workspace.version > 1` →
   **load the graph only**, one-line warning ("this file's saved workspace needs
   a newer Loop Studio; the graph opened without it"). Never throw.
4. Otherwise restore each part **defensively and independently** — a failure in
   one part discards *that part* only:
   - **`mc.config`** — reuse `applyRecommended()`'s validation (finite-int
     `baseSeed → uint32`, positive `runs` / `steps`, `tracked` intersected with
     the loaded Pools in graph order, unknowns dropped). Invalid → default
     config.
   - **`mc.result`** — §W3 (semantic-digest compare vs the current graph;
     corruption check; `resultOmitted` → notice, no result).
   - **`view`**:
     - `timeline` must be `"live"` / `"distribution"`, else `"live"`.
     - **If `timeline` is `"distribution"` but there is no usable result → fall
       back to `"live"`.**
     - `distributionPoolId` must be a Pool id present in the graph **and** a
       tracked Pool of the result; otherwise use the **first valid Pool**, and
       if none, fall back to `"live"`.
     - `showMean` coerced to boolean.
   - **`canvas`** — `x`, `y`, `zoom` must be **finite**; `zoom` **clamped to
     React Flow's `[minZoom, maxZoom]`**. Any non-finite → skip (leave the
     default fit).
   - **`simulation`** — the strictest:
     - `seed` via the finite-int `→ uint32` rule (same as `simStore.setSeed`);
       invalid → the store's current seed.
     - `step` a non-negative integer; `ended` boolean.
     - `values` — drop keys not node ids in the graph; each value a finite
       number ≥ 0, else that Pool falls back to its `initial`.
     - `fired` — keep only ids present in the graph.
     - `triggerQueue` — drop entries whose `edgeId` or `target` no longer exists
       (the `loop-state/1` §S8 delivery-time guard), coerce `deliveryStep` to an
       integer `> step`, then **re-sort by the canonical `(deliveryStep,
       edgeId)` order**.
     - `stateEvents` — filter to edges present in the graph; re-sort ascending
       `edgeId`; if malformed, drop the whole array (it re-derives on the next
       `step()`).
     - `series` — validate **each** frame:
       - every Pool id present in the current graph (drop unknown keys / a whole
         bad frame),
       - every value **finite**,
       - overall length **≤ `MAX_SERIES` (400)** (truncate the oldest beyond
         that),
       - the **last frame's values equal `simulation.values`** (the snapshot's
         current values); if not, drop the trailing mismatched frames or, if
         unrecoverable, replace `series` with a single frame `{ step,
         values }` from the snapshot.
       - A bad individual Pool series is dropped on its own; **an inconsistent
         `series` never blocks restoring the rest of the snapshot.**
     - If `simulation` cannot yield a coherent snapshot at all, restore **step 0
       / idle** and warn — never a half-set sim.
5. **No auto-run**, **no timer** (§W2.1).

### W5.1 Atomic restore order

Graph-store subscribers (the sim-reset-on-`simulationRev` hook, the
MC-stale-on-`simulationRev` hook) must **not** fire mid-restore and undo the
snapshot / re-stale the just-restored result. Restore is:

1. load the graph (bumps `simulationRev` once, resetting sim + staling MC — as
   normal);
2. **then**, in one synchronous pass, apply `mc.config`, attach `mc.result` with
   its file/`digest`-derived `stale`, set `view`, set `canvas`, and call
   `simStore.restoreSnapshot(simulation)` which sets the fields **and forces
   `status: 'paused'`** — after this pass no further `simulationRev` bump occurs,
   so the subscribers see a consistent final state and do not re-stale or
   re-reset.

Restoration is deterministic and order-independent: the same file always
restores the same state.

---

## W6. Old-app / forward compatibility

| reader | file | result |
|---|---|---|
| build **without** `loop-workspace` support | Workspace file | opens the graph (unknown `workspace` key ignored); fresh session state |
| build **with** `loop-workspace/1` | plain Graph file | opens as today; workspace state fresh; existing graph-import rules only |
| build with `loop-workspace/1` | `workspace.version` > 1 (or unknown schema) | **graph loads, workspace skipped + warning** |
| any build | Workspace file whose graph half is invalid | Import fails on the graph, as today |

Round-trip: `Import(Workspace) → Export(Workspace)` reproduces the same
`workspace` payload up to (a) a re-sorted `triggerQueue` / `stateEvents` if the
input was out of canonical order, (b) `mc.stale` written as the value it was
*displayed* at after Import — i.e. `true` if the Import forced it on a digest
mismatch (§W3.2) — while `resultGraphDigest` is carried through **unchanged**,
and (c) `view.timeline` falling back to `"live"` if there was no usable result.
`Export(Graph)` from a restored workspace produces exactly today's Graph file (no
`workspace` key).

---

## W7. Implementation consequences (decided here; not part of the frozen wire contract)

- **Band-chart selection moves into a store.** `distributionPoolId` and
  `showMean` are `useState` in `BandChart.tsx`; to save/restore they live in
  `mcStore` (or a small `viewStore`). Refactor, not a semantic change.
- **Canvas viewport** — `getViewport()` at Export; `setViewport()` at Import
  after suppressing `fitView`.
- **`simStore.restoreSnapshot(simulation)`** — a new action that sets
  `{ seed, stepIndex, values, firedNodeIds, triggerQueue, stateEvents, series }`
  and forces `status: 'paused'`; the inverse of the fields the store already
  exposes. It must **not** start the play timer.
- **`src/model/workspace.ts`** — owns the `workspace` schema, `semanticDigest()`,
  the byte-size check, `resultOmitted`, and the defensive reader — mirroring how
  `serialize.ts` owns the graph doc. `serialize()` / `deserialize()` grow a
  workspace-aware sibling; `deserialize()` returns `{ …graph, workspace? }`.
- The restore pass is written so it runs **after** the one `simulationRev` bump
  from graph load and causes no further bump (§W5.1).

---

## W8. UI

- **`Export ▾`** (toolbar) → **Graph JSON** (`loop-studio-graph.json`, unchanged)
  and **Workspace JSON** (`loop-studio-workspace.json` — a distinct default name
  so the two are not confused on disk).
- Before the Workspace download: a short summary of *what is included* (config,
  the *R*-run distribution if it fits, timeline view, canvas position, the live
  run at step *N*) and *what is not* (undo history, selection, theme). If the
  result does not fit, the §W4 choice ("save without result" / "cancel") is here;
  if graph + snapshot alone exceed the cap, the §W4 hard-reject message.
- **Import** stays a single control; it detects the `workspace` key. A restore
  that dropped parts shows one aggregated notice ("opened; the saved
  distribution was from an older graph and is marked stale").
- The Monte-Carlo `Export ▾` inside the Distribution panel is unchanged (it
  exports the *result* as CSV / JSON — a different artifact from a Workspace).

---

## W9. Invariants

| # | invariant |
|---|---|
| **W1** | A Workspace file is a valid Graph file. Stripping `workspace` yields exactly what `Export(Graph)` would have written. |
| **W2** | Import never starts a run and never starts a timer. After Import the live sim is `paused` (snapshot) or `idle` (none); Monte-Carlo is `idle` or `done`, never `running`. |
| **W3** | A restored `simulation` snapshot fed to `step(nodes, edges, snapshot, snapshot.seed)` produces the same next state as if the run had never been saved — including RNG draws, because the live `seed` is in the snapshot (`loop-state/1` §S8 `SimState` + `seed` fully captured). |
| **W4** | A result is shown only when the **semantic digest** of the current graph equals the digest stored with it (computed from its `runGraph`); otherwise it is shown `stale` or discarded. A provisional result is never in the file. A cosmetic edit (move / rename) does not stale a result. |
| **W5** | No `workspace` payload — malformed, oversized, wrong version, or partially corrupt — can prevent the graph from importing. |
| **W6** | Size handling is all-or-nothing per artifact: the full result is saved, or it is omitted (with consent, `resultOmitted` recorded), or the whole Workspace is hard-rejected. Arrays are never silently shortened. |
| **W7** | Restoration is atomic and order-independent: graph-store subscribers do not re-stale the restored result or re-reset the restored sim; the same file always restores the same state; `triggerQueue` / `stateEvents` are re-sorted to canonical order on read. |
| **W8** | `view.timeline: "distribution"` is honoured only with a usable result and a valid selected Pool; otherwise it falls back to `"live"`. |

---

## W10. Decisions — resolved

| # | decision |
|---|---|
| **D1** | **Snapshot, not replay.** The live run is a full `SimState` snapshot plus `seed`, `stateEvents`, `series`. |
| **D2** | **Nested `workspace` key**, not a new container schema. |
| **D3** | **`loop-workspace/1` is its own frozen spec id.** |
| **D4** | **Always restore paused / idle; never auto-run; never restore the timer.** |
| **D5** | **No silent truncation.** Over the byte cap ⇒ prompt (save without result / cancel); after removing the result, if graph + snapshot still exceed the cap ⇒ **hard reject**. A left-out result is recorded as `resultOmitted: "size-limit"`. |
| **D6** | **Result ↔ graph binding via a SEMANTIC digest** (SHA-256 of the canonical, id-sorted, fixed-key-order JSON of engine-relevant node/edge fields only — no `position`, `label`, viewport, `recommendedRunConfig`, or other presentation fields). **Digest provenance:** the digest is generated **only when a Monte-Carlo run completes** (from that run's `runGraph`) and thereafter travels with the result **verbatim** — export writes it unchanged, and a result restored from a Workspace keeps its original digest (never relabelled with the current graph's). Import is its only consumer: it compares the stored digest against the current graph's semantic digest to decide `stale`. |
| **D7** | **Excluded:** running/timer state, abort/Worker/provisional-MC state, undo history, dialog/focus/selection, transient animations, `lastThroughput`, user-global prefs (theme, language). |
| **D8** | **Atomic, defensive, independent restoration.** Each part validates and fails in isolation; the restore pass runs after the single graph-load `simulationRev` bump and causes no further bump, so subscribers do not re-stale / re-reset. |
| **D9** | **The live single-run `seed` (`simStore.seed`) is a required snapshot field**, distinct from `mc.config.baseSeed`, so a random run continues identically past the restore. |
| **D10** | **`series` is capped at `MAX_SERIES` (400)** — only the app's bounded live timeline is saved; no hidden full history is synthesised. Each frame is validated (Pool ids present, values finite, length ≤ 400, last frame == snapshot `values`); a bad Pool series is dropped alone; an inconsistent `series` never blocks the snapshot. |
| **D11** | **`view.timeline: "distribution"` with no usable result ⇒ fall back to `"live"`**; no selected Pool ⇒ first valid tracked Pool, else `"live"`. |

---

## W11. Constants to pin on freeze

| name | value | note |
|---|---|---|
| `WORKSPACE_SCHEMA` | `"loop-workspace/1"` | the `workspace.schema` string |
| `WORKSPACE_VERSION` | `1` | integer; a reader loads graph-only when the file's value exceeds this |
| `WORKSPACE_MAX_BYTES` | `8 * 1024 * 1024` (8 MiB) | hard cap on the serialized file; measured, not estimated |
| `MAX_SERIES` | `400` (the existing `simStore` value) | the snapshot never carries more `series` frames than the store holds live |
| `resultOmitted` values | `"size-limit"` (the only v1 value) | present only when a result existed but was left out |

**Semantic-digest projection (exact field lists — to lock on freeze):**

- **node** → `id`, `kind`, and by kind: `activation` (source/pool/drain/gate/
  converter), `mode` (pool/source/drain/converter flow mode), `distribution`
  (gate), `initial` + `capacity` (pool), and any future engine field. **Not**:
  `position`, `label`, `selected`, `type` (the React-Flow render type), width/
  height, or any style field.
- **edge** → `id`, `source`, `target`, `sourceHandle`, `targetHandle`,
  `data.kind`; for `resource`: `data.flow`; for `state`: `data.mode`,
  `data.delay`, `data.expr`. **Not**: `label`, `selected`, `markerEnd`, style,
  or any render-only field.
- **doc** → nothing (`schema`, `version`, `recommendedRunConfig`, and any
  advisory metadata are excluded).
- **canonicalisation** → sort `nodes` and `edges` by `id`; within every object
  emit keys in lexicographic order; `JSON.stringify` with no whitespace;
  `SHA-256` of the UTF-8 bytes, lowercase hex.

---

## W12. Acceptance vectors (test basis — filled on implementation)

1. **Plain graph unaffected** — `Export(Graph)` bytes identical before/after this
   feature; a v0.3.0 Graph file imports with fresh session state and does not
   disturb an already-open workspace beyond today's graph-import rules.
2. **Round-trip** — build a graph, run 20 live steps (including a hand-delivered
   `interactive` pulse and a mid-run `seed` change), run a small Monte-Carlo,
   `Export(Workspace)`, `New`, `Import` → `simulation.{seed,step,values,fired,
   triggerQueue,stateEvents,series}`, the MC result, `view` (Pool + mean), and
   the canvas viewport all match; status `paused`; nothing auto-ran; no timer.
3. **Continue after restore** — from the restored snapshot, `Step` once ⇒ the
   same state (values **and** the next RNG draw) as stepping once before the
   Export.
4. **Semantic digest — move / rename does NOT stale** — export a workspace with a
   result, then in the file move a node's `position` and change a `label`;
   Import ⇒ result **not** stale.
5. **Semantic digest — engine edit DOES stale** — change a Pool `capacity` (or an
   edge `flow` / a gate `distribution`) in the file; Import ⇒ result attached,
   `stale: true`, notice shown.
6. **Stale-on-export** — hold a knowingly-stale result (edit the graph after a
   run), `Export(Workspace)`; the stored digest is the `runGraph`'s, and
   re-Import into the *edited* graph keeps it `stale`.
6a. **Digest provenance across a re-save** — Import a Workspace whose result is
    `stale` (digest mismatch), make no further change, `Export(Workspace)` again,
    then Import that second file: the result is **still `stale`** — the re-save
    carried the original `runGraph` digest, it was **not** relabelled with the
    current graph's digest (which would have made it look fresh).
7. **Corrupt result** — truncate `series` in `mc.result`; Import ⇒ graph +
   config + view + sim restore, result discarded with a warning.
8. **Oversize → save without result** — a result over `WORKSPACE_MAX_BYTES` ⇒
   Export prompts; "save without result" writes a valid Workspace with
   `mc.result` omitted and `mc.resultOmitted: "size-limit"`; re-Import shows the
   explanatory notice and falls back to LIVE.
9. **Oversize → hard reject** — a graph + `series` alone over the cap ⇒ Export is
   refused with the hard-reject message; `Graph JSON` still works.
10. **Unknown version** — `workspace.version: 2` ⇒ graph loads, workspace skipped
    + warning.
11. **Old build** — a Workspace file opened by a `loop-workspace`-unaware build
    (simulate by removing the reader) loads the graph.
12. **Bad refs** — `triggerQueue` / `stateEvents` / `values` / a `series` frame
    referencing deleted ids ⇒ those entries dropped, the rest restored, queue
    re-sorted, `series` last frame reconciled to `simulation.values`.
13. **Distribution fallback** — `view.timeline: "distribution"` with no result ⇒
    restores as LIVE; with a result but `distributionPoolId` not tracked ⇒ first
    valid Pool.
14. **Atomic restore** — a Workspace with a non-stale result imports into the
    matching graph and the result stays **not stale** (the graph-load
    `simulationRev` bump does not re-stale it).
15. **`file://` portable** — the whole round-trip (2), the semantic digest (4/5),
    and `resultOmitted` (8) all work in the portable single-file build opened
    from `file://`. SHA-256 is required there: `crypto.subtle` is used when the
    context exposes it (Chromium treats `file://` as potentially-trustworthy), and
    the implementation **bundles a pure-JS SHA-256 fallback** so the digest — and
    therefore the Workspace round-trip — is available on every `file://` target.
    A build that somehow has neither degrades the Workspace reader to
    graph-only + warning (also tested).
