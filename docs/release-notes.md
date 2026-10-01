# Release notes, the update notice and change declarations

Issue #296. Two things live here. The first is what a person sees after an update: a one-line notice, the What's new panel, and a `New` marker in the Help menu. The second is what keeps that honest: the release-note list, the declaration every shipping change makes, and the check that holds both.

## Why

After an update the screen looks different and nothing says why. A GitHub release does not reach an ordinary user, so the notes ship inside the app and the app says when there is something new to read.

A merge to `main` is the production deploy. A change the user can see therefore has to arrive with its version and its release note in the same change: there is no later release to carry them. A reviewer's checkbox does not hold that line, and neither does a label or a sentence in a pull-request description, because none of them can be checked before a push and none of them is in the tree after a squash merge. A file is.

## What a person sees

### The update notice

One sentence naming the version, a button that opens the What's new panel, and a button that closes the notice. `src/components/WhatsNewNotice.tsx`.

- It is shown once, on the first launch after an update, and only to a browser profile that was used before. A first visit has no previous version to have been updated from, so it sees nothing.
- It never changes the document, the run or the selection.
- It does not take focus when it appears, and it does not time out. It stays until the person presses one of its two buttons.
- Closing it does not count as reading the notes: the `New` marker stays.

Where it sits was measured, not chosen. In both places no control is covered and no element moves when it appears.

| Layout | Place |
|---|---|
| Desktop | the inline-start top corner of the canvas, so it mirrors in a right-to-left layout |
| Mobile | the physical right, just above the run bar, in right-to-left too, because the canvas zoom controls stay on the left there |

On mobile the offset is measured against the run bar, whose height is not a constant.

### One thing at a time

Several things use the top of the canvas, and on a narrow window they would overlap. They are ordered by priority instead of being moved around.

| While this is up | The notice |
|---|---|
| the PWA update bar | waits. One automatic notice at a time |
| the filter panel (desktop) | waits. It uses the same corner |
| a running tour | waits |
| a note that follows a deliberate action: the import note, the frame-move note, the suggested-frames note, the focus-mode prompt | waits |

- A notice that was already showing steps aside and comes back afterwards. It is not announced a second time.
- The other way round, the canvas's own discovery hints (the empty-canvas hint and the Focus and Filter hint) wait while the notice is showing. A hint that is waiting is not rendered, so it is not used up.
- The `New` marker does not wait for anything.

### Accessibility

- The card is a named region. It is not a live region.
- The announcement is a separate, short, polite sentence, written once, the first time the notice has really been on screen.
- Both buttons are in the ordinary tab order, right after the toolbar and before any node.
- Focus is moved in two cases only. When the person closes the notice or the panel while focus is inside it, focus goes to the Help button, or to the More button on mobile, which is where the marker is. When the notice steps aside while focus is inside it, focus goes to the same button instead of falling to the page. If another element already holds focus, for instance the filter button that was just pressed, it stays there.
- The card and the marker keep a solid boundary when colours are forced.

### The What's new panel

Every release note, newest first: the version, the date, and three to five lines. `src/components/WhatsNewPanel.tsx`.

- It opens from the notice, from Help on desktop, and from the Help sheet on mobile, at any time.
- Really opening it is what records the notes as read and clears the marker.
- Opening it also withdraws a notice that is still owed: its entry has just been read.
- The version and the date are shown as they are in every language, `v0.15.0` and an ISO date, the way About shows the version. The lines are catalog text.
- It is a normal modal: Escape, the backdrop and the close button each dismiss it.
- Like every dialog, it is drawn in the shared dialog layer and not where it is declared. See [`mobile.md`](mobile.md), "The dialog layer".

### The Help menu

The same three groups, in the same order, on desktop and in the mobile Help sheet.

| Item | What it does |
|---|---|
| Restart the tour | replays the guided tour |
| Turn contextual tips back on | opens the dialog that re-arms the one-time notes |
| What's new, with the `New` marker | opens the panel. The marker stays until the newest entry has been opened |
| Send feedback | the external form, in a new tab |
| About Loop Studio | the About dialog |

The names say what each item does. The contextual entry is not a help document: its dialog is titled "Manage contextual tips", a note that has been seen offers "Show next time it applies", and one that is already waiting reads "Will show".

## What is stored

Two keys, both holding a release-note id such as `release:0.15.0`. Dismissing a notice and reading the notes are different things, so they are stored apart. `src/store/whatsNewStore.ts`.

| Key | Written when |
|---|---|
| `loop-studio/whats-new/announced/1` | the notice is really on screen. Also, silently, on a first visit, as the baseline the next release is compared with |
| `loop-studio/whats-new/opened/1` | the panel is really opened |

A notice that was only waiting behind another overlay has announced nothing, records nothing, and is offered again on the next launch.

### Who is a returning profile

The app cannot identify a person. What it can identify is a browser profile that has been used before. `src/whatsNew/decide.ts`.

The app writes data on its own: about a second and a half after a first boot, the default sample document is saved. So "some Loop Studio key exists" is true of a brand-new profile almost at once, and is not the test. The test is an allow-list of the thirteen keys that only a person's action writes: skipping or finishing the tour, choosing a theme or a language, locking the canvas, typing an author name, and so on.

