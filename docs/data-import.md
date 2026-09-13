# Sheet / table data import — snapshot, diff, and change-proposal export (design doc)

**Status: design draft — for review.** No `loop-*/N` id yet (§DI13 explains
why one is likely needed) and no `Frozen` marker. Prefix `DI`. Kicked off by
explicit instruction after the gacha Template's README documentation (PR
#200) shipped: **"Google Sheets 가져오기·변경안 내보내기 계약 설계를 시작해도
됩니다."**, with the v1 scope fixed in the same instruction (§DI1) and a
concrete gacha item table required as the worked example (§DI4) before
anything else in this doc.

This document **promotes and extends** Appendix GSA of
[`docs/example-gacha-simulator.md`](example-gacha-simulator.md) (GS11 item 4)
into its own standalone contract. GSA0–GSA5's decisions are restated below as
this doc's own foundational decisions (§DI2–§DI3, §DI9); nothing there is
reopened. What's new here, not covered by GSA: **multiple linked tables**
(GSA1 was one flat table), the materialize-as-Parameter mechanic spelled out
against real code, the two CSV exports, and a concrete multi-table gacha
example throughout.

Implementation is explicitly **out of scope for this PR** — design only, per
the same design-doc-first → approval → implementation split already used for
`docs/conditional-state-update.md`, `docs/label-timing-authoring.md`,
`docs/parameter-activator.md`, and `docs/gacha-banner-zones.md`.

Sections: **DI1** scope · **DI2** exclusions · **DI3** snapshot mechanism ·
**DI4** worked example · **DI5** per-table import config · **DI6** row key ·
**DI7** column selection & type mapping · **DI8** cross-table key
relationships · **DI9** source key vs. node id · **DI10** materializing
Parameters · **DI11** provenance, refresh & 3-way diff · **DI12** exports ·
**DI13** serialization / revision-digest impact · **DI14** decisions ·
**DI15** out of scope (restated) · **DI16** suggested implementation
sequencing.

---

## DI1. Scope (v1) — fixed by explicit instruction

1. Google Sheets **read-only snapshot** import (no write-back — DI2, DI15).
2. Sheet / range / header-row selection.
3. A designated **row unique key** per table.
4. Selecting only the needed columns and mapping each to a type.
5. **Cross-table key relationships** — items, loot/gacha pools, and link
   packages (bundles) as separate tables joined by a shared key.
6. **Source key kept separate from the internal node id.**
7. Numeric values **materialize as `parameter` nodes** (`loop-model/1`,
   already shipped — no new engine primitive).
8. **Manual refresh** with a **base / local / incoming three-way diff**.
9. **Simulation-results CSV export.**
10. A **change-proposal CSV** export: `key / previous value / new value`.

Item 9 turns out to be **already shipped and needs no new work** — see
§DI12.1. Everything else is new.

## DI2. Explicit exclusions (today's instruction, on top of GSA5)

- **Writing back to the source Google Sheet is out of scope, explicitly and
  permanently for this contract** — not deferred, not a "v2" item. Loop
  Studio never has write access to a user's Sheet. The change-proposal CSV
  (§DI12.2) is the entire answer to "how does a tuned value get back to the
  spreadsheet": a human pastes it in themselves.
- Everything GSA5 already excluded: live/automatic Google Sheets
  synchronization, OAuth or any private-sheet access, binding to a node kind
  other than `parameter`, import rows that directly create `register` nodes
  or expressions, and multi-dimensional stat tables (only flattened rows).

## DI3. Snapshot mechanism (restates GSA0, now the final answer, not a hypothesis)

**No live network fetch, no OAuth, no CORS-dependent `fetch()` against a
published Sheets URL.** This was floated and rejected: it would make a
"read-only snapshot" secretly a live, network-dependent feature, contradicts
Loop Studio's whole positioning (client-only, no accounts, works offline —
README's "Why" section, `docs/pwa.md`), and doesn't even solve provenance
cleanly (a background auto-refresh has no natural moment to run the 3-way
diff). GSA0 already reached this conclusion for the single-table case; it
applies unchanged here.

