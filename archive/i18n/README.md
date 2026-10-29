# Archived translations — restored

In 2026-10 Loop Studio shipped English and Korean only, and the other sixteen languages were kept here as translation material. On 2026-10-28/29 all sixteen were brought back into the product (`docs/localization.md` §L2.0a): their catalogs are in `src/i18n/locales/<code>/` and their template labels in `src/i18n/templateLabels/<code>.ts` again, and the strings added since the archive are translation drafts before native review.

## What is still here

| Folder | Content |
| --- | --- |
| `tests/` | the eighteen-locale versions (`*.multilocale.test.ts`) of unit tests, as they were at the archive date. The current tests cover every shipped language again; these are kept as the record of the shapes the earlier versions had |
| `e2e/` | the eighteen-locale versions of browser specs as they were at the archive date, kept the same way, and `i18n-ar-isolation.spec.ts`, whose contract now lives in `e2e/rtl-bidi-isolation.spec.ts` (run under `ar`) |

None of it is built or checked: nothing under `src/` imports it, `vite.config.ts` excludes `archive/**` from the unit tests, and the e2e suites do not read it.
