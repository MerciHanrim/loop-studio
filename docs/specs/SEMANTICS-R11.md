# SEMANTICS-R11 — the port faces of a connection in the revision layer

Spec ID: loop-revision/11

**Frozen (2026-10-12).** The node structure's first implementation (share
`connection-editing-2/17-implementation-rules.md` §4.2, `22-ports-compat.md`): a
connection may leave or arrive at a non-default FACE of a node (`data.ports`). This
document gives that field its place in the revision layer and a declared semantics in the
revision header. A behavioural change after this is a new spec id in a new document.

**No behavioural change to `loop-revision/1` … `/10`.** A graph with no surviving
non-default port face has a canonical projection, digest, diff and Apply **byte-identical**
to before this document (R11-INV-1). Revision and proposal payloads written before it keep
their bytes and their digests.

**`loop-workspace/1` and the engine digest are NOT touched**: a face changes where a line
leaves a body, nothing `SimState` computes (R11-INV-2).

**`loop-studio/graph/2` is NOT bumped** (decision D-A, §R11-D): an older build must keep
opening the document.

---

## R11-0. Scope

This document covers:

- the stored form of `data.ports` and its reading rules (§R11-1.1);
- the version predicate (§R11-1);
- the field's slot in the projection (§R11-2) and its tag and Apply (§R11-3);
- the header field `semantics` and the newer-version message (§R11-6);
- what an older build does with a document or a revision that carries a face (§R11-5).

The faces themselves — which face a connection uses by default, how a face handle is
drawn and picked — are the node structure's, not this document's.

## R11-1. Version inference

A side is `loop-revision/11` iff, after the defensive read (`normalizeGraph`), at least
one edge carries a `ports` payload with a surviving non-default face. It takes the
highest label precedence, above `/10`; like every label from `/2` up it is served by the
one `{ modelLayer: true }` projection, so the precedence changes the reported label only.
Survival decides, as for `/5`, `/9` and `/10`.

### R11-1.1 Reading rules — the canonical stored form

`data.ports` is `{ source?: face, target?: face }`, a face one of `top`, `right`,
`bottom`, `left`. The reader (`canonicalPorts`, `src/model/ports.ts`) keeps a face only if
it is valid AND differs from the kind's default — resource `right → left`, state
`bottom → top`; an explicit default face says nothing and is dropped; an invalid value is
dropped; a payload with nothing left is dropped whole. So two documents that draw alike
store alike and digest alike, and a file without faces is byte-identical on a round trip.
Handle ids stay the plain `out` / `in` / `state-source` / `state-target`; a face never
rides in a handle id.

## R11-2. The projection

`ports` is appended TRAILING to both edge field lists (`resource`: after `accent`;
`state`: after `accent`), emitted only under `{ modelLayer: true }`, only in the canonical
form, `source` before `target`. The literal `loop-revision/1` projection never emits it.

## R11-3. Field tag and Apply

`fieldTag(edge, 'data.ports')` is `cosmetic`: projected, diffed, dirty-tracked, carried
by undo, never `engineAffecting`, never `advisoryAffecting`. A face change is a real
change in Review. `ports` is in `OPTIONAL_PROJECTED_KEYS`, so a selective Apply whose
chosen side has no faces REMOVES the key — a user's chosen face is overwritten by the
side they chose, in both directions.

`cosmetic` means "the computation does not see it". It does not mean the user's edit is
free to lose (Lumi, 2026-10-12): the loss an older build causes (§R11-5) is a stated
limit, named in the user-facing release note as well as here.

## R11-4. Invariants

- **R11-INV-1** — no surviving non-default face ⇒ projection, digest, diff and Apply are
  byte-identical to `loop-revision/10` and earlier.
- **R11-INV-2** — `semanticDigest`, the engine digest and every simulation result are the
  same before and after any face change.
- **R11-INV-3** — the stored form is canonical: valid, non-default faces only; the reader
  never writes a default face back, and a face never changes a handle id.

Pinned by `src/model/revision.r11.test.ts`, `revision.ports.test.ts`, `ports.test.ts`
and the small-graph e2e (`node-structure-small.spec.ts`: engine digest same, revision
content differs, round trip stable).

