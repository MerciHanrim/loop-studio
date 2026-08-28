# Workspace Export / Import

```
Spec ID: loop-workspace/1
Status:  Draft — for review (freezes on sign-off)
```

**Not frozen yet.** This document defines *what a Workspace file is*, *what it
carries*, and *how it is restored*, so the implementation has a fixed target.
Once reviewed it freezes as `loop-workspace/1`; a behavioural change after that is
a new spec id in a new document, exactly like `loop-state/1 → loop-state/2`.

It is **independent of** and layered on top of the graph / engine / Monte-Carlo
specs. It never changes how a diagram *runs* — it only saves and restores app
state around a run. `SEMANTICS.md`, `SEMANTICS-B1.md`, `SEMANTICS-B2.md`,
`SEMANTICS-S.md`, `SEMANTICS-S2.md` are unaffected.

---

## W0. Scope

**Added**

- A **Workspace file** — a superset of a Graph Export file: the same
  `loop-studio/graph` document with one extra optional top-level key,
  `workspace`, holding the run configuration, the last completed Monte-Carlo
  result, the timeline view state, the canvas viewport, and a verified live
  simulation snapshot.
- **`Export ▾` gains a second item** — `Graph JSON` (today's behaviour, byte-for-
  byte) and `Workspace JSON`.
- **Import auto-detects.** One file input, one code path: a file with no
  `workspace` key loads exactly as today; a file with a `workspace` key also
  restores the workspace, defensively.

**Explicitly out of scope for v1**

- Multi-document / project files (more than one graph in a file).
- Embedding external assets (images, notes).
- Cross-version migration of `workspace` payloads — `loop-workspace/2` will
  define its own reader; a v1 reader that meets a higher version loads the graph
  only (§W6).
- Cloud sync, shareable URLs, autosave of the workspace (localStorage still
  persists the **graph only**, as today).

**Unchanged**

- The graph half is written by the *same* `serialize()` path as a Graph Export,
  so schema, handle ids, and `recommendedRunConfig` behave identically.
