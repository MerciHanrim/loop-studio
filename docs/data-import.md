# Spreadsheet snapshot import — diff, provenance & change-proposal export (design doc)

**Status: approved — settled design, implementation pending.** Draft 7
(round 6) closed the last real conflict (the row/cell two-phase
classification); Hanrim/Lumi confirmed no further blockers and approved
this design after 6 review rounds. Phase 1A (the storage foundation; §DI13,
§DI16) has since shipped its `loop-revision/N` id as `loop-revision/8`
(`SEMANTICS-R8.md`) — see §DI13 for the settled shape. The rest of this
design (Phase 1B's import UI and the refresh workflow) has no `Frozen`
marker yet — that's minted at its own implementation time, per this
project's established pattern (`docs/example-mmo-progression.md`,
`docs/example-coffee-roastery.md`).
Implementation is its own separate, later PR (§DI16), same as every other
design-doc-first feature in this project — not started here, and not
authorized to start without its own explicit kickoff. Prefix `DI`. Kicked
off by explicit instruction after the gacha Template's README documentation
(PR #200) shipped, with the v1 scope fixed in that same instruction (§DI1)
and a concrete gacha item table required as the worked example (§DI4)
before anything else in this doc.

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

**Draft 5 (Hanrim/Lumi, round 4)** confirmed the prior 5 items are closed and
found 5 more refinements needed before approval — all fixed below:

1. **Nothing linked an incoming cell's identity to the actual Parameter node
   it produced.** The refresh identity `(sourceTableId, sourceKey,
   sourceColumnId)` was well-defined, but DI13's stored shape never said
   which `parameterNodeId` it pointed at — a real gap, since refresh cannot
   even locate its target without this. Fixed: every generated Parameter now
   stores its own generating triple directly (§DI9, §DI10, §DI13); `unlink`
   clears it, and a re-added row after unlink mints a brand-new Parameter
   rather than resurrecting the old one.
2. **The auto-label's constituent list was incomplete.** DI10's actual label
   format also embeds the table's display name and the number column's own
   header text, not just the row/FK label text draft 4 covered. Fixed: all
   four constituents are named, split correctly into the three that are
   sheet-sourced (diffed base/incoming, §DI11) and the one
   (`table.label`) that is a Loop-Studio-local setting recomposing
   immediately on rename, never diffed at all (§DI10, §DI11).
3. **A stale phrase survived the label-mechanism split.** The number-only
   three-way's `local` definition still said "a Parameter's `data.value`, or
   a generated label's current text" — the label half was already moved to
   its own mechanism in draft 4 and shouldn't have still been here. Fixed
   (§DI11).
4. **FK re-pointing's base-movement and placement rules were unstated.**
   Fixed with the exact rules given: accepting moves the FK's base to
   `incoming`; rejecting leaves it at the OLD value (unlike a number
   conflict's "keep mine," which still advances base — rejecting an FK
   re-point is "not yet," not "acknowledged and different"); accepting
   never moves the already-existing node's frame/position (§DI11); and
   DI-D12's "never retroactively reframe" rule is now stated to cover BOTH
   a changed group-by *setting* and a re-pointed group-by *FK value* on an
   existing row, not just the former.
5. **CSV Windows-compatibility was incomplete.** UTF-8 alone was requested
   as UTF-8 **with a BOM** plus **CRLF** line endings, not just an encoding
   name — fixed (§DI12.3, §DI-D14). Also added one line making explicit that
   the formula-injection leading-`'` guard changes the field's raw bytes
   (a display/paste-safety convention, not a byte-identical copy of
   `source_key`) and must be stripped by any machine reader that needs the
   original value.

**Draft 6 (Hanrim/Lumi, round 5)** confirmed the prior 5 items landed exactly
as requested, and found 4 more lifecycle gaps that storing the triple ON the
node (rev 5) itself newly exposed — **not a reopening of anything earlier**
— plus one Undo-contract clarification. All fixed below:

1. **Nothing guaranteed a triple maps to at most one active Parameter.**
   Fixed: an explicit invariant, copy/duplicate/module-extract strips the
   triple from the copy, and a corrupted document with a duplicate triple
   blocks refresh for that triple rather than updating both (§DI9, §DI-D15).
2. **Unlink's scope was self-contradictory.** "Removes exactly the node's
   pointer" left the row's stored base projection behind, which would make
   the SAME `sourceKey` register as already-known (not `added`) on a later
   refresh. Fixed: unlink clears the triple, the row's base projection, and
   any linkage bookkeeping together, atomically (§DI9, §DI11, §DI-D16).
3. **A user deleting a linked Parameter directly on the canvas was an
   undefined 5th state** — source and base both survive, only the node is
   gone. Fixed: a new `locally deleted / detached` case, never silently
   recreated, resolved by explicit recreate-or-discard-link, tracked at
   `(row, column)` cell granularity (not per row, since one row can have
   several `number`-role columns) (§DI11, §DI-D17).
4. **The CSV protective prefix wasn't losslessly reversible.** "Only guard
   dangerous-looking values" makes a genuinely `'`-led real key
   indistinguishable from a protected one. Fixed: every text field gets
   exactly one leading `'`, always, unconditionally — trivially and
   losslessly reversible by stripping exactly one leading `'` from every
   text field, no judgment call needed (§DI12.3, §DI-D18).
5. **The Undo contract for label operations was unstated.** Fixed: a label
   edit + its `labelAutoComposed` flip is one atomic Undo entry; a
   table-rename recompose cascade touching many Parameters is one atomic
   Undo entry for the whole batch, not one per Parameter (§DI11, §DI-D19).

**Draft 7 (Hanrim/Lumi, round 6)** confirmed the 4 lifecycle fixes and Undo
contract from draft 6 landed as intended, and found one real conflict left
in the new 5th state, plus one small cleanup — both fixed below:

1. **`locally deleted` and `value-changed` were not mutually exclusive.**
   Concretely: stored base `10`, the user deletes the Parameter node, the
   next paste's incoming value is `25` — that cell is simultaneously
   "locally deleted" (no node) and "value-changed" (`10 → 25`) under a flat
   list of cases, with no principled tiebreak between "recreate from
   base" and "run the number three-way." **Fixed by splitting into two
   ordered phases**: phase 1 classifies the ROW itself
   (`added`/`missing`/`present`) from `sourceKey` presence alone —
   `missing` wins outright even if the local node also happens to be
   deleted; only phase 2, for a `present` row's individual
   `number`-role CELLS, distinguishes "node exists → three-way" from "node
   doesn't exist → `locally deleted`" — genuinely exclusive now, since a
   cell can't be both `missing`'s row-level outcome and phase 2's cell-level
   one at once (§DI11, §DI-D17).
2. **Copy/duplicate/module-extract stripped the triple but not
   `labelAutoComposed`.** A "fully ordinary Parameter" (the claimed result)
   has neither field — leaving one behind contradicted that. Fixed: both
   strip together (§DI9, §DI-D15).

**Final approval (Hanrim/Lumi, after round 6):** confirmed the two-phase
split resolves the exact conflicting scenario cleanly, the recreate/base
sync is correct, the triple/`labelAutoComposed` strip is now complete, and
nothing contradicts the existing added/missing, number three-way, Undo, or
CSV rules. No further blockers — **this design is approved.**

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

**A real gap, found this round: nothing linked that triple to the actual
Parameter node it produced.** Knowing the identity of an incoming CELL is
useless on refresh without also knowing WHICH existing node, if any, it
corresponds to. Fixed: **every `number`-role-generated Parameter stores its
own generating triple** — `(sourceTableId, sourceKey, sourceColumnId)` — on
the node itself (§DI10, §DI13). This is a one-way pointer, Parameter →
source; the per-row base projection (§DI11) is the reverse direction,
source → stored base values, used for diffing. Together they're what makes
a refresh actionable: given an incoming triple, find the Parameter(s)
carrying that same triple (an implementation detail whether this is a
linear scan or a maintained index — not specified here), then run the
row-lifecycle / diff against its base.

**Invariant (new this round — storing the triple ON the node raises a real
lifecycle question rev 5 didn't address): at most one ACTIVE Parameter
carries a given `(sourceTableId, sourceKey, sourceColumnId)` triple at any
time** (§DI-D15). Two consequences, both settled here rather than left to
an implementation PR's discretion:

- **Copying, duplicating, or extracting a triple-carrying Parameter into a
  module (`docs/module-system.md`) strips BOTH the triple AND
  `labelAutoComposed` from the COPY** (the second field named explicitly
  this round — a plain hand-created Parameter has neither field at all, so
  "becomes a fully ordinary Parameter" means dropping the complete
  provenance shape, not just its identity half). Only the original keeps
  either field; the duplicate becomes an ordinary, fully independent
  hand-owned Parameter from the moment it's created — otherwise copy-paste
  alone would silently create two "active" nodes for one triple, and a
  refresh would have no principled way to choose which one to update. A
  module that once contained an imported Parameter carries a plain
  Parameter on **Insert** too, for the same reason (a module is portable
  graph data meant to enter a possibly-different document; the triple is
  meaningful only within the specific binding it came from).
- **If a corrupted or hand-edited document is ever found with two
  Parameters carrying the same triple, refresh does NOT update both.** That
  is treated as a data-integrity error and refresh is **blocked for that
  specific triple** (surfaced to the user, not silently resolved) until the
  duplication is fixed — silently updating both would hide the corruption
  and make future diffs meaningless.

**Unlink must clear more than just this pointer (corrected this round — a
real contradiction, not a restatement).** Rev 5 said unlink "clears exactly
this pointer," but the Parameter-side triple is only HALF of what makes a
row "known" — the per-row base projection stored in the table's
import-source record (§DI11's "What's stored") is the OTHER half, and if it
survives, a later refresh sees the SAME `sourceKey` still has a stored base
and treats it as an existing (if nodeless) row, never as freshly `added`.
Unlink now clears, together, as one operation (§DI11 restates this as its
own row-lifecycle rule):

1. the generating triple on every Parameter this row produced,
2. the row's entire stored base projection in the import-source record,
3. any other row↔node linkage bookkeeping (subsumed by 1–2, listed for
   completeness).

Only after all three are gone does the SAME `sourceKey` reappearing on a
later refresh correctly register as `added` — a brand-new Parameter, never
a resurrection of the unlinked one, which by then is ordinary,
fully independent hand-owned data with no trace of ever having been bound.

## DI10. Materializing values as Parameters

For every **(row, number-role column)** pair across every imported table, the
importer creates one fresh `parameter` node (`loop-model/1`, already
shipped — no engine change):

- **id**: freshly minted (`nextId('parameter')`), per DI9 — never derived
  from the sourceKey, and never equal to `sourceTableId` or
  `sourceColumnId` (each serves a different purpose).
- **its generating triple**: `(sourceTableId, sourceKey, sourceColumnId)`,
  stored on the node itself (§DI9's fix this round) — the pointer a refresh
  uses to find this Parameter again; cleared on `unlink` (§DI11), never
  present on a hand-created Parameter.
- **value**: the cell's numeric value at import time.
- **`labelAutoComposed`**: `true` at creation (§DI11) — flips permanently to
  `false` the moment a user hand-edits the label below, after which nothing
  in this list ever recomposes it again.
- **label**: `"<table label> · <row's label-role text(s), enriched via any
  FK per §DI8, or the row's own key if none was mapped> · <column's header
  text>"` — e.g. `"GachaPoolEntries · Ember Blade · Premium Pickup ·
  weight"`, `"Packages · Whale Pack · price_krw"`, `"PackageItems ·
  Starter Pack · Iron Blade · quantity"` (PackageItems has no label-role
  column of its own, so it falls back to composing from its two FK targets'
  names — resolved to EACH target's own `label`-role text
  (`Packages.package_name`, `Items.display_name`), joined `" · "` in column
  declaration order, exactly like every other multi-term case; corrected at
  Phase 1B implementation time — an earlier draft showed this example with
  an inconsistent `" → "` join and the raw `pkg_starter` key instead of the
  resolved `"Starter Pack"`, which was never a distinct rule, just a stale
  artifact from an earlier round never reconciled with the general one).
  **Four independent things feed this string, all of which recompose
  it while `labelAutoComposed` is `true`** (§DI11 fixes this — draft 4 only
  named two of the four), and they split into two different mechanisms:
  - **Sheet-sourced (three): the row's own label-role text, if the table has
    one; each FK target's label-role text (§DI8); and the mapped number
    column's header text.** All three arrive from a refresh's incoming
    paste and go through the plain two-way base/incoming compare in §DI11 —
    none of them can ever have a `local` divergence of their own, since none
    is a directly user-editable field anywhere except through the composed
    Parameter label itself.
  - **Loop-Studio-local (one): the table's own display `label` (§DI5).**
    This never comes from the sheet at all — it's metadata the user typed
    when configuring the import binding — so there is no base/incoming pair
    to diff; recomposition happens immediately whenever the user renames the
    binding, not gated behind a refresh.
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

### Row existence, then per-cell state — a two-phase classification (restructured this round: `locally deleted` and `value-changed` were NOT mutually exclusive as one flat list)

A single flat list of "cases," as earlier drafts had, breaks down for a
concrete scenario: stored base `10`, the user deletes the Parameter node
directly on the canvas, and the next paste's incoming value is `25`. That
one `(row, column)` cell is simultaneously "locally deleted" (no node) AND
"value-changed" (`10 → 25`) under a flat classification — ambiguous, with
no principled way to decide whether "recreate from stored base" or "the
number three-way" governs. **Fixed by splitting into two ordered phases**,
so every cell lands in exactly one place:

**Phase 1 — row existence** (`sourceKey` presence, ROW-level, unchanged from
earlier drafts):

1. **Added** — a `sourceKey` in the incoming snapshot with no matching
   stored row for this `sourceTableId`. Shown in the refresh preview as
   `added`. **Materialized only after the user explicitly confirms** — the
   same "validate/preview the whole batch before touching the graph"
   discipline as the first import (§DI7), not a silent auto-add. (Confirming
   several adds at once, e.g. "add all 3 new rows," is a normal UX
   convenience — the underlying rule is that nothing is created without the
   user having seen and accepted it.)
2. **Missing** — a stored row's `sourceKey` is absent from the incoming
   snapshot. **Takes priority over everything in phase 2** — if the row is
   gone from the SOURCE too, it's `missing`, full stop, even if the local
   node also happens to be deleted (that combination is not a special
   third thing; the source-side absence already answers the question).
   **Never auto-deleted.** Shown as `missing from source`; the user
   explicitly picks, per row (or per batch):
   - **unlink** — keep every Parameter generated from this row exactly
     as-is (values, labels, positions untouched), but clear ALL THREE of
     §DI9's fixed set together, atomically: every affected Parameter's
     generating triple, the row's entire stored base projection, and any
     other linkage bookkeeping — so it becomes ordinary hand-owned data no
     future refresh will touch again, AND the same `sourceKey` reappearing
     later correctly registers as `added`, not as an already-known row, or
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
4. **Present** — the `sourceKey` exists on both sides. Proceed to phase 2,
   independently, for every one of this row's mapped columns — a
   `number`-role column per the rules below; a `label`-role or
   `foreignKey`-role column per its own separate mechanism (§"Label
   composition," next) — all processed in the SAME refresh batch, and one
   cell's outcome never blocks or alters another's.

**Phase 2 — per `number`-role cell, only for a `present` row:**

5. **Node exists** (a Parameter carries this cell's `(sourceTableId,
   sourceKey, sourceColumnId)` triple) → runs the ordinary
   base/local/incoming three-way below, unaffected by whether the row's
   OTHER cells are in a different state.
6. **Node doesn't exist — `locally deleted / detached`** (the user deleted
   the Parameter directly on the canvas, through ordinary node deletion,
   entirely outside this feature's own `unlink`/`delete` flow; detected by
   finding zero Parameters carrying this cell's triple while a base
   projection for it still exists). **Never silently recreated** — that
   would violate this doc's own repeated "never silently regenerate
   something the user might have touched" stance (GSA4, §DI-D4, §DI-D12).
   Not a three-way at all (there is no `local` — the node is gone). The
   user explicitly picks, per cell:
   - **recreate** — materialize a fresh Parameter (a new id — the deleted
     node's original id is simply gone; Loop Studio's own Undo, if the
     deletion is still on that stack, is a separate, unrelated recovery
     path outside this feature's scope) using the CURRENT incoming value,
     **and moves this cell's stored base to that same incoming value** — the
     new Parameter starts with base and value in sync, exactly like a fresh
     first-time import, or
   - **discard the link** — remove this ONE cell's base-projection entry
     (not the whole row's, unless every one of its number columns is in
     this state) so future refreshes stop asking about it.

   **Per-cell, not per-row, granularity matters specifically because a row
   can have more than one `number`-role column** (none of this doc's
   worked-example tables do, but the mechanism must not assume otherwise):
   deleting only ONE of a row's several generated Parameters on canvas puts
   only THAT cell into `locally deleted` — the row's other still-existing
   Parameters are untouched and run phase 2's node-exists path normally.

### Label composition has a different diff unit than a number (corrected this round — draft 3 wrongly said "the exact same rule")

Draft 3 claimed a `label`/`foreignKey`-role column "follows the exact same
rule" as a number. **This doesn't hold up**, for a reason specific to how a
label is built: a generated Parameter's label is composed from **four**
constituents (§DI10, corrected this round — draft 4 only named two): the
row's own label-role text if the table has one, each FK target's
label-role text (§DI8), the mapped number column's header text, and the
table's own display `label`. None of the first three is itself a
directly-editable field anywhere in Loop Studio — `Items`/`Banners` are
pure-lookup tables (§DI4) with no `number`-role column, so they never
become Parameters a user could hand-edit, and a column header is display
text, not a graph field. There is no possible `local` divergence for any of
them; the ONLY place local hand-editing can happen is on the **composed
Parameter's own label field**, in the Inspector. (The fourth constituent,
the table's own `label`, is different again — see below.)

This needs two separate, simpler mechanisms instead of one three-way table:

1. **A sheet-sourced constituent's text change is a plain two-way compare,
   always auto-appliable, never a conflict** — `base` vs. `incoming` for
   `Items.itm_blade_ssr.display_name`, or for `Banners.premium_pickup
   .banner_name`, or for the `weight` column's own header text under an
   explicit "same column, renamed" remap (§DI9). If any changed, recompose
   every Parameter label that draws on it.
2. **The table's own display `label` recomposes immediately on rename, no
   diffing at all.** It never comes from the sheet (§DI5), so there is no
   `base`/`incoming` pair for it — the moment the user renames the import
   binding, every Parameter with `labelAutoComposed: true` that draws on it
   is recomposed right away, independent of any refresh.
3. **Whether either kind of recomposition actually touches the Parameter's
   label is gated by one stored flag: `labelAutoComposed` (default `true`
   at creation).** The moment a user directly edits a generated Parameter's
   label in the Inspector, `labelAutoComposed` flips to `false` — a
   permanent detach, mirroring "never silently clobber a hand edit"
   everywhere else in this doc. **The label edit and the flag flip are one
   atomic change** (§DI-D19, new this round) — a single Undo restores both
   the old label text and `labelAutoComposed: true` together, never one
   without the other. While `true`, a constituent change recomposes and
   applies the new label with no prompt (there is nothing to conflict with —
   the label was never independently edited); a table-rename cascade
   touching many Parameters at once is likewise one atomic Undo entry for
   the whole batch, not one per Parameter (§DI-D19). While `false`, a
   constituent change is **skipped** for that Parameter and surfaced only as
   an FYI line in the refresh summary ("3 upstream names changed but these
   Parameters' labels are customized — not updated"), never a per-row
   prompt.
4. **A foreign key's VALUE changing (the row re-points to a different key,
   not just that the pointed-to row's own text changed) is treated as its
   own, always-surfaced case — never auto-applied, regardless of
   `labelAutoComposed`.** `ppe_pickup_blade_ssr.item_key` changing from
   `itm_blade_ssr` to `itm_blade_sr` means this row is now conceptually
   ABOUT a different item, not a cosmetic rename. Base-movement and
   placement rules, fixed this round (mirroring §DI11's number three-way and
   §DI-D12's group-by scoping exactly, rather than inventing a third
   pattern):
   - **accept the re-point** — the FK's stored base moves to `incoming`;
     the label recomposes from the new target, but ONLY if `labelAutoComposed`
     is still `true`;
   - **reject the re-point** — the FK's stored base stays at its OLD value,
     so the SAME disagreement surfaces again on every future refresh until
     either the source reverts or the user accepts it (this is the one
     place base does NOT move on a resolved choice, unlike the number
     three-way's "keep mine" — rejecting an FK re-point is "not yet
     decided," not "acknowledged, staying different");
   - **either way, the already-existing node's frame and position are never
     touched** — this is the SAME rule §DI-D12 already states for a changed
     "group by" *setting*, extended here to cover a changed "group by" *FK
     value* on an existing row too: only a node materialized fresh after
     accepting the re-point would ever be grouped/framed under the new
     relationship.

### The complete base/local/incoming three-way — `number`-role columns only (corrected this round — one case and all base-movement rules were missing)

```
base     = the stored value at last import/refresh
local    = the Parameter's current data.value — may have been hand-tuned
           since (label text is NOT this — it has its own mechanism above,
           corrected this round: draft 4 still described `local` as
           covering "a generated label's current text" too, left over from
           before the label mechanism was split out)
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

### Removed-column defaults, per role (new — Phase 2 implementation-time addendum, approved)

A refresh can find that a previously-mapped column's header is simply gone
from the new paste. §DI9/§DI-D7 already say a missing header is resolved
explicitly (rename to a different-looking incoming column, or confirmed
removed) — never inferred — but never stated what happens to that column's
existing data once removal is confirmed. Settled per-role, since each role
owns different data and a different downstream effect:

- **`key`** — **cannot be removed.** A missing key-column header MUST
  resolve via an explicit rename to one of the incoming columns; the row's
  identity cannot simply vanish. A refresh stays blocked while a missing
  key column is unresolved.
- **`number`** — bulk-**unlink** (never delete) every Parameter this
  column generated — the same atomic triple/`labelAutoComposed`/base
  clearing §DI-D16 already defines for a single row's unlink, applied to
  every row's cell under this column in one step — then drop the column's
  own entry and every row's base under it. Affects only this table's own
  Parameters; a `number`-role column has no label-composing role.
- **`label`** — drop the column/base (a `label`-role column never owns a
  Parameter, so there is nothing to unlink), then **recompose** every
  Parameter whose auto-composed label drew on it — both this table's own
  Parameters AND any OTHER table's Parameters that reach this table via an
  FK (§DI10's label composition resolves a target row's own `label`-role
  text, so losing it changes what a dependent's FK resolution reads too).
- **`foreignKey`** — drop the column/base (again, nothing to unlink), and
  if this column was the table's group-by pick, **clear the group-by
  setting too** rather than leave it pointing at a column that no longer
  exists. Recompose is scoped to **this table's own Parameters only** — a
  label composition never chases a target row's own FK columns
  transitively, so losing this table's outgoing FK column cannot change
  any OTHER table's labels.
- **In every case**: an existing node's `position` and placement relative to any frame (frames store no membership — §LGR6.5)
  are never touched — a column removal only ever edits `data` fields and
  the stored table record, the same "never silently move or regenerate
  something the user might have touched" stance this doc keeps throughout
  (GSA4, §DI-D4, §DI-D12).

### A `missing` lookup row still referenced elsewhere refuses unlink/delete (new — Phase 2 implementation-time addendum, approved)

§DI-D9's reference scanner only sees the live GRAPH (expressions and
edges) — it cannot see that another STORED import table's row still
FK-references the very key about to disappear (e.g. `Items.itm_blade_ssr`
missing from a fresh `Items` paste while `GachaPoolEntries` still has a
row whose `item_key` cell is `itm_blade_ssr`). This is a separate,
data-model-level dependency check, run in addition to the graph scan:
a `missing` row with any other stored table still pointing at its key
**refuses both `unlink` and `delete` outright**, naming which table(s)
must be refreshed first. Never silently orphans a live cross-table
relationship stored in a table the current refresh isn't even touching.

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
'GachaPoolEntries,'ppe_pickup_blade_ssr,'weight,10,25
'Packages,'pkg_whale,'price_krw,49900,59900
```

(the leading `'` on every text field is §DI12.3's unconditional
formula-injection guard — always present, never conditional; `previous_value`/
`new_value` are numeric and carry none)

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
controlled node-label vocabulary. Requirements, settled here rather than
left to an implementation PR's discretion — **expanded this round from
"UTF-8" alone to the full Windows/Excel-compatible shape actually
requested**:

- **UTF-8 with a BOM** (`﻿` as the file's first three bytes) — plain
  UTF-8 with no BOM is exactly the case Excel on Windows is known to
  misinterpret (reads non-ASCII text as the system codepage instead), the
  opposite of what a designer pasting Korean/Japanese item names back into
  their sheet needs.
- **CRLF line endings** (`\r\n`), not a bare `\n` — the other half of
  practical Windows/Excel compatibility alongside the BOM.
- **Proper RFC 4180 quoting, not the naive "strip the problem characters"
  approach.** A value containing a comma, a double quote, or a newline is
  wrapped in double quotes with internal quotes doubled — never replaced
  with a space (which would silently corrupt a `source_key` that
  legitimately contains one of those characters).
- **CSV/formula-injection guard — applied UNCONDITIONALLY, to every text
  field, not just ones that "look dangerous" (corrected this round — the
  conditional version was ambiguous to reverse).** A cell that a spreadsheet
  app would interpret as a formula or command when the exported file is
  later opened — one starting with `=`, `+`, `-`, `@`, a tab, or a carriage
  return (the well-known CSV-injection character set) — is neutralized with
  a leading `'`. The previous rule ("only add `'` to values that need it,
  strip a leading `'` on read") is **not losslessly reversible**: a real
  `source_key` that itself genuinely starts with `'` becomes indistinguishable
  from a protected one, and a naive reader can't tell which values were
  ever prefixed at all without re-deriving the same "is this dangerous"
  judgment the writer made. **Fixed: every text field
  (`source_table`, `source_key`, `source_column` — never the numeric
  `previous_value`/`new_value` columns, which need no such guard) gets
  EXACTLY ONE leading `'` prepended, always, whether or not the value would
  otherwise look dangerous.** This matters specifically because §DI12.2's
  whole purpose is for a designer to **paste this export straight back into
  their own spreadsheet** (DI2) — an un-neutralized `source_key` that
  happens to start with `=` would execute as a formula (or worse) the moment
  it lands there, a real, not theoretical, risk given `source_key` is
  arbitrary designer-chosen text.
- **This makes recovery trivial and lossless, not just "safer."** Any
  machine reader needing the exact original value strips **exactly one**
  leading `'` from every text field, unconditionally — no per-value
  judgment call, no ambiguity about whether a given `'` was original data or
  the guard, because the guard is now always present exactly once. (The
  spreadsheet-paste path needs nothing extra: a spreadsheet app already
  treats a leading `'` as "literal text, don't evaluate" and hides the mark
  on display, which is exactly the wanted behavior either way.) A
  considered alternative — a separate boolean column recording whether the
  guard was applied per field — was rejected as needless complexity (one
  extra column per protected field) once the always-prefix rule makes that
  bookkeeping unnecessary.

## DI13. Serialization / revision-digest impact

A new provenance shape (sketch, per DI11 — expanded this round beyond a bare
numeric base):

- per table: `sourceTableId`, `label`, column-role config (each column's
  `sourceColumnId`, role, and current header text),
- per imported row: `sourceKey`, and the stored base projection —
  `{ number: Record<sourceColumnId, number>, label: Record<sourceColumnId,
  string>, foreignKey: Record<sourceColumnId, sourceKey> }`,
- per generated **Parameter**: its generating triple —
  `{ sourceTableId, sourceKey, sourceColumnId }` (§DI9's fix this round —
  the pointer a refresh uses to find this node again; absent after
  `unlink`) — and `labelAutoComposed: boolean` (§DI11's label-composition
  fix, also new this round).

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

**Settled at Phase 1A implementation time (§DI16): this is `loop-revision/8`
(`SEMANTICS-R8.md`).** A fresh `SideVersion`, a `dataImports` top-level
`CanonicalContent` key (mirroring `frames`' `loop-revision/5` graph-array
shape), a trailing `MODEL_NODE_FIELDS.parameter` row for the four fields
above, and a `serialize.ts` allowlist entry — following the exact pattern
`SEMANTICS-R5.md` / `SEMANTICS-R6.md` already set, verified directly against
the real `src/model/revision.ts` code rather than assumed, the same
discipline `docs/parameter-activator.md`'s `loop-revision/7` (proposed, then
found unnecessary after checking the real code) is this project's own
cautionary precedent for.

These fields are **not** `cosmetic` like `frames`/`route`, nor `engine` like
`timing`/`when`: they change nothing the engine computes, but they are real
document content that changes the *meaning* of a future refresh (Phase 1B),
a materially different claim than a purely presentational overlay. They get
their own field tag, **`provenance`** (`FieldTag` in `src/model/revision.ts`).
Version inference is by **presence, not validity** — an incoherent partial
generating triple, or a `dataImports` entry with zero referencing
Parameters, is still `loop-revision/8` content, never silently normalized
back to a plain document. `loop-workspace/1` is unaffected (provenance is
not a real input to what a run computes).

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

### DI-D12 — neither a changed "group by" SETTING nor a re-pointed group-by FK VALUE ever retroactively moves an existing node (scope broadened this round)

DI-D11 fixed the AMBIGUITY of picking a group-by FK; this closes two related
follow-up questions with the SAME rule. **Settled: only a node materialized
AFTER the change is ever grouped/framed under it** — any node/frame already
on the canvas keeps its existing position (and so its placement relative to any frame — frames store no membership, §LGR6.5), regardless
of either:

- the **"group by" SETTING** changing later (a reconfiguration, or choosing
  differently on a fresh separate import of the same table), or
- the **specific FK VALUE** a group-by column actually holds being
  re-pointed on a refresh and accepted (§DI11's label-composition fix,
  item 4) — accepting `ppe_pickup_blade_ssr.banner_key` changing from
  `premium_pickup` to `premium_standard` updates the stored data and, if
  still auto-composed, the label, but does **not** move that node into a
  different banner's frame.

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

### DI-D14 — the change-proposal CSV is UTF-8-BOM/CRLF, RFC 4180-quoted, and formula-injection-safe (scope widened this round)

Settled requirements for the one export this doc actually builds from
scratch (§DI12.3), widened from "UTF-8" alone to the full
Windows/Excel-compatible shape: **UTF-8 with a BOM**, **CRLF line endings**,
proper comma/quote/newline RFC 4180 quoting (never "strip the character"),
and pasting this export back into the source sheet is the export's entire
purpose (DI2), so a formula-injection guard on its text fields is required,
not optional — see DI-D18 for exactly how (unconditional, not
value-dependent — this round's own correction to what was first proposed
here).

### DI-D15 — exactly one active Parameter per generating triple (new this round)

`(sourceTableId, sourceKey, sourceColumnId)` identifies at most one ACTIVE
Parameter at any time. Copying, duplicating, or module-extracting a
triple-carrying Parameter strips BOTH the triple and `labelAutoComposed`
from the copy (corrected this round — dropping only the triple would have
left a "fully ordinary Parameter" with a field plain Parameters never have)
— only the original stays bound. A document ever found with two Parameters
sharing one triple is a data-integrity error: refresh blocks for that
specific triple and surfaces it, rather than silently updating both (§DI9).

### DI-D16 — unlink clears the node triple, the row's base projection, and its linkage together, atomically (new this round)

Corrects a real contradiction: storing the triple ON the Parameter (§DI-D15
above, rev 5) made "unlink removes the node's pointer" alone insufficient —
the row's base projection, stored separately in the table's import-source
record, would survive and make the same `sourceKey` register as an
already-known row (not `added`) on a later refresh. All three clear
together as one operation (§DI9, §DI11).

### DI-D17 — row existence and per-cell state are two SEPARATE phases, not one flat list; `locally deleted` is phase 2, never confused with `missing` (corrected this round)

A Parameter deleted directly on the canvas (outside this feature's own
unlink/delete flow) while its source row and stored base survive is neither
`added` nor `missing`. Originally added to a flat 5-case list alongside
`value-changed` — but that made the two NOT mutually exclusive (a cell can
be both "locally deleted" and "its incoming value differs from base" at
once, with no principled tiebreak). **Fixed: two ordered phases.** Phase 1
classifies the ROW (`added` / `missing` / `present`) from `sourceKey`
presence alone — `missing` wins outright if the row is gone from the
source, regardless of whether the local node also happens to be deleted.
Only a `present` row proceeds to phase 2, which classifies each
`number`-role CELL independently: a Parameter still carrying the cell's
triple runs the ordinary three-way; no Parameter carrying it is
`locally deleted` (never silently recreated — the user explicitly picks
recreate, moving base to the current incoming value in the same step, or
discard-the-link). Tracked per `(row, column)` cell, not per row, since a
row can have more than one `number`-role column and only one of its
generated Parameters might be the one a user deleted (§DI11).

### DI-D18 — the change-proposal CSV's formula-injection guard is applied unconditionally, to every text field, for lossless reversibility (new this round)

Corrects DI-D14's original "only guard values that look dangerous" framing:
that version can't be losslessly reversed (a real `source_key` that
genuinely starts with `'` is indistinguishable from a protected one).
Fixed: every text field (`source_table`, `source_key`, `source_column`) gets
EXACTLY ONE leading `'` prepended, always — never conditional on whether the
value "looks" dangerous. A machine reader strips exactly one leading `'`
from every text field, unconditionally, with zero ambiguity. A considered
alternative (a separate boolean column recording whether the guard applied)
was rejected as unneeded complexity once the always-prefix rule makes it
moot (§DI12.3).

### DI-D19 — a label edit + its `labelAutoComposed` flip, and a table-rename recompose cascade, are each one atomic Undo entry (new this round)

Two related Undo-contract commitments, settled here rather than left
implicit: (1) hand-editing a generated Parameter's label and flipping
`labelAutoComposed` to `false` happen together as one change — a single
Undo restores both the old label text AND `labelAutoComposed: true`
together, never one without the other. (2) Renaming an import binding's
table `label`, which can recompose MANY auto-composed Parameters' labels at
once (§DI10's 4th, Loop-Studio-local constituent), is one atomic Undo entry
for the whole cascade, not one entry per affected Parameter — mirrors the
"one atomic commit, one undo" discipline already required for the first
multi-table import (§DI-D10) and Insert module's own precedent.

### DI-D20 — a removed column's Parameters and recompose scope are settled per role (new — Phase 2 implementation-time addendum, approved)

Restates the "Removed-column defaults, per role" subsection above as a
decision: `key` cannot be removed (rename only); `number` bulk-unlinks its
own Parameters; `label` drops + recomposes both its own table and any
dependent table (an FK resolution reads a target row's `label`-role text);
`foreignKey` drops + recomposes only its own table (never a dependent —
label composition never chases a target row's own FK columns
transitively). An existing node's position (and so its placement relative to any frame — frames store no membership, §LGR6.5) is never
touched by a column removal, in every case.

### DI-D21 — a `missing` row still FK-referenced by another stored table blocks unlink/delete (new — Phase 2 implementation-time addendum, approved)

Restates the "still referenced elsewhere" subsection above as a decision:
this is a data-model dependency check, separate from and in addition to
§DI-D9's graph-reference scanner. A `missing` row with any other stored
table still pointing at its key refuses both `unlink` and `delete`,
naming which table(s) need refreshing first — never silently orphans a
cross-table relationship stored outside the table currently being
refreshed.

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

## DI17. In-tool onboarding (shipped after v0.11.0)

The audit of 2026-09-19 (Hanrim) found the wizard's rules complete but its
guidance absent: nothing said what the feature creates, that a Key column is
required, why `4,900` is not a number, or how many Parameters would appear.
This section records what the wizard now carries so the strings and states
have one home. Presentation only — no validation rule, wire shape,
`loop-revision/8` id, or engine behaviour changed.

- **Quick start** (`import.qs.*`): a collapsible block at the top of the
  input step — the outcome in one line, the three-sentence mental model, the
  three-row `Items` example, its role mapping, `2 rows × 2 Number columns = 4
  Parameters`, **Use this example** (idempotent: reuses an existing example
  card, fills an empty card in place, otherwise adds one — never past
  `DI_TABLES_MAX`, never over a filled card), **Download sample CSV**, a
  secondary **Full guide ↗** link to [`import-guide.md`](import-guide.md),
  and two `<details>`: getting data out of Sheets/Excel (with the "never
  Publish to web" rule from §DI3) and what is not imported (formulas: only
  each cell's current calculated value arrives). Collapsed state lives in
  `localStorage` `loop-studio/import-quickstart/1` as `{ collapsed,
  explicit }`: the header toggle is an explicit choice; the first successful
  import collapses it only when the user never toggled it. **Data ▾ → How to
  prepare a spreadsheet…** opens the wizard with the block forced open
  without touching the stored state. Bump the key's trailing number to reset
  everyone after a copy revision.
- **Role help** (`import.roleHelp.*`): rendered once per dialog; every role
  `<select>` carries `aria-label` "Role for column {header}" and
  `aria-describedby` pointing at its current role's line.
- **Count line** per table (`import.status.*`), computed by
  `previewDraftCounts` before validation; after validation every number the
  placement and review steps show — and the commit itself — comes from ONE
  pure `summarizeImportPlan(plan, placementKind)` in `dataImportCommit.ts`
  (`buildImportCommit` materialises exactly its `cells`; the review's label
  preview uses the same `cellLabel`). `dataImportSummary.test.ts` pins that
  the preview, the summary, and the created node count agree.
- **Inline errors**: there is no separate error step any more. A failed check
  keeps the input on screen, renders a focused `role="alert"` summary, lists
  each table's problems under its card as buttons that reveal the offending
  cell (`.is-bad` + `aria-invalid`), and names the header and the offending
  value (display-formatted: 40 code points then `…`, control characters as
  visible glyphs — `detail.value` stays raw). Any edit after the check marks
  the list **stale** (no `aria-invalid`, no warning colour, "press Next to
  check again") until Next re-validates.
- **Post-commit view**: select ONLY the first created Parameter; frame the
  created batch's rect (positions + `NODE_W`/`NODE_H`, no DOM measurement)
  inside the usable canvas via the shared `viewportForRect`
  (`src/components/canvasFit.ts`, the same function the Template initial
  view uses) with `IMPORT_FIT_FLOOR` / `IMPORT_FIT_CEIL` /
  `IMPORT_HINT_INSET_TOP` (the top-center hint slot; measured values 0.5 / 1 / 88 px — the slot at its tallest, a three-line note plus the 15 px panel margin, on the 1280×800 e2e viewport). A batch too large for
  the floor is never shrunk further — the view anchors its top-left corner at
  the floor zoom. The one-shot `import-first-commit` canvas hint (tier 1 in
  `contextual-inline-help.md` §CIH2.3a, above the auto-frame suggest note)
  reads the batch from `uiStore.lastImportBatch`, which the wizard clears on
  its next open. Complexity: one pass over the created nodes; the measured
  round-trip for 1,200 rows × 2 Number columns is recorded in the PR, and the
  theoretical maximum (64 × 20,000 × 128) is not claimed to be fast.
- **Menu wording**: `Data ▾` stays; its items read *Import spreadsheet values
  as Parameters…*, *Refresh or manage imported tables…*, *How to prepare a
  spreadsheet…*.
- **Out of scope, recorded**: a summary-row heuristic warning; mobile
  editing (the wizard stays desktop-only, `mobile.md` §MV1).
- **Tests**: `e2e/data-import-guide.spec.ts` (element captures
  `data-import-quickstart` / `data-import-inline-errors` under the `element`
  policy — the only two baselines this added; the 46 existing ones are
  untouched), `dataImportSummary.test.ts`, `canvasFit.test.ts`,
  `quickStartStore.test.ts`.
