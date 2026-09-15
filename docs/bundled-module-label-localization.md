# Bundled-module label localization (design doc)

**Status: approved design, implementation landing in the same PR as this
doc.** Supersedes the stale forward-reference to this filename left in
`src/model/modules.ts`, `src/components/ModuleMenu.tsx`, `src/components/
Canvas.tsx`, and `e2e/module-label-localization.spec.ts` (all of which cited
it before it existed). §MLS0–MLS3 describe the KO/JA node-label overlay that
already shipped (PR #185); §MLS4 onward is the new locale-**sync**
mechanism — Hanrim's 2026-09-15 kickoff — that this PR adds on top of it.

**Revision 2 (2026-09-15, pre-push review round).** Two P1 findings against
the first draft of this implementation, both fixed before push, both now
folded into the sections below rather than kept as a separate erratum:

1. §MLS3.1's original rule — "official in ANY shipped locale" — wrongly kept
   translating a user rename that happened to land exactly on another
   locale's official string (e.g. an EN-inserted `Supply` renamed BY THE
   USER to the Korean word `공급원`). That content-matching rule is
   **retired**. The provenance record now tracks `lastAppliedLabel` — the
   exact string this feature itself last wrote — and a node is switched iff
   its current label still matches that recorded value; anything else
   detaches it, permanently, with no re-examination by content ever again.
2. Provenance was a single global map, fully cleared by `newGraph` /
   `loadGraph` / `loadDoc`. Since those three actions push the PRE-reset
   document into `past` first, an Undo back past one of them restored the
   module instance's NODES but not its tracking, silently breaking sync for
   an otherwise-legitimate, still-open instance. Provenance is now a
   **history-aware sidecar** — captured and restored by `commit()` /
   `undo()` / `redo()` exactly like the existing project-header and
   saved-frames sidecars, never a bare global.

**Revision 3 (2026-09-15, same review round, one more pass).** A third P1:
revision 2's detach was purely LAZY — checked only at the next locale
switch. A user could rename `Supply → My Supply → Supply` (back to the
exact original text) with no switch in between, and the lazy check would
see the string match `lastAppliedLabel` again and wrongly treat the node as
never-edited. §MLS4.4 adds an EAGER detach at the `updateNodeData` edit
itself — `commit()` → detach the live map → mutate the node, in that exact
order, so the entry is already gone before any switch could be fooled by
the coincidence, and Undo/Redo across the edit boundary each restore the
correct (managed / detached) state.

## MLS0. Why

`src/i18n/moduleLabels.ts` already applies a KO/JA overlay to a bundled
Building block's node labels **at the moment of insert** (menu click or
canvas drag-drop — both funnel through `cloneModuleDoc`). Until now that was
the whole feature: switching the UI language after an insert left the
instance exactly as it was (`e2e/module-label-localization.spec.ts`'s
`switching locale AFTER insert does not retranslate an already-inserted
instance` test asserted this directly).

That's the gap this doc closes: after inserting a bundled module, changing
the UI language (EN/KO/JA, either direction) now updates that module
instance's **official, unedited** node labels to match — live, in the open
canvas, and in every undo/redo snapshot — exactly like `docs/
template-label-overlay.md` §TLO11 already does for bundled Templates.

## MLS1. Scope

### In scope

- A freshly-inserted bundled module's official node labels follow later
  EN/KO/JA switches, in both directions, indefinitely (not just the one
  switch right after insert).
