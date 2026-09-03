# Large-graph readability — Slice 5: saved group frames

`SF` — the **design pass**. LGR Slice 5 makes a **manual** group frame (name,
size, and — from the frame-colour follow-up — accent) **survive a reload,
Import / Export, Share, Workspace, and a Project revision**, by adding a
graph-level `frames` block behind a **Frozen `loop-revision/5` cosmetic**
amendment, modelled exactly on `route` / `waypoints` (`SEMANTICS-R3.md` / §ER6).

**This is a docs-only design pass.** It decides the persisted shape, every
serialization boundary, the defensive-read rules, the migration story, and the
test scope. **No code, no `SEMANTICS-R5.md` Freeze in this PR.** Implementation
starts only after this design is approved; `SEMANTICS-R5.md` is drafted here
(§SF8) and Frozen at the top of the impl PR.

---

## SF0. Why now, and what this is NOT

**Why.** After the frame-colour follow-up shipped, a user reported that a
manual frame they had *named, sized, and coloured* vanished on the next open —
"it feels like my work wasn't saved." Slices 4a/4b deliberately kept every
frame session-only (§LGR6.1); Slice 5 is the always-planned step that lifts
manual frames into the document (§LGR6.2, §LGR6.4).

**Not in scope:**
- **Auto (suggested) frames.** A pure `Suggest`-produced frame the user has not
  touched stays **session-only** — it is derived, recomputed, and re-proposed
  (§AF, §LGR6.1). Only a frame in `frameStore.frames` (drawn by hand, or an
  auto frame the user *promoted* via a committed rename / resize / colour —
  §AF5 R5) persists.
- **Any engine, run, or model-semantics change.** `frames` never reaches the
  engine, `SimState`, the Monte-Carlo digest, `simulationRev`, the timeline, or
  `nConf` (§SF4.3, §SF5).
- **A frame grouping any behaviour.** A saved frame is still a labelled
  rectangle with no membership (§LGR6.5) — `id`, `label`, `rect`, optional
  `color`, nothing else.
- **Auto-layout, "move the group", collapsible groups, semantic sections.**
  Those are §PD12 candidates, untouched here.
- **A `members: nodeId[]` list.** The §LGR6.4 sketch predates 4a/4b and carried
  `members`; 4a/4b removed the membership model, so Slice 5 stores **no
  members** (§SF3).

---

## SF1. The user problem, and the success test

| # | Criterion | How it is checked |
|---|---|---|
| SF-S1 | A manual frame's `label`, `rect`, and `color` are the same after: reload, Export → Import, Share round-trip, Workspace save/restore, and a Project-revision Apply of the same content | round-trip fixtures (§SF9) |
| SF-S2 | An **untouched** auto frame does **not** persist — reload / Import shows it only after a fresh `Suggest` | e2e |
| SF-S3 | An old file with **no `frames`** opens with an **empty** frame set, no error, and re-exports **byte-identical** to before | conservative-extension golden (§SF4.4) |
| SF-S4 | Adding / editing / deleting a saved frame — **and any `Ctrl+Z` / `Ctrl+Shift+Z` of it** — **never** changes the engine result, `R(t)`, state events, the MC digest, `simulationRev`, or the timeline | invariance fixture (§SF9) |
| SF-S5 | A malformed frame in a hand-edited / hostile file is **dropped**; the rest of the graph loads | defensive-read unit tests (§SF4.2) |
| SF-S7 | Every frame operation is `Ctrl+Z` / `Ctrl+Shift+Z`-able at the §SF11.1 granularity: one entry per committed op, `Clear all frames` = **one** atomic entry, a promote = **one** entry; `Suggest` / `Dismiss` / `Clear suggested` add **none** | undo-unit tests (§SF9 / §SF11) |
| SF-S6 | The dirty flag and the revision three-way diff **do** react to a frame change (it is document content) — shown as a **cosmetic** hunk, never `engineAffecting` | revision fixture (§SF9) |

---

## SF2. What persists

| frame kind | store | Slice 5 |
|---|---|---|
| **drawn manual frame** (4a tool) | `frameStore.frames` | **saved** — `id, label, rect, color?` |
| **promoted auto frame** (§AF5 R5 — committed rename / resize / colour) | `frameStore.frames` (already moved here at promotion) | **saved** — identical treatment |
| **pure auto (suggested) frame**, untouched | `autoFrameStore.autoFrames` | **session-only, unchanged** — never serialized, cleared on `loadRev` |