- Graph schema stays **`version: 1`**. The `workspace` key is additive and
  optional; older builds ignore an unknown top-level key.

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
      "result": { /* a MonteCarloResult, or omitted — §W3 */ },
      "resultGraphDigest": "<sha-256 hex of the canonical graph the result ran against>",
      "stale": false
    },

    "view": {
      "timeline": "distribution",           // "live" | "distribution"
      "distributionPoolId": "pool_x",       // selected Pool in the band chart, or null
      "showMean": false
    },

    "canvas": { "x": -120.5, "y": 40, "zoom": 1.25 },

    "sim": {
      "seed": 1,
      "step": 7,
      "ended": false,
      "values": { "pool_x": 12, "pool_y": 0 },
      "fired": ["pool_x_drain"],
      "triggerQueue": [ { "edgeId": "t1", "target": "d", "deliveryStep": 9 } ],
      "stateEvents": [ /* the StateEvent[] from the step that produced `step` */ ],
      "series": [ { "step": 0, "values": { /* … */ } }, /* … up to the store cap … */ ]
    }
  }
}
```

Why a nested key rather than a new container schema:

- today's Import reads `nodes` / `edges` unchanged;
- an older build ignores the unknown `workspace` key and still opens the graph;
- a new build distinguishes a plain graph from a workspace by the key's
  presence — no schema bump, no `version` collision;
- a Workspace file **is** a valid Graph file, so "open a workspace in an old
  build" degrades cleanly to "open the graph".

---

## W2. Save scope

### Included

| group | fields | source |
|---|---|---|
| **graph** | the whole `GraphDoc` (`nodes`, `edges`, `recommendedRunConfig`) | `serialize()` — identical to Graph Export |
| **MC config** | `baseSeed`, `runs`, `steps`, `tracked` | `mcStore.config` |
| **MC result** | the last **completed** `MonteCarloResult` + its `stale` flag + a digest of the graph it ran against (§W3) | `mcStore.result` / `mcStore.stale` / derived from `mcStore.runGraph` |
| **view** | timeline mode (`live` / `distribution`), selected Distribution Pool, mean-line toggle | `mcStore.view` + the band-chart selection (**must be lifted into a store — §W7**) |
| **canvas** | viewport `{ x, y, zoom }` | React Flow `getViewport()` |
| **live sim snapshot** | `seed`, `step`, `values`, `ended`, `fired`, `triggerQueue`, `stateEvents` (of the step that produced `step`), and `series` (the timeline history, already capped at the store's `MAX_SERIES`) | `simStore` |

The live snapshot is a **verified `SimState` snapshot, not a step number to be
replayed.** Replaying from step 0 cannot reconstruct an `interactive` pulse that
a user delivered by hand, a partially-drained `triggerQueue`, or a mid-run seed
change; a snapshot of `{ step, values, ended, fired, triggerQueue }` (the exact
`SimState` shape from `loop-state/1` §S8) plus `stateEvents` and `series` restores
the run bit-for-bit and lets `step()` continue from it. (§W12 D1.)

### Excluded

| group | why |
|---|---|
| `running` / `playing` status, the play timer | transient control state; a restored workspace is always **paused / idle** (§W2.1) |
| `AbortController`, Worker handles, an in-flight / provisional MC result, `completedRuns` mid-run | not a result; §W3 forbids saving a provisional run |
| Undo / redo history (`graphStore.past` / `future`) | session-local editing history, not document state; large; a restored file starts a fresh history |
| open dialog / menu, keyboard focus, node / edge **selection** | transient UI |
| pulse / tint / flash animation state | derived from `stateEvents` + `step`; re-derives on restore, nothing to save |
| `lastThroughput` | an in-memory perf hint keyed to the current session |
| **theme, language**, and any other user-global preference | belongs to the user / device (their own `localStorage` keys), not to a shared document |

### W2.1 Restore is always paused

After Import, regardless of whether the file was saved while a live run or a
Monte-Carlo run was in progress:

- the live sim is **`paused`** if a snapshot was restored (so Step / Play resume
  from `sim.step`), or **`idle`** at step 0 if there was no snapshot;
- the Monte-Carlo status is **`idle`** (or `done` if a valid `result` was
  restored — but never `running`);
- **no run — live or Monte-Carlo — starts automatically** (§W6).

---

## W3. Result consistency

A `MonteCarloResult` is only meaningful against the graph it ran on. The file
binds them:

- **`workspace.mc.resultGraphDigest`** = SHA-256 (hex) of the **canonical
  serialization** of the graph the result was produced from
  (`mcStore.runGraph`). "Canonical" = `serialize(nodes, edges)` with a
  deterministic key order — the exact bytes are pinned in §W11.
- On **Import**, recompute the digest of the file's own `nodes` / `edges`:
  - **match** → the result is attached and shown; `stale` is whatever the file
    recorded (a file can legitimately hold a stale result the user chose to
    keep);
  - **mismatch** → the result is attached but forced **`stale: true`**, with a
    one-line notice ("the saved distribution is from an earlier version of this
    graph");
  - the graph always loads either way.
- A **structurally invalid / corrupt** `result` (missing `pools`, `series`
  length ≠ `steps + 1`, `runSeeds` length ≠ `runs`, non-finite numbers, ids not
  in the graph) → **the result is discarded** with a warning; the graph and the
  rest of the workspace load normally.
- A **provisional / in-progress** result is **never written**. `Workspace JSON`
  is disabled (or omits `mc.result`) while `mcStore.status === 'running'`; only
  a `status === 'done'` result is eligible.

---

## W4. Size limits

Monte-Carlo results dominate the file size (`runs · (steps+1) · trackedPools`
numbers in `final` + `series`). Truncating the arrays would break internal
invariants (§W3), so **silent truncation is forbidden**.

1. Before serializing, compute the **UTF-8 byte length** of the candidate
   `workspace` payload (and of the whole file).
2. **Under the limit** → write the full Workspace file.
3. **Over the limit** → do not write silently. Tell the user the file would be
   *N* MB (limit *L* MB, mostly the *R*-run distribution) and offer:
   - **Save workspace without the result** — everything else, `mc.result`
     omitted, `mc.stale` irrelevant; or
   - **Cancel**.
4. Never drop "some runs" or "every other timestep" to fit — a partial result is
   not a result.

**Pinned bounds (§W11):**

- hard cap **`WORKSPACE_MAX_BYTES`** on the serialized file (proposed
  **8 MiB**);
- the result-eligibility pre-check mirrors the engine's `CELL_LIMIT`
  (5 000 000 cells) — a result at/under that limit serializes to well under the
  cap in practice, but the byte check in step 1 is authoritative, not the cell
  count;
- the doc records the measured bytes-per-cell so a UI can estimate before the
  user hits Export.

---

## W5. Import safety

The graph must always survive a bad `workspace`. Order of operations:

1. **Parse + load the graph first** via the existing `deserialize()` path. If
   that throws, the whole Import fails as today — `workspace` is not consulted.
2. `workspace` absent → done (plain graph, fresh session state).
3. `workspace.schema !== 'loop-workspace/1'` **or** `workspace.version > 1` →
   load the graph only, one-line warning ("this file's saved workspace needs a
   newer Loop Studio; the graph opened without it"). Never throw.
4. Otherwise restore each part **defensively and independently** — a failure in
   one part discards *that part* only:
   - **`mc.config`** — reuse `applyRecommended()`'s validation (finite-int
     `baseSeed → uint32`, positive `runs` / `steps`, `tracked` intersected with
     the loaded Pools in graph order, unknowns dropped). Invalid → MC config
     stays at its default.
   - **`mc.result`** — §W3 (digest check, corruption check).
   - **`view`** — `timeline` must be `"live"` / `"distribution"` else default;
     `distributionPoolId` must be a Pool id present in the graph else `null`;
     `showMean` coerced to boolean.
   - **`canvas`** — `x` / `y` / `zoom` must be finite; `zoom` clamped to React
     Flow's `[minZoom, maxZoom]`. Any non-finite → skip (leave the default fit).
   - **`sim`** — the strictest:
     - `seed` via the same finite-int `→ uint32` rule;
     - `step` a non-negative integer; `ended` boolean;
     - `values` — drop keys that are not node ids in the graph; each value must
       be a finite number ≥ 0, else that Pool falls back to its `initial`;
     - `fired` — keep only ids present in the graph;
     - `triggerQueue` — drop entries whose `edgeId` or `target` no longer exists
       (the same delivery-time guard as `loop-state/1` §S8), coerce
       `deliveryStep` to an integer `> step`, then **re-sort by the canonical
       `(deliveryStep, edgeId)` order**;
     - `stateEvents` — filter to edges present in the graph; re-sort ascending
       `edgeId`; if malformed, drop the whole array (it re-derives on the next
       `step()`);
     - `series` — keep only well-formed `{ step, values }` entries, truncate to
       the store cap; if empty/absent, seed a single step-0 frame from the
       graph.
     - If `sim` cannot yield a coherent snapshot, restore **step 0 / idle** and
       warn — never leave the sim in a half-set state.
5. **No auto-run.** Import never calls `sim.play()` or `mc.run()` (§W2.1, §W6).

---

## W6. Old-app / forward compatibility

| reader | file | result |
|---|---|---|
| build **without** `loop-workspace` support | Workspace file | opens the graph (unknown `workspace` key ignored); session state is fresh |
| build **with** `loop-workspace/1` | plain Graph file | opens as today; workspace state is fresh (equivalent to an empty `workspace`) |
| build with `loop-workspace/1` | file with `workspace.version` > 1 | graph loads, workspace skipped + warning (§W5.3) |
| any build | Workspace file whose graph half is invalid | Import fails on the graph, as today (§W5.1) |

Round-trip: `Import(Workspace) → Export(Workspace)` reproduces the same
`workspace` payload up to (a) a re-sorted `triggerQueue` / `stateEvents` if the
input was out of canonical order, and (b) `mc.stale` possibly flipping to `true`
on a digest mismatch. `Export(Graph)` from a restored workspace produces exactly
today's Graph file (no `workspace` key).

---

## W7. Implementation consequences (not part of the frozen contract, but decided here)

- **Band-chart selection must move into a store.** `distributionPoolId` and
  `showMean` are currently `useState` inside `BandChart.tsx`; to save/restore
  them they must live in `mcStore` (or a small `viewStore`). This is a
  refactor, not a semantic change.
- **Canvas viewport** needs a `getViewport()` read at Export time and a
  `setViewport()` (after `fitView` is suppressed) at Import time.
- `simStore` gains a `restoreSnapshot(sim)` action that sets
  `{ stepIndex, values, firedNodeIds, triggerQueue, stateEvents, series, seed }`
  and forces `status: 'paused'` — the inverse of the fields it already exposes.
- `serialize()` grows an optional third argument shape or a sibling
  `serializeWorkspace(doc, workspace)`; `deserialize()` returns
  `{ …graph, workspace? }` and the store wires restoration.
- One new module `src/model/workspace.ts` owns the `workspace` schema, the
  digest, the byte-size check, and the defensive reader — mirroring how
  `serialize.ts` owns the graph doc.

---

## W8. UI

- **`Export ▾`** (toolbar) → two items:
  - **Graph JSON** — `loop-studio-graph.json`, unchanged.
  - **Workspace JSON** — `loop-studio-workspace.json`. Distinct default name so
    the two are not confused on disk.
- Before the Workspace download, a short confirm/summary line: *what is
  included* (config, the *R*-run distribution if it fits, the timeline view, the
  canvas position, the live run at step *N*) and *what is not* (undo history,
  selection, theme). If the result does not fit, the §W4 choice is shown here.
- **Import** stays a single control; it detects the `workspace` key and restores
  it. A restore that dropped parts shows one aggregated notice ("opened; the
  saved distribution was from an older graph and is marked stale").
- The Monte-Carlo `Export ▾` inside the Distribution panel is unchanged (it
  exports the *result* as CSV / JSON — a different artifact from a Workspace).

---

## W9. Invariants

| # | invariant |
|---|---|
| **W1** | A Workspace file is a valid Graph file. Stripping the `workspace` key yields exactly what `Export(Graph)` would have written. |
| **W2** | Import never starts a run. After Import the live sim is `paused` (snapshot) or `idle` (none); Monte-Carlo is `idle` or `done`, never `running`. |
| **W3** | A restored `sim` snapshot fed to `step(nodes, edges, snapshot, seed)` produces the same next state as if the run had never been saved (snapshot fidelity — `loop-state/1` §S8 `SimState` is fully captured). |
| **W4** | A result is shown only when its `resultGraphDigest` matches the file's own graph; otherwise it is shown `stale` or discarded. A provisional result is never in the file. |
| **W5** | No `workspace` payload — malformed, oversized, wrong version, or partially corrupt — can prevent the graph from importing. |
| **W6** | Size handling is all-or-nothing per artifact: the full result is saved, or it is omitted with the user's consent. Arrays are never silently shortened. |
| **W7** | Restoration is deterministic and order-independent: the same file always restores the same state; `triggerQueue` / `stateEvents` are re-sorted to canonical order on read. |

---

## W10. Decisions — resolved

| # | decision |
|---|---|
| **D1** | **Snapshot, not replay.** The live run is saved as a full `SimState` snapshot (`step`, `values`, `ended`, `fired`, `triggerQueue`) plus `stateEvents` and `series`. A step number + replay-from-0 cannot reproduce interactive pulses, a mid-run seed change, or a partially-consumed queue. |
| **D2** | **Nested `workspace` key, not a new container schema.** Keeps the file a valid Graph file, needs no graph-schema bump, degrades cleanly in old builds. |
| **D3** | **`loop-workspace/1` is its own frozen spec id**, independent of graph / engine / MC specs. A change is `loop-workspace/2` in a new doc. |
| **D4** | **Always restore paused / idle; never auto-run.** |
| **D5** | **No silent truncation.** Over the byte cap ⇒ prompt: save without the result, or cancel. |
| **D6** | **Result ↔ graph binding via a SHA-256 digest of the canonical graph serialization**, stored in the file; mismatch ⇒ `stale`, corruption ⇒ discard, always keep the graph. |
| **D7** | **Excluded:** running/timer state, abort/Worker/provisional-MC state, undo history, dialog/focus/selection, transient animations, `lastThroughput`, and user-global prefs (theme, language). |
| **D8** | **Defensive, independent restoration.** Each `workspace` part validates and fails in isolation; bad refs (node/pool/edge ids) are dropped per-entry; numbers are finite- and domain-checked; the queue re-runs its delivery guard and canonical sort. |

---

## W11. Constants to pin on freeze

| name | proposed value | note |
|---|---|---|
| `WORKSPACE_SCHEMA` | `"loop-workspace/1"` | the `workspace.schema` string |
| `WORKSPACE_VERSION` | `1` | integer; a reader loads graph-only when the file's value exceeds this |
| `WORKSPACE_MAX_BYTES` | `8 * 1024 * 1024` (8 MiB) | hard cap on the serialized file; measured, not estimated |
| canonical graph bytes | `serialize(nodes, edges)` output (2-space indent, insertion key order as today) | the exact input to the SHA-256 digest |
| digest | `sha-256`, lowercase hex, of the UTF-8 bytes of the canonical graph serialization | stored as `workspace.mc.resultGraphDigest` |
| `series` cap | the existing `simStore` `MAX_SERIES` (400) | the snapshot never carries more than the store would hold live |

---

## W12. Acceptance vectors (test basis — to be filled on implementation)

1. **Plain graph unaffected** — `Export(Graph)` bytes are identical before and
   after this feature; a v0.3.0 Graph file imports with fresh session state.
2. **Round-trip** — build a graph, run 20 live steps (including a hand-delivered
   interactive pulse and a mid-run seed change), run a small Monte-Carlo,
   `Export(Workspace)`, `New`, `Import` → `sim.step`, `values`, `triggerQueue`,
   `stateEvents`, `series`, the MC result, the Distribution Pool + mean toggle,
   and the canvas viewport all match; status is `paused`; nothing auto-ran.
3. **Continue after restore** — from the restored snapshot, `Step` once ⇒ the
   same state as stepping once before the Export.
4. **Digest mismatch** — edit one node's capacity in the exported file, Import ⇒
   graph loads, result shown `stale: true` with the notice.
5. **Corrupt result** — truncate `series` in the file ⇒ graph + config + view +
   sim restore; result discarded with a warning.
6. **Oversize** — a result over `WORKSPACE_MAX_BYTES` ⇒ Export prompts; "save
   without result" writes a valid Workspace with `mc.result` omitted.
7. **Unknown version** — `workspace.version: 2` ⇒ graph loads, workspace skipped
   + warning.
8. **Old build** — a Workspace file opened by a `loop-workspace`-unaware build
   (simulated by deleting the reader) loads the graph.
9. **Bad refs** — `triggerQueue` / `stateEvents` / `values` referencing deleted
   ids ⇒ those entries dropped, the rest restored, queue re-sorted.
10. **No auto-run** — a Workspace saved mid-`running` imports `paused`; a
    Workspace saved mid-Monte-Carlo has no `mc.result` and imports `idle`.
