// CI on `main` (#615 follow-up, Lumi 2026-11-25) — may a push to `main` skip
// the e2e jobs because the exact files it holds already passed the full CI on
// their pull request?
//
// With one pull request merged at a time, the merge commit on `main` holds the
// same tree as the approved head, so the full e2e on `main` re-ran what the
// pull request had just run (#663–#665: identical trees, ~18 minutes each).
// `checks` still runs on every push; this decides only the e2e jobs, and it is
// conservative: the e2e jobs are skipped only when ALL of these are certain,
// and anything unknown, missing or failing to compare runs them in full.
//
//   1. the event is a push to `main` (a pull request, the daily schedule and a
//      manual run always run everything);
//   2. the push is one commit on top of the previous `main` (`before` is the
//      commit's only parent);
//   3. exactly one merged pull request into `main` has this commit as its
//      merge commit;
//   4. that pull request's head has the required checks (`checks`, `e2e`) from
//      GitHub Actions, the latest run of each completed with success;
//   5. the head is fetched from `refs/pull/<n>/head` and is that commit;
//   6. the previous `main` is an ancestor of the head, so the pull request's CI
//      (which runs on the merge of the head into `main`) tested the head's own
//      tree; and
//   7. the merge commit's tree is the head's tree.
//
// Same tree is not the same run: time and environment can still fail a test,
// so the full suite also runs every day and by hand before a release.
//
// CLI (CI): reads GITHUB_EVENT_NAME, GITHUB_SHA, GITHUB_REPOSITORY and
// EVENT_BEFORE, calls `gh api` (GH_TOKEN) and `git`, and writes `run_e2e=true|false`
// to GITHUB_OUTPUT and the reason to GITHUB_STEP_SUMMARY.
// Local dry run: node scripts/ci-main-e2e-decision.mjs --sha <sha> [--before <sha>] [--repo owner/name]

import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'

export const REQUIRED_CHECKS = ['checks', 'e2e']
/** GitHub Actions' app id: a required check must come from it, not from another app with the same name */
export const ACTIONS_APP_ID = 15368

/**
 * @param {{ event: string, sha: string, before: string, repo: string }} ctx
 * @param {{ api: (path: string) => any, git: (args: string[]) => string }} io
 * @returns {{ runE2e: boolean, reason: string }}
 */
export function decide(ctx, io) {
  const full = (reason) => ({ runE2e: true, reason })
  try {
    if (ctx.event !== 'push') return full(`event "${ctx.event}": the full suite always runs`)
    if (!/^[0-9a-f]{40}$/.test(ctx.sha ?? '')) return full('undetermined: no commit SHA')
    if (!/^[0-9a-f]{40}$/.test(ctx.before ?? '') || /^0+$/.test(ctx.before)) return full('undetermined: no previous main commit for this push')

    const parents = io.git(['rev-list', '--parents', '-n', '1', ctx.sha]).trim().split(/\s+/).slice(1)
    if (parents.length !== 1 || parents[0] !== ctx.before) return full(`not a single commit on top of ${ctx.before.slice(0, 8)} (parents: ${parents.map((p) => p.slice(0, 8)).join(', ') || 'none'})`)

    const prs = io.api(`repos/${ctx.repo}/commits/${ctx.sha}/pulls`)
    if (!Array.isArray(prs)) return full('undetermined: the pull request lookup did not return a list')
    const merged = prs.filter((p) => p && p.merged_at && p.base?.ref === 'main' && p.merge_commit_sha === ctx.sha)
    if (merged.length !== 1) return full(`undetermined: ${merged.length} merged pull requests have this commit as their merge commit`)
    const pr = merged[0]
    const head = pr.head?.sha
    if (!/^[0-9a-f]{40}$/.test(head ?? '')) return full(`undetermined: #${pr.number} has no head SHA`)

    const runs = io.api(`repos/${ctx.repo}/commits/${head}/check-runs?per_page=100`)
    const list = runs?.check_runs
    if (!Array.isArray(list) || typeof runs.total_count !== 'number' || runs.total_count > list.length) return full(`undetermined: the check runs of ${head.slice(0, 8)} could not all be read`)
    for (const name of REQUIRED_CHECKS) {
      const mine = list.filter((r) => r.name === name && r.app?.id === ACTIONS_APP_ID)
      if (mine.length === 0) return full(`#${pr.number} head ${head.slice(0, 8)}: no "${name}" check from GitHub Actions`)
      const latest = mine.reduce((a, b) => (b.id > a.id ? b : a))
      if (latest.status !== 'completed' || latest.conclusion !== 'success') return full(`#${pr.number} head ${head.slice(0, 8)}: the latest "${name}" check is ${latest.status}/${latest.conclusion}`)
    }

    io.git(['fetch', '--no-tags', '--quiet', 'origin', `+refs/pull/${pr.number}/head:refs/ci/pr-head`])
    const fetched = io.git(['rev-parse', 'refs/ci/pr-head']).trim()
    if (fetched !== head) return full(`#${pr.number}: the fetched head ${fetched.slice(0, 8)} is not ${head.slice(0, 8)}`)

    try {
      io.git(['merge-base', '--is-ancestor', ctx.before, head])
    } catch {
      return full(`#${pr.number}: the previous main ${ctx.before.slice(0, 8)} is not in head ${head.slice(0, 8)}, so its CI tested a different merge`)
    }

    const mergedTree = io.git(['rev-parse', `${ctx.sha}^{tree}`]).trim()
    const headTree = io.git(['rev-parse', `${head}^{tree}`]).trim()
    if (!/^[0-9a-f]{40}$/.test(mergedTree) || mergedTree !== headTree) return full(`#${pr.number}: the merge tree ${mergedTree.slice(0, 8)} is not head ${head.slice(0, 8)}'s tree ${headTree.slice(0, 8)}`)

    return { runE2e: false, reason: `#${pr.number}: the merge commit holds head ${head.slice(0, 8)}'s tree ${headTree.slice(0, 8)}, whose required checks passed; e2e skipped (the full suite runs daily)` }
  } catch (e) {
    return full(`undetermined: ${String(e?.message ?? e).split('\n')[0]}`)
  }
}

if (process.argv[1]?.endsWith('ci-main-e2e-decision.mjs')) {
  const arg = (name) => {
    const i = process.argv.indexOf(name)
    return i > 0 ? process.argv[i + 1] : undefined
  }
  const git = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const api = (path) => JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
  const sha = arg('--sha') ?? process.env.GITHUB_SHA
  let before = arg('--before') ?? process.env.EVENT_BEFORE
  if (!before && arg('--sha')) before = git(['rev-parse', `${sha}^`]).trim() // a local dry run of one commit
  const ctx = {
    event: arg('--sha') ? 'push' : (process.env.GITHUB_EVENT_NAME ?? ''),
    sha,
    before,
    repo: arg('--repo') ?? process.env.GITHUB_REPOSITORY ?? '',
  }
  const { runE2e, reason } = decide(ctx, { api, git })
  console.log(`run_e2e=${runE2e} — ${reason}`)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `run_e2e=${runE2e}\n`)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `**e2e on this push:** ${runE2e ? 'run' : 'skipped'} — ${reason}\n`)
}