`serialize()` reads **`frameStore.getState().frames`** only. `autoFrameStore`
is never consulted by the write boundary.

---

## SF3. The persisted shape — graph-level `frames`

`frames` is a **graph-level** field on `GraphDoc` (a frame belongs to no node
or edge — it has no membership), placed on the `GraphDoc` literal in
`serialize()` (the location the `serialize()` schema-allowlist note already
anticipates for "a future graph-level `frames`").

```ts
// GraphDoc (src/model/serialize.ts) gains one optional field:
frames?: SavedFrame[]

type SavedFrame = {
  id: string
  label: string                 // "" ⇒ the render layer's `Group N` default
  rect: { x: number; y: number; w: number; h: number }   // flow units, finite, w>0, h>0
  color?: 'slate' | 'sage' | 'gold' | 'violet' | 'rose'   // absent ⇒ neutral
}
```

- **Field order (canonical):** `id`, `label`, `rect` (`x, y, w, h` in that
  order), then `color` **only when set**. Matches the committed example-file
  key order convention (§ER6 style).
- **Emitted only when non-empty.** `serialize()` adds `doc.frames` **iff**
  `frameStore.frames.length > 0`. An empty frame set ⇒ **no `frames` key** ⇒
  the file is byte-identical to today (§SF4.4).
- **Not stored:** `n` (the session `Group N` ordinal — re-derived on load,
  §SF6), `selectedId`, `toolArmed`, `nextN`, and anything from `autoFrameStore`.
- **`schema` is NOT bumped.** `frames` is a *forward-compatible, additive,
  cosmetic* field: a reader that does not know it simply ignores it and loses
  nothing but the overlay. This is the `route` / `waypoints` precedent — they
  entered the doc under `loop-revision/3` **without** a `schema` / `version`
  bump. `loop-model/2` bumped `schema` only because it changed *simulated
  numbers* and old clients had to fail-closed; `frames` changes no number.

---

## SF4. The wire contract — `loop-revision/5` cosmetic

Modelled precisely on `SEMANTICS-R3.md` (`route` / `waypoints`).

### SF4.1 Version predicate

A graph is **`loop-revision/5` content iff** `frames` is present and, after the
defensive read (§SF4.2), **non-empty**. Inferred from normalised content, never
stored — same shape as the v1 / v2 / v3 predicates. A file that carries
`frames: []` or a `frames` array that the defensive read empties is **not** v5
content and projects / digests exactly as v4.

`loop-revision/*` tokens in play: `1`, `2`, `3`, `4` (= `loop-model/2`
declaration). Slice 5 adds **`loop-revision/5`**.

### SF4.2 Defensive read of `frames` (§SF-S5)

Applied in `deserialize()` before the graph is handed to the store. Order:

1. `frames` absent, not an array, or `[]` ⇒ **empty set**, graph loads.
2. For each entry, **drop the whole frame** (keep the graph) if any of:
   - not a plain object;
   - `rect` missing, or any of `rect.x / y / w / h` is not a **finite number**
     (`NaN`, `±Infinity`, non-number ⇒ drop);
   - `rect.w <= 0` or `rect.h <= 0`.
3. Otherwise **normalise, keep**:
   - `id` — coerce to string; if empty / missing / duplicate of an
     already-kept id ⇒ **assign a fresh session id** (`frame_…`), so a
     hand-edited file with clashing ids still loads deterministically;
   - `label` — coerce to string; trim trailing control chars; **cap at
     `SF_LABEL_MAX` = 120** UTF-16 units (excess truncated) to bound the
     payload;
   - `rect` — kept **verbatim** (no clamping). A frame far off-canvas is the
     user's choice, exactly like a node `position`;
   - `color` — kept **iff** it is one of the five palette ids; any other value
     ⇒ the `color` key is **dropped**, the frame stays (neutral).
4. **Cap the count at `SF_FRAMES_MAX` = 200.** Entries past the cap are
   dropped (keep the first 200 in file order).
5. `n` / ordinal is re-derived on load (§SF6); never read from the file.

The graph is **never rejected** because of a bad `frames` block — the
quarantine drops the payload and keeps the graph, a `loop-revision/5` read rule
(the §ER4-DR pattern).

