# Spreadsheet snapshot import — diff, provenance & change-proposal export (design doc)

**Status: design draft — for review, draft 4.** No `loop-*/N` id yet (§DI13
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

**Draft 2 (Hanrim/Lumi, round 1)** fixed 6 real contract conflicts: renamed
the feature from "Google Sheets import" to **spreadsheet/CSV/TSV snapshot
import** (it was never a live connection); removed `Publish to web` guidance
(a real privacy hazard); split the permanent write-back exclusion from the
deferrable OAuth/live-connector question; fixed an unstable refresh-identity
key (`(table label, sourceKey)` → a minted `sourceTableId`); rebuilt the
worked example to fix a price-duplication modelling bug and give
`banner_key` an actual table; and fixed the change-proposal CSV's fragile
composite key into separate columns.

**Draft 3 (Hanrim/Lumi, round 2)** approved draft 2's direction and found 7
more contract gaps before this can be settled — all fixed below:

1. **DI1 and DI5 contradicted each other on scope wording.** DI1 still said
   "Sheet / range / header-row selection"; DI5 said a Sheets-style range
   doesn't apply. Unified into one list — table display name, the
   pasted/uploaded data block, header row, delimiter, and an optional
   in-preview row/column trim (§DI1, §DI5).
2. **Column names need a stable id too, not just rows.** The refresh
   identity was `(sourceTableId, sourceKey, sourceColumn)` with
   `sourceColumn` as the raw header text — renaming `weight` to
   `drop_weight` in the sheet would have made every value under it look
   simultaneously `missing` (old header) and `added` (new header). Fixed:
   a `sourceColumnId` is minted once per column-role mapping (§DI7, §DI9);
   the header text is display/CSV only; a header change is handled as an
   explicit remap, never inferred.
3. **Stored base state was insufficient to detect a label/relationship
   change.** Draft 2 only stored a numeric `lastImportedValue`. If a row's
   `display_name` or an FK column's value changes upstream, the generated
   Parameter's *label and meaning* change too, but there was nothing to
   diff that against. Fixed: the base projection now stores the row's
   mapped **key + number + label + foreign-key** values (still never the
   full original row, an unmapped column, or a source file/URL — §DI11,
   §DI13, §DI-D6 updated accordingly).
4. **The three-way rule was missing a case and never specified where `base`
   moves.** `local == incoming != base` (both sides independently converged
   on the same new value) is not a conflict but wasn't handled; and none of
   the four outcomes said whether `base` advances. Both fixed with a
   complete case table (§DI11).
5. **Multi-table atomicity and ambiguous FK grouping were unstated.**
   Pure-lookup tables (`Items`, `Banners`) create zero Parameters of their
   own — the doc needed to say explicitly that the whole first import (every
   table together) validates and commits as one atomic step. Separately,
   `GachaPoolEntries` has TWO foreign keys (`item_key`, `banner_key`), so
   "one frame per FK group" was ambiguous — fixed by requiring an explicit
   "group by" FK pick, never a silent default (§DI11, §DI-D10, §DI-D11).
6. **"Reused from Project Revision's incident-edge precedent" overclaimed
   what that precedent actually covers.** A Register expression, a
   `loop-model/2` resource-edge `flow`, and a `loop-state/4` activator
   `expr` can all reference a Parameter by `@id` **without being a graph
   edge at all** — checked directly against `graphStore.ts`'s `removeNode`
   (strips only literal incident edges, nothing else) and confirmed this is
   a real, currently-unhandled gap even in today's ordinary node deletion,
   not something Project Revision already solved. Restated honestly as NEW
   required work, not reused (§DI11, §DI-D9).
7. **Three wording/accuracy corrections**: DI12.1 overclaimed that a
   Register appears in the CSV exports — checked directly against
   `TimelineChart.tsx`'s `downloadCsv(pools, series)` call site (Registers
   are handled in a completely separate path, never passed to `downloadCsv`)
   and `montecarlo.ts`'s `resolveTracked` (Pool ids only) — both exports are
   **Pool-only**; a Register's value is computed and shown on the Timeline
   chart on-screen but is not in either CSV today (§DI12.1, stated as a
   pre-existing gap, not something this doc fixes). The draft-2 changelog
   said "four properly normalized tables" for a five-table rebuild — fixed.
   And the junction-table explanation was imprecise: it's not that the two
   FK columns' *combination* is non-unique, it's that **neither FK column
   alone is unique, and v1 requires a single key column** — fixed (§DI4,
   §DI6). `sourceKey`'s maximum length is now its own independent limit,
   not a reuse of the unrelated node-label length ceiling (§DI-D8).

**Draft 4 (Hanrim/Lumi, round 3)** confirmed draft 3 closed the prior 7
items and raised 5 new, different gaps before this can be settled — all
fixed below:

1. **DI16 Phase 1 contradicted DI9.** Phase 1 said "no provenance stored
   yet," but DI9 already has Phase 1 minting `sourceTableId`/
   `sourceColumnId` — which ARE provenance, and every generated Parameter's
   initial value already IS its own `lastImportedValue` at zero extra cost.
   Fixed: Phase 1 stores identity + an initial base from the start; only
   the refresh **workflow/UI** is phase 2's job, not the underlying data
   (§DI16).
