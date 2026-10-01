# Release notes and change declarations

Issue #296. This document covers the part that exists today: the release-note data model, the declaration every shipping change makes, and the check that holds both. The in-product notice, the What's new panel and the Help menu entry are not built yet; they arrive together in a later change, with the first entries.

## Why

A merge to `main` is the production deploy. A change the user can see therefore has to arrive with its version and its release note in the same change: there is no later release to carry them. A reviewer's checkbox does not hold that line, and neither does a label or a sentence in a pull-request description, because none of them can be checked before a push and none of them is in the tree after a squash merge. A file is.

## The declaration

A change that touches anything a build reads or ships, or the app version, adds exactly one file: `.changes/<slug>.json`. The slug is lower-case letters, digits and hyphens, and is unique because it is a file name.

```json
{ "type": "user-facing", "releaseNoteId": "release:0.15.0" }
```

```json
{ "type": "internal", "reason": "Why no release note is needed, in words." }
```

- **`user-facing`** changes the app version in `package.json`, raises it, and names the release note for exactly that version. That entry must exist in the release-note list in the same change.
- **`internal`** says why no note is needed. It may raise the version too: a technical redeploy or an internal fix has a version and no note.
- A change that touches nothing that is built or shipped needs no declaration, and may still add one.
- Declarations are a record. One that is on `main` is never edited, renamed or removed. Before a change is merged its own declaration can still be corrected.

### What counts as built or shipped

Everything, except what is listed as never shipping. The list is the exclusions on purpose: a list of what ships goes stale, silently, the day a build starts reading a new place. A path nobody has classified therefore counts as shipping, and the cost of that is one `internal` declaration.

| Never built, never shipped |
|---|
| `docs/**`, and any `.md` file outside `src/` and `public/` |
| `.changes/**` |
| `*.test.*` files, `e2e/**`, `test/**`, the Playwright configurations, `tsconfig.e2e.json` |
| `.github/**`, `.gitignore`, `.gitattributes`, `.oxlintrc.json` |
| `scripts/check-*.mjs`, the readers the checks share, and the checks' data files |

What that leaves, and why each is a build input:

| Path | Because |
|---|---|
| `src/**`, `public/**`, `index.html` | the app itself |
| `examples/**` | the bundled templates and modules are imported from here |
| `vite.config.ts` | the web, portable and PWA builds, the service-worker settings, the build constants |
| `scripts/locale-chunk.mjs`, `scripts/gen-*` | imported by the build configuration, or the generator of shipped files |
| `package.json`, `package-lock.json` | the runtime dependencies and their resolved versions; a development dependency can ship too, as the service-worker runtime does |
| `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `.nvmrc` | how the source is compiled and with what |
| any path not listed anywhere | not classified, so it counts |

The app version is watched on its own as well: a change of `version` needs a declaration wherever it comes from. Versions are `x.y.z` and are compared as numbers, so `0.9.9` to `0.10.0` is a rise. A pre-release or otherwise malformed version is refused.

## The release-note list

`src/releaseNotes/releaseNotes.ts`. One entry per release that has something to tell the user, newest first.

| Field | Rule |
|---|---|
| `id` | `release:<version>`, unique. This id, not a version comparison, is what will decide whether a notice is shown |
| `version` | the real app version the entry shipped in, `x.y.z` |
| `date` | `YYYY-MM-DD`, a real date, not after the date of a newer entry |
| `items` | three to five catalog keys, each with text in every shipped language |

- The newest entry is never for a version ahead of the app. The app may be ahead of the newest entry.
- Items are catalog keys so that the existing catalog rules apply: a language that lacks a line fails the build. There is no English fallback.
- Past entries are not rewritten.

## The check

```
npm run check:change-declaration
```

It compares the working tree, including uncommitted and untracked files, with the commit the branch started from, so it can be run before a commit or a push. The base is `--base <ref>`, else the `CHANGE_BASE` environment variable, else `origin/main`. CI passes the pull request's base commit, or the previous `main` commit on a push.

It fails when:

- a change to anything that is built or shipped, or a version change, has no declaration, or has more than one
- a declaration is not valid JSON, has an unknown `type`, an empty `reason`, a missing or extra field, or a file name outside the pattern
- a `user-facing` change leaves the version as it was, lowers it, names a release note for another version, or names one that does not exist
- a declaration that is already on `main` is edited, renamed or removed
- the release-note list breaks a rule in the table above

It fails closed. If git cannot find a common ancestor with the base, which is what a shallow clone looks like, that is an error, not "nothing changed". The CI job therefore checks out the full history.

The rule itself is in `scripts/change-declaration.mjs` and the list's rules in `src/releaseNotes/validate.ts`, both as pure functions with their own tests. `scripts/check-change-declaration.mjs` only gathers the facts.

## What is not decided here

- The next version number. It is chosen when the next release is prepared.
- The text of any entry. Source text is written in Korean and English first.