### SF4.3 Field tag — `frames` is `cosmetic`

`loop-revision/2 §R2-3` defines `engine` / `advisory` / `cosmetic`. A saved
frame is pure user intent about *what to display* — so it is **`cosmetic`**,
beside `label`, `position`, `route`, `waypoints`:

| projected field | tag | projected & diffed | `engineAffecting` | feeds `nConf` |
|---|---|---|---|---|
| `doc.frames[*]` (whole array) | `cosmetic` | **yes** | **no** | **no** |

- **Projected & diffed:** the canonical `loop-revision/5` projection includes
  `frames`; a Review UI shows a frame change as a **"frames" / "cosmetic"**
  hunk in the three-way diff (§SF-S6).
- **Dirty-tracked:** adding / renaming / resizing / recolouring / deleting a
  saved frame marks the document dirty (it is document content now).
- **Never `engineAffecting`, never feeds `nConf`:** the engine, the MC digest,
  `simulationRev`, `SimState`, and the timeline are computed from a projection
  that omits `frames` entirely (§SF5).

### SF4.4 Conservative extension + the golden vector

**Guarantee:** `frames` **absent / empty ⇒ the file, its `loop-revision/*`
digest, its Share link, and its Workspace payload are byte- and
digest-identical to before Slice 5.** Adding `frames` to the projection must not
move any existing file's digest.

**Golden vector** — `examples/revision-v5/` + `test/revision-v5-fixture.test.ts`
(impl PR), mirroring `revision-v3`:

- **SG0 — the v4 conservative-extension golden.** A committed graph with **no
  `frames`**. Assert `digest_v5(SG0) === digest_v4(SG0)`, both equal the pinned
  oracle value.
- **SG1 — v5 content.** SG0 + two manual frames (one coloured). Assert
  `digest_v5(SG1) !== digest_v4(SG1)`; the projected `frames` array is
  `cosmetic`, `engineAffecting: false`; the engine / MC / `R(t)` digests equal
  SG0's.
- **SG2 — v4 → v5 → v4 digest return.** SG1 with every frame deleted / cleared;
  `frames` key removed on write; `digest_v5(SG2) === digest_v4(SG2) ===
  digest_v4(SG0)` — the round-trip to "no frames" is exact.
- **SG3 — per-side (Apply).** A revision whose base is v4 and whose proposed
  side is v5 (frames added); the diff shows the frames hunk as `cosmetic`;
  Apply restores the frames; v5↔v5 full-content diff works both ways.

Every oracle digest is **pinned to a literal** in the fixture (the
`loop-revision/2 §R2-4` rule).

---

## SF5. Serialization-boundary decisions

| boundary | decision |
|---|---|
| **Graph JSON — save / autosave** | `serialize()` writes `doc.frames` from `frameStore.frames` when non-empty. `saveToStorage()` gains the frames (passed in, same as `timelineSeries` today); the autosave trigger also fires on a `frameStore.frames` change. |
| **Graph JSON — load / reload** | `deserialize()` returns `frames` (defensively read, §SF4.2). `graphStore.loadGraph` / `loadDoc` populate `frameStore` from it (§SF6). |
| **Import / Export** | Export writes `frames`; Import reads + populates `frameStore`. No special-casing — it is the same `serialize` / `deserialize` boundary. |
| **Share** | The Share blob is `serialize()` output ⇒ includes `frames`. Opening a shared link populates `frameStore`. Share's "never re-translate an open doc" rules are untouched — `frames` just rides along. |
| **Workspace** | `serializeWorkspaceFile` already calls `serialize()` ⇒ `frames` is in the Workspace file. `loop-workspace/*` (`SEMANTICS-W.md`) is **unchanged** — a frame adds **nothing** to `SimState`, the restore contract, or the Workspace validator. `frames` restores as part of the graph, before the `SimState` restore. |
| **engine / step / Monte-Carlo / timeline** | never read `frames`. No change. |
| **semantic / engine digest, `simulationRev`, `nConf`** | computed from a projection **without** `frames`. No change (§SF4.3, SG1). |
| **`loop-revision` canonical projection + its digest** | **includes** `frames` as a `cosmetic` field under `loop-revision/5` (§SF4.3). A frame change moves this digest (dirty flag + diff react) but not the engine digest. |
| **Project revision — Apply** | a revision snapshot is the canonical projection ⇒ it carries `frames`. Apply restores `frameStore.frames` from the snapshot, same as it restores `label` / `position` / `route`. |
| **`recommendedRunConfig`** | untouched — `frames` is real document content, not an advisory run default, so it is **not** placed under `recommendedRunConfig`. |
| **old file (no `frames`) → new client** | opens with an empty frame set; re-exports byte-identical (§SF-S3 / SG0). |
| **new file (with `frames`) → old client** | the old `deserialize` ignores the unknown `frames` key; the graph loads normally; on the old client's next save `frames` is **silently dropped** (only the frames are lost — never a node, edge, or value). This is the accepted trade-off for a `schema`-compatible cosmetic field, identical to how a pre-`loop-revision/3` client treats `route` / `waypoints`. **Decision: accept the forward-drop** — a hard `schema` bump (fail-closed) is not warranted for an overlay that carries no simulated meaning. |

