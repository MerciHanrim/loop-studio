# Change declarations

One file per change that touches anything a build reads or ships, or the app version: `<slug>.json`, the slug in lower-case letters, digits and hyphens.

```json
{ "type": "user-facing", "releaseNoteId": "release:0.15.0" }
```

```json
{ "type": "internal", "reason": "Why no release note is needed, in words." }
```

`npm run check:change-declaration` reads these. The rule and its reasons are in [docs/release-notes.md](../docs/release-notes.md).

Files here are a record. A declaration that is on `main` is never edited, renamed or removed.
