# Spreadsheet snapshot import — diff, provenance & change-proposal export (design doc)

**Status: design draft — for review, draft 2.** No `loop-*/N` id yet (§DI13
explains why one is likely needed) and no `Frozen` marker. Prefix `DI`.
Kicked off by explicit instruction after the gacha Template's README
documentation (PR #200) shipped, with the v1 scope fixed in that same
instruction (§DI1) and a concrete gacha item table required as the worked
example (§DI4) before anything else in this doc.

This document **promotes and extends** Appendix GSA of
[`docs/example-gacha-simulator.md`](example-gacha-simulator.md) (GS11 item 4)
into its own standalone contract. GSA0–GSA5's decisions are restated below as
this doc's own foundational decisions; nothing there is reopened. What's new
here, not covered by GSA: **multiple linked tables** (GSA1 was one flat
table), the materialize-as-Parameter mechanic spelled out against real code,
the two CSV exports, and a concrete multi-table gacha example throughout.

**Draft 2 (Hanrim/Lumi, round 1)** held draft 1's direction but found real
contract conflicts, all fixed below:

1. **Name conflict: "Google Sheets import" described a CSV/TSV paste
   mechanism, not an actual Sheets connection.** Draft 1's title and prose
   called this "Google Sheets import" while its own §DI3 explicitly ruled
   out any live connection to Sheets — the feature IS a spreadsheet
   snapshot importer that happens to work well with data a designer keeps in
   Sheets (or Excel, or anywhere else). Renamed throughout: **v1 is
   `Spreadsheet snapshot import` / `CSV/TSV snapshot import`**, not "Sheets
   import." Google Sheets is one common *origin* of the pasted data, never a
   *destination* or a *live connection* (§DI2, §DI3).
2. **`Publish to web` is a real privacy hazard, removed from all guidance.**
   Draft 1 suggested `File → Share → Publish to web → CSV` as one way to get
   data out of Sheets — but "publish to web" makes the sheet **publicly
   readable by anyone with the link**, which is the wrong instruction to
   give a designer whose gacha rate table is exactly the kind of unreleased,
   confidential content they'd never want public. Removed entirely; §DI3 now
   only names non-exposing paths (`File → Download`, or select a range and
   `Copy`).
3. **OAuth / private-sheet read access should not be a *permanent*
   exclusion — only Sheet write-back is permanent.** Draft 1 lumped both
   together under "permanently excluded." Corrected: **write-back to any
   source is permanently excluded, forever** (unchanged) — but read-only
   access to a private Sheet via OAuth is a *materially different, smaller*
   promise (never writes anything) that a later, clearly-separate,
   **optional** connector could reasonably add. v1 ships with paste/upload
   only; a live connector is deferred, not foreclosed (§DI2, §DI-D5, §DI16).
4. **The refresh-identity key was unstable.** Draft 1 matched a refreshed row
   by `(table label, sourceKey)` — but a table's `label` is an ordinary,
   user-editable display string (§DI5); renaming "Pools" to "Gacha pool
   entries" would have silently broken every binding in that table. Fixed:
   a freshly-minted, never-shown, never-editable **`sourceTableId`** is the
   real match key; `label` is presentation only (§DI9).
5. **The worked example had a real modelling bug the change-proposal export
   would have inherited.** The original "Bundles" table repeated a
   package's price on every one of its item rows, so importing it would have
   materialized the SAME price as multiple different Parameters (one per
   item row) instead of one Parameter per package. Rebuilt the example as
   four properly normalized tables — `Items`, `Banners`, `GachaPoolEntries`,
   `Packages`, `PackageItems` — so price lives in exactly one place (§DI4).
   `banner_key` is now a real foreign key into an actual `Banners` table
   (draft 1 called it a foreign key with no table for it to reference).
6. **The change-proposal CSV's synthetic composite key was fragile.** Draft
   1's `key` column concatenated table/row/column with `__`, which (a) does
   not match any real row key a designer could search their sheet for and
   (b) risks collision if a real key ever contains `__`. Fixed: separate
   columns — `source_table,source_key,source_column,previous_value,new_value`
   (§DI12.2).

Also settled in this round, per explicit direction: **DI-D1 approved**
(changed-rows-only), **DI-D2 approved** (cross-table FK only),
**DI-D3 approved** (normalized long form only), **DI-D4 approved** (preserve
+ warn on a missing row, never auto-delete) — plus a fuller row-lifecycle
contract these decisions actually require (added / missing / key-changed /
value-changed, §DI11), and an explicit provenance-privacy statement (§DI-D6).

Implementation is explicitly **out of scope for this PR** — design only, per
the same design-doc-first → approval → implementation split already used for
`docs/conditional-state-update.md`, `docs/label-timing-authoring.md`,
`docs/parameter-activator.md`, and `docs/gacha-banner-zones.md`.

Sections: **DI1** scope · **DI2** exclusions · **DI3** snapshot mechanism ·
**DI4** worked example · **DI5** per-table import config · **DI6** row key ·
**DI7** column selection & type mapping · **DI8** cross-table key
relationships · **DI9** stable identifiers (table / source key / node id) ·
**DI10** materializing Parameters · **DI11** provenance, refresh & row
lifecycle · **DI12** exports · **DI13** serialization / revision-digest
impact · **DI14** decisions · **DI15** out of scope (restated) · **DI16**
suggested implementation sequencing.

---

## DI1. Scope (v1) — fixed by explicit instruction

1. **Spreadsheet snapshot import** (CSV/TSV paste or upload — no write-back,
   ever; DI2, DI15). Google Sheets, Excel, or any spreadsheet a designer
   already uses is a valid *origin* of the pasted data — there is no
   Sheets-specific mechanism.
2. Sheet / range / header-row selection.
3. A designated **row unique key** per table.
4. Selecting only the needed columns and mapping each to a type.
5. **Cross-table key relationships** — items, gacha pool entries, and
   packages (with their own item-linking table) joined by shared keys.
6. **Source identity kept separate from the internal node id** — and, as
   corrected in this round, from the table's own display label too (§DI9).
7. Numeric values **materialize as `parameter` nodes** (`loop-model/1`,
   already shipped — no new engine primitive).
8. **Manual refresh** with a full **row lifecycle** (added / missing /
   key-changed / value-changed) and a **base / local / incoming three-way
   diff** for value changes.
9. **Simulation-results CSV export.**
10. A **change-proposal CSV** export: `source_table / source_key /
    source_column / previous value / new value`.

Item 9 turns out to be **already shipped and needs no new work** — see
§DI12.1. Everything else is new.

## DI2. Explicit exclusions

- **Writing back to the source spreadsheet is out of scope, explicitly and
  permanently, for any source, forever** — not deferred, not a "v2" item.
  Loop Studio never has write access to a user's Sheet, Excel file, or
  anything else it imported from. The change-proposal CSV (§DI12.2) is the
  entire answer to "how does a tuned value get back to the source": a human
  pastes it in themselves.
- **v1 ships no live connection at all** — no OAuth, no background refresh,
  no network fetch, no stored source URL (§DI3, §DI-D6). This is a
  **deferred**, not permanent, exclusion: a later, clearly-separate,
  strictly **read-only** Google Sheets (or similar) connector is named as a
  possible future phase in §DI16 / §DI-D5, distinct from — and never
  reopening — the write-back exclusion above.
- Binding to any node kind other than `parameter` (restates GSA5).
- Import rows that directly create `register` nodes or expressions (restates
  GSA5).
- Multi-dimensional stat tables (only flattened rows, restates GSA5).

## DI3. Snapshot mechanism

**No live network fetch, no OAuth, no CORS-dependent `fetch()` against any
spreadsheet host, and — this round's correction — no guidance that risks
exposing a private table.** Contradicts Loop Studio's whole positioning
(client-only, no accounts, works offline — README's "Why" section,
`docs/pwa.md`) and doesn't even solve provenance cleanly (a background
auto-refresh has no natural moment to run the row-lifecycle / diff, §DI11).
GSA0 already reached this conclusion for the single-table case; it applies
unchanged here, generalized beyond Sheets specifically.