---

## SF6. Load behaviour

On `graphStore.loadGraph` / `loadDoc` (doc open, template load, Import,
Workspace restore, Share restore, revision Apply):

1. bump `loadRev` (unchanged).
2. **`autoFrameStore`** — its `loadRev` subscription still **clears** the
   derived auto set (pure suggestions never persist).
3. **`frameStore`** — its `loadRev` subscription is replaced by a
   `loadFrames(docFrames)` call from `graphStore`:
   - `frames` ← the defensively-read `SavedFrame[]` (may be `[]`);
   - each frame gets a session `n` = its **1-based index in file order**;
   - `nextN` = `frames.length + 1`;
   - `selectedId` = `null`, `toolArmed` = `false`.
   - A template with no `frames` ⇒ `frames: []`, `nextN: 1` — today's behaviour.
4. A plain in-app **edit** never bumps `loadRev`, so frames persist across
   editing exactly as in 4a; autosave (§SF5) is what writes them out.

---

## SF7. Migration

**No migration script, no `schema` bump, no `version` bump.** `frames` is
additive and optional:

- every existing file, template, Share link, Workspace, and revision **opens
  unchanged** — `frames` absent ⇒ empty set (§SF-S3);
- a file this design produces is still `schema: "loop-studio/graph"` (or
  `…/graph/2` for a v2 model doc) — no new schema token;
- the only observable change for a graph that never had a manual frame is:
  **none** (byte- and digest-identical, SG0).

The forward-drop for an old client (§SF5) is the single compatibility cost and
is accepted.

---

## SF8. `SEMANTICS-R5.md` (Draft — Frozen at the top of the impl PR)

A new `SEMANTICS-R5.md`, "Project Revision / Proposal — saved-frames
extension", extends `SEMANTICS-R3.md`. It fixes precisely, mirroring R3:

- **R5-0 Scope** — `frames` cosmetic, graph-level, no engine / `SimState` /
  semantic-digest effect; the conservative-extension guarantee + golden vector.
- **R5-1 Version predicate** — `loop-revision/5` iff non-empty `frames` after
  the defensive read (§SF4.1).
- **R5-1.1 Defensive read** — the §SF4.2 rules, verbatim, as a `loop-revision/5`
  read rule (the §ER4-DR quarantine pattern).
- **R5-2 Extended canonical projection** — one graph-level `frames` row after
  the edge rows; exact field order `id, label, rect{x,y,w,h}, color?`; emitted
  only when non-empty; `color` omitted when neutral.
- **R5-3 Field tag** — `frames` is `cosmetic` (§SF4.3), `engineAffecting:
  false`, does not feed `nConf`.
- **R5-4 Conservative extension + golden vector** — SG0–SG3 (§SF4.4), every
  oracle digest pinned.
- **R5-5 Per-side discrimination & validation order** — verify a v1–v4 side
  with its own projection first, then lift to the v5 compare model
  (R2-INV-style).
- **loop-workspace stays as-is** — re-confirmed with a fixture.

`SEMANTICS-R5.md` ships **Draft** in the impl PR and is **Frozen** before any
serialization code lands (the R3 sequence).

---

## SF9. Test scope (for the impl PR)

