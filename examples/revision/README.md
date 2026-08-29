# `loop-revision/1` verification fixture

A tiny, fully worked example of **file-based asynchronous collaboration**
([`SEMANTICS-R.md`](../../SEMANTICS-R.md)). No accounts, no server, no
real-time sync — every artifact here is a plain JSON file you could email.

| File | What it is |
|---|---|
| `base.revision.json` | A **Project revision** file — a normal graph doc plus a `project` key (stable `projectId`, `revisionId`, `parentId` chain, content digest). Importing it opens the project. |
| `proposal.clean.json` | A **proposal** off that base: adds a `Bonus` pool + its edge, bumps `Gold.initial` 5 → 8, switches the gate to `uniform`. Carries a complete `base.content` snapshot so the diff and apply run offline. |
| `proposal.structural.json` | A proposal that **removes the `Split` gate**: it drops one incident edge and **retargets** the other (`Gate → Sink` becomes `Gold → Sink`). |
| `oracle.json` | The expected results — whole-apply and selective-apply digests, the three-way hunk verdicts, the dependency / structural-conflict cases, and the named selections the E2E specs replay. |

The graph: `Faucet → Gold → Split → Sink`.

## The workflow these files demonstrate

1. **Create a Project revision.** `Export ▾ → Project revision` writes a file
   like `base.revision.json`. Send it to a collaborator.
2. **Make a proposal.** They open it, choose `Export ▾ → Make a proposal`,
   edit the copy, and send the proposal file back (`proposal.*.json`).
3. **Review.** You `Import` the proposal. It opens a **non-destructive Review**
   panel (a bottom sheet on mobile) — nothing in your graph, simulation, or
   undo history changes. It shows a three-way diff (`base` / `theirs` /
   `yours`), a classification (`exact` / `divergent` / `unknown`), and — when a
   proposal removes a node your copy still has an edge to — a **structural
   conflict** you must resolve first.
4. **Apply.**
   - **Whole proposal** — replaces your graph with theirs. Lands with no prompt
     only when your revision *is* the base (`exact`); otherwise it confirms.
   - **Choose changes** (per-hunk) — pick individual adds / removes and resolve
     each conflicting field (*take theirs* / *keep mine*). Removing a node
     surfaces the incident edges that go with it — resolved by removing **or
     retargeting** each. An invalid pick (an edge left pointing at nothing) is
     refused before anything changes.
   Either way the result is **one new local revision** (`parentId` = your
   pre-apply revision), a single `simulationRev` bump, the sim paused at step 0,
   and **one undo entry** — a single Undo restores both the graph and the
   revision header. Apply never writes a file; you `Export ▾ → Project revision`
   afterward to persist it.

## Trust

`meta.author` (`name` / `note`), `meta.title`, and `meta.createdAt` are
**self-reported, unverified** strings — anyone can put anything there. The
Review UI renders them muted, as *"proposed by … · unverified"*. No diff,
classification, or apply decision depends on them.

## Regenerating

```bash
UPDATE_FIXTURE=1 npm test -- revision-fixture
```

`test/revision-fixture.test.ts` re-derives every value from
`src/model/revision.ts` and fails on drift; `e2e/revision-fixture.spec.ts` and
`e2e/mobile.spec.ts` replay the Import → Review → Apply → Undo → Redo flow
through the real UI and check it against `oracle.json` — identically on desktop
and mobile.
