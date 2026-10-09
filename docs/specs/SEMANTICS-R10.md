# Project Revision / Proposal — straight connection extension

```
Spec ID: loop-revision/10
Status:  Frozen
```

**Frozen (2026-10-10).** Issue #344, step 3 (`docs/diagram-layout.md` §DL4). One new value
for the routing slot of `loop-revision/3`: a connection drawn as a straight line, and a
declared semantics in the revision header (§R10-6). A behavioural change after this is a new spec
id in a new document.

**No behavioural change to `loop-revision/1` … `/9`.** A graph with no surviving straight
connection has a canonical projection, digest, diff and Apply **byte-identical** to before
this document (R10-INV-1). Revision and proposal payloads written before it keep their
bytes and their digests.

**`loop-workspace/1` is NOT bumped**: a connection's shape changes nothing `SimState`
computes (R10-INV-2).

---

## R10-0. Scope

Added over `loop-revision/9`:

- one value, `"straight"`, for the existing optional key `data.route` on both edge kinds;
- the reading rules of §R10-1.1;
- the version predicate of §R10-1;
- the header field `semantics` and the autosave header's `labelLayoutVersion` (§R10-6);
- nothing else: the key, its place in the projection (§R3-2.1) and its field tag
  (`cosmetic`, §R3-3) are unchanged.

The four connection shapes and how each is stored:

| shape | `data.route` | `data.waypoints` |
|---|---|---|
| Curved (the Bézier) | absent — `"bezier"` is never written | absent |
| Straight | `"straight"` | absent |
| Auto orthogonal | `"orthogonal"` | absent |
| Manual orthogonal | `"orthogonal"` | 1 … 64 points |

Manual orthogonal is not a route value: it is an orthogonal route with bend points.

## R10-1. Version inference

A side is `loop-revision/10` iff, after the defensive read (`normalizeGraph`), at least one
edge carries `route: "straight"`. It takes the highest label precedence, above `/9`; like
every label from `/2` up it is served by the one `{ modelLayer: true }` projection, so the
precedence changes the reported label only. Survival decides, as for `/5` and `/9`.

### R10-1.1 Reading rules

Extends §R3-1.1; each drop is reported by `routingReadIssues` on import.

- `route` absent or `"bezier"`: Curved; `"bezier"` is read as absent.
- `route: "straight"`: kept. Any `waypoints` beside it are dropped (a warning when the
  array was not empty); the shape stays.
- `route: "orthogonal"`: as §R3-1.1 (1 … 64 finite points, verbatim; more than 64 or a
  malformed entry drops the whole payload).
- any other `route` value: the whole routing payload is dropped (unchanged).
- `waypoints` with no `route`: dropped (unchanged).

## R10-2. The projection

`data.route` keeps its slot (§R3-2.1) and is emitted only under `{ modelLayer: true }`:
`"orthogonal"` as before, `"straight"` for a straight connection, nothing for Curved.
`data.waypoints` is emitted only beside `"orthogonal"` (unchanged). The literal
`loop-revision/1` projection emits neither.

## R10-3. Field tag and Apply

`fieldTag(edge, 'data.route')` stays `cosmetic`: projected, diffed, dirty-tracked, never
`engineAffecting`, never `advisoryAffecting`. A shape change and a bend-point change are
real changes in Review. `route` and `waypoints` stay in `OPTIONAL_PROJECTED_KEYS`, so a
selective Apply whose chosen side is Curved removes the key, and one whose chosen side
has no bend points removes `waypoints`.

## R10-4. Invariants

- **R10-INV-1** — no surviving straight connection ⇒ projection, digest, diff and Apply
  are byte-identical to `loop-revision/9` and earlier.
- **R10-INV-2** — `semanticDigest` and every simulation result are the same before and
  after any shape or bend-point change.
- **R10-INV-3** — a Curved connection never carries `route`; switching to Curved or
  Straight removes `waypoints`; Reset to automatic keeps `route: "orthogonal"` and removes
  `waypoints`.

## R10-5. What a build before this document does with a `/10` file — measured

Measured 2026-10-10 in Google Chrome (headless) against v0.24.0 on its production deploy,
in a fresh browser context per file, reading only. The files were Project revisions
exported by this build: Faucet → Gold Straight and Gold → Sink Curved; the control file
is the same graph with both connections Curved.

| | control (no straight) | `/10` file |
|---|---|---|
| graph opens | yes, 3 nodes, 2 connections | yes, 3 nodes, 2 connections |
| project header (the revision chip) | accepted | **refused**: no chip |
| the Straight connection | — | drawn **Curved** |
| re-saved as Graph JSON | no `route` | **no `route`**: `"straight"` is gone |
| a warning to the user | none | **none** |

So v0.24.0 and earlier open a `/10` diagram but refuse its project header, draw a Straight
connection as Curved, drop `route: "straight"` when the document is saved again, and say
nothing. **Round-tripping a `/10` file through v0.24.0 or earlier is not supported and
does not preserve its data.** The shipped build cannot be changed to warn; this limit is
recorded as it is.

## R10-6. The declared semantics of a record, and the label rule

A revision's content version is inferred (§R10-1), so it cannot say which build recorded
it: a `/10` record may hold no straight connection. The header therefore declares it.

- Every revision and proposal header written from this document on carries
  `"semantics": "loop-revision/10"`, after `meta`. It is not content: no digest covers
  it, and a reader that does not know it ignores it (v0.24.0 rebuilds the header field
  by field). A reader keeps it only in the exact form `loop-revision/N`; anything else
  reads as absent.
- A record whose header declares no semantics, or semantics before `/10`, keeps its
  Curved labels where they were recorded (`docs/edge-routing.md` §ER15.1). One that
  declares `/10` or later takes the current label placement. The edges are never
  inspected for this.
- The autosaved Project header carries the rule in force as `labelLayoutVersion`: `0`
  the record's own rule, `1` the current placement; a header saved before the key
  existed reads as `0`. An ordinary document has no Project header and never holds the
  record rule; `layoutVersion` keeps meaning the layout migration only.

## R10-D. Settled decisions (Lumi, 2026-10-09 and 2026-10-10)

- Curved keeps today's canonical form: no `route`, never `"bezier"`.
- Manual orthogonal is told apart by its bend points, not by a value.
- Invalid values, and bend points beside Straight or Curved, are removed by the reader and
  reported; nothing is repaired silently.
- Revisions and proposals written before this document are read unchanged; only this
  version recognises `"straight"`.
- A record keeps its recorded Curved label places by its DECLARED header semantics (§R10-6), never by inferring from its edges; `layoutVersion` is the layout migration only.
- §R10-5 is recorded as measured: v0.24.0 shows no warning, and round-tripping a `/10` file through it is not supported.