**unit — defensive read (`serialize.test.ts` / a new `savedFrames.test.ts`):**
- `frames` absent / `[]` / not-an-array ⇒ empty set, graph loads;
- non-finite / negative-size `rect` ⇒ frame dropped, graph kept;
- empty / duplicate / missing `id` ⇒ fresh session id assigned;
- over-long `label` ⇒ truncated to `SF_LABEL_MAX`;
- unknown `color` ⇒ key dropped, frame kept neutral;
- > `SF_FRAMES_MAX` entries ⇒ capped;
- `n` / `nextN` re-derived from file order.

**unit — write boundary (`serialize.test.ts`):**
- `frameStore.frames = []` ⇒ **no `frames` key** in the output; output
  byte-identical to the pre-Slice-5 serializer for a committed fixture graph;
- 2 manual frames (one coloured) ⇒ `doc.frames` present, canonical field order,
  `color` omitted for the neutral one;
- `autoFrameStore.autoFrames` is **never** in the output.

**unit — round-trip (`serialize` ⇄ `deserialize`):**
- frames survive `serialize → deserialize` with identical `label` / `rect` /
  `color`; `n` re-derived to `1..k`.

**unit — revision (`revision-v5-fixture.test.ts`):**
- SG0 conservative-extension golden (`digest_v5 === digest_v4`, pinned);
- SG1 v5 content — engine / MC / `R(t)` digests unchanged, `frames` hunk
  `cosmetic` + `engineAffecting: false`;
- SG2 v4 → v5 → v4 digest return;
- SG3 per-side Apply restores frames; the diff labels the hunk cosmetic.

**unit — engine invariance:**
- a graph run before and after adding / editing / clearing a saved frame, and
  before and after an undo / redo of each: identical pool series, `R(t)`, state
  events, resource findings, MC digest, `simulationRev`, timeline (§SF11.3).

**unit / integration — undo units (§SF11.1):**
- **one** entry per: valid create, rename commit, resize-gesture end, colour
  commit, Neutral commit, single delete;
- **zero** entries for: a cancelled create, a keystroke in the rename input, a
  pointer-move during resize, a resize gesture that ends unchanged, re-picking
  the current colour, `Esc` in the rename input;
- **`Clear all frames` = exactly one** entry that removes N frames; one undo
  restores all N together (assert `undoStack` grew by 1, not N);
- **promote = one** entry bundling promotion + first edit; `Suggest` / `Dismiss`
  / `Clear suggested` add **zero** entries;
- **redo** replays each of the above to the same `frameStore.frames` state.

**e2e (`large-graph-readability.spec.ts`):**
- draw + name + size + colour a manual frame → **reload** → same frame, same
  colour, same rect;
- **Export → New graph → Import** → the frame comes back;
- **Share** round-trip (copy link, open) → the frame comes back;
- **Suggest** an auto frame, do **not** touch it → reload → it is gone (only a
  fresh `Suggest` brings suggestions back); promote one (rename), reload → the
  promoted one persists;
- **Workspace** save/restore → frames restore with the graph, before the sim
  state;
- a **Project revision** captured with frames, then Apply on a frame-less base
  → frames appear; the engine result / timeline unchanged;
- an old committed fixture file (no `frames`) opens with **no** frames and
  re-exports byte-identical;
- a hostile file with a `NaN` rect + an unknown colour → the bad frame is gone,
  the good one loads;
- **undo/redo (§SF11):** delete a saved frame → `Ctrl+Z` restores it (label /
  rect / colour intact) → `Ctrl+Shift+Z` deletes it again; `Clear all frames`
  with 3 frames → **one** `Ctrl+Z` brings back all 3; **promote** an auto frame
  by renaming → `Ctrl+Z` removes the manual frame **and does NOT** bring back
  the auto frame (only the next `Suggest` does) → `Ctrl+Shift+Z` re-creates the
  manual frame; every one of these leaves the GraphDoc engine digest / timeline
  unchanged.

**golden fixtures:**
- `examples/revision-v5/` SG0–SG3;
- one committed `examples/*.json` gains a small `frames` block so the
  example-file round-trip / byte-identity suites cover it.

---

## SF10. Implementation plan (named, not built here)

