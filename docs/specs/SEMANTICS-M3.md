# SEMANTICS-M3 — `loop-model/3`: resource kinds and per-kind conservation

Status: normative for a document whose `schema` is `loop-studio/graph/3`. Issue #471; design record `kinds-units-design.md` rev 3 (decided 2026-11-03). Extends SEMANTICS-M.md §M4 (the advisory `resourceType`) and SEMANTICS-M2.md (the model layer). Numbering continues the model-semantics axis: `loop-model/1` → `/2` → `/3`.

## M3-1. The kinds table — what a document declares

A `loop-studio/graph/3` document may carry a top-level `kinds` array:

```json
"kinds": [
  { "name": "water", "conserved": true,  "baseUnit": "m³"  },
  { "name": "power", "conserved": false, "baseUnit": "kWh" }
]
```

- `name` is a **kind**: a `resourceType` as §M4.1 identifies it (trim Unicode white space, NFC, ≤ 64 UTF-8 bytes, case-sensitive). A `resourceType` on a Pool or a connection that is in the table is **declared**; one that is not is **undeclared** and behaves exactly as under `loop-model/2`.
- `conserved` (boolean) opts the kind into per-kind conservation (M3-3). It is **opt-in**: the bundled game economies create and destroy by design, and nothing is conserved because it has a name.
- `baseUnit` (optional string, trimmed NFC, ≤ 32 UTF-8 bytes) is the kind's base unit, which is also its input unit. It is a label: the engine never converts a unit. (Display units with a factor and a step duration are a later stage and are not part of `loop-model/3`.)
- **Defensive read** (`readKinds`): a non-array is no table; an entry that is not an object with a usable name is dropped; the first of two equal names wins; `conserved` is true only when literally `true`; an over-cap `baseUnit` is dropped, not truncated. File order is kept. The table is written in its read form (`canonicalKinds`), so a file never carries an entry its reader would drop.
- **Version boundary.** A document with a kinds table is a new model meaning and is written as `loop-studio/graph/3` (`modelSemantics: "loop-model/3"` in its projection). An older app fails closed on it, as a pre-`loop-model/2` app does on `/graph/2` (§M2-1). A `loop-model/2` document never gains a table by being opened; declaring the first kind is the person's act and promotes the document, one-way, as the first `@` reference promotes v1 to v2 (§M2-1.1). **M3-INV-1:** a `/graph/3` document with no kinds table computes, event for event, what `loop-model/2` computes for the same graph.

## M3-2. K1 — the kind of a connection

Every `resource` connection has exactly one kind, or none, by this resolution (`resolveKinds`), in this order:

1. **A Pool end.** A connection with a Pool end has that Pool's `resourceType`. A connection whose two ends are Pools of two kinds is a **conflict**.
2. **The connection's annotation.** A connection with no Pool end has its own `resourceType` as its kind, when set — the explicit assignment for Converter → Drain / End, Source → Gate, Converter → Gate and router → router lines. On a connection that also has a Pool end the annotation is a note, never the kind: where it differs from the Pool's kind it is a **conflict** (the §M4.3 mismatch, kept with its text), and where that Pool has no kind the connection is undetermined (rule 4).
3. **Propagation through Gates.** A Gate never changes a kind, so all its connections carry one kind. After 1–2, in synchronous rounds to a fixpoint: every Gate carrying exactly one kind offers it to its undetermined connections, every offer of a round reading the state at the round's start. A connection two Gates offer two kinds to in the same round is contested: it stays undetermined, and both Gates carry both kinds from then on. A Gate carrying two kinds is a **conflict** and propagates nothing. The result does not depend on the order of ids: two kinds entering a chain of Gates from its two ends meet at one Gate (the conflict) or on one connection (undetermined, a conflict at both its Gates), never as the kind of a connection the first-visited Gate happened to reach.
4. **None.** A connection none of 1–3 reaches has no kind; it is never of a conserved kind. Converters, Sources, Drains and Ends propagate nothing: a Converter changes kinds by its nature; a Drain or an End may take several kinds.

**A conserved kind is involved** at a node when one of its connections has a determined kind the table marks conserved. Everything that refuses (M3-4) refuses only there.

## M3-3. C1 — per-kind conservation (I1-K)