The import surface is a **pasted or uploaded CSV/TSV snapshot** — the same
"moves only as files you export yourself" shape `SEMANTICS-R.md`'s Project
Revision already uses. Getting the data OUT of a spreadsheet app, without
exposing it:

- **Google Sheets**: `File → Download → Comma-separated values (.csv)` for a
  whole sheet/tab, or select a range and `Copy` to paste it directly.
  **Never** `File → Share → Publish to web` — that makes the sheet
  **publicly readable by anyone with the link**, the wrong instruction for
  what is very often confidential, unreleased game-balance data. This
  guidance is removed from the doc entirely, not just de-emphasized.
- **Excel, Numbers, or any other spreadsheet app**: `Save As` / `Export` to
  CSV, or a plain copy-paste of a selected range — no app-specific mechanism
  needed, since the importer only ever sees delimited text.

"Manual refresh" (DI1 item 8) means: the user re-exports/re-copies the same
range whenever they've changed it, pastes or re-uploads it into the SAME
import binding, and clicks **Refresh** — which re-runs the identical column
mapping and walks the full row lifecycle (§DI11) against what's stored. No
polling, no stored URL, no token, no background activity.

## DI4. Worked example — a real, normalized gacha item table set

Rebuilt this round to fix draft 1's price-duplication bug (see the draft-2
changelog above) and to give `banner_key` an actual table to reference.
Every mechanic below is illustrated against this same example: five sheets a
designer already has, linked by ordinary spreadsheet convention (a shared
key column, no formulas).