| file | change |
|---|---|
| `SEMANTICS-R5.md` | **new** — Draft → Frozen (§SF8) |
| `src/model/serialize.ts` | `GraphDoc.frames?`, `SavedFrame`, `SF_*` consts; `serialize()` writes `frames` when non-empty; `deserialize()` defensive read; `saveToStorage()` gains `frames` |
| `src/model/revision.ts` | `loop-revision/5` predicate; `frames` in the canonical projection tagged `cosmetic`; per-side validation order; the R5 digest |
| `src/store/frameStore.ts` | `loadFrames(docFrames)`; the `loadRev` subscription no longer just clears — `graphStore` drives it; `frames` shape unchanged (`n` still session-only); **every mutation (`addFrame` / `renameFrame` / `resizeFrame` / `setFrameColor` / `adoptFrame` / `removeFrame` / `clearFrames`) routes through the graph undo transaction at the §SF11.1 granularity** — commit-boundary only, `Clear all` = one atomic entry, promote+first-edit = one entry |
| `src/store/graphStore.ts` | thread `doc.frames` into `loadFrames` on every load path; autosave also fires on a `frameStore.frames` change; pass `frames` to `saveToStorage` / `serialize`; expose the undo transaction to `frameStore` (§SF11); a frame entry is tagged cosmetic — it never bumps the engine digest / `simulationRev` |
| `src/store/workspaceIO.ts` | none beyond what `serialize()` already gives it (confirm with a fixture) |
| `docs/large-graph-readability.md` | §LGR6.1 / §LGR6.2 / §LGR6.4 / §LGR6.5, §LGR3.4 persistence table (new **Saved frames** row), the roadmap line (Slice 5 no longer "deferred") |
| `docs/large-graph-readability-auto-frames.md` | §AF5 / §AF6 — a promoted frame now persists; §AF7 unchanged |
| `docs/large-graph-readability-frame-colour.md` | §FC0 / §FC5 — `color` now persists on a saved (manual) frame; the "session-only, dropped on reload" line becomes "session-only until Slice 5; then saved with the frame" |
| tests + fixtures | §SF9 |

Estimated as **one impl PR** (the R3 shape): Freeze `SEMANTICS-R5.md`, then
`serialize` + `revision` + store wiring + the fixture suite, held as Draft.

---

## SF11. Undo / redo — DECIDED: Option A, with fixed units