- Both insert paths — "Insert module ▾" menu click and canvas drag-drop —
  behave identically (they already share one `graphStore.insertModule` call;
  this doc doesn't change that).
- A label the user has edited, even once, is preserved through every future
  switch — independently per node, so editing one node in an instance
  doesn't stop its siblings from translating.
- Multiple inserted instances of the same bundled module are each tracked
  and relabeled correctly on their own.
- Undo/Redo across a language switch never resurrects a stale-language
  label (§TLO11's same guarantee, extended to modules).

### Out of scope (named so it is not assumed)

- **A new wire field or file-format version.** No `GraphDoc`, `LoopNode`, or
  `LoopEdge` field is added (§MLS3, §MLS-D1). The tracking this feature needs
  is **session-only** — see §MLS3 for exactly what that means and doesn't.
- **A user-supplied "From file…" module.** Never localized at insert, never
  tracked, never synced — regardless of whether its ids or labels happen to
  match a bundled module's (§MLS2.3, §MS-Q1/MS1.1). This is unchanged
  existing behavior, restated here because it is load-bearing for this
  feature's safety boundary.
- **Anything but `label`.** `id`, `kind`, `position`, edges, `value`, `expr`,
  `flow`, `modelVersion` are all untouched, exactly as `stripDataImport
  Provenance`/§TLO11 already establish as the norm for a label-only overlay.
- **Templates.** They already have their own, unrelated mechanism (§TLO11) —
  this doc does not change it, only sits beside it in the same `useI18n`
  subscription (§MLS4.3).

## MLS2. Why Templates' mechanism can't be reused as-is

§TLO11 keys entirely on `node.id`, because a bundled Template's node ids are
**stable** — `loadGraph` uses each Template's own canonical ids verbatim, so
a single build-time table (`known.generated.ts`: id → official label per
locale) can classify any node in any document, in any session, forever.

A module is different by design (`docs/module-system.md` §MS-Q5): **every**
node id is re-issued on **every** insert, so two instances of the same
bundled block never share an id, and neither instance's ids match the
block's own canonical ids (`examples/module-*.json`). A static
`id → official label` table is therefore impossible for modules — the same
canonical id (`supply`, `inbox`, …) is shared by every instance, but each
instance's *host* ids are different and unpredictable ahead of time.

**What this means:** classifying a module-inserted node requires knowing,
per node, which bundled module and which of that module's own canonical ids
it came from. Nothing in the existing wire format carries that — it has to
be recorded at the moment of insert and kept somewhere that isn't the saved
document (§MLS1 "out of scope").

## MLS3. The provenance record — session-only, history-aware, never serialized

`src/model/moduleProvenance.ts` — a `Map<hostNodeId, { moduleId,
canonicalId, lastAppliedLabel }>`. Not a Zustand store, not part of
`GraphDocLike`, not touched by `serialize()` / `deserialize()` — but, per
revision 2, it IS captured and restored alongside `nodes`/`edges` on every
`commit()` / `undo()` / `redo()`, via the exact same sidecar mechanism
`frameSidecar` / `dataImportSidecar` already use (`graphStore.ts`'s
`SidecarBundle` gains one more key, `m`). This is the load-bearing
correction from revision 1: a bare global map, cleared wholesale by
`newGraph`/`loadGraph`/`loadDoc`, cannot be right — those three actions
push the pre-reset document into `past` FIRST, so an Undo back past one of
them must restore that point's tracking along with its nodes, not land on
an empty map.

- **`lastAppliedLabel`** is the exact string THIS FEATURE itself last wrote
  at that node — set at insert time to whatever `cloneModuleDoc` actually
  applied (the EN canonical, or the KO/JA overlay's entry), updated on every
  successful relabel. It is the ONLY signal §MLS3.1 uses to decide
  official-vs-user-edited — see below.
- **Written** only by `graphStore.insertModule`, only after a bundled insert
  has fully committed (§MLS4.1) — never on a `needs-v2-consent` refusal,
  never on any other insert failure, never for a file-inserted module.
- **Read and (possibly) rewritten** by the relabel pass (§MLS4.3) — a
  successful relabel bumps `lastAppliedLabel`; a detected divergence
  (§MLS3.1) removes the entry.
- **The LIVE map is cleared** at every "start fresh" point — `newGraph`,
  `loadGraph`, `loadDoc` (§MLS4.2) — so the NEW current document never
  carries over a previous document's module provenance. The PRE-reset
  state is not lost, though: `commit()` (called by all three, first) folds
  the live snapshot into the new `past` entry's own sidecar, so Undo past
  the reset restores it (§MLS4.2, §MLS-D5).
- **Never persisted.** It does not survive a page reload, and does not need
  to: `loadDoc` never re-runs the insert path (this was already true before
  this feature — `moduleLabels.ts`'s original comment), so an already-saved
  module instance is just plain graph JSON on reload either way. **This
  feature syncs only bundled instances inserted in the CURRENT session, from
  this feature onward** — reloading the page (or opening a saved file from
  an earlier session) resets tracking, and those older instances' labels
  simply stop following future switches, exactly as they always have. This
  is a deliberate scope line (§MLS-D1), not a bug to fix later by smuggling
  provenance into the graph JSON as non-standard metadata — that is
  explicitly rejected (§MLS-D1).

## MLS3.1 The "official vs. user-edited" test — `lastAppliedLabel`, not content-matching

**Revision 2 correction.** The original rule — "official in ANY shipped
locale" — is retired: it wrongly kept translating a user rename that
happened to equal another locale's official string (an EN `Supply` renamed
BY THE USER to the Korean `공급원` kept getting retranslated on every
switch, because `공급원` genuinely IS an official string — just not the one
THIS instance's own history says it should currently hold). §TLO11's
"accepted rare edge case" framing for Templates does not transfer here —
Hanrim's kickoff contract has no such exception for modules, and the new
per-instance provenance record makes an exact fix possible.

The corrected rule: given a node's provenance record, its label is switched
**iff** the CURRENT label is exactly (`===`) `lastAppliedLabel` — the value
THIS FEATURE itself put there, whether at insert or at a previous switch:

1. no match → the node was changed by something else since (almost always a
   user edit) — left untouched, AND the provenance entry is **removed**,
   permanently.
2. a match → replaced with that pair's official string in the target
   locale (the EN canonical when the target locale has no overlay entry,
   i.e. English itself), and `lastAppliedLabel` is updated to the new value
   in the same step — so the switch's OWN write is never mistaken for a
   user edit on the next switch.

**Revision 3 correction — detachment is EAGER, not just this lazy check.**
Checking rule 1 only at the next locale switch has a gap: a user can rename
`Supply → My Supply → Supply` (back to the exact original text) entirely
BEFORE any switch ever happens. A purely lazy, switch-time check would see
`lastAppliedLabel === "Supply"` still equal to the current label and
wrongly conclude the node was NEVER edited — silently erasing a genuine
edit history. §MLS4.4 below adds an EAGER detach, right at the
`updateNodeData` edit itself, so this can never happen: the entry is gone
the instant a real rename commits, regardless of what the user later types
it back to. The switch-time check (rule 1 above) still exists as the
correct behavior for a node WITHOUT this feature's own write in between
(e.g. a value arriving via Undo/Redo, restored from an earlier history
point) — it is not redundant, just no longer the ONLY detach path.

**No separate boolean "has this node been edited" flag is needed** —
removing the map entry IS the flag; there is nothing left to re-check once
it's gone, whether that removal happened eagerly (§MLS4.4) or was noticed
lazily at a switch (rule 1). This also gives per-node granularity within
one instance for free (§MLS1 "independently per node") — nothing about how
one node in an instance is judged depends on any other node in that
instance. And because detachment mutates a provenance SNAPSHOT (never the
live singleton read out of thin air for a historical array), it composes
correctly with history (§MLS4.3): a past point where the node hadn't been
renamed yet still has its own, not-yet-detached record, and correctly
resumes translating if Undo lands there — see §MLS4.4 for exactly how the
`commit()` / detach / mutate ordering makes this so.

## MLS4. Implementation

### MLS4.1 `insertModule` — provenance registered only after real success

`graphStore.insertModule`'s `opts` gains one new, optional field:
`bundledModuleId?: string`. The two call sites that insert a `BUNDLED_MODULES`
entry (`ModuleMenu.tsx`'s `insertBundled` → `runInsert`, `Canvas.tsx`'s
`handleDrop`) pass the block's own `id`; every other call (`handleFileText`,
the frames-exclusion dialog's `run` for a file, `extract`'s download path —
which never calls `insertModule` at all) passes nothing, so `bundledModuleId`
stays `undefined` and no provenance is ever recorded for them.

Inside `insertModule`, `registerModuleProvenance(entries, opts.
bundledModuleId)` runs **only after** the existing `needs-v2-consent` early
return (`built.promotedToV2 && !opts.confirmedPromotion` — unchanged), so a
first attempt that still needs the promotion dialog registers nothing; only
the call that actually reaches the one committed `set(...)` (§MS3.5's
existing one-atomic-transaction contract, unchanged) registers anything.
`entries` is built from `built.idMap` (`insertGraph`'s existing return
field, `canonical id → fresh id`, previously computed but never surfaced
past this action) PLUS each inserted node's own ACTUAL label right now
(read back off `built.nodes`) — so `lastAppliedLabel` starts in sync with
the real, already-localized node, not re-derived separately. No widening of
`InsertModuleResult` is required — it says the same to every existing
caller.

### MLS4.2 Session resets — clear the LIVE map, not history

`clearModuleProvenance()` is called from `newGraph`, `loadGraph`, and
`loadDoc` — the three, and only three, places `graphStore.ts` replaces the
whole document (`docs/root-markdown-reorg`-era audit of every load path:
file import, Workspace import, Share-link apply, Revision proposal-open,
Revision Apply all funnel through `loadDoc`; a bundled Template open through
`loadGraph`; New through `newGraph`). This clears only the LIVE map for the
NEW document — the outgoing document's own tracking is not lost, because
each of these three calls `commit('')` FIRST, and `commit()`'s
`sidecarNow()` already folds the live provenance snapshot into the `past`
entry it pushes (§MLS4.3, §MLS-D5). An Undo back past the reset therefore
restores both the old document's nodes AND the module tracking that
belonged to it — not an empty map. A provenance entry for a node that no
longer exists within a still-live document (e.g. its module instance was
later deleted without a reset) is simply never looked up again — left in
place rather than swept per-delete, since it is harmless and every snapshot
it might pollute is either still valid or gets superseded at the next
commit/reset regardless (§MLS-D3).

### MLS4.3 The relabel pass — one subscription, a per-snapshot pure function

`src/i18n/moduleLabelSync.ts` exports
`relabelModuleNodesForLocale(nodes, targetLocale, provenance)` — pure,
taking an explicit `ModuleProvenanceSnapshot` rather than reading a global,
and returning **both** a (possibly new) `nodes` array and a (possibly new)
`provenance` snapshot: a successful relabel updates an entry's
`lastAppliedLabel`; a detected divergence (§MLS3.1) removes it. Both
returned values keep their SAME reference when nothing changed, mirroring
`relabelNodesForLocale`'s (§TLO11) existing contract.

Taking an explicit snapshot rather than reading the live singleton is what
makes history correct: the existing `useI18n.subscribe` reaction at the
bottom of `graphStore.ts` calls this pass **twice** — once for the LIVE
nodes against the LIVE snapshot (`moduleProvenanceSnapshot()`), and once
per `past`/`future` HISTORY ENTRY against THAT ENTRY's OWN sidecar
snapshot (`sidecar.m`), never the live one. This matters concretely: a node
detached in the live map (renamed after the entry was captured) may still
have been genuinely under management AT that earlier history point, and a
node the live map still tracks may already have been detached by an
earlier-in-time rename that a later Undo would step back past. Each point
in time is relabeled against its own recorded state, exactly like
`nodes`/`edges`/`modelVersion` themselves already are.

```
tNodes = relabelNodesForLocale(g.nodes, loc)                          // Templates
{ nodes, provenance } = relabelModuleNodesForLocale(tNodes, loc, moduleProvenanceSnapshot())
if (provenance changed) restoreModuleProvenanceSnapshot(provenance)     // write back the LIVE map
// … the same two calls again per history entry, using `sidecar.m` instead
```

The existing one-atomic-write contract is untouched: still no new undo
entry, still no `simulationRev` / `loadRev` / `fitRev` / `pristineSample`
touch, still exactly one `persist()` call when a LIVE label changed
(a provenance-only change, e.g. a pure detachment with no label rewrite,
never triggers autosave — provenance is never part of the saved bytes),
still zero writes for a re-select of the active locale or a same-locale
boot. Frame titles are unaffected — modules never carry frames (§MS3.7 /
B3).

### MLS4.4 Eager detach on a real edit (revision 3)

`graphStore.updateNodeData(id, patch)` is the ONE place a node's label can
be user-edited (`Inspector.tsx`'s label field is its only caller for
`label`; `ModelPanels.tsx` only ever patches `value`). It now detaches
provenance the instant a REAL label edit commits:

```
updateNodeData: (id, patch) => {
  commit(`data:${id}`)                                    // 1. snapshot PRE-edit state
  if (typeof patch.label === 'string') {
    const cur = get().nodes.find(n => n.id === id)?.data.label
    if (patch.label !== cur) detachModuleProvenance(id)    // 2. detach the LIVE entry
  }
  set({ nodes: /* apply patch */ })                        // 3. mutate the node
  ...
}
```

The order is load-bearing, and matches exactly what was asked: `commit()`
first, so the `past` entry it pushes captures the node's PRE-edit label
alongside the STILL-MANAGED provenance (the live map hasn't been touched
yet); detach second, mutating only the LIVE map; the actual label mutation
third. A patch that never sets `label`, or sets it to the exact value the
node already has (not a real edit — e.g. a form re-submitting an unchanged
field), does not detach anything.

This closes the gap §MLS3.1 flagged: `Supply → My Supply → Supply`, done
as two separate edits with no locale switch in between, detaches on the
FIRST edit (`Supply → My Supply`) and stays detached through the second
(`My Supply → Supply`) even though the text lands back on the original
applied value — the lazy, switch-time content check (§MLS3.1 rule 1) never
gets a chance to be fooled by the coincidence, because the entry is already
gone before any switch happens.

**Undo/Redo across the edit boundary**, worked through concretely: before
the edit, the live map has the node MANAGED (`lastAppliedLabel: "Supply"`).
`updateNodeData`'s `commit()` pushes a `past` entry whose `sidecar.m`
carries that MANAGED snapshot (step 1, before detach). The edit then
detaches the LIVE map (step 2) and writes the new label (step 3) — so after
the edit, live provenance has NO entry for this node. `undo()` pops that
`past` entry: nodes revert to the pre-edit label, `restoreSidecar` replaces
the live map with the entry's OWN `sidecar.m` — MANAGED — so the node
resumes translating on the next switch. `undo()` also pushes the
CURRENT (post-edit, DETACHED) state into `future` with its OWN
`sidecarNow()`; `redo()` later restores exactly that — DETACHED — so
redoing the edit correctly un-resumes translation. Each point in time
carries its own, independently-correct provenance, exactly per §MLS4.3's
existing per-snapshot design — this needed no changes to `undo`/`redo`
themselves, only to `updateNodeData`.

## MLS5. Safety boundaries (Hanrim, 2026-09-15 kickoff — restated as the
contract this implementation is checked against)

1. Only instances inserted **from `BUNDLED_MODULES`** are ever tracked.
2. A "From file…" import is never localized and never tracked, even if its
   ids/structure/labels coincide with a bundled module's.
3. A module extracted from a selection and later re-imported is, by
   construction, a file import (§MLS4.1) — never tracked either.
4. A user-edited label is never overwritten by a later switch — including a
   rename that happens to equal ANOTHER locale's official string — and once
   detached it stays detached forever; only the still-unedited official
   labels in that same instance keep translating (§MLS3.1, revision 2).
5. Multiple instances of the same bundled module are each tracked and
   relabeled independently (their host ids are always distinct — §MS-Q5).
6. Node ids are re-issued on every insert; provenance is keyed on the fresh
   host id, populated from `insertGraph`'s own `idMap`, never guessed from a
   canonical id pattern.
7. Bundled origin is never inferred from a node's shape or current label —
   only an explicit provenance record (written at insert time) counts.
8. Only `data.label` is ever written by this feature.
9. A locale switch creates no Undo entry and bumps none of `simulationRev` /
   `loadRev` / `fitRev`.
10. Undo/Redo snapshots are re-seeded the same pass the live graph is —
    against EACH ENTRY's own provenance snapshot, never the live one
    (§MLS4.3, revision 2) — so neither can resurrect a stale-language label,
    AND a still-managed-at-that-point instance correctly resumes syncing if
    Undo lands there, even past a New/Template-load/file-load.
11. `newGraph` / `loadGraph` / `loadDoc` all clear the LIVE provenance map
    (§MLS4.2) — but the outgoing document's own tracking is preserved in
    history via the same `commit()` sidecar mechanism as `nodes`/`edges`
    themselves, so an Undo past the reset restores it too (revision 2).
12. No new wire field, no new file-format version; provenance does not
    survive a save/reload — scoped explicitly to "bundled instances inserted
    in the current session, from this feature onward" (§MLS3), never smuggled
    into graph JSON as non-standard metadata.

## MLS6. Tests

- `src/model/moduleProvenance.test.ts` — register/lookup/clear, snapshot
  round-trip through `restoreModuleProvenanceSnapshot`, and that a lookup
  for an untracked id returns `undefined`; `detachModuleProvenance` removes
  exactly the given id, is a no-op for an untracked id, and is idempotent.
- `src/i18n/moduleLabelSync.test.ts` — the pure relabel function against
  explicit provenance snapshots: a match on `lastAppliedLabel` switches (and
  bumps it); **[P1]** a user rename to ANOTHER locale's official string is
  detached and never re-adopted, through repeated later switches; any other
  user-edited label is preserved and detached; same-locale re-apply is a
  no-op on both returned references; a node with no provenance entry is
  left untouched; multiple instances of the same canonical id are relabeled
  independently; a locale with no overlay entry falls back to EN.
- `src/store/relabelOnLocaleSwitch.test.ts` (extended) — provenance-tracked
  nodes in the live graph AND in `past`/`future` follow a switch using EACH
  entry's OWN sidecar snapshot (not the live one); **[P1]** a rename to
  another locale's official string is preserved at the store/subscription
  level too; a history entry with no `sidecar.m` at all is never touched
  even if the live map still tracks that id; `simulationRev` is untouched;
  same-locale re-select and a plain user graph are no-ops.
- `src/store/moduleInsert.test.ts` (extended) — a bundled insert with
  `bundledModuleId` registers provenance (with the real applied label) for
  exactly the inserted node ids; a `needs-v2-consent` refusal registers
  nothing; a file-based insert (no `bundledModuleId`) registers nothing;
  `newGraph`/`loadGraph`/`loadDoc` clear the LIVE provenance; **[P1]**
  New/loadGraph/loadDoc followed by Undo restores the module instance's
  provenance along with its nodes; Redo past a reset restores the empty
  (new-document) provenance, not the pre-reset instance's; a loaded document
  that reuses a former host node id is never treated as provenanced;
  **[P1, revision 3]** `updateNodeData` detaches provenance immediately on a
  real label edit with no switch involved; a same-value patch does not
  detach; a patch that never touches `label` leaves provenance untouched;
  `Supply → My Supply → Supply` in quick succession stays permanently
  detached (not re-adopted); Undo across that edit boundary restores the
  MANAGED state, Redo restores the DETACHED one.
- `src/store/relabelOnLocaleSwitch.test.ts` (extended, revision 3) — the
  same `Supply → My Supply → Supply` sequence through the REAL
  `updateNodeData` action, then a locale switch, confirms the label stays
  `Supply` rather than being retranslated.
- `e2e/module-label-localization.spec.ts` — the full regression list from
  Hanrim's kickoff (EN→KO→JA→EN, first-insert-in-KO/JA then switch, menu AND
  drag paths, multiple instances, one node renamed by the user, a From-file
  module never following a switch, Undo/Redo not resurrecting a stale label,
  same-locale reselect a no-op, no regression to Template label-switch
  behavior) PLUS, from revision 2's review round: **[P1]** a rename to
  another locale's official string preserved through EN/KO/JA cycling;
  insert → New/loadDoc/loadGraph → Undo → switch still syncs the restored
  instance; a loaded document reusing a former host node id is never
  synced; a rename followed by Undo then Redo restores the managed state
  matching each history point (pre-rename still syncs, post-rename stays
  preserved) — PLUS, from revision 3's review round: **[P1]**
  `Supply → My Supply → Supply` with no switch in between stays `Supply`
  after a switch (not re-adopted); Undo across that edit boundary restores
  translation, Redo across it restores the preserved rename.

## MLS7. Decisions (MLS-D)

| # | Question | Decision |
|---|---|---|
| **MLS-D1** | persist provenance across save/reload? | **No.** No new wire field, no file-format version bump, no non-standard metadata smuggled into graph JSON. Scoped explicitly to the current session, from this feature's ship date onward (§MLS3). |
| **MLS-D2** | where does the EN canonical label come from? | **`BUNDLED_MODULES[i].doc`** directly (the same source `cloneModuleDoc` already reads for an EN insert) — not a third overlay table, so there is exactly one place each canonical id's English text is authored. |
| **MLS-D3** | prune provenance entries for deleted/detached nodes? | **No.** Left in whatever snapshot they're in — harmless (never looked up for a node that no longer exists in that snapshot's own `nodes` array) and every live-map entry is fully cleared at the next `newGraph`/`loadGraph`/`loadDoc` regardless; pruning per-delete would be extra wiring for no observable benefit. |
| **MLS-D4** | reuse `known.generated.ts` / the Template relabel machinery? | **No** — a static id table is structurally impossible for modules (§MLS2); a small, synchronous, always-resident map is enough here (two modules, under a dozen nodes apiece), so none of the Template path's lazy-dictionary/CI-drift-check machinery is needed. |
| **MLS-D5** | (revision 2) how does provenance survive Undo/Redo past a New/Template-load/file-load? | **A history-aware sidecar**, riding on the exact mechanism `frameSidecar`/`dataImportSidecar` already use — `SidecarBundle` gains a `m` key, captured by `commit()`'s `sidecarNow()` and restored by `undo()`/`redo()`'s `restoreSidecar()`. Rejected: a bare global map cleared by the three reset actions (revision 1's approach) — provably wrong, since it discarded the outgoing document's tracking the instant a reset committed, with no way for Undo to bring it back. |
| **MLS-D6** | (revision 3) when does a real label edit detach provenance — lazily at the next switch, or eagerly at the edit? | **Eagerly**, in `updateNodeData` itself (§MLS4.4). Rejected: lazy-only detection (revision 2's approach) — it cannot distinguish "never edited" from "edited, then edited back to the exact same text" before any switch happens, silently erasing a genuine edit. The lazy check (§MLS3.1 rule 1) still exists as a correct fallback for a label that arrives some OTHER way (e.g. via Undo/Redo restoring an earlier snapshot) — it is not made redundant, just no longer the only path. |

## MLS8. Order this feeds into

Second of [[v0.10.0-followups]]'s four post-#207 items — root Markdown doc
reorg (PR #208) landed first. Next: the `ConfirmDialog` double-click-guard
PR merge, then the v0.10.0 `CHANGELOG` date / tag / GitHub Release pass.