2. **The three-way diff had no defined unit for a Parameter label composed
   from MULTIPLE source columns across MULTIPLE tables.** Draft 3 said a
   label "follows the exact same rule" as a number, which doesn't hold —
   neither `Items.display_name` nor `Banners.banner_name` is ever a
   directly-editable field a user could diverge from, so there is no
   `local` to speak of for a raw constituent text. Replaced with two
   simpler mechanisms: a constituent text change is a plain two-way compare
   that's always auto-appliable; whether it actually touches a Parameter's
   label is gated by one flag, `labelAutoComposed`, which permanently flips
   off the moment a user hand-edits that label. An FK VALUE re-pointing (a
   row now refers to a different key, not just cosmetic text) is its own
   always-surfaced case, never auto-applied (§DI11).
3. **Changing which FK drives "group by" (DI-D11) left open what happens to
   ALREADY-existing frames/positions.** Settled: a group-by change only
   affects nodes materialized after the change — never a retroactive
   reframe or reposition of anything already on the canvas (§DI-D12).
4. **CSV encoding and formula-injection safety were unaddressed** for the
   one export this doc builds from scratch. The change-proposal CSV carries
   free-form designer text (`source_key`) that gets pasted straight back
   into the designer's own spreadsheet (DI2) — an un-neutralized value
   starting with `=`/`+`/`-`/`@`/tab/CR would execute as a formula there.
   Fixed: UTF-8, proper RFC 4180 quoting (never "strip the character"), and
   a leading-`'` neutralizer on every text field (§DI12.3, §DI-D14).
5. **The scope boundary for auto-wiring an imported Parameter into the
   pre-existing model was never stated in general terms** — only
   Register-aggregation was called out as manual (§DI8). Generalized: import
   never creates or edits ANY resource-edge flow, Register expression, or
   activator reference — a freshly imported Parameter is exactly as
   free-floating as one dragged in from the toolbar (§DI10, §DI-D13).

Implementation is explicitly **out of scope for this PR** — design only, per
the same design-doc-first → approval → implementation split already used for
`docs/conditional-state-update.md`, `docs/label-timing-authoring.md`,
`docs/parameter-activator.md`, and `docs/gacha-banner-zones.md`.

Sections: **DI1** scope · **DI2** exclusions · **DI3** snapshot mechanism ·
**DI4** worked example · **DI5** per-table import config · **DI6** row key ·
**DI7** column selection & type mapping · **DI8** cross-table key
relationships · **DI9** stable identifiers (table / column / source key /
node id) · **DI10** materializing Parameters · **DI11** provenance, refresh,
row lifecycle, label composition & atomicity · **DI12** exports · **DI13** serialization /
revision-digest impact · **DI14** decisions · **DI15** out of scope
(restated) · **DI16** suggested implementation sequencing.

---

## DI1. Scope (v1) — fixed by explicit instruction

1. **Spreadsheet snapshot import** (CSV/TSV paste or upload — no write-back,
   ever; DI2, DI15). Google Sheets, Excel, or any spreadsheet a designer
   already uses is a valid *origin* of the pasted data — there is no
   Sheets-specific mechanism.
2. **Table display name, the pasted/uploaded data block, header row,
   delimiter, and an optional in-preview row/column trim** — unified this
   round with §DI5's actual mechanism (there is no literal Sheets-style
   `A1:D6` range; see §DI3/§DI5 for why).
3. A designated **row unique key** per table.
4. Selecting only the needed columns and mapping each to a type.
5. **Cross-table key relationships** — items, gacha pool entries, and
   packages (with their own item-linking table) joined by shared keys.
6. **Source identity kept separate from the internal node id, the table's
   display label, AND a column's header text** (§DI9 — the label/header
   parts were this round's and last round's fixes respectively).
7. Numeric values **materialize as `parameter` nodes** (`loop-model/1`,
   already shipped — no new engine primitive).
8. **Manual refresh** with a full **row lifecycle** (added / missing /
   key-changed / value-changed) and a complete **base / local / incoming
   three-way diff** (§DI11).
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
  strictly **read-only** connector is named as a possible future phase in
  §DI16 / §DI-D5, distinct from — and never reopening — the write-back
  exclusion above.
- Binding to any node kind other than `parameter` (restates GSA5).
- Import rows that directly create `register` nodes or expressions (restates
  GSA5).
- Multi-dimensional stat tables (only flattened rows, restates GSA5).

## DI3. Snapshot mechanism

**No live network fetch, no OAuth, no CORS-dependent `fetch()` against any
spreadsheet host, and no guidance that risks exposing a private table.**
Contradicts Loop Studio's whole positioning (client-only, no accounts, works
offline — README's "Why" section, `docs/pwa.md`) and doesn't even solve
provenance cleanly (a background auto-refresh has no natural moment to run
the row-lifecycle / diff, §DI11). GSA0 already reached this conclusion for
the single-table case; it applies unchanged here, generalized beyond Sheets
specifically.

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

There is no Sheets-style `A1:D6` range address, because nothing here
connects live to a Sheet — the whole pasted/uploaded block is the input, and
any further trimming happens in the Preview (§DI5), same as trimming a CSV
in a text editor before importing it anywhere else.

"Manual refresh" (DI1 item 8) means: the user re-exports/re-copies the same
data whenever they've changed it, pastes or re-uploads it into the SAME
import binding, and clicks **Refresh** — which re-runs the identical column
mapping and walks the full row lifecycle (§DI11) against what's stored. No
polling, no stored URL, no token, no background activity.

## DI4. Worked example — a real, normalized gacha item table set

