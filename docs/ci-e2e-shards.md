# The e2e shards (issue #311)

The browser suite (`npm run e2e`: the dev-server projects and the portable file) runs on CI as four concurrent jobs on `windows-latest`, each with a 20-minute limit. This page says how the suite is divided between them, what proves the division is complete, and how the division is kept honest as the suite grows.

## Why not Playwright's `--shard`

`--shard=i/N` cuts the ordered list of test groups into N pieces of equal test **count**. Per-test cost in this suite spans more than twenty times (a pixel comparison at 15 s, a locale check under a second), so equal counts give unequal time.

Measured on 2026-10-03 with `--shard` and 1,829 tests: the four shards carried 464 / 454 / 457 / 454 tests but 981 / 695 / 848 / 614 seconds of tests. The longest shard job took 18 min 44 s on `main 16020f2`, 1 min 16 s short of the limit, and two runs of the same tree differed by 56 % on one shard. A slow runner meeting the heavy shard is a red CI with no change in the code. The test count had grown 14 % in three days (1,605 to 1,829), so the margin was not going to come back by itself.

## How the split is decided

`scripts/e2e-shards.mjs` decides it at run time, on every shard job, from two inputs:

- the live list of the suite (`playwright test --list`), so an added or removed spec file is placed without anyone editing a manifest;
- `e2e/shard-weights.json`: for every spec file, the seconds Playwright reported for its tests on recent CI runs, summed over every project the file runs under, one sample per run, newest first, at most six.

The unit is the spec **file**. `portable.setup.ts` is counted with `portable-file.spec.ts`, the spec that depends on it, so the portable bundle is built on the one shard that runs that spec. A file's weight is the **median** of its samples, so no single runner, fast or slow, sets the number; a file with no sample yet is estimated at the suite's median seconds per test times its test count, and the check names it. The files are placed longest-first, each into the shard with the least weight so far (longest-processing-time-first), with ties broken by name and by the lower shard index, so the same inputs give the same split on every machine.

The shard job runs `node scripts/e2e-shards.mjs run i/N`, which prints its share and hands Playwright a file filter matching exactly those files. `node scripts/e2e-shards.mjs plan [N]` prints the split for any N without running anything.

## What `npm run check:e2e-shards` proves

It runs in the `checks` job on every pull request and push.

1. **A partition.** For every shard, Playwright itself is asked, with that shard's file filter, which tests it would run. The multiset union of the N answers must equal the full list: no test missing, none twice, none that the full list does not have. This is the real filter on the real configuration, not the script's idea of it.
2. **The budget.** For every shard, the sum of its files' **slowest** recorded samples plus the fixed cost of a shard job (120 s: checkout, Node, `npm ci`, the Chromium install, the dev server, measured at 35 to 100 s plus 9 to 27 s) must stay at least two minutes under the 20-minute limit. The slowest samples stand for the slowest runner in the sample; the two minutes are the room the next spec file needs before the split has to grow. When this goes red the remedy is another shard (the matrix in `.github/workflows/ci.yml` and the `/N` in its run step; the check keeps the two equal), not a longer limit.
3. **Hygiene.** Every weight belongs to a file the suite still lists.

Measured at the first split (weights from six runs, 2026-10-01 to 2026-10-03): with four shards the predicted loads are 808 / 808 / 809 / 808 s by the medians and 894 / 919 / 882 / 919 s by the slowest samples, so the longest predicted job is 17 min 19 s, 2 min 41 s under the limit. Against each of the eleven recorded runs, with that run's own times and weights that exclude it, the longest shard would have been 9 to 18 % shorter than the count split that ran (for example 848 s instead of 1,037 s on `16020f2`).

## Keeping the weights current

Every shard job uploads its JSON report (`test-results/e2e-report.json`) as the artifact `e2e-report-shard-<i>`, kept for two weeks. To add a run as a sample:

```bash
gh run download <run id> -p 'e2e-report-shard-*' -D reports
node scripts/e2e-shard-weights.mjs <run sha> reports/*/e2e-report.json
```

The newest sample goes to the front of every file it covers and the seventh sample falls off; a file in the weights but in none of the reports keeps its samples, since one run is not evidence that a file is gone (the check against the live list is). A run already among the sources is ignored. Refresh when a spec file is added or changed enough to move its time, and in any case when the check's margin gets thin; the weights are history, and a test that got slower since its last sample is weighted by the old number until then.

## What this does not do

- It does not make a shard finish in time on a runner slower than any in the sample, and it does not say why two runners differ; that variance (up to ±50 % per shard on the same tree) is recorded, not explained.
- It does not touch the production-bundle and PWA jobs, which are not sharded, and it does not change the 20-minute limit.
- It does not split a spec file. The largest file (`large-graph-readability.spec.ts`, about 210 s) is well under a shard's share, so file granularity does not bind; if a single file ever approached a shard's share, the unit would have to change.