**Decision (review, 2026-09-04): a saved frame is document content, so a frame
operation is `Ctrl+Z` / `Ctrl+Shift+Z`-able exactly like any other graph edit.**
Parity with `route` / `waypoints` (§ER-D13: "one undo entry per add / move /
delete, cosmetic revision content, no engine effect"). `frameStore` mutations
route through the **same undo transaction** the graph store uses; every frame
undo entry is a **cosmetic** change — the GraphDoc's `loop-revision/5` digest
moves, the engine / MC / `simulationRev` digest does not.

### SF11.1 The undo unit for each operation — fixed

| operation | undo entry |
|---|---|
| **Create** (draw tool) | **1**, when a **valid drag completes** (clears `frameIsCreatable`). A cancelled / too-small / no-node drag makes **no frame and no entry**. |
| **Rename** | **1**, on **commit** (Enter / blur). **Not per keystroke** while the input is open. `Esc` = no commit, no entry. |
| **Resize** | **1**, on **resize-gesture end**. **Not per pointer-move frame** during the drag. A gesture that ends unchanged (`rectEq` to the start) = **no entry**. |
| **Colour set** and **return to Neutral** | **1 each**, on the swatch **commit** (the `pickColor` click). Picking the colour a frame already has = **no entry**. |
| **Delete** (✕) | **1 per frame**. |
| **`Clear all frames`** | **exactly 1 atomic entry** for the whole clear, **regardless of frame count**. One `Ctrl+Z` restores **every** frame the clear removed, together. |
| **Promote by editing an auto frame** (committed rename / resize / colour — §AF5 R5) | **1 entry that bundles the promotion _and_ the first edit.** One `Ctrl+Z` removes the new manual frame in one step (see SF11.2). The promotion is never a separate entry from the edit that triggered it. |
| **Suggest / Dismiss / `Clear suggested frames`** on a **pure** auto frame | **no undo entry** — a suggested frame is derived session state, not document content (§SF2, §AF6). |
| **Import / Workspace restore / revision Apply / initial load** | **no per-frame entries.** These are load boundaries; the frames arrive as part of the loaded document. (Whether the load itself is one coarse undo entry is the existing graph-load behaviour, unchanged by this doc.) |

### SF11.2 Undoing a promotion

`Ctrl+Z` on a promote entry:

- **removes the promoted manual frame** from `frameStore.frames`;
- **does NOT restore the pure auto frame** it came from. A suggested frame is
  **derived session state** — it is reconstructed by `Suggest`, not by undo.
  After the undo, the cluster is simply unframed until the next `Suggest`;
- **redo** re-creates the promoted manual frame (with the label / rect / colour
  it had), not the auto frame.

This keeps the invariant that `autoFrameStore` content is never on the undo
stack (SF11.1 row 8) while still giving the user a single-step reversal of a
promote.

### SF11.3 What an undo/redo never changes

An undo or redo of any frame operation leaves the **engine result, `R(t)`,
state events, resource findings, the Monte-Carlo digest, `simulationRev`, and
the timeline byte-identical**. Only the `loop-revision/5` cosmetic projection
(and the dirty flag / diff) moves.

Everything in §SF4 / §SF5 / §SF6 stands as written; §SF11 is now closed.

---

## SF12. Order this feeds into

1. **This design pass** — docs-only Draft PR (this file + the LGR / AF / FC
   cross-refs). §SF11 decided (Option A + the fixed undo units, §SF11.1);
   §SF5 confirmed. **MERGED** (`a10ae75`).
2. **Impl PR** — Freeze `SEMANTICS-R5.md`; `serialize` + `revision` + store
   wiring + §SF9 fixtures; held as Draft. **BUILT (Draft PR #122).** Landed:
   `SEMANTICS-R5.md` Frozen; `serialize` / `deserialize` / `saveToStorage` /
   `loadFromStorage` `frames` boundary (`SF_FRAME_COLORS` / `SF_LABEL_MAX 120` /
   `SF_FRAMES_MAX 200`, `readSavedFrames` defensive read); `canonicalContent`
   trailing `frames` key + `computeRevisionDiff` one cosmetic `frames` hunk
   (`summary.framesChanged`, never `engineAffecting` / `advisoryAffecting`);
   a second graph-undo **sidecar** (`setFrameHistorySidecar`) so one graph
   undo / redo restores the graph AND its saved frames together; `frameStore`
   self-commits at the §SF11.1 units (`commitHistory('')` discrete,
   `commitHistory('frame:gesture:<id>')` coalesces a resize/move gesture),
   `loadFrames` / `snapshot`, cold-boot seed; `graphStore.loadDoc(…, frames)`
   (`undefined` keeps, array replaces) threaded through `loadJSON` /
   `workspaceIO` / revision **whole-proposal** Apply + "Open as a document"
   (atomic array swap — §R5-6); `planRevisionExport` / `planProposalExport` /
   `buildFile` write `frames` and its `contentDigest` covers them (frame-free
   ⇒ byte-identical, R5-INV-2).
   **The full revision contract is closed** (§R5-6): `computeThreeWay` emits the
   single graph-level `FramesHunk` (`clean` / `noop` / `conflict` against the
   live target, a `conflict` feeding `nConf` like a `label` conflict);
   `HunkSelection.frames` (`'proposed'` swaps the whole array in — an empty
   array clears — `'yours'` keeps the target's); `buildSelectiveApply` returns
   `frames` only when the hunk is accepted; `ReviewOverlay` shows a **"frames"**
   part in the diff summary and a **"Saved frames"** hunk row; `readRevisionSide`
   infers `loop-revision/5` from a surviving `frames` block and verifies the
   digest with the v5 projection; `readCanonicalContent` carries a stored base's
   `frames`; `liveDigest` / `currentTargetDigest` and every `dirty` snapshot
   include the on-screen saved frames.
   Golden vector `test/revision-v5-fixture.test.ts`
   (**SG0–SG5**; SG4 = the v4↔v5 three-way / selective-apply combinations) +
   `examples/revision-v5/`; unit deltas in `serialize.test.ts`,
   `threeway.test.ts`, `revisionApply.test.ts`,
   `revision.test.ts`, `frameStore.test.ts`; e2e in
   `e2e/large-graph-readability.spec.ts` (persist / reload / Export·Import /
   undo-unit / hostile-record) and `e2e/revision.spec.ts` (the cosmetic diff
   row + per-hunk swap / keep / conflict-gate through the Review UI).
3. **After Slice 5 ships** — the **B module / template-composition** design
   pass (unchanged as the next item).

Slice 5 does **not** unblock semantic sections, hierarchical groups, or
authored regions (§PD12) — those remain separate.
