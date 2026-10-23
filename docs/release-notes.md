# Change declarations and the changelog

Issue #296, revised in 2026-10. What users notice about a change is recorded in [`CHANGELOG.md`](../CHANGELOG.md), under `## Unreleased` until a release takes it. Every change to what is built or shipped says what it is in one declaration file, and a check holds both.

## The in-app release notes were removed (2026-10)

Up to v0.28.4 the app carried its own release notes: a one-line update notice on the canvas, a What's new panel, and a `New` marker in the Help menu, with the notes as catalog text in every shipped language. They were removed in the workbench redesign. Changes are recorded in the repository's CHANGELOG and in the GitHub release notes; the Help menu keeps the tour, the contextual tips, feedback and About, and (2026-10-20) offers Example notes: each Templates-menu example's explanation, in the app.

What remains of them:

- **Two stored keys**, `loop-studio/whats-new/announced/1` and `loop-studio/whats-new/opened/1`. No code reads or writes them. They are listed as `RETIRED_STORAGE_KEYS` in `src/storage/storagePort.ts`, outside the key registry and its type, so nothing can store them again; "Reset all Loop Studio data" still removes them.
- **Old declarations** that name an in-app note (`releaseNoteId`). They are a record and stay as they are.
- **The version check.** About shows the version in `package.json`, in the dev server, the production build, the PWA build and the portable file (`e2e/support/appVersion.ts`). A dev server reads the version once, when it starts: one left running across a version change shows the old number, and restarting it is the fix.

The design of the removed notes, and the measurements behind it, are in this file's git history.

## Why a declaration

A merge to `main` is the production deploy. A change the user can see therefore has to arrive with its record in the same change: there is no later step to carry it. A reviewer's checkbox does not hold that line, and neither does a label or a sentence in a pull-request description, because none of them can be checked before a push and none of them is in the tree after a squash merge. A file is.

## The declaration

A change that touches anything a build reads or ships, or the app version, adds exactly one file: `.changes/<slug>.json`. The slug is lower-case letters, digits and hyphens, and is unique because it is a file name.

```json
{ "type": "user-facing", "changelog": "- **Structures**: save a selection and insert it into another document." }
```

```json
{ "type": "internal", "reason": "Why no changelog entry is needed, in words." }
```

- **`user-facing`** names one line it adds under `## Unreleased` in `CHANGELOG.md`, in the same change. The line must be in that section, and must not have been there at the base: an entry an earlier change wrote does not stand for this one. A list marker (`- `) may be left out of the declared text.
- **`internal`** says why no changelog entry is needed.
- **The version.** An ordinary change does not raise it: the app version is raised only when a release is approved. Whatever a change declares, a version that changes only goes up, and a change of the version alone still needs a declaration.
- **A release** (2026-10-23) raises the version and, in the same change, moves the lines under `## Unreleased` into a new section `## v<x.y.z> — <date>` of exactly that version, leaving `## Unreleased` empty above it. For that change only, its declared line is accepted in the new version's section too. Without a raise, and in any other version's section, it is not; the date is the release day, corrected before the merge if the release slips.
- A change that touches nothing that is built or shipped needs no declaration, and may still add one.
- Declarations are a record. One that is on `main` is never edited, renamed or removed. Before a change is merged its own declaration can still be corrected.

### What counts as built or shipped

Everything, except what is listed as never shipping. The list is the exclusions on purpose: a list of what ships goes stale, silently, the day a build starts reading a new place. A path nobody has classified therefore counts as shipping, and the cost of that is one `internal` declaration.

| Never built, never shipped |
|---|
| `docs/**`, and any `.md` file outside `src/` and `public/` |
| `archive/**` — the archived translations ([`archive/i18n/README.md`](../archive/i18n/README.md)) |
| `.changes/**` |
| `*.test.*` files, `e2e/**`, `test/**`, the Playwright configurations, `tsconfig.e2e.json` |
| `.github/**`, `.gitignore`, `.gitattributes`, `.oxlintrc.json` |
| `scripts/check-*.mjs`, the readers the checks share, and the checks' data files |

What that leaves, and why each is a build input:

| Path | Because |
|---|---|
| `src/**`, `public/**`, `index.html` | the app itself |
| `examples/**` | the bundled templates are imported from here |
| `vite.config.ts` | the web, portable and PWA builds, the service-worker settings, the build constants |
| `scripts/locale-chunk.mjs`, `scripts/gen-*` | imported by the build configuration, or the generator of shipped files |
| `package.json`, `package-lock.json` | the runtime dependencies and their resolved versions; a development dependency can ship too, as the service-worker runtime does |
| `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `.nvmrc` | how the source is compiled and with what |
| any path not listed anywhere | not classified, so it counts |

Versions are `x.y.z` and are compared as numbers, so `0.9.9` to `0.10.0` is a rise. A pre-release or otherwise malformed version is refused.

## The check

```
npm run check:change-declaration
```

It compares the working tree, including uncommitted and untracked files, with the commit the branch started from, so it can be run before a commit or a push. The base is `--base <ref>`, else the `CHANGE_BASE` environment variable, else `origin/main`. CI passes the pull request's base commit, or the previous `main` commit on a push.

It fails when:

- a change to anything that is built or shipped, or a version change, has no declaration, or has more than one
- a declaration is not valid JSON, has an unknown `type`, an empty `reason` or `changelog`, a missing or extra field, or a file name outside the pattern
- a `user-facing` change's line is not under `## Unreleased` in `CHANGELOG.md`, was already there at the base, or the CHANGELOG has no such section
- a NEW `user-facing` declaration names an in-app release note instead of a changelog line
- the version goes down, whatever the change declares
- a declaration that is already on `main` is edited, renamed or removed

It fails closed, in two places:

- If git cannot find a common ancestor with the base, which is what a shallow clone looks like, that is an error, not "nothing changed". The CI job therefore checks out the full history.
- If the app version at the base cannot be read, because the base has no `package.json`, the file is not JSON, or it has no `x.y.z` version, that is an error, not "there was no version before".

The rule itself is in `scripts/change-declaration.mjs`, as pure functions with their own tests (`scripts/change-declaration.test.mjs`). `scripts/check-change-declaration.mjs` only gathers the facts.

## Making a user-facing change

1. Add a line under `## Unreleased` in `CHANGELOG.md`: what a person notices, without internal mechanics, test counts or pull-request numbers.
2. Add `.changes/<slug>.json` with `user-facing` and that line.

Do not raise the version.

## Making a release

Only when a release is approved:

1. Raise `version` in `package.json` and in `package-lock.json`.
2. Turn `## Unreleased` into the release's own heading (`## vX.Y.Z — YYYY-MM-DD`) and start a new, empty `## Unreleased` above it.
3. Add `.changes/<slug>.json`, `internal`, saying that this change is the release.
4. The tag and the GitHub release are separate records, made after the merge.