Five sheets a designer already has, linked by ordinary spreadsheet
convention (a shared key column, no formulas). Every mechanic below is
illustrated against this same example.

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
exactly once per package):

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

**Why `pool_entry_key` and `package_item_key` exist, precisely** (corrected
this round): it is **not** that the *combination* of `banner_key`+`item_key`
(or `package_key`+`item_key`) fails to be unique — in this well-formed data
it IS unique per row. The real reason is narrower: **v1 requires a single
key COLUMN** (§DI6), and *neither FK column alone* is unique (several items
share a `banner_key`; several items share a `package_key`) — so a
link/junction table needs its own synthetic single-column key. This is a
consequence of v1's own constraint, not an inherent property of the data;
§DI6 states it as a requirement for that reason.

## DI5. Per-table import configuration

Unified this round with DI1 item 2 (draft 2 had these two sections
contradicting each other). For each pasted/uploaded table, the user
supplies:

- a **table display name**, typed by the user (a plain paste carries no
  sheet/tab name — "Items", "Banners", "GachaPoolEntries", "Packages",
  "PackageItems" above are user-typed labels, not detected from the
  clipboard). **Presentation only, freely renameable at any time** — it
  plays no role in matching a refresh; that's `sourceTableId` (§DI9), minted
  once and never shown.
- the **pasted or uploaded data block** itself (CSV/TSV text, or a file) —
  this is the entire input; there is no separate "connect to a range"
  step (§DI3).
- the **header row** (usually row 1; a preview shows the first ~10 rows so
  the user can confirm before committing),
- the **delimiter** (auto-detected from a pasted TSV vs. an uploaded CSV;
  user-overridable for an unusual export),
- an **optional, in-preview row/column trim** — e.g. drop a leading title
  row a paste happened to include, exclude trailing summary rows, or narrow
  which columns are even considered before DI7's per-column ROLE assignment
  runs on whatever remains. This is a coarse structural trim, distinct from
  DI7's semantic role assignment (key/number/label/FK/ignored), and is the
  closest thing to a "range" in this contract — entirely local to the
  pasted text, never a live Sheets address.

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
- no control characters, and a maximum length — **its own independent
  limit, decided at implementation time, not a reuse of the unrelated
  node-label length ceiling** (corrected this round; a sourceKey and a
  node label serve different purposes and may need different bounds —
  §DI-D8).

**A link/junction table needs a genuinely unique COLUMN, which often
doesn't exist yet** — `GachaPoolEntries`/`PackageItems` above needed their
own synthetic key added, precisely because v1 requires a single key column
and neither of their FK columns is unique alone (§DI4's corrected
explanation — not because the FK *combination* is non-unique). The import
preview's key-selection step, faced with no unique column, tells the user
this directly (with the duplicate rows highlighted) rather than silently
picking a non-unique column and producing a broken import.

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