The decision, in this order:

1. The newest entry has already been opened: nothing to announce.
2. An `announced` record exists: a notice if it names another entry, nothing if it names the newest.
3. No record, and an allow-list key is present: a returning profile. A notice.
4. No record and no such key: a first visit. No notice, and the newest id is recorded as the baseline.

- Ids are compared for equality. Versions are never ordered.
- The document key is not in the allow-list, so the three states are distinct: empty storage, storage that holds only the auto-saved sample, and a real returning profile.
- The two keys of this feature are not in the allow-list either. A first visit writes `announced`, and reading that back as a trace would turn every new profile into a returning one on its second launch.
- The list is explicit. A key added to the registry later is not a trace until it is added here, and a test fails until every registered key is classified one way or the other.
- A stored value that is not a release-note id is treated as absent, never as "already told".
- If storage cannot be read at all, nothing can be remembered, so no automatic notice is shown. The panel and the marker still work for the session.

A profile that only ever edited the document and never touched a setting counts as a first visit. It errs toward saying nothing.

### Builds

| Build | What holds |
|---|---|
| Web and PWA | the automatic notice, the panel and the marker. The notes are in the bundle, so the panel reads offline once the app is installed |
| Portable | the panel and the marker, offline |
| Portable, the automatic notice | best effort. It works where the browser keeps one storage for every `file://` page, which was measured in Chrome only |

## Not verified

- **A real screen reader.** The checks in `e2e/whats-new.spec.ts` read the accessibility tree and count the changes of the live region. That is a structural check, not a screen-reader test. What a screen reader actually says has not been confirmed on any platform yet.
- **Browsers other than Chrome.**
- **Touch.** The mobile layout is checked at a phone-sized viewport, not on a device.
- **A temporary session** (issue #297) does not exist yet. When it does, it reads and writes neither key and shows neither the notice nor the marker; the panel stays reachable from Help.

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
- Whatever is declared, a version that changes only goes up. An `internal` change cannot lower it either.
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
- An item key is named for its release and its subject, for example `whatsNew.v0150.timeline`.
- The version and the date are shown as they are; only the items are translated.

## The check

```
npm run check:change-declaration
```

It compares the working tree, including uncommitted and untracked files, with the commit the branch started from, so it can be run before a commit or a push. The base is `--base <ref>`, else the `CHANGE_BASE` environment variable, else `origin/main`. CI passes the pull request's base commit, or the previous `main` commit on a push.

It fails when:

- a change to anything that is built or shipped, or a version change, has no declaration, or has more than one
- a declaration is not valid JSON, has an unknown `type`, an empty `reason`, a missing or extra field, or a file name outside the pattern
- a `user-facing` change leaves the version as it was, names a release note for another version, or names one that does not exist
- the version goes down, whatever the change declares
- a declaration that is already on `main` is edited, renamed or removed
- the release-note list breaks a rule in the table above
- the languages that have a catalog are not exactly the registered shipped languages: one missing, one extra, or one with no text

It fails closed, in three places:

- If git cannot find a common ancestor with the base, which is what a shallow clone looks like, that is an error, not "nothing changed". The CI job therefore checks out the full history.
- If the app version at the base cannot be read, because the base has no `package.json`, the file is not JSON, or it has no `x.y.z` version, that is an error, not "there was no version before".
- "Text in every language" is checked against the registered languages, read from `src/i18n/registry.ts`. A language that lost its catalog fails the check; it is not left out of the comparison.

The rule itself is in `scripts/change-declaration.mjs` and the list's rules in `src/releaseNotes/validate.ts`, both as pure functions with their own tests. `scripts/check-change-declaration.mjs` only gathers the facts.

## Making a user-facing change

Everything below goes into the same change as the visible change itself.

1. Raise `version` in `package.json` and in `package-lock.json`.
2. Add the entry at the top of `RELEASE_NOTES`: its id, its version, the date it ships, and three to five item keys.
3. Add the text of each item to `ui.ts` in all eighteen locales. The Korean and English source text is written first. Describe what a person notices; leave out internal mechanics, test counts and pull-request numbers.
4. Add `.changes/<slug>.json` with `user-facing` and the new id.
5. Update the catalog counts that the locale tests pin.

`npm run check:change-declaration` fails if any of the first four is missing or does not match.

## Tests

- `src/whatsNew/decide.test.ts` holds the decision and the classification of every stored key.
- `src/store/whatsNewStore.test.ts` holds what is written and when, including storage that cannot be read or written.
- `e2e/whats-new.spec.ts` holds the rest in a browser: who is told, the notice's place at five widths in three languages, the tab order and the announcement, the priority rules, the Help menu on desktop and mobile, and the text in every language.

The other specs pre-dismiss the guided tour, which makes their profile a returning one. So the shared fixture, and every spec that seeds the tour key by hand, also records the newest release note as announced and opened (`e2e/support/whatsNew.ts`). The id is read from the product's own list, so a new release needs no change there. `e2e/whats-new.spec.ts` is the one spec that switches this off.

## What is not decided here

- The text of future entries.
- How a temporary session treats the two keys. That belongs to issue #297.
