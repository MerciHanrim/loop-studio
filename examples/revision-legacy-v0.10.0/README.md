# v0.10.0 legacy-envelope fixtures (`loop-model/2` documents)

Real artifacts of the **v0.10.0** release code (`main` at `65d4f93`,
`meta.tool: "loop-studio/0.10.0"`), kept **byte-for-byte as that version wrote
them** so the reader-side recovery stays pinned to the genuine shape. Do NOT
regenerate these with current code — current code no longer produces them.

The v0.10.0 defect: for a document whose model-semantics version is **2**
(`@parameter` references — here the bundled *Coffee roastery* Template), the
Project-revision / proposal writer emitted the **v1** envelope
`"schema": "loop-studio/graph"` while computing `project.contentDigest` under
the **v2** canonical projection (`modelSemantics: "loop-model/2"`). Read
literally, such a file fails its own digest cross-check (the header is
dropped) and its graph loads as v1 — every `@…` flow silently becomes `1`.

| File | What it is |
|---|---|
| `LR0.json` | A **Project revision** of the Coffee roastery Template as v0.10.0 wrote it: v1 envelope, v2 digest. |
| `LP0.json` | A **proposal** made from `LR0` with no edits (the only proposal shape v0.10.0 could actually produce for a v2 document — importing `LR0` on another machine already failed). Its `base` is the first-creation shape: projected as **v1**, self-consistent. |
| `LP1.json` | `LP0` with one real change (`cafe_retail_demand_kg` value 6 → 7) and the top-level digest recomputed the way v0.10.0 would have (v2 projection, v1 envelope) — shape-faithful, hand-derived, so Apply tests have a diff to apply. |

Reader rule (see `readRevisionSideAndProject` in `src/model/revision.ts`):
a file that declares v1 and whose `project.contentDigest` fails the v1
projection but verifies under the v2 projection is loaded as v2. Nothing
else promotes a file. A legacy proposal's v1-projected `base` is read
verbatim and is **not** lifted, so it classifies as `unknown` against its
own v2 target — the confirmation gate stays.

Pinned by `test/revision-legacy-v0.10.0-fixture.test.ts`.