Assigning a role to a column mints that column's own stable
**`sourceColumnId`** (§DI9) — the header text itself (`weight`,
`price_krw`, …) is never the identity, only its current display name.

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
- **Grouping — needs an explicit "group by" pick when a table has more than
  one FK (new this round, §DI-D11).** `GachaPoolEntries` has TWO foreign
  keys (`item_key`, `banner_key`); "one frame per FK group" is ambiguous
  without saying which one groups. The import preview requires the user to
  explicitly choose, e.g. **"Group by: banner_key"** → one frame per banner
  (`Premium Pickup`, `Premium Standard`), never a silently-guessed default
  (restates GSA4's "do not silently generate frames from group").
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

FK relationships are **cross-table only** in v1, approved (§DI-D2) — a row
referencing a key in its *own* table (a self-reference) is out of scope.

## DI9. Stable identifiers — table, column, source key, and node id

Four separate identifiers are in play — a third was added this round
(`sourceColumnId`) after `sourceTableId` (draft 2's fix) was found to have
left column names with the exact same instability bug one level down:

1. **`sourceTableId`** — freshly minted once, when a table is first bound
   (the same `nextId()` scheme as any other internal id, e.g.
   `srctable_mtc00jt3_2`). **Never shown to the user, never editable.** The
   match key for a table across refreshes.
2. **`sourceColumnId`** (new this round) — freshly minted once, when a
   column is first assigned a role (§DI7) — e.g. `srccol_mtc00jt5_1` for
   `GachaPoolEntries.weight`. **Never shown to the user, never editable.**
   The header text (`weight`) is display/CSV-facing only. **A header rename
   is an explicit remap, never inferred**: on refresh, if a previously-known
   header text is missing, the user is asked "is this the same column under
   a new name, or a different column?" — picking "same column" keeps the
   existing `sourceColumnId` (only its display text updates); picking
   "different column" mints a fresh `sourceColumnId` (the old one's values
   then behave as ordinary missing rows, §DI11). A whole-column rename or
   removal is surfaced **once, as one column-level event** — never smeared
   into one `missing` prompt per row under that column.
3. **The table's `label`** (§DI5) — a plain, user-editable display string
   ("GachaPoolEntries", "Packages"). Purely presentational, exactly like a
   column's header text. **Renaming a table's label never breaks its
   binding** (draft 2's fix).
4. **The internal node id** — restates GSA3, unchanged: `nextId('parameter')`
   (`src/model/factory.ts`) mints every generated Parameter's real id exactly
   the way dragging a Parameter onto the canvas already does
   (`parameter_mtc00jt3_2`-shaped). A `sourceKey` (e.g.
   `"pkgitem_starter_charm_r"`, arbitrary designer text) never touches the
   id-safe charset requirement and is never itself used as, or sanitized
   into, a node id.

**The refresh-matching identity for one imported value is the triple
`(sourceTableId, sourceKey, sourceColumnId)`** — internal ids only, never
raw display text on any of the three axes. Not the bare `sourceKey` alone (a
table's own key values are only unique WITHIN that table), not
`(label, sourceKey)` (draft 2's bug), and not `(sourceTableId, sourceKey,
<header text>)` (this round's bug).

## DI10. Materializing values as Parameters

For every **(row, number-role column)** pair across every imported table, the
importer creates one fresh `parameter` node (`loop-model/1`, already
shipped — no engine change):

- **id**: freshly minted (`nextId('parameter')`), per DI9 — never derived
  from the sourceKey, and never equal to `sourceTableId` or
  `sourceColumnId` (each serves a different purpose).
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
  1. one frame per table (or per explicit "group by" FK pick, per §DI8 —
     required, never guessed, when a table has more than one FK) — the
     default in this doc's worked example: a "GachaPoolEntries" frame
     grouped by `banner_key`, a "Packages"/"PackageItems" frame;
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

**Explicit boundary, stated plainly rather than left implied (new this
round):** import creates the Parameter nodes and nothing else — it never
wires a single one of them into the pre-existing model. No resource-edge
`flow` is created or edited to reference an imported Parameter's `@id`, no
Register `expr` is authored or changed to sum/reference one, no activator
`expr` is touched. A freshly imported Parameter sits on the canvas exactly
as free-floating as one dragged in from the toolbar, until the designer
connects it by hand — the same manual step §DI8 already named for
aggregation Registers, generalized here to cover ANY connection into ANY
pre-existing node, not only summary Registers.

## DI11. Provenance, manual refresh, row lifecycle, and atomicity

### What's stored (expanded this round — a numeric base alone can't detect a label/relationship change)

- one document-level **import-source record** per bound table: its
  `sourceTableId` (§DI9), its display `label`, and its declared
  key/number/label/FK column roles + their `sourceColumnId`s (so re-pasting
  a fresh export from the same sheet doesn't require re-answering DI5–DI8
  every time),
- per imported **row** (not just per generated Parameter): its `sourceKey`
  plus the **base projection of every mapped column** —
  `{ number: Record<sourceColumnId, number>, label: Record<sourceColumnId,
  string>, foreignKey: Record<sourceColumnId, sourceKey> }` (a sketch, not
  final field names — see §DI13). The **number** values are what §DI10's
  Parameters diff against on refresh (draft 2 already had this, as
  `lastImportedValue`); the **label** and **foreignKey** values are new this
  round — without them, a changed `display_name` or a re-pointed FK has
  nothing to compare against, and a generated Parameter's label would either
  never update or update silently with no way to detect the change was even
  real.
- per generated **Parameter**: `labelAutoComposed` (default `true`, flips
  permanently to `false` the moment the user hand-edits its label in the
  Inspector — new this round, §DI11's label-composition fix below).
- **Still never stored**: the full original row, any unmapped/ignored
  column, or a source file/Sheet URL (GSA2, §DI-D6 — unchanged).

Rejected in draft 2: matching on `(label, sourceKey)`. Rejected this round:
`sourceColumn` as raw header text instead of `sourceColumnId` (§DI9).

### Column-level events, handled once (new this round)

Before any per-row diffing: if a refresh's paste is missing a previously
mapped header and the user confirms it's genuinely a different column (not
a rename — §DI9), that whole column's prior values are dropped from
matching in **one** column-level acknowledgement, never as N separate
per-row `missing` prompts. A genuine rename (same `sourceColumnId`, new
header text) is not a "change" in the diff sense at all — only the display
text updates.

### The four things a refresh can see, per row

A fresh paste/upload is compared against the stored bindings for that table.
Every `sourceKey` present on either side falls into exactly one case:

1. **Added** — a `sourceKey` in the incoming snapshot with no matching
   stored row for this `sourceTableId`. Shown in the refresh preview as
   `added`. **Materialized only after the user explicitly confirms** — the
   same "validate/preview the whole batch before touching the graph"
   discipline as the first import (§DI7), not a silent auto-add. (Confirming
   several adds at once, e.g. "add all 3 new rows," is a normal UX
   convenience — the underlying rule is that nothing is created without the
   user having seen and accepted it.)
2. **Missing** — a stored row's `sourceKey` is absent from the incoming
   snapshot. **Never auto-deleted.** Shown as `missing from source`; the
   user explicitly picks, per row (or per batch):
   - **unlink** — keep every Parameter generated from this row exactly
     as-is, drop only its provenance, so it becomes ordinary hand-owned
     data no future refresh will touch again, or
   - **delete** — remove the node(s). **Reference-checking here needs NEW
     work, not a reuse of Project Revision's incident-edge precedent** —
     see the correction below. **A referenced node is never silently
     deleted.**
3. **Key-changed** — modeled as **exactly Added + Missing together, no
   separate "rename" detection.** If a designer renames a spreadsheet row's
   key, the old key shows up as `missing` (case 2) and the new key shows up
   as `added` (case 1) in the SAME refresh — handled independently by the
   two rules above. No heuristic tries to guess that these are "the same
   row that got renamed"; guessing wrong (two unrelated rows that happen to
   swap-look-alike) would be worse than asking the user to redo the one
   Parameter's edits from a fresh materialization.
4. **Value-changed** — a `sourceKey` present on both sides, with at least
   one mapped column's incoming value differing from its stored base. A
   `number`-role column runs the base/local/incoming three-way below
   directly. A `label`-role or `foreignKey`-role column is **not** the same
   shape — see the correction below (a real gap, not just a restatement of
   the numeric rule).

### Label composition has a different diff unit than a number (corrected this round — draft 3 wrongly said "the exact same rule")

Draft 3 claimed a `label`/`foreignKey`-role column "follows the exact same
rule" as a number. **This doesn't hold up**, for a reason specific to how a
label is built: a generated Parameter's label is composed from **multiple**
constituent texts across **multiple** tables (§DI10) — e.g.
`ppe_pickup_blade_ssr`'s label draws on `Items.itm_blade_ssr.display_name`
AND `Banners.premium_pickup.banner_name`, neither of which is itself a
directly-editable field anywhere in Loop Studio (`Items`/`Banners` are
pure-lookup tables — §DI4 — with no `number`-role column, so they never
become Parameters a user could hand-edit). There is no possible `local`
divergence for a raw constituent text, because nothing in the app lets a
user edit it directly; the ONLY place local hand-editing can happen is on
the **composed Parameter's own label field**, in the Inspector.

This needs two separate, simpler mechanisms instead of one three-way table:

1. **A constituent text change is a plain two-way compare, always
   auto-appliable, never a conflict** — `base` vs. `incoming` for
   `Items.itm_blade_ssr.display_name` (say). If it changed, recompose every
   Parameter label that draws on it.
2. **Whether that recomposition actually touches the Parameter's label is
   gated by one stored flag: `labelAutoComposed` (default `true` at
   creation).** The moment a user directly edits a generated Parameter's
   label in the Inspector, `labelAutoComposed` flips to `false` — a
   permanent detach, mirroring "never silently clobber a hand edit"
   everywhere else in this doc. While `true`, a constituent change (1)
   recomposes and applies the new label with no prompt (there is nothing to
   conflict with — the label was never independently edited). While
   `false`, a constituent change is **skipped** for that Parameter and
   surfaced only as an FYI line in the refresh summary ("3 upstream names
   changed but these Parameters' labels are customized — not updated"),
   never a per-row prompt.
3. **A foreign key's VALUE changing (the row re-points to a different key,
   not just that the pointed-to row's own text changed) is treated as its
   own, always-surfaced case — never auto-applied, regardless of
   `labelAutoComposed`.** `ppe_pickup_blade_ssr.item_key` changing from
   `itm_blade_ssr` to `itm_blade_sr` means this row is now conceptually
   ABOUT a different item, not a cosmetic rename — the user explicitly
   confirms accepting the re-point (which then also recomposes the label,
   if still auto-composed) or rejecting it (this refresh leaves the FK
   value at its old target; a future refresh asks again if the source still
   disagrees).

### The complete base/local/incoming three-way — `number`-role columns only (corrected this round — one case and all base-movement rules were missing)

```
base     = the stored value at last import/refresh
local    = the current value in the graph (a Parameter's data.value, or a
           generated label's current text) — may have been hand-tuned since
incoming = the freshly pasted/uploaded value
```

| case | condition | outcome | base after |
|---|---|---|---|
| unchanged | `local == base`, `incoming == base` | nothing to do | unchanged |
| source-only changed | `local == base`, `incoming != base` | **auto-apply** incoming, no prompt | → incoming |
| local-only changed | `local != base`, `incoming == base` | nothing to do (keep local) | unchanged |
| **converged (new this round)** | `local != base`, `incoming != base`, `local == incoming` | nothing to do — **not** a conflict, both sides independently reached the same value | → incoming |
| real conflict | `local != base`, `incoming != base`, `local != incoming` | ask the user: **apply incoming** (value → incoming) or **keep mine** (value stays local) | → incoming **either way** |

The "converged" row and the "base after" column are this round's fixes.
Moving `base` to `incoming` even on **keep mine** matters: it means the
NEXT refresh, if the sheet hasn't changed further, sees `incoming == base`
again and stays quiet — without this, the same already-acknowledged
difference would re-prompt as a conflict every single refresh forever.

**Proposed, not yet fully verified**: reuse the Project Revision three-way
Apply *classification logic* (`src/model/revision.ts`, `SEMANTICS-R.md`'s
`exact`/`divergent`/`unknown` shape) for the table above, rather than writing
a second diff engine from scratch. Needs implementation-time verification
against the actual code — whether the same functions run over an in-memory
synthetic "incoming GraphDoc fragment" built fresh from a paste, or only the
classification *logic* is reusable and the UI needs its own thinner surface,
is exactly the kind of claim this project's history
(`docs/parameter-activator.md`'s `loop-revision/7` reversal,
`docs/gacha-banner-zones.md`'s `pickup_share` correction) says must be
checked before an implementation PR relies on it.

### Reference-checking before a delete (corrected this round — the prior claim overreached)

Draft 2 said deleting a node on a `missing` row reuses "Project Revision's
existing incident-edge-surfacing precedent." **Checked directly against the
code, and this overclaimed what that precedent covers.**
`src/store/graphStore.ts`'s `removeNode` strips only literal **incident
edges** (`e.source !== id && e.target !== id`) — it does **not** scan for a
Parameter's id appearing as an `@id` inside:

- a Register's `expr` (`loop-expr/1`),
- a `loop-model/2` resource-edge `flow`,
- a `loop-state/4` activator `expr` (an `ActivatorRhs` `param-term`).

(A `label` state edge's grammar — `+N -N =N +S -S =S` — has no `@id` form at
all, verified against `stateExpr.ts`'s `parseLabelExpr`; labels are correctly
excluded from this list, unlike the reviewer's original broader phrasing.)

The engine already tolerates a dangling `@id` gracefully (an unknown
reference fails closed to a visible error state and never halts the run,
per `SEMANTICS-M.md`) — but the UI does not warn about it today, for ANY
node deletion, imported or not. This is a **real, pre-existing gap**, not
something Project Revision already solved. **This import feature needs a
NEW reference-scanning utility** — walk every Register `expr`, every
`loop-model/2` flow, and every `loop-state/4` activator `expr` for the
target id, before offering `delete` on a missing row — flagged here as
required new work (§DI-D9), not assumed to already exist or to be a trivial
extension of the incident-edge check.

### Multi-table atomicity (new this round)

The **first import**, when it spans several tables at once (as the worked
example does — five sheets bound together), validates every table's preview
together and commits as **one atomic graph mutation with one undo entry** —
the same discipline the shipped "Insert module" already uses (validate the
whole candidate first, nothing changes on failure, one atomic undo;
`docs/module-system.md`). Pure-lookup tables (`Items`, `Banners` here)
create zero Parameters of their own but are still bound in this same atomic
step, so their key/label data is available for FK enrichment (§DI8) both
immediately and on every future refresh.

## DI12. Exports

### DI12.1 Simulation-results CSV — already shipped, no new work (correction this round: Pool-only, not "Pool or Register")

Verified directly against the code rather than assumed: this requirement is
**already fully satisfied** — but the earlier claim that a Register also
appears was wrong and is corrected here.

- `src/components/TimelineChart.tsx`'s `downloadCsv(pools, series)` already
  exports `step, <one column per tracked Pool's label>` for the current
  single run (the Timeline's **CSV** button). Checked the actual call site:
  `pools` and `registers` are computed as two SEPARATE arrays in this file,
  and only `pools` is ever passed to `downloadCsv` — a Register's value is
  computed and shown on the Timeline **chart** on-screen
  (`registersOfSnapshot`), but is **not** in this CSV.
- `src/engine/montecarlo.ts`'s `toSeriesCsv` / `toFinalCsv` /
  `toFinalSummaryCsv` already cover the Monte Carlo distribution — also
  Pool-only, since `resolveTracked` filters to `n.data.kind === 'pool'`
  before anything else runs.

**Corrected statement**: both exports are **Pool-only**, full stop. A Pool
fed by an imported Parameter (e.g. via a resource edge's `@id` flow) needs
no special handling to appear correctly — but a Register that aggregates
several imported Parameters (§DI8's manual-aggregation case) does **not**
appear in either CSV today. This is a real, pre-existing limitation, stated
honestly rather than papered over — fixing it is out of scope for this doc
(it would be a change to `TimelineChart.tsx`/`montecarlo.ts` unrelated to
import). This item is listed in DI1 only because it was part of the original
fixed scope instruction; no implementation work follows from it here.

### DI12.2 Change-proposal CSV — new

The actual answer to "how does a tuned value get back to the spreadsheet,"
given DI2's permanent write-back exclusion: a small, new export producing
**separate columns**, never a joined composite key:

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
- **source_column** is the column's CURRENT header text (display, like
  `source_table` above) — never the internal `sourceColumnId` — so `weight`
  vs. `price_krw` vs. `quantity` never collide even when several numeric
  columns exist on one table.
- **previous_value** is the stored base for that (row, column) — §DI11.
- **new_value** is the current value.
- Scoped to rows where `new_value != previous_value` **only** — approved
  (§DI-D1).

This is a plain CSV a designer pastes back into their own sheet by hand (or
feeds to a script they already own) — Loop Studio never touches the source.

### DI12.3 Encoding and CSV-injection safety (new this round — applies to this export, since it carries free-form user text)

This export is a new, from-scratch writer (unlike §DI12.1's already-shipped
Pool CSVs), and it carries far more free-form text than those do —
`source_key` and `source_table` are arbitrary designer-typed strings, not a
controlled node-label vocabulary. Two requirements, settled here rather than
left to an implementation PR's discretion:

- **Encoding**: UTF-8, matching the Unicode-normalization discipline §DI6
  already requires for keys.
- **Proper RFC 4180 quoting, not the naive "strip the problem characters"
  approach.** A value containing a comma, a double quote, or a newline is
  wrapped in double quotes with internal quotes doubled — never replaced
  with a space (which would silently corrupt a `source_key` that
  legitimately contains one of those characters).
- **CSV/formula-injection guard.** A cell that a spreadsheet app would
  interpret as a formula or command when the exported file is later opened —
  one starting with `=`, `+`, `-`, `@`, a tab, or a carriage return (the
  well-known CSV-injection character set) — is neutralized with a leading
  `'` before being written, on every text field (`source_table`,
  `source_key`, `source_column`). This matters specifically because §DI12.2's
  whole purpose is for a designer to **paste this export straight back into
  their own spreadsheet** (DI2) — an un-neutralized `source_key` that
  happens to start with `=` would execute as a formula (or worse) the moment
  it lands there, a real, not theoretical, risk given `source_key` is
  arbitrary designer-chosen text.

## DI13. Serialization / revision-digest impact

A new provenance shape (sketch, per DI11 — expanded this round beyond a bare
numeric base):

- per table: `sourceTableId`, `label`, column-role config (each column's
  `sourceColumnId`, role, and current header text),
- per imported row: `sourceKey`, and the stored base projection —
  `{ number: Record<sourceColumnId, number>, label: Record<sourceColumnId,
  string>, foreignKey: Record<sourceColumnId, sourceKey> }`,
- per generated **Parameter**: `labelAutoComposed: boolean` (§DI11's
  label-composition fix — new this round).

This is a **genuine new stored schema**, not a UI-only feature. Restating
GSA2's own explicit warning rather than repeating its mistake: this must
**not** be described as simply "excluded from the digest." The precedent is
`GraphDoc.frames` (`loop-revision/5`, `SEMANTICS-R5.md`) — a frame edit
moves the full revision **content** digest and `dirty`, but never the
engine/structure digest or the simulation result, because a frame changes
nothing the engine computes. Provenance is the same shape: a Parameter's
`data.value` already affects simulation and already moves the existing
digests through the ordinary Parameter-value path; the NEW provenance
fields affect nothing the engine computes, but they are still real,
serialized document content someone might git-diff or three-way-merge, so
they **do** belong in the revision content digest.

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

Only rows where the current value differs from the stored base. An "all
mapped rows, changed or not" mode would make the export usable as a full
current-state dump too, at the cost of being much noisier as a "here's what
changed" artifact — which is the export's whole purpose per its name.

### DI-D2 — foreign keys are cross-table only (**approved**)

A row referencing a key in its own table (a same-table self-reference, e.g.
a hypothetical "parent item" column on Items) is out of scope for v1. The
worked example never needs one, and it's a materially different UI problem
(cycle detection, tree/hierarchy display) than the star-shaped linking this
doc designs for.

### DI-D3 — a link table is long/normalized form only (**approved**)

`PackageItems` is expressed as one row per (package, item) pair (the worked
example's shape), never as one row with a delimited multi-value cell
(`item_key: "itm_blade_sr;itm_charm_r"`). The latter needs its own small
parsing sub-language and isn't how most spreadsheet tools naturally produce
this data; deferred, not designed here.

### DI-D4 — a row missing on refresh: preserve + warn, never auto-delete (**approved**)

GSA2 flagged "deletion and missing-row behaviour" as undecided; settled. A
missing row is never silently removed — it surfaces as `missing from
source` and the user explicitly chooses unlink-and-keep or delete (with the
NEW reference-checking of §DI-D9 before any delete), per §DI11's
row-lifecycle rules.

### DI-D5 — a live, read-only connector is a possible LATER phase, not v1

Write-back stays permanently excluded for every source, forever — not
reopened by this. Read-only access to a private Sheet (or similar) via OAuth
is a smaller, later, explicitly **optional** promise a future phase could
add without changing anything in this contract: it would only ever produce
the same kind of pasted-snapshot data this doc already designs for, just
fetched instead of copy/pasted. Not designed further here.

### DI-D6 — provenance data is ordinary shareable document content; store the minimum (updated this round)

- **Privacy**: `sourceTableId`, `sourceColumnId`, `sourceKey`, table/column
  display text, and every stored base value are ordinary **user document
  content** — exactly like a node's `label` or position today. If a Graph,
  Workspace, or Project-revision file carrying these is exported, shared, or
  committed to a Project revision, this provenance travels with it, the same
  way any other document content does. Not a NEW risk class (labels already
  do this) but worth stating plainly, since imported data often comes from
  an internal, unshared spreadsheet the designer never intended to expose
  via a shared Loop Studio file.
- **Storage minimization (scope updated this round — DI11 now stores more
  than a bare numeric base, but the boundary is unchanged)**: Loop Studio
  stores the table-level binding config plus, per row, only the **mapped**
  key/number/label/foreign-key base values (§DI11, §DI13). It does **not**
  store the full original row, any **unmapped/ignored** column's value, or
  a source file/Sheet URL. The set of columns eligible to be stored is
  exactly the set the user explicitly gave a role to in §DI7 — nothing
  entering through the back door.

### DI-D7 — `sourceColumnId` is the real column identity; header rename is an explicit remap (new this round)

A column's header text is display/CSV-facing only (§DI9). Renaming a header
between refreshes is never inferred from position or fuzzy text matching —
the user is asked once, explicitly, whether it's the same column renamed or
a genuinely new one, exactly mirroring how a table's own rename is already
handled (§DI9 item 3).

### DI-D8 — `sourceKey`'s maximum length is its own independent limit (new this round)

Not a reuse of the unrelated node-label length ceiling (a correction from
draft 2, which conflated the two). The exact number is an implementation-time
decision — a `sourceKey` and a display label serve different purposes and
may reasonably need different bounds.

### DI-D9 — deleting an imported node needs a NEW reference scan, not a reuse of the incident-edge precedent (new this round)

Verified against `graphStore.ts`'s `removeNode`: it strips only literal
incident edges. A Register `expr`, a `loop-model/2` resource-edge `flow`,
and a `loop-state/4` activator `expr` can all reference a node by `@id`
without being an edge — none of these are scanned today, by any node
deletion path, imported or not. Building the delete-with-reference-check
flow §DI11 requires means writing this scanner as new work — explicitly not
assumed solved by Project Revision's existing (narrower) precedent.

### DI-D10 — the first multi-table import is one atomic wizard/commit/undo (new this round)

Mirrors the shipped Insert-module discipline: validate every bound table's
preview together, commit every generated node across every table as one
graph mutation, one undo entry. Pure-lookup tables that generate zero
Parameters of their own (`Items`, `Banners`) are still part of this same
atomic step, since their data feeds FK enrichment (§DI8) from the moment of
import onward.

### DI-D11 — a table with 2+ foreign keys requires an explicit "group by" pick (new this round)

No silent default when a table like `GachaPoolEntries` has more than one FK
column. The import preview requires the user to name which FK drives the
per-table frame grouping (§DI8, §DI10) — restates and sharpens GSA4's "do
not silently generate frames from group" for the multi-FK case draft 2 left
unaddressed.

### DI-D12 — changing the "group by" FK never retroactively moves already-existing nodes (new this round)

DI-D11 fixed the AMBIGUITY of picking a group-by FK; this closes the
follow-up question of what happens if that pick changes LATER (a
reconfiguration, or simply choosing differently on a fresh separate import
of the same table). **Settled: a group-by change affects only nodes
materialized AFTER the change** — any node/frame from an earlier import or
refresh keeps its existing frame membership and position untouched,
regardless of what a later "group by" setting would have produced for it.
Reframing or repositioning already-existing nodes is ordinary manual frame
editing (already fully supported — `docs/large-graph-readability*.md`), not
something this import feature ever does automatically. Matches this doc's
consistent "never silently move or regenerate something the user might have
already touched" stance (GSA4, §DI-D4, §DI11's `labelAutoComposed`).

### DI-D13 — an imported Parameter is never auto-wired into the pre-existing model (new this round)

Generalizes §DI8's "manual aggregation only" note (which covered just
Register aggregation) to every kind of connection: import never creates or
edits a resource-edge `flow`, a Register `expr`, or an activator `expr` to
reference a newly materialized Parameter. Every connection into the
pre-existing simulation is a manual follow-up step, indistinguishable from
wiring up a Parameter a user typed in by hand (§DI10).

### DI-D14 — the change-proposal CSV is UTF-8, RFC 4180-quoted, and formula-injection-safe (new this round)

Settled requirements for the one export this doc actually builds from
scratch (§DI12.3): UTF-8 encoding, proper comma/quote/newline quoting (never
"strip the character"), and a leading-`'` neutralizer on any text field
that would otherwise read as a formula/command (`=`, `+`, `-`, `@`, a tab,
or a CR) when pasted into a spreadsheet — directly relevant here since
pasting this export back into the source sheet is the export's entire
purpose (DI2).

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
- Storing the full original row, any unmapped column, or a source file/Sheet
  URL (DI-D6).
- A "rename detection" heuristic for the key-changed or column-renamed
  cases (§DI9, §DI11) — both modeled as an explicit user choice instead.
- A Register appearing in either CSV export (§DI12.1 — a pre-existing gap,
  not fixed by this doc).
- Any automatic wiring of an imported Parameter into the pre-existing model
  — no auto-created resource-edge flow, Register expression, or activator
  reference (DI-D13, generalizes §DI8's aggregation-only note).
- Retroactively reframing or repositioning already-existing nodes when a
  "group by" FK setting changes later (DI-D12).

## DI16. Suggested implementation sequencing (non-binding)

Three phases, separating the (deferred, optional) connector from the (v1,
committed) offline work. Each is its own explicit-kickoff PR, not decided or
started here:

1. **Offline import** (§DI4–§DI10, §DI12.1's reuse confirmed) — paste/upload,
   configure (including `sourceColumnId` minting, §DI9), validate,
   materialize Parameters, one atomic commit across every bound table
   (§DI-D10). **Corrected this round — this phase DOES persist identity and
   an initial base**, resolving a real contradiction: §DI9 already mints
   `sourceTableId`/`sourceColumnId` here, and every generated Parameter's
   first value IS its own initial `lastImportedValue` at zero extra cost —
   there was never a reason to withhold storing them. "No refresh
   **workflow**" is the accurate boundary for this phase, not "no
   provenance stored": no Refresh button, no row-lifecycle UI, no
   change-proposal export exist yet, but the data phase 2 needs to make
   sense of a later refresh is already sitting on every node it created
   (matches GSA1's original Track 2A framing, extended to multiple linked
   tables).
2. **The refresh workflow: row lifecycle, the complete three-way table,
   label composition, atomicity for refresh batches, and the
   change-proposal export** (§DI9, §DI11–§DI13, §DI12.2) — builds the UI and
   logic on top of phase 1's already-stored data: the
   added/missing/key-changed/value-changed lifecycle, the number-only
   three-way table, the separate `labelAutoComposed` mechanism, the NEW
   reference-scanner (§DI-D9), and both new CSV/digest work. Depends on (1)
   shipping first, but does not require retrofitting phase 1's data shape.
3. **Optional, later: a read-only connector** (§DI-D5) — fetches the same
   shape of snapshot phases 1/2 already handle, purely as a convenience over
   manual paste/re-paste; never gains write access; not committed, not
   designed further here, and does not block or get blocked by (1)/(2).
