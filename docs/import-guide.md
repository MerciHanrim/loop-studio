# Importing spreadsheet values as Parameters — user guide

Bring the numbers you already manage in Excel, Google Sheets, or any other
table into Loop Studio as adjustable simulation **Parameters**. When the
source table changes, import a new snapshot and review the differences before
applying them.

Everything in this guide is also available inside the app: **Data ▾ → How to
prepare a spreadsheet…** opens the import dialog with its quick start, a
one-click example, and the role help. You never need this page to complete an
import; it collects the same rules in one place.

## Is my table suitable?

If your work can be written as **rows with a stable unique ID and one or more
numeric values you want to adjust or compare**, it imports. Examples:

- game balance — prices, damage, cooldowns, drop rates, gacha weights;
- service operations — capacity, processing time, staffing, conversion rates;
- content operations — cost, duration, reward amounts, publishing frequency;
- business / economic models — unit cost, selling price, fees, inventory;
- research / education — initial values, limits, coefficients.

## What the import creates — and what it does not

- Every column you mark **Number** creates **one Parameter per data row**.
  One row with two Number columns creates two Parameters.
- A **Label** column contributes the human-readable part of each generated
  Parameter's name (`Items · Steel Sword · price`).
- A **Foreign key** column links a row to a Key in another imported table, so
  the other table's Label enriches the name, and can group frames.
- The importer does **not** turn each row into a domain node and does **not**
  infer a simulation. Connecting the Parameters into your model (a Register
  expression, a connection's flow field, an Activator) is your step
  afterwards: type `@` in a Register expression and pick the Parameter by
  name.
- Nothing is uploaded anywhere, and your spreadsheet is never written to. The
  change-proposal CSV export is the manual way back to the source.

## A minimal example

```csv
item_id,item_name,price,drop_rate
sword,Steel Sword,4900,10
potion,Health Potion,300,25
```

| Column | Role | Result |
|---|---|---|
| `item_id` | Key | Stable identity of each row |
| `item_name` | Label | Human-readable generated name |
| `price` | Number | One Parameter per row |
| `drop_rate` | Number | A second Parameter per row |

2 rows × 2 Number columns = **4 Parameters**. The dialog's **Use this
example** button fills exactly this table; **Download sample CSV** gives you
the same three lines as a file.

## Getting the data out of your spreadsheet

- **Google Sheets** — `File → Download → Comma-separated values (.csv)` for a
  whole sheet/tab, or select a range and copy it, then paste.
- **Excel, Numbers, others** — `Save As` / `Export` to CSV, or copy a range.
- Do **not** use `File → Share → Publish to web` on a private sheet: it makes
  the sheet readable by anyone with the link. A download or a copy keeps it
  private.
- Formulas themselves are not imported — a CSV or a paste only carries each
  cell's **current calculated value**.

## Column roles

| Role | Meaning |
|---|---|
| **Key** | Unique ID used to match this row on refresh. Exactly one per table. |
| **Number** | Creates one adjustable Parameter for every row. |
| **Label** | Name shown on generated Parameters. May be blank (the Key is shown instead). |
| **Foreign key** | Links this value to a row in another imported table (cross-table only). |
| **Ignore** | Keep this column out of Loop Studio. |

A table with only a Key and a Label is a **lookup table**: it enriches the
names in another table and creates no Parameters of its own.

## Input rules the dialog checks

- **Text**: paste CSV or TSV, or upload `.csv` / `.tsv` / `.txt`. There is no
  `.xlsx` reader and no live connection. The delimiter is auto-detected and
  can be overridden; a header row can be chosen; leading title rows and
  trailing summary rows can be excluded with **Header row** and **Ignore last
  N rows**. Quoted fields are supported; malformed quoting is rejected.
- **Key**: every row needs a non-empty Key; keys are trimmed and Unicode
  (NFC) normalised, must be unique, compare case-sensitively (`Item_A` and
  `item_a` differ), may not contain control characters, and are at most 256
  UTF-8 bytes. A link table between two other tables needs its own single
  Key column.
- **Number**: every cell in a Number column must be a plain finite number:
  `4900`, `-3.5`, `.25`, `1e6`. Thousands separators, currency symbols,
  percentages, hexadecimal, `NaN`, and `Infinity` are rejected (`4,900`,
  `₩4900`, `25%` are not numbers). A blank cell is an error, never zero.
- **Foreign key**: a non-empty value must match a Key in the target table;
  blank means "no link". A table with two Foreign key columns must choose
  which one groups its frames.
- **Shape and limits**: every data row needs the same number of cells as the
  header row. Up to 64 tables, 128 mapped columns per table, 20,000 rows per
  table, 200 characters for a table name or header. The whole batch is
  checked before anything is created; problems are listed inline, next to
  the table they belong to, and nothing is imported until they are fixed.

## What is not imported

Formatting, colours, charts, images, macros, workbook layout; formulas as
executable logic; nested or multi-dimensional records that are not flattened
into rows; several values packed into one cell; prose; automatically inferred
nodes, edges, rules, or simulation flow; and any automatic or background
synchronisation with the source.

## After the import

The first new Parameter is selected and the created batch is framed on the
canvas (a very large batch shows its top-left corner rather than shrinking to
a dot). Every value is listed in the **Inputs** panel and can be edited there.
To refresh from a changed spreadsheet later, use **Data ▾ → Refresh or manage
imported tables…**; the design and the full refresh contract live in
[`data-import.md`](data-import.md).
