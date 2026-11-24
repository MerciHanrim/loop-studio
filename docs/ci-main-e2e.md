# The e2e jobs on `main` (2026-11-25)

## Why

Every fix ran the full CI twice: about 18 minutes on its pull request and about 18 minutes again on `main` after the merge. With one pull request merged at a time, the second run tested nothing new: on #663, #664 and #665 the merge commit on `main` held exactly the tree of the approved head (`4e5ec440` = `e633aa29`, `5855c9ee` = `a511342e`, `754f1026` = `d2470a8b`). The CI on `main` does not gate the deploy either: Cloudflare Pages builds and deploys `main` from its own GitHub connection.

## What runs where

- **A pull request:** everything, as before. The ruleset on `main` requires `checks` and `e2e`.
- **A push to `main`:** `checks` always. The e2e jobs run unless the `e2e decision` job shows that this commit holds a tree that has already passed the full CI. The gate job `e2e` then passes with the e2e jobs skipped, and the decision job's summary names the pull request and head.
- **Every day at 03:00 KST** (cron `0 18 * * *`, on `main`), and **by hand before a release** (Actions ▸ CI ▸ Run workflow): everything. A tree that passed once can still fail with time, the runner image or a flaky test, so the full suite keeps running on `main` regardless.

## The decision (`scripts/ci-main-e2e-decision.mjs`)

The e2e jobs are skipped only when every one of these is certain:

1. the event is a push to `main`;
2. the push is one commit whose only parent is the previous `main` (`before`);
3. exactly one pull request merged into `main` has this commit as its merge commit;
4. that pull request's head has the required checks `checks` and `e2e` from GitHub Actions, and the latest run of each completed with success;
5. the head fetched from `refs/pull/<n>/head` is that commit;
6. the previous `main` is an ancestor of the head, so the pull request's CI, which runs on the merge of the head into `main`, tested the head's own tree; and
7. the merge commit's tree is the head's tree.

Anything else runs the e2e jobs in full: another event, several commits or a merge commit pushed, no pull request or more than one, a check missing, running, failed or from another app, a head that cannot be fetched, a tree that cannot be read, or any error in the lookup. The e2e jobs run unless the decision is exactly `false`, so the decision job failing, or giving no answer, runs them too.

## Checked

- `scripts/ci-main-e2e-decision.test.mjs`: every rule above, with made-up API answers and git, each test asserting the reason it ends on.
- Dry runs against the real history (`node scripts/ci-main-e2e-decision.mjs --sha <sha>`), 2026-11-25:
  - **the same tree:** the twelve merges #654 to #665 decide `false`.
  - **a different tree:** #567 (`bc9df4c6`) and #568 (`d2d04159`) decide `true`: `main` had moved after their CI, the previous `main` is not in the head, and the trees differ.
  - **cannot be determined:** `68fb0e54` (a commit pushed without a pull request), the root commit (no parent) and the merge commit of #144 (two parents) decide `true`.

The shard weights (docs/ci-e2e-shards.md) take their timing samples from any run that ran the shards: pull requests, the daily run and the `main` pushes that still run them.