**What proves R11-INV-1 against the past** — the INV-1 case in `revision.r11.test.ts`
compares, under THIS code, a document with no faces to one with explicit default faces;
that pins the canonical-form rule, not the history. The history is pinned elsewhere:

- the content digests of the Gacha and MMO Templates, pinned in
  `src/engine/templateFlowColours.test.ts` before this document, still verify under the
  `/11` projection (the Coffee pin moved for its unit change, not for this);
- `examples/revision/proposal.clean.json` and `proposal.structural.json`, regenerated
  under `/11`, changed in their header line only — their `contentDigest` values are
  unchanged (`test/revision-fixture.test.ts`);
- the v0.10.0 legacy files still verify (`test/revision-legacy-v0.10.0-fixture.test.ts`);
- measured (§R11-5): a revision written by v0.25.0 verifies in this build, and a faceless
  revision written by this build with the `/11` header verifies in v0.25.0.

## R11-5. What a build before this document does with a `/11` file — measured

Measured 2026-10-12 in Google Chrome (headless) against the production deploy of
**v0.25.0** — `main` at `41a4983` (2026-10-10); the build wrote `meta.tool:
"loop-studio/0.25.0"` into the files it exported — in a fresh browser context per step,
reading and exporting only (tool
`ports-roundtrip.mjs` in the QA folder; share `22-ports-compat.md` §2 and its re-run after
the `/11` bump). The document is the small graph whose `e_leave` is stored `bottom → top`;
the control is the same graph with the faces stripped.

| | control (no face) | `/11` file |
|---|---|---|
| Graph JSON opens | yes, 7 nodes, 5 connections | yes, 7 nodes, 5 connections, no warning |
| the faced connection | — | drawn with the DEFAULT faces (right → left) |
| re-saved as Graph JSON | no `ports` | **no `ports`**: the faces are gone |
| back in this build | — | default faces: **the user's faces are lost** |
| Project revision: project header (the chip) | accepted | **refused**: no chip, and the alert "this file's project data does not match its graph (edited outside Loop Studio?)" |
| a revision written by the older build, read by this build | accepted (byte-identical projection) | — |

So v0.25.0 (measured) opens a `/11` diagram, draws its default faces, drops `ports` when
the document is saved again, and refuses the project header of a faced revision with the
outside-editing wording (the shipped build cannot be changed; §R11-6 fixes the wording
from this build on). Builds before v0.25.0 are expected to behave the same — read from
the code, not measured: no earlier build knows the key, and the field-by-field edge
reader that drops it predates the key. **Round-tripping a document with port faces
through v0.25.0, or by that reasoning any earlier build, is not supported and does not
preserve the faces.** Opening the document is never affected.

Tested: Graph JSON import and export, revision import and export, both builds. Read from
the code, not measured: autosave, the storage modes and share links use the same reader
and writer, so the same drop is expected there.

## R11-6. The declared semantics of a record, and the newer-version message

- Every revision and proposal header written from this document on carries
  `"semantics": "loop-revision/11"`, after `meta` (§R10-6 posture: not content, no digest
  covers it, an unknowing reader ignores it). The label rule of §R10-6 (`< /10` keeps
  recorded label places) is unchanged by this.
- **The newer-version message.** When a project header's digest FAILS to verify AND the
  header declares a semantics `N` greater than the reader's own, the reader reports
  "written by a newer version of Loop Studio, so this version cannot verify its revision
  history (the diagram itself opens)" instead of "edited outside Loop Studio?". The
  declaration alone refuses nothing: a newer-declared file whose digest verifies is
  accepted like any other. Opening the diagram and trusting the revision history stay two
  separate questions, as they are for every other drop reason.

## R11-D. Settled decisions (Lumi, 2026-10-12)

- **D-A**: the document schema stays `loop-studio/graph/2`; `ports` is cosmetic and
  trailing; an older build opens the document, shows default faces and drops the faces on
  save. The limit is stated in the design docs AND in the user-facing change note.
- **R-A**: faces are revision content (`cosmetic`), the format becomes `/11`; a faceless
  document keeps its projection and digest; a face change is detected, diffed, undone and
  applied like any cosmetic field, and applying a faceless side removes existing faces.
- The newer-version message is wording for a failed verification only; no file is refused
  for being newer.
- The improvement that older builds cannot have (a right message there) is not pretended.
