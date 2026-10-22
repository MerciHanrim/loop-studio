# Change declarations

One file per change that touches anything a build reads or ships, or the app version: `<slug>.json`, the slug in lower-case letters, digits and hyphens.

```json
{ "type": "user-facing", "changelog": "- **Structures**: save a selection and insert it into another document." }
```

The `changelog` value is one line this change adds under `## Unreleased` in [CHANGELOG.md](../CHANGELOG.md). It must be there, and it must not have been there before this change.

```json
{ "type": "internal", "reason": "Why no changelog entry is needed, in words." }
```

A change does not raise the app version: that happens only when a release is approved, and then the version only goes up.

`npm run check:change-declaration` reads these. The rule and its reasons are in [docs/release-notes.md](../docs/release-notes.md).

Files here are a record. A declaration that is on `main` is never edited, renamed or removed. Declarations written before 2026-10 name an in-app release note (`releaseNoteId`); the in-app notes were removed, and those files stay as the record they are.