The import surface is a **pasted or uploaded CSV/TSV snapshot** — a Google
Sheet reaches Loop Studio exactly the way a project revision reaches a
collaborator (`SEMANTICS-R.md`'s own framing): as a file the user exports
themselves (`File → Download → CSV`, or `File → Share → Publish to web →
CSV`, copied and pasted). "Manual refresh" (DI1 item 8) means: the user
re-exports/re-copies the same range from the same Sheet whenever they've
changed it, pastes or re-uploads it into the SAME import binding, and clicks
**Refresh** — which re-runs the identical column mapping and diffs the
result against what's stored (§DI11). No polling, no stored URL, no token.

## DI4. Worked example — a real gacha item table set

Every mechanic below is illustrated against this same example: three sheets
a designer already has, linked by ordinary spreadsheet convention (a shared
key column, no formulas).

**Sheet "Items"** (one row per catalogue item — a pure lookup table, no
numeric columns mapped in this example):

| item_key | display_name | rarity | category |
|---|---|---|---|
| itm_blade_ssr | Ember Blade | SSR | weapon |
| itm_blade_sr | Iron Blade | SR | weapon |
| itm_charm_r | Lucky Charm | R | accessory |

**Sheet "Pools"** (one row per item **within** a gacha banner — this is the
banner's weight table, the direct ancestor of the shipped gacha Template's
own `zone3_pickup_w_ssr`-style Parameters):

| pool_key | banner_key | item_key | weight |
|---|---|---|---:|
| pool_pickup_blade_ssr | premium_pickup | itm_blade_ssr | 10 |
| pool_pickup_blade_sr | premium_pickup | itm_blade_sr | 90 |
| pool_pickup_charm_r | premium_pickup | itm_charm_r | 900 |

**Sheet "Bundles"** (store packages — a **link/junction** table: each row
pairs one bundle with one item it contains):

| bundle_item_key | bundle_key | item_key | quantity | price_krw |
|---|---|---|---:|---:|
| bundle_starter__blade_sr | bundle_starter | itm_blade_sr | 1 | 4900 |
| bundle_starter__charm_r | bundle_starter | itm_charm_r | 3 | 4900 |
| bundle_whale__blade_ssr | bundle_whale | itm_blade_ssr | 1 | 49900 |

Note the `bundle_item_key` column: neither `bundle_key` nor `item_key` alone
is unique per row (a bundle has several items) — this table needed its own
synthetic per-row key. This is a real, common spreadsheet shape and §DI6
states it as a requirement, not a special case.

## DI5. Per-table import configuration

For each pasted/uploaded table, the user supplies:

- a **label** for the table, typed by the user (a plain paste carries no
  sheet/tab name — "Items", "Pools", "Bundles" above are user-typed labels,
  not detected from the clipboard),
- the **header row** (usually row 1; a preview shows the first ~10 rows so
  the user can confirm before committing),
- the **delimiter** (auto-detected from a pasted TSV vs. an uploaded CSV;
  user-overridable for an unusual export).

"Range" in the Sheets sense doesn't apply once the input is a pasted/uploaded
snapshot (§DI3) — the whole pasted block **is** the range. A user who only
wants part of a sheet exports/copies just that part from Sheets first, the
same way they'd trim a CSV before importing it anywhere else.

## DI6. Row unique key

Every table declares **one column as its row key** — the stable identity used
across a refresh (§DI11), never the sheet's raw row position (rows reorder;
`item_key` doesn't). Requirements, all validated in the import preview before
anything touches the graph (restates GSA1):

- the column exists and every row has a non-empty value in it,
- values are unique after normalization: trim whitespace, Unicode NFC
  normalize, and — an explicit decision, not left implicit — **key
  comparison is case-sensitive** (`itm_Blade_SSR` ≠ `itm_blade_ssr`; a
  designer relying on case-only distinction is vanishingly unlikely and
  case-INsensitive comparison risks silently merging two real rows),
- no control characters, and a maximum length (reuses the existing label
  length ceiling already enforced on node labels elsewhere in the app).

**A link/junction table needs a genuinely unique column, which often doesn't
exist yet** — Bundles above needed `bundle_item_key` added. The import
preview's key-selection step, faced with no unique column, tells the user
this directly (with the duplicate rows highlighted) rather than silently
picking a non-unique column and producing a broken import.

## DI7. Column selection & type mapping

The user picks which columns matter (an 8-column sheet with 3 useful columns
imports 3, not 8) and assigns each a role:

| role | meaning | example above |
|---|---|---|
| **key** | this table's row key (§DI6) | `item_key`, `pool_key`, `bundle_item_key` |
| **number** | materializes as a `parameter` value (§DI10) | `weight`, `quantity`, `price_krw` |
| **label** | human-readable text folded into a generated node's label | `display_name` |
| **foreign key** | references another table's key column (§DI8) | `item_key` (in Pools/Bundles, referencing Items), `banner_key` |
| **ignored** | present in the sheet, not imported | `rarity`, `category` in this example (kept in the Sheet, absent from Loop Studio) |

A **number** column must parse as finite numeric data for every row (same
validate-the-whole-preview-first discipline as GSA1); a bad cell is reported
with its row/column, nothing is imported until it's fixed or the column is
dropped to **ignored**.

## DI8. Cross-table key relationships

A **foreign key** column's value must match some row's **key** in the table
it's declared to reference (validated in preview: an orphan FK value is
reported, not silently dropped). This is what makes "Pools" and "Bundles"
more than two disconnected flat tables:

