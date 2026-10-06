# Project Revision / Proposal — flow colour extension

```
Spec ID: loop-revision/9
Status:  Frozen
```

**Frozen (2026-10-06).** Issue #325, PR 1. The flow colour a node or an edge may carry
(`docs/flow-colour-and-compact-nodes.md` FC-2): decorative content that the revision layer
must see — it changes the document, so it is dirty-tracked, diffed and applied — and that
the engine must never see. A behavioural change after this is a new spec id in a new
document.

Extends every earlier label at once: a flow colour can sit on any node kind and on both
edge kinds, so it is orthogonal to frames (`/5`), CSU content (`/6`), data-import
provenance (`/8`) and the model layer (`/2`, `/4`).

**No behavioural change to `loop-revision/1` … `/8`.** A graph with no surviving flow
colour has a canonical projection, digest, diff and Apply **byte-identical** to before this
document (R9-INV-1).

**`loop-workspace/1` is NOT bumped**: a flow colour changes nothing `SimState` computes, so
the semantic digest behind the Monte-Carlo stale-result check (`semanticDigest`, an
allowlist that does not name `accent`) is untouched (R9-INV-2).

---

## R9-0. Scope

Added over `loop-revision/8`:

- one optional key, `data.accent`, on every node kind (Pool, Source, Drain, Gate,
  Converter, End, Parameter, Register) and on both edge kinds (`resource`, `state`);
- the version predicate of §R9-1;
- a trailing `accent` in every projected field list (§R9-2);
- the field tag `cosmetic` (§R9-3).

## R9-1. Version inference

A side is `loop-revision/9` iff, after the defensive read (`normalizeGraph`), at least one
node or edge carries an `accent` that `readAccent` keeps. It takes the highest label
precedence, above `/8`; like every label from `/2` up it is served by the one
`{ modelLayer: true }` projection, so the precedence changes the reported label only.

Survival, not presence, decides — the frames rule (§R5-5.1), not the provenance rule
(§R8-1). A provenance key is evidence of an import even when corrupted; an `accent` that is
not a stored-form colour carries nothing and is dropped by every reader, so a side whose
only flow colour is invalid infers as whatever it was without it.

## R9-2. The extended canonical projection

`accent` is appended, LAST, to:

| list | kinds |
|---|---|
| `NODE_FIELDS` | pool, source, drain, gate, converter, end |
| `MODEL_NODE_FIELDS` | parameter, register |
| `EDGE_FIELDS` | resource, state |

It is emitted only under `{ modelLayer: true }` and only when `readAccent` keeps the stored
value: exactly `^#[0-9A-F]{6}$` (a lower-case file value is upper-cased first). The literal
`loop-revision/1` projection never emits it. With no surviving colour, no key is emitted, so
R9-INV-1 holds.

## R9-3. Field tag

`fieldTag(node | edge, 'data.accent')` is `cosmetic`, like `label`, `position`, `route` and
`waypoints`: projected, diffed, dirty-tracked, never `engineAffecting`, never
`advisoryAffecting`. `accent` is in `OPTIONAL_PROJECTED_KEYS`, so a selective Apply whose
chosen side has no colour removes the key instead of keeping the target's.

## R9-4. Invariants

- **R9-INV-1** — no surviving flow colour ⇒ projection, digest, diff and Apply are
  byte-identical to `loop-revision/8` and earlier.
- **R9-INV-2** — `semanticDigest` is the same before and after any flow-colour change.
- **R9-INV-3** — two documents that differ only in the case of a colour's hex digits have
  the same full digest.

## R9-5. What a build before this document does with a `/9` file — measured

Measured 2026-10-06 in Google Chrome 154 against v0.18.2 (main `72c7f1a`) on its own
Cloudflare deploy origin, in a fresh browser context, with a Project revision exported by
this build: a Source, a Pool and a Parameter, one resource edge; the colour file gives the
Pool, the Parameter and the edge `#638EA5`; the control file is the same graph with no
colour.

| | control (no colour) | `/9` file |
|---|---|---|
| graph opens | yes, 3 nodes, 1 edge | yes, 3 nodes, 1 edge |
| project header (the revision chip) | accepted: the chip shows the revision | **refused**: no chip, no message |
| colour drawn | — | no |
| colour kept in the opened graph (re-exported as Graph JSON) | — | **Pool kept, Parameter and edge dropped** |

So an older build opens the diagram, does not show the colours, silently leaves the
revision unopened as a project, and keeps a flow node's colour (its reader spreads `data`)
while dropping a Parameter's and an edge's (both rebuilt field by field). A Register was
not in the measured file; its reader rebuilds `data` the same way as a Parameter's, so it
is expected to drop the colour too — read from the code, not measured. Refusing the project header is the intended outcome: an older build cannot verify
a digest computed over a field it does not project, and it does not pretend to.

## R9-D. Settled decisions

- **D-8** (issue #325): one stored spelling, upper-case `#RRGGBB`; no alpha, no names, no
  CSS functions.
- An invalid file value drops the key and keeps the element; no notice.
- No migration: a file without `accent` gains nothing.