**Sheet "Items"** (one row per catalogue item — a pure lookup table, no
numeric columns mapped in this example):

| item_key | display_name | rarity | category |
|---|---|---|---|
| itm_blade_ssr | Ember Blade | SSR | weapon |
| itm_blade_sr | Iron Blade | SR | weapon |
| itm_charm_r | Lucky Charm | R | accessory |

**Sheet "Banners"** (one row per gacha banner — also a pure lookup table;
this is what makes `banner_key` below a REAL foreign key rather than a bare
grouping string):

| banner_key | banner_name |
|---|---|
| premium_pickup | Premium Pickup |
| premium_standard | Premium Standard |

**Sheet "GachaPoolEntries"** (one row per item **within** a banner — this is
the banner's weight table, the direct ancestor of the shipped gacha
Template's own `zone3_pickup_w_ssr`-style Parameters):

| pool_entry_key | banner_key | item_key | weight |
|---|---|---|---:|
| ppe_pickup_blade_ssr | premium_pickup | itm_blade_ssr | 10 |
| ppe_pickup_blade_sr | premium_pickup | itm_blade_sr | 90 |
| ppe_pickup_charm_r | premium_pickup | itm_charm_r | 900 |

**Sheet "Packages"** (one row per **store package**, price lives here
exactly once per package — this is the fix for draft 1's duplication bug):

| package_key | package_name | price_krw |
|---|---|---:|
| pkg_starter | Starter Pack | 4900 |
| pkg_whale | Whale Pack | 49900 |

**Sheet "PackageItems"** (a link/junction table: each row pairs one package
with one item it contains and how many — quantity only, no price):

| package_item_key | package_key | item_key | quantity |
|---|---|---|---:|
| pkgitem_starter_blade_sr | pkg_starter | itm_blade_sr | 1 |
| pkgitem_starter_charm_r | pkg_starter | itm_charm_r | 3 |
| pkgitem_whale_blade_ssr | pkg_whale | itm_blade_ssr | 1 |

Note `pool_entry_key` and `package_item_key`: neither `banner_key`+`item_key`
nor `package_key`+`item_key` is unique on its own (a banner has several
items; a package contains several items) — every link/junction table needs
its own synthetic per-row key. §DI6 states this as a requirement, not a
special case.

## DI5. Per-table import configuration

For each pasted/uploaded table, the user supplies:

- a **label** for the table, typed by the user (a plain paste carries no
  sheet/tab name — "Items", "Banners", "GachaPoolEntries", "Packages",
  "PackageItems" above are user-typed labels, not detected from the
  clipboard). **The label is presentation only and freely renameable at any
  time** — it plays no role in matching a refresh; that's `sourceTableId`
  (§DI9), minted once and never shown.
- the **header row** (usually row 1; a preview shows the first ~10 rows so
  the user can confirm before committing),
- the **delimiter** (auto-detected from a pasted TSV vs. an uploaded CSV;
  user-overridable for an unusual export).

"Range" in the Sheets sense doesn't apply once the input is a pasted/uploaded
snapshot (§DI3) — the whole pasted block **is** the range. A user who only
wants part of a sheet exports/copies just that part first, the same way
they'd trim a CSV before importing it anywhere else.

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
exist yet** — `GachaPoolEntries`/`PackageItems` above needed their own
synthetic key added. The import preview's key-selection step, faced with no
unique column, tells the user this directly (with the duplicate rows
highlighted) rather than silently picking a non-unique column and producing
a broken import.

## DI7. Column selection & type mapping

The user picks which columns matter (an 8-column sheet with 3 useful columns
imports 3, not 8) and assigns each a role:

| role | meaning | example above |
|---|---|---|
| **key** | this table's row key (§DI6) | `item_key`, `banner_key`, `pool_entry_key`, `package_key`, `package_item_key` |
| **number** | materializes as a `parameter` value (§DI10) | `weight`, `price_krw`, `quantity` |
| **label** | human-readable text folded into a generated node's label | `display_name`, `banner_name`, `package_name` |
| **foreign key** | references another table's key column (§DI8) | `GachaPoolEntries.item_key`→Items, `GachaPoolEntries.banner_key`→Banners, `PackageItems.package_key`→Packages, `PackageItems.item_key`→Items |
| **ignored** | present in the sheet, not imported | `rarity`, `category` in this example (kept in the Sheet, absent from Loop Studio) |

A **number** column must parse as finite numeric data for every row (same
validate-the-whole-preview-first discipline as GSA1); a bad cell is reported
with its row/column, nothing is imported until it's fixed or the column is
dropped to **ignored**.

A column with no genuine target table to reference is **not** a foreign key
— it's either a plain **ignored**/informational column, or (if it groups
rows meaningfully, like a category) still just data, not a relationship.
Draft 1's `banner_key` was exactly this mistake before `Banners` existed;
fixed by giving it a real table (§DI4).

## DI8. Cross-table key relationships

A **foreign key** column's value must match some row's **key** in the table
it's declared to reference (validated in preview: an orphan FK value is
reported, not silently dropped). This is what makes these five sheets more
than five disconnected flat tables:

- **Enriched labels.** A `GachaPoolEntries` row's generated Parameter label
  folds in BOTH tables it points to, not just their raw keys — e.g. the
  `weight` Parameter for `ppe_pickup_blade_ssr` is labelled **"GachaPoolEntries
  · Ember Blade · Premium Pickup · weight"** (item name from `Items` via
  `item_key`, banner name from `Banners` via `banner_key`), not
  "GachaPoolEntries · ppe_pickup_blade_ssr · weight". This is the concrete
  payoff of linking tables: a designer reading the Inputs panel sees real
  names, not opaque keys, even though the numeric data, the item name, and
  the banner name each live in a different sheet.
- **Grouping.** Every row generated from one FK-linked group can share one
  frame (§DI10's frame destination), so "everything about the Premium Pickup
  banner" sits together on canvas regardless of which sheet each column came
  from.
- **Manual aggregation stays available, not automated.** A designer who
  wants "total weight of the Premium Pickup banner" as a Register can already
  write `@<id> + @<id> + @<id>` by hand with the shipped `@` autocomplete
  (`docs/register-expression-authoring.md`) once the Parameters exist — a
  Register's `loop-expr/1` expression can reference **any** node by id
  (`SEMANTICS-X.md`), so no new engine primitive is needed for this.
  **Auto-generating such summary Registers from the FK grouping is
  explicitly OUT of v1** (DI1's fixed list doesn't ask for it) — the
  import's job stops at producing well-labelled, well-grouped Parameters;
  summarizing them is an ordinary follow-up edit like any other Register.

FK relationships are **cross-table only** in v1, approved this round
(§DI-D2) — a row referencing a key in its *own* table (a self-reference) is
out of scope.

## DI9. Stable identifiers — table, source key, and node id

Three separate identifiers are in play, corrected and clarified this round
because draft 1 conflated two of them:

1. **`sourceTableId`** — freshly minted once, when a table is first bound
   (the same `nextId()` scheme as any other internal id, e.g.
   `srctable_mtc00jt3_2`). **Never shown to the user, never editable.** This
   is the ONLY thing a refresh matches a table against.
2. **The table's `label`** (§DI5) — a plain, user-editable display string
   ("GachaPoolEntries", "Packages"). Purely presentational. **Renaming a
   table's label never breaks its binding** — this is exactly the bug
   draft 1 had (matching on `(table label, sourceKey)`) and this round's
   fix.
3. **The internal node id** — restates GSA3, unchanged: `nextId('parameter')`
   (`src/model/factory.ts`) mints every generated Parameter's real id exactly
   the way dragging a Parameter onto the canvas already does
   (`parameter_mtc00jt3_2`-shaped). A `sourceKey` (e.g.
   `"pkgitem_starter_charm_r"`, arbitrary designer text) never touches the
   id-safe charset requirement and is never itself used as, or sanitized
   into, a node id.

**The refresh-matching identity for one imported value is the triple
`(sourceTableId, sourceKey, sourceColumn)`** — not the bare `sourceKey`
alone (a table's own key values are only unique WITHIN that table; `Items`
and a hypothetical differently-shaped table could coincidentally reuse a
key string), and not `(label, sourceKey)` (fixed this round, item 4 above).

## DI10. Materializing values as Parameters

For every **(row, number-role column)** pair across every imported table, the
importer creates one fresh `parameter` node (`loop-model/1`, already
shipped — no engine change):

- **id**: freshly minted (`nextId('parameter')`), per DI9 — never derived
  from the sourceKey, and never equal to `sourceTableId` (a different id
  serving a different purpose).
- **value**: the cell's numeric value at import time.
- **label**: `"<table label> · <row's label-role text(s), enriched via any
  FK per §DI8, or the row's own key if none was mapped> · <column name>"` —
  e.g. `"GachaPoolEntries · Ember Blade · Premium Pickup · weight"`,
  `"Packages · Whale Pack · price_krw"`, `"PackageItems · pkg_starter →
  Iron Blade · quantity"` (PackageItems has no label-role column of its own,
  so it falls back to composing from its two FK targets' names).
- **unit**: left blank unless the column name or a future per-column unit
  hint supplies one (out of scope to design further here — same "advisory,
  optional" contract `ParameterData.unit` already has).
- **position / frame**: per the import preview's explicit choice — reused
  unchanged from GSA4's three destinations (never silently generated):
  1. one frame per table (or per FK group, for a linked table) — the
     default in this doc's worked example: a "GachaPoolEntries" frame, a
     "Packages"/"PackageItems" frame;
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

## DI11. Provenance, manual refresh, and the full row lifecycle

A binding that supports **refresh** (DI1 item 8) needs to remember what it
last imported:

- one document-level **import-source record** per bound table: its
  `sourceTableId` (§DI9), its display `label`, and its declared
  key/number/label/FK column roles (so re-pasting a fresh export from the
  same sheet doesn't require re-answering DI5–DI8 every time),
- per generated Parameter: `sourceTableId`, `sourceKey`, `sourceColumn`, and
  `lastImportedValue` (a sketch, not final field names — see §DI13).

Rejected this round: matching on `(label, sourceKey)` — fixed to
`(sourceTableId, sourceKey, sourceColumn)`, §DI9.

### The four things a refresh can see, per row

A fresh paste/upload is compared against the stored bindings for that table.
Every `sourceKey` present on either side falls into exactly one case:

1. **Added** — a `sourceKey` in the incoming snapshot with no matching
   stored Parameter for this `sourceTableId`. Shown in the refresh preview
   as `added`. **A Parameter is materialized only after the user explicitly
   confirms** — the same "validate/preview the whole batch before touching
   the graph" discipline as the first import (§DI7), not a silent auto-add.
   (Confirming several adds at once, e.g. "add all 3 new rows," is a normal
   UX convenience — the underlying rule is that nothing is created without
   the user having seen and accepted it.)
2. **Missing** — a stored Parameter's `sourceKey` is absent from the
   incoming snapshot. **Never auto-deleted.** Shown as `missing from
   source`; the user explicitly picks, per row (or per batch):
   - **unlink** — keep the Parameter exactly as-is, drop only its
     provenance, so it becomes ordinary hand-owned data no future refresh
     will touch again, or
   - **delete** — remove the node. If the node is referenced elsewhere (a
     Register expression, a `loop-model/2` resource-edge `@id` flow), that
     reference is surfaced first and must be resolved (removed or
     retargeted) exactly the way Project Revision's selective Apply already
     handles "removing a node surfaces its incident edges to remove or
     retarget" — reused, not reinvented. **A referenced node is never
     silently deleted**, matching Hanrim/Lumi's explicit instruction this
     round.
3. **Key-changed** — modeled as **exactly Added + Missing together, no
   separate "rename" detection.** If a designer renames a spreadsheet row's
   key, the old key shows up as `missing` (case 2) and the new key shows up
   as `added` (case 1) in the SAME refresh — handled independently by the
   two rules above. No heuristic tries to guess that these are "the same
   row that got renamed"; guessing wrong (two unrelated rows that happen to
   swap-look-alike) would be worse than asking the user to redo the one
   Parameter's edits from a fresh materialization.
4. **Value-changed** — a `sourceKey` present on both sides. Runs the
   base/local/incoming three-way check below.

### Value-changed rows — the base/local/incoming three-way

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
  three-way conflict** — the ONLY case in this category that asks the user
  anything, exactly the Project-Revision precedent (`SEMANTICS-R.md`)
  already established for `exact` / `divergent` / `unknown` classification.
  Both values are shown; the user picks *keep mine* or *take incoming*, per
  row.

**Proposed, not yet verified**: reuse the Project Revision three-way Apply
machinery/UI (`src/model/revision.ts`, the Review panel) for this
classification and resolution step (and, ideally, for the added/missing
lifecycle above too, since "surface incident edges before removing a node"
is already exactly that system's job) rather than writing a second diff
engine from scratch. This needs implementation-time verification against the
actual code — the existing three-way apply operates over `GraphDoc` id-keyed
nodes/edges; whether the SAME functions can run over an in-memory synthetic
"incoming GraphDoc fragment" built fresh from a pasted CSV (rather than a
literal prior `project.revision`), or only the classification *logic* is
reusable and the UI needs its own thinner surface, is exactly the kind of
claim this project's history (`docs/parameter-activator.md`'s
`loop-revision/7` reversal, `docs/gacha-banner-zones.md`'s `pickup_share`
correction) says must be checked against real code before an implementation
PR relies on it, not assumed from this design doc alone.

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

### DI12.2 Change-proposal CSV — new, format corrected this round

The actual answer to "how does a tuned value get back to the spreadsheet,"
given DI2's permanent write-back exclusion: a small, new export producing
**separate columns**, not draft 1's fragile `__`-joined composite key:

```
source_table,source_key,source_column,previous_value,new_value
GachaPoolEntries,ppe_pickup_blade_ssr,weight,10,25
Packages,pkg_whale,price_krw,49900,59900
```

- **source_table** is the table's CURRENT display `label` (§DI5) — a plain,
  human-readable convenience for finding the right sheet, deliberately
  distinct from the internal `sourceTableId` (§DI9) that never appears
  anywhere user-visible. A table renamed between import and export shows its
  new name here, which is correct for a one-off CSV a person reads
  immediately (not a stored, long-lived identity — that job belongs to
  `sourceTableId` alone).
- **source_key** is the ORIGINAL `sourceKey` — never the internal node id —
  so a designer can find the row in their own sheet by eye or by their own
  spreadsheet lookup formula.
- **source_column** is the original column name, so `weight` vs. `price_krw`
  vs. `quantity` never collide even when several numeric columns exist on
  one table.
- **previous_value** is `lastImportedValue` (the base, §DI11).
- **new_value** is the current `parameter.value`.
- Scoped to rows where `new_value != previous_value` **only** — approved
  this round (§DI-D1).

This is a plain CSV a designer pastes back into their own sheet by hand (or
feeds to a script they already own) — Loop Studio never touches the source.

## DI13. Serialization / revision-digest impact

A new provenance shape on a `parameter` node's `data` (sketch, per DI11 —
`sourceTableId` / `sourceKey` / `sourceColumn` / `lastImportedValue`, plus a
document-level import-source record carrying `sourceTableId` / `label` /
column-role config) is a **genuine new stored schema**, not a UI-only
feature. Restating GSA2's own explicit warning rather than repeating its
mistake: this must **not** be described as simply "excluded from the
digest." The precedent is `GraphDoc.frames` (`loop-revision/5`,
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

### DI-D1 — change-proposal CSV lists only CHANGED rows (**approved**)

Only rows where the current value differs from `lastImportedValue`. An "all
mapped rows, changed or not" mode would make the export usable as a full
current-state dump too, at the cost of being much noisier as a "here's what
changed" artifact — which is the export's whole purpose per its name.
Approved by Hanrim/Lumi this round.

### DI-D2 — foreign keys are cross-table only (**approved**)

A row referencing a key in its own table (a same-table self-reference, e.g.
a hypothetical "parent item" column on Items) is out of scope for v1. The
worked example never needs one, and it's a materially different UI problem
(cycle detection, tree/hierarchy display) than the star-shaped linking this
doc designs for. Approved by Hanrim/Lumi this round.

### DI-D3 — a link table is long/normalized form only (**approved**)

`PackageItems` is expressed as one row per (package, item) pair (the worked
example's shape), never as one row with a delimited multi-value cell
(`item_key: "itm_blade_sr;itm_charm_r"`). The latter needs its own small
parsing sub-language and isn't how most spreadsheet tools naturally produce
this data; deferred, not designed here. Approved by Hanrim/Lumi this round.

### DI-D4 — a row missing on refresh: preserve + warn, never auto-delete (**approved**)

GSA2 flagged "deletion and missing-row behaviour" as undecided; settled this
round. A missing row is never silently removed — it surfaces as `missing
from source` and the user explicitly chooses unlink-and-keep or delete
(with reference-checking before any delete), per §DI11's row-lifecycle
rules. Approved by Hanrim/Lumi this round.

### DI-D5 — a live, read-only Sheets connector is a possible LATER phase, not v1 (new this round)

Corrects draft 1's "OAuth permanently excluded" framing (changelog item 3
above). Write-back stays permanently excluded for every source, forever —
that is not reopened. Read-only access to a private Sheet via OAuth is a
smaller, later, and explicitly **optional** promise a future phase could add
without changing anything in this contract: it would only ever produce the
same kind of pasted-snapshot data this doc already designs for, just fetched
instead of copy/pasted. Not designed further here; named so it isn't
confused with, or blocked by, the permanent write-back exclusion.

### DI-D6 — provenance data is ordinary shareable document content; store the minimum (new this round)

Two points, both settled this round:

- **Privacy**: `sourceTableId`, `sourceKey`, the table's `label`, column
  names, and `lastImportedValue` are ordinary **user document content** —
  exactly like a node's `label` or position today. If a Graph, Workspace, or
  Project-revision file carrying these is exported, shared, or committed to
  a Project revision, this provenance travels with it, the same way any
  other document content does. This is not a NEW risk class (labels already
  do this) but is worth stating plainly, since imported data often comes
  from an internal, unshared spreadsheet the designer never intended to
  expose via a shared Loop Studio file.
- **Storage minimization**: Loop Studio stores only the four-tuple
  `(sourceTableId, sourceKey, sourceColumn, lastImportedValue)` per bound
  Parameter, plus the table-level binding config (`sourceTableId`, `label`,
  column-role mapping). It does **not** store the full original row, any
  unmapped column's value, or a source file/Sheet URL. Locked in as a
  decision, not left to an implementation PR's discretion.

## DI15. Out of scope for v1 (restated, consolidated)

- Direct write-back / overwriting any source spreadsheet (DI2 — permanent,
  every source, forever).
- A live connection of any kind in v1: OAuth, private-source access,
  background refresh, any network fetch (DI3) — **deferred, not permanent**,
  see DI-D5.
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
- Storing the full original row or any source file/Sheet URL (DI-D6).
- A "rename detection" heuristic for the key-changed case (§DI11) — modeled
  as add + remove instead.

## DI16. Suggested implementation sequencing (non-binding)

Three phases, corrected this round to separate the (deferred, optional)
connector from the (v1, committed) offline work. Each is its own
explicit-kickoff PR, not decided or started here:

1. **Offline import** (§DI4–§DI10, §DI12.1's reuse confirmed) — paste/upload,
   configure, validate, materialize Parameters. No provenance stored yet, no
   refresh possible (matches GSA1's original Track 2A framing, extended to
   multiple linked tables).
2. **Provenance, refresh, the full row lifecycle, and the change-proposal
   export** (§DI9, §DI11–§DI13, §DI12.2) — the stored binding, the
   added/missing/key-changed/value-changed lifecycle, and both new
   CSV/digest work. Depends on (1) shipping first.
3. **Optional, later: a read-only Google Sheets connector** (§DI-D5) —
   fetches the same shape of snapshot phase 1/2 already handle, purely as a
   convenience over manual paste/re-paste; never gains write access; not
   committed, not designed further here, and does not block or get blocked
   by (1)/(2).