For each Converter where a conserved kind is involved and each conserved kind `k` among its connections, the balance in `k` is **computable** when every connection of the Converter has a kind and every connection of kind `k` has a numeric rate (a `const`, or a `@param` reference resolved to one — the same resolution `step` performs, §M2-3). When computable it must hold:

```
Σ inRate(k) = Σ outRate(k)      (to 1e-9), deliveries into Drains and Ends counted among the outputs
```

Because every connection of a Converter run scales by the one run fraction `f` (SEMANTICS.md I2), a recipe balanced in rates is balanced in every step and in both modes. **M3-INV-2 (I1-K):** per step and per conserved kind, `Σ Pools(after) = Σ Pools(before) + Source pushes − Drain / End intake`; no net-loss term exists for a conserved kind, and any other difference is an engine defect. A kind not declared conserved is consumed or produced freely. Gates, Sources, Drains, `pull all` / `pull any`, Parameters in rates (checked after resolution) and the run fraction are untouched.

## M3-4. D1 — findings and refusal

`kindFindings` is a pure function of the graph, its kinds table and its model version, in a stable order (every conflict by connection id then Gate id; then per Converter by id: each non-numeric rate by connection id, each connection with no kind, each broken conserved kind). Three classes, each stating the measured fact:

| class | what | refuses when |
|---|---|---|
| **conflict** | two Pool ends of two kinds; an annotation against its Pool; a Gate carrying two determined kinds | one of its kinds is conserved |
| **not computable** | a Converter connection whose rate is not a number (`all`, a percent, a random form, an unresolved reference); a connection with no kind on a Converter where a conserved kind is involved | a conserved kind is involved at the Converter (the no-kind finding exists only then) |
| **broken** | a Converter whose computable balance in a conserved kind differs, with `Σ in` and `Σ out` | always (it exists only where a conserved kind is involved) |

A **not-computable** finding is the whole finding: no `Σ in` is formed from the connections that do have numbers (a feed line whose rate is `all` yields "cannot be computed", never "100 ≠ 0").

**Refusal** is what it is for a split that rejoins (SEMANTICS.md §6, #473 F1): Play, Step and Monte Carlo do not start; the run bar says so with Show; the Inspector of the node says what to change; and `step` itself, given the kinds table, returns the unchanged state with one diagnostic per refusing finding, so no caller can run around the check. Where no conserved kind is involved, the same facts are findings only, and the run is `loop-model/2`'s: the §M4.3 mismatch keeps its text, a non-numeric rate on a Converter keeps the run-time refusal of that connection (#396, #471 item 5), an undetermined line is simply untyped.

## M3-5. L1 — boundary outflow by kind

An intended loss is written as an output into a Drain or an End on a line that has a kind (an annotation on a Converter → Drain line; propagation out of a Gate). The step report carries `boundaryOutflow`: a step's deliveries into Drains and Ends grouped per kind and per exit node (ascending kind, `null` last, then node id; amounts to 9 decimals). The report names none of it a loss: permeate delivered to "demand", brine to "outfall" and water to "evaporation" are all outflows, and the Drain's label says which is which. The list is empty for a document with no kinds table (`loop-model/2` reports are unchanged).

## M3-6. Where it lives

- Model: `src/model/kinds.ts` (`readKinds`, `canonicalKinds`, `resolveKinds`, `kindFindings`, `refusingKindFindings`). Engine: `src/engine/step.ts` (the refusal, after the split-rejoin refusal; `boundaryOutflow` in the report), `src/engine/boundaryOutflow.ts`.
- File: `kinds` after `dataImports` in the envelope, written only when non-empty, and then only with `schema: "loop-studio/graph/3"`. Projection and digest (`canonicalContent`, `canonicalGraphString`): `kinds` after `dataImports`, before `modelSemantics`, under the model layer; a different table hashes differently. Engine revision (SEMANTICS-W2.md §W2-1) is not raised: no number changes for a document whose meaning did not change.
- Pins: `src/model/kinds.test.ts` (the case table per connection and Pool), `src/engine/kinds.test.ts` (what runs, what is refused, M3-INV-1 and M3-INV-2, the outflow), the serializer and revision tests for the envelope and the digest.
