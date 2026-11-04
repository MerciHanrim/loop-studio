# SEMANTICS-M4 — `loop-model/4`: units and the step length

Status: normative for a document whose `schema` is `loop-studio/graph/4`. Issue #471, U1 stage 2; design record `units-display-design.md` rev 6 (decided 2026-11-03). Extends SEMANTICS-M3.md (the kinds table and per-kind conservation). Numbering continues the model-semantics axis: `loop-model/1` → `/2` → `/3` → `/4`.

## M4-1. What a document declares

A kind in the table (§M3-1) may carry two unit lists, and the document may carry a top-level `time`:

```json
"kinds": [
  { "name": "water", "conserved": true, "baseUnit": "m³",
    "units":     [{ "name": "L", "factor": "0.001" }],
    "rateUnits": [{ "name": "MLD", "factor": "1000", "per": "d" }] }
],
"time": { "step": { "value": 1, "unit": "h" }, "display": "d" }
```

- An **amount unit** `{ name, factor }`: one `name` is `factor` base units. A stock or a rate may be authored in it.
- A **rate unit** `{ name, factor, per }`: one `name` is `factor` base units per `per` (`s`, `min`, `h`, `d`). Only a rate may be authored in it, and only once the document declares a step length.
- `factor` is a positive plain decimal of at most 15 significant digits in the **runnable range 10⁻¹⁵ … 10¹⁵**, kept as TEXT in its shortest exact form (`1000.0` is written `1000`). The range is checked where a declaration is read and where one is committed in the Kinds panel (the same read): `1e400` is a valid 15-digit decimal, but no engine value scaled by it is finite. Inside the range, a factor times the largest step ratio (10⁶ days over 1 s) leaves every authored number below 10²⁸⁰ finite. A `name` is trimmed, NFC, at most 32 UTF-8 bytes, and may not contain `/`, which separates an amount unit from a time unit in a field's unit text (`L/min`).
- **Defensive read**: a bad entry is dropped; names are unique across both lists and apart from the base unit (the base unit's name wins, then file order); an empty list is no key.
- `time.step` is the **step length**: `value` an integer 1…10⁶, `unit` a time unit. It is a model fact. `time.display` is the time unit aggregate panels show rates per; it is presentation. Anything else is no `time` at all.
- **Version boundary.** A unit list, a `time` or a field `unit` (M4-2) is written only on `loop-studio/graph/4`; writing one at a lower version is refused, never silently dropped. None of them is read from an earlier schema. An older app fails closed on `/graph/4`. Declaring a unit list, a step length or a field unit promotes the document, one-way; a module insert that would promote asks first (§MS3.4). **M4-INV-1:** a document with no unit list, no `time` and no field unit computes, byte for byte, what it computes under `loop-model/3`, and its projection and digest are `loop-model/3`'s apart from the discriminator.

## M4-2. Authored values and engine values (invariant S′)

1. A Pool's `initial` and `capacity`, and a resource connection's constant `flow`, keep what the person typed: the **authored decimal** and the field's **`unit`** (`"L"`, `"L/min"`, `"MW"`; absent = the base unit, per step for a rate). The file stores exactly that.
2. **Resolution, fail-safe.** A field's unit resolves against its kind's lists and the step length. An unknown name, a rate unit or a per-time unit on a stock, and a per-time or rate unit without a step length all read as the base unit: the number then means what every earlier document meant by it, never a silently scaled amount.
3. **The engine value** is the nearest double of the exact rational `authored × factor × S ÷ T`, where `S` is the step length in seconds and `T` the seconds of the unit's time (`S ÷ T` = 1 for an amount per step). It is derived when the engine reads the graph and is never persisted. Only a plain decimal is converted: a percent, `all`, a random form or a `@param` reference is read as it is, and a Parameter's value has no unit.
4. `step()`, Monte Carlo and the engine revision (4) are unchanged: they read the derived graph.
5. **Out of range.** A field whose engine value is not finite (an authored number near the double's limit in a large unit) is an `outOfRange` finding. It always refuses the run, whether or not a kind is conserved, as the kinds findings do (§M3-4): Play, Step and Monte Carlo do not start, and `step` returns the unchanged state with a diagnostic.

## M4-3. The step length

A step change moves the amount per step of every field authored per time unit, and of no other field. It can therefore change a balance verdict only at a Converter whose connections mix per-time and per-step rates; the change names those Converters and waits for consent before it is applied (M4-4).

## M4-4. Changing a unit, a step length or a factor

- **A unit change of a non-empty field** re-expresses the authored value through exact rationals. When the result terminates within 15 significant digits it is applied at once: the same rational, so the engine value and every verdict are unchanged. Otherwise nothing is applied until the person confirms: the sheet shows the exact value as far as it goes, the 15-digit value that would be stored and its deviation in the base unit (all under M4-5), and the Converters whose verdict would change. There is no "keep the number" action. Cancel leaves the field as it was.
- **A step-length change** that changes any Converter's verdict lists those Converters first and is applied only on consent. One that changes none is applied at once.
- Every applied change is one undo entry.
- **A module insert never changes what a field means** (§MS3.4). It is refused, with the reason, when:
  - the module and the document declare different step lengths (compared in seconds, so 60 min = 1 h);
  - a kind both declare has two different base units;
  - a unit name both declare has a different factor, a different time, or sits in the other list.

  Otherwise the module's units that the document does not name join the document's kind, and a side with no step length takes the other's. As a backstop, every field's engine value after the insert, the document's and the module's alike, must equal the one it had in its own document; if any differs, the insert is refused. A selection saved from a document with a step length carries that step length, so the comparison can be made.

## M4-5. C1 exact, and what a surface prints (R≈)

- **Balance (D4).** The C1 test of §M3-3 is exact: every computable rate is its authored decimal times its unit's ratio to the base unit per step, as a rational, and `Σ in = Σ out` must hold exactly — no epsilon, no double. This supersedes the `1e-9` tolerance of §M3-3 for every version: `0.1 + 0.2 = 0.3` balances, `100 = 50 + 55` breaks by exactly 5. A resolved `@param` takes part at its value, in the base unit.
- **R≈.** A verdict is taken from the rational, never from printed text. A surface prints a value's exact decimal when it terminates, otherwise `≈` and 15 significant digits, always in plain digits (never an exponent). An approximation is never labelled exact. Authored field text never carries `≈`.
- **An engine value on screen.** A surface that re-expresses an engine value in a field's unit (the Properties panel's current amount of a Pool) takes the double's exact binary value in that unit. It shows at most 15 significant digits and adds `≈` exactly when the shown text is not that value. After 720 steps of 1000/24 m³, the engine's 1699.999999999984 m³ shows as `≈ 1699999.99999998 L`; an exact 200 m³ shows as `200000 L`. The stored value and every verdict are untouched. A Pool in the base unit keeps the node's two-decimal format.

## M4-6. Exports (D6)

- **CSV**: numeric cells stay numbers, in the base unit per step; the header names the unit (`feed [m³]`).
- **JSON**: numbers stay numbers, and a `units` object names each unit once. The document itself stores the authored decimal and its `unit` key.
- No export turns a computed number into a string by prefixing `≈`.
- **A document that names no unit** writes every export as it always did, byte for byte. A Pool's unit is its kind's `baseUnit`; a Pool of no kind, or of a kind with none, names no unit, and a file may hold both.

Each export applies this as follows.

| Export | The unit |
|---|---|
| Timeline run CSV | in the column name, before the node id: `feed [m³] [pool_1]`. The last bracket is always the id (DI-D19) |
| Monte Carlo runs CSV | in the column name: `feed [m³]` |
| Monte Carlo series and summary CSVs | a `unit` column after `pool`, because one header serves every Pool in these long files |
| Monte Carlo JSON | a top-level `units` object by node id, because labels may repeat, after `engineRevision`. It is left out when no unit is named. The `loop-mc/1` fields do not change: `final` and `series` stay numbers |

**The step length of a Monte Carlo JSON is `config.time.step`.** That path is the one source: the run's own input, written with the result, and absent when the document declares no step length. `config.time.display` beside it is presentation. No other key repeats it.

**A re-expressed or difference value.** No export holds one: every number above is the engine value in the base unit. The columns and fields that would carry one, with the R≈ text and an approximation flag kept apart from the number, are designed with the Timeline's view-unit conversion, together with the value shown on screen.

## M4-7. Where it lives

- Model: `src/model/rational.ts` (exact decimals, R≈), `src/model/units.ts` (the reads, field-unit resolution, the engine value, the unit-change preview), `src/model/engineValues.ts` (`applyUnits`, the derived graph; `stripFieldUnits`), `src/model/kinds.ts` (`readKindsAt`, the exact C1, `convertersWhoseVerdictChanges`). Engine: `src/engine/step.ts` and `montecarlo.ts` read the derived graph; the findings read the authored one.
- File: `time` after `kinds`, field `unit` keys trailing on Pool and resource-connection data. Projection and digest: the unit lists ride their kind entry, `time` follows `kinds` with `step` only, field `unit` keys are projected — all at version 4 only.
- UI: the Inspector's unit select on a Pool and on a resource connection, and its confirm sheet; the Kinds panel's unit lists and step-length row, which the Inputs tab shows for any graph that names or declares a kind.
- Exports: `src/model/exportUnits.ts` (the table of a document's Pools, the JSON header); the writers are `src/components/timelineCsv.ts` and the exports of `src/engine/montecarlo.ts`.
- Pins: `src/model/units.test.ts` (rationals and R≈, the reads and the factor range, resolution, engine values and the out-of-range refusal, unit changes, exact C1, module inserts, the `/graph/4` boundary and M4-INV-1), `src/model/kinds.test.ts`, `src/engine/kinds.test.ts`, `src/model/exportUnits.test.ts` (M4-6, and the readers of a result file); in the browser, `e2e/units.spec.ts` (the confirm sheet's cancel, confirm and undo, an exact change, the step-length sheet) and `e2e/desalination.spec.ts` (the real downloads).
- Not in this stage: the Timeline's view-unit conversion, and with it the export of a re-expressed value, is a separate kickoff.
