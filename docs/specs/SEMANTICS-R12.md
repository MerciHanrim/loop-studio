# SEMANTICS-R12 — the icon of a flow node in the revision layer

Spec ID: loop-revision/12

A flow node may carry an icon (`data.icon`): a small mark drawn before its name. This
document gives that field its place in the revision layer and a declared semantics in the
revision header. A behavioural change after this is a new spec id in a new document.

**No behavioural change to `loop-revision/1` … `/11`.** A graph with no surviving icon has a
canonical projection, digest, diff and Apply **byte-identical** to before this document
(R12-INV-1). Revision and proposal payloads written before it keep their bytes and their
digests.

**`loop-workspace/1` and the engine digest are NOT touched**: an icon is a drawing and
nothing `SimState` computes (R12-INV-2).

**`loop-studio/graph/1` is NOT bumped**: the key is optional, like `accent`, and an older
build must keep opening the document.

---

## R12-0. Scope

- the stored form of `data.icon` and its reading rules (§R12-1.1);
- the version predicate (§R12-1);
- the field's slot in the projection (§R12-2) and its tag and Apply (§R12-3);
- the header field `semantics` (§R12-6) and what an older build does with a document that
  carries an icon (§R12-5).

The drawings, the picker and the placement before the name are the node shell's and the
Inspector's, not this document's.

## R12-1. Version inference

A side is `loop-revision/12` iff, after the defensive read (`normalizeGraph`), at least one
node carries a surviving `icon`. It takes the highest label precedence, above `/11`; like
every label from `/2` up it is served by the one `{ modelLayer: true }` projection, so the
precedence changes the reported label only. Survival decides, as for `/5`, `/9`, `/10` and
`/11`.

### R12-1.1 Reading rules — the stored form

`data.icon` is one id of the fixed registry in `src/model/model/icon.ts` (`NODE_ICON_IDS`:
stable ASCII words such as `cloud` or `nuclear-plant`). The registry is extensible by adding
ids; it started with fourteen, and the first follow-up added `rain-cloud` and `recycling`
(sixteen). The reader (`readIcon`) keeps a value only when it is a
registered id; anything else (a string that is not registered, a number, an object) is
dropped and the node kept, as a malformed `accent` is, so a file from a later version that
knows more ids still opens here.

The field is read on the **six flow kinds only** (Pool, Source, Drain, Gate, Converter,
End). On a Parameter or a Register it is dropped on read: not kept on the node, not shown,
not written back, not part of either digest, and no warning — so a document that differs
from another only by an `icon` on a Register has the same revision. A later version that
widens the scope reads the key on the added kinds from that version on; this version keeps
dropping it.

## R12-2. The projection

`icon` is appended TRAILING to the node field list of each of the six flow kinds (after
`accent`), emitted only under `{ modelLayer: true }` and only when a registered id is
stored. The literal `loop-revision/1` projection never emits it. Edges carry no icon.

## R12-3. Field tag and Apply

`fieldTag('node', 'data.icon')` is `cosmetic`: projected, diffed, dirty-tracked, carried by
undo, never `engineAffecting`, never `advisoryAffecting`. `icon` is in
`OPTIONAL_PROJECTED_KEYS`, so a selective Apply whose chosen side has no icon REMOVES the
key.

## R12-4. Invariants

- **R12-INV-1** — no surviving icon ⇒ projection, digest, diff and Apply are byte-identical
  to `loop-revision/11` and earlier.
- **R12-INV-2** — `semanticDigest`, the engine digest and every simulation result are the
  same before and after any icon change; setting, changing, removing, undoing or redoing
  one never resets a run.
- **R12-INV-3** — the stored form is a registered id only; the reader never writes anything
  else back.

Pinned by `src/model/nodeIcon.test.ts` and `src/store/graphStore.icon.test.ts`.

## R12-5. What a build before this document does with a `/12` file — read from the code

Not measured on a production deploy (unlike §R11-5); read from the code of the builds
that precede this one.

- Opening the document is never affected. The node reader of a build before this one spreads
  the stored `data` over the kind's defaults, so a flow node's unknown `icon` key is kept on
  the node, not drawn, and written back when the document is saved again; the Parameter and
  Register readers keep only the fields they know and drop it.
- A revision or project header written with icons carries a content digest that includes
  `icon`; a build before this one projects without it, so its digest check fails. Because
  such a header declares `semantics: "loop-revision/12"`, a build that has the §R11-6 rule
  reports "written by a newer version of Loop Studio" rather than "edited outside Loop
  Studio"; a build before that reports the older wording.

## R12-6. The declared semantics of a record

Every revision and proposal header written from this document on carries
`"semantics": "loop-revision/12"` (§R10-6 posture: not content, no digest covers it, an
unknowing reader ignores it). The label rule of §R10-6 and the newer-version message of
§R11-6 are unchanged.

## R12-D. Settled decisions (Lumi, 2026-11-02)

- `data.icon` is cosmetic, optional, a registry id, on the six flow kinds; it is outside
  the engine digest and inside the full revision digest; `loop-revision/12`.
- The first registry is the fourteen ids of the first list; the coin stack, order, sale,
  recycling and the other candidates are out of it. (Follow-up 1, approved 2026-11-03:
  `rain-cloud` and `recycling` join the registry as two more values of the same field; the
  revision note is unchanged, since the digest records the id string.)
- The mark is a detail of the L2 level of the canvas and folds away, with its gap, at L1
  and L0; its name stays in the node frame's accessible name at every zoom.