- **Enriched labels.** A Pool row's generated Parameter label folds in the
  Items row it points to via `item_key`, not just the raw key — e.g. the
  `weight` Parameter for `pool_pickup_blade_ssr` is labelled **"Pools ·
  Ember Blade (premium_pickup) · weight"**, not "Pools ·
  pool_pickup_blade_ssr · weight". This is the concrete payoff of linking
  tables: a designer reading the Inputs panel sees the item's real name, not
  an opaque key, even though the numeric data lived in a different sheet
  than the name did.
- **Grouping.** Every row generated from one FK-linked group can share one
  frame (§DI10's frame destination), so "everything about the Premium Pickup
  pool" sits together on canvas regardless of which sheet each column came
  from.
- **Manual aggregation stays available, not automated.** A designer who
  wants "total weight of the Premium Pickup pool" as a Register can already
  write `@<id> + @<id> + @<id>` by hand with the shipped `@` autocomplete
  (`docs/register-expression-authoring.md`) once the Parameters exist — a
  Register's `loop-expr/1` expression can reference **any** node by id
  (`SEMANTICS-X.md`), so no new engine primitive is needed for this. **Auto-
  generating such summary Registers from the FK grouping is explicitly OUT
  of v1** (DI1's fixed list doesn't ask for it) — the import's job stops at
  producing well-labelled, well-grouped Parameters; summarizing them is an
  ordinary follow-up edit like any other Register.

FK relationships are **cross-table only** in v1 (a row referencing a key in
its *own* table — a self-reference — is out of scope; see DI14/DI-D2).

## DI9. Source key vs. internal node id (restates GSA3, extended)

**A sourceKey is never the node id.** `nextId('parameter')`
(`src/model/factory.ts`) mints every generated node's real id exactly the way
dragging a Parameter onto the canvas already does (`parameter_mtc00jt3_2`-
shaped) — sourceKeys never touch the id-safe charset requirement, so
`bundle_item_key = "bundle_starter__blade_sr"` (arbitrary designer text) is
fine as-is, never sanitized into an id.

Because the SAME import can hold several tables, the identity a refresh
matches against is the pair **(table label, sourceKey)**, not the bare
sourceKey alone — `item_key = "itm_blade_ssr"` in "Items" and a hypothetical
same-valued key in an unrelated table are different rows, never confused.

## DI10. Materializing values as Parameters

For every **(row, number-role column)** pair across every imported table, the
importer creates one fresh `parameter` node (`loop-model/1`, already
shipped — no engine change):

- **id**: freshly minted (`nextId('parameter')`), per DI9 — never derived
  from the sourceKey.
- **value**: the cell's numeric value at import time.
- **label**: `"<table label> · <row's label-role text, or its own key if
  none was mapped, enriched via any FK per §DI8> · <column name>"` — e.g.
  `"Pools · Ember Blade (premium_pickup) · weight"`,
  `"Bundles · bundle_starter · quantity"` (Bundles has no label-role column
  mapped in the example, so it falls back to the row's own key).
- **unit**: left blank unless the column name or a future per-column unit
  hint supplies one (out of scope to design further here — same "advisory,
  optional" contract `ParameterData.unit` already has).
- **position / frame**: per the import preview's explicit choice — reused
  unchanged from GSA4's three destinations (never silently generated):
  1. one frame per table (or per FK group, for a linked table) — the
     default in this doc's worked example: a "Pools" frame, a "Bundles"
     frame;
  2. all imported nodes placed into one existing frame the user picks;
  3. no frames — a plain drop onto the canvas.

  **Checked, not assumed**: no existing feature auto-lays-out a *fresh* batch
  of newly created nodes with no prior relative positions — `moduleGraph.ts`'s
  Insert module only **translates** an already-authored module's existing
  relative layout to the insert point (`src/model/moduleGraph.ts`), which is
  a different problem (this import has no prior layout to translate; a
  spreadsheet row has no `x,y`). Destination 3 needs a small, new,
  presentation-only grid/stack placement — the closest existing prior art is
  the row/column pitch each bundled Template's own generator script computes
  (e.g. `scripts/gen-gacha-banner-zones-example.ts`'s per-zone grid), not a
  reusable runtime utility. This is new (small) work, called out here so it
  isn't silently assumed to already exist.

Every generated Parameter is, from the moment it lands, **ordinary model
data** — editable in the Inputs panel, referenceable by any Register's `@id`,
indistinguishable in the engine from a Parameter a user typed in by hand.
Nothing about materialization is a new engine capability; it is entirely
graph-construction plumbing on top of `loop-model/1`.

## DI11. Provenance, manual refresh, and the base/local/incoming diff

A binding that supports **refresh** (DI1 item 8) needs to remember what it
last imported, restating and finalizing GSA2:

- one document-level **import-source record** per bound table (its label,
  its declared key/number/label/FK column roles — so re-pasting a fresh
  export from the same sheet doesn't require re-answering DI5–DI8 every
  time),
- per generated Parameter: `sourceTable`, `sourceKey`, `sourceColumn`, and
  `lastImportedValue` (a sketch, not final field names — see §DI13).

**Refresh, per (table, sourceKey, column) triple:**

```
base     = lastImportedValue        (what was imported last time)
local    = current parameter.value  (what's in the graph now — may have
                                      been hand-tuned since)
incoming = the freshly pasted value
```

- `local == base` (never touched since import) and `incoming` differs ⇒
  **auto-apply** the incoming value, no prompt.
- `incoming == base` (the sheet didn't actually change this cell) ⇒ nothing
  to do regardless of `local`.
- `local != base` and `incoming != base` and `local != incoming` ⇒ a **real
  three-way conflict** — the ONLY case that asks the user anything, exactly
  the Project-Revision precedent (`SEMANTICS-R.md`) already established for
  `exact` / `divergent` / `unknown` classification. Both values are shown;
  the user picks *keep mine* or *take incoming*, per row.

**Proposed, not yet verified**: reuse the Project Revision three-way Apply
machinery/UI (`src/model/revision.ts`, the Review panel) for this
classification and resolution step rather than writing a second diff engine.
This needs implementation-time verification against the actual code — the
existing three-way apply operates over `GraphDoc` id-keyed nodes/edges;
whether the SAME functions can run over an in-memory synthetic
"incoming GraphDoc fragment" built fresh from a pasted CSV (rather than a
literal prior `project.revision`), or only the classification *logic* is
reusable and the UI needs its own thinner surface, is exactly the kind of
claim this project's history (`docs/parameter-activator.md`'s
`loop-revision/7` reversal, `docs/gacha-banner-zones.md`'s `pickup_share`
correction) says must be checked against real code before an implementation
PR relies on it, not assumed from this design doc alone.

**A row that disappears on refresh** (deleted from the sheet) — flagged
open, not decided here; see DI14/DI-D4.

## DI12. Exports

### DI12.1 Simulation-results CSV — already shipped, no new work

Verified directly against the code rather than assumed: this requirement is
**already fully satisfied**.

- `src/components/TimelineChart.tsx`'s `downloadCsv` already exports
  `step, <one column per tracked Pool's label>` for the current single run
  (the Timeline's **CSV** button).
- `src/engine/montecarlo.ts`'s `toSeriesCsv` / `toFinalCsv` /
  `toFinalSummaryCsv` already cover the Monte Carlo distribution (per-step
  bands, per-run finals, and a final-value summary).

These are generic and label-driven — a Pool or Register fed by an imported
Parameter needs no special handling to appear correctly in either export.
(Parameters themselves are never MC-tracked — `resolveTracked` accepts Pool
ids only, an already-verified fact from this project's own history — but
that's exactly right: a Parameter is a tunable input, not a simulation
result, so it was never expected to appear there.) This item is listed in
DI1 only because it was part of the original fixed scope instruction; no
implementation work follows from it.

### DI12.2 Change-proposal CSV — new

The actual answer to "how does a tuned value get back to the spreadsheet,"
given DI2's permanent write-back exclusion: a small, new export producing

```
key,previous value,new value
itm_blade_ssr__Pools__weight,10,25
bundle_starter__blade_sr__Bundles__price_krw,4900,5900
```

- **key** is the ORIGINAL sourceKey (plus table/column, since a bare
  sourceKey isn't globally unique per §DI9) — never the internal node id —
  so a designer can find the row in their own sheet by eye or by their own
  spreadsheet lookup formula.
- **previous value** is `lastImportedValue` (the base, §DI11).
- **new value** is the current `parameter.value`.
- Scoped to rows where `new value != previous value` **only** — see
  DI14/DI-D1 for why, and as an explicit decision point for review rather
  than a silent default.

This is a plain CSV a designer pastes back into their own sheet by hand (or
feeds to a script they already own) — Loop Studio never touches the source.

## DI13. Serialization / revision-digest impact

A new provenance shape on a `parameter` node's `data` (sketch, per DI11 —
`sourceTable` / `sourceKey` / `sourceColumn` / `lastImportedValue`, plus a
document-level import-source record) is a **genuine new stored schema**, not
a UI-only feature. Restating GSA2's own explicit warning rather than
repeating its mistake: this must **not** be described as simply "excluded
from the digest." The precedent is `GraphDoc.frames` (`loop-revision/5`,
`SEMANTICS-R5.md`) — a frame edit moves the full revision **content** digest
and `dirty`, but never the engine/structure digest or the simulation result,
because a frame changes nothing the engine computes. Provenance is the same
shape: `data.value` already affects simulation and already moves the
existing digests through the ordinary Parameter-value path; the NEW
provenance fields affect nothing the engine computes, but they are still
real, serialized document content someone might git-diff or three-way-merge,
so they **do** belong in the revision content digest.

This will very likely need its **own new `loop-revision/N`** entry (a fresh
`SideVersion`, `FIELDS_BY_KIND` row, and `serialize.ts` allowlist entry —
following the exact pattern `SEMANTICS-R5.md` / `SEMANTICS-R6.md` already
set) — stated here as the probable plan, **not** asserted as verified fact.
The exact number, and whether it's cosmetic-tagged like `frames`/`route` or
needs its own tag, is an implementation-time question to check against
`src/model/revision.ts`'s real `projectNode` / `fieldTag` code, the same
discipline `docs/parameter-activator.md`'s `loop-revision/7` (proposed, then
found unnecessary after checking the real code) is this project's own
cautionary precedent for.

## DI14. Decisions

### DI-D1 — change-proposal CSV lists only CHANGED rows (open for review)

Proposed default: only rows where the current value differs from
`lastImportedValue`. An "all mapped rows, changed or not" mode would make the
export usable as a full current-state dump too, at the cost of being much
noisier as a "here's what changed" artifact — which is the export's whole
purpose per its name. Flagged for explicit confirmation, not decided
unilaterally.

### DI-D2 — foreign keys are cross-table only (settled)

A row referencing a key in its own table (a same-table self-reference, e.g.
a hypothetical "parent item" column on Items) is out of scope for v1. The
worked example never needs one, and it's a materially different UI problem
(cycle detection, tree/hierarchy display) than the star-shaped
Items↔Pools↔Bundles linking this doc designs for.

### DI-D3 — a link table is long/normalized form only (settled)

Bundles-containing-many-items is expressed as one row per (bundle, item)
pair (the worked example's shape), never as one row with a delimited
multi-value cell (`item_key: "itm_blade_sr;itm_charm_r"`). The latter needs
its own small parsing sub-language and isn't how most spreadsheet tools
naturally produce this data; deferred, not designed here.

### DI-D4 — a row missing on refresh (open, restates GSA2's own callout)

GSA2 already flagged "deletion and missing-row behaviour" as undecided.
Restated, still open: when a refresh's incoming snapshot no longer contains
a `sourceKey` that a generated Parameter still carries, the safest default is
almost certainly to surface it as a conflict requiring confirmation (a
Parameter may have downstream Register/edge references a silent delete would
orphan) rather than auto-deleting the node — but this needs explicit
confirmation before an implementation PR builds it either way.

## DI15. Out of scope for v1 (restated, consolidated)

- Direct Google Sheets write-back / overwriting the source (DI2 — permanent,
  not deferred).
- Live/automatic Sheets connection, OAuth, private-sheet access, background
  refresh, any network fetch at all (DI3, restates GSA0/GSA5).
- Real-time collaborative sync.
- Binding to any node kind other than `parameter` (restates GSA5).
- Import rows that directly create `register` nodes or expressions (restates
  GSA5) — a Register referencing an imported Parameter is still an ordinary
  manual follow-up, already fully supported (§DI8).
- Same-table (self-referencing) foreign keys (DI-D2).
- Wide/multi-value FK cells (DI-D3).
- Multi-dimensional stat tables beyond flattened rows (restates GSA5).
- Auto-generated summary/aggregation Registers from FK grouping (§DI8) — the
  mechanism is available for a human to use by hand, not built automatically.

## DI16. Suggested implementation sequencing (non-binding)

Mirrors GS11 item 4's own Track 2A/2B split — each its own explicit-kickoff
PR, not decided or started here:

1. **Import only** (§DI4–§DI10, §DI12.1's reuse confirmed) — paste/upload,
   configure, validate, materialize Parameters. No provenance stored yet, no
   refresh possible (matches GSA1's original Track 2A framing, extended to
   multiple linked tables).
2. **Refresh, diff, provenance, and the change-proposal export**
   (§DI11–§DI13, §DI12.2) — the stored binding, the three-way diff, and both
   new CSV/digest work. Depends on (1) shipping first.
