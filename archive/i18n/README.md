# Archived translations

Loop Studio supports **English and Korean** only. From 2026-10, the other sixteen languages it once shipped are kept here as translation material, and nothing else.

## Status

These sixteen are **not a supported language**. Their files are:

- **outside the build:** nothing under `src/` imports them, so they are not part of any bundle;
- **outside the checks:** `tsc`, the unit tests (`vite.config.ts` excludes `archive/**`) and the e2e suites do not read them;
- **not kept up to date:** keys added to or removed from the English catalog after the archive date are not reflected here.

A user who had chosen one of these languages sees English from the next start. Their documents are not changed.

## What is here

| Folder | Content |
| --- | --- |
| `locales/<code>/` | the UI catalog of each language (`ui`, `canvas`, `inspector`, `templates`, `dataImport`, `index`), as it was at the archive date |
| `templateLabels/<code>.ts` | the bundled templates' node labels in that language |
| `tests/` | the unit tests that were written for one language each, and (`*.multilocale.test.ts`) the eighteen-locale versions of tests that now cover English and Korean only |
| `e2e/` | the browser specs that were written for one language each, and the eighteen-locale versions of specs that now cover English and Korean only |

The languages: `ar`, `de`, `es-419`, `es-ES`, `fr`, `it`, `ja`, `nl`, `pt-BR`, `pt-PT`, `ru`, `th`, `tr`, `vi`, `zh-Hans`, `zh-Hant`.

## Bringing a language back

The localisation infrastructure stays in the product: the registry (`src/i18n/registry.ts`), ICU formatting, reading direction, and the `check-i18n` / `check-template-labels` checks. To support a language again:

1. Move its folder back to `src/i18n/locales/<code>/` and its dictionary to `src/i18n/templateLabels/<code>.ts`.
2. Add its entry to the registry, take it out of `RETIRED_LOCALES`, add its `language.*` display-name key to the English and Korean catalogs, add its dictionary loader to `src/i18n/templateLabels/dicts.ts`, and run `npm run gen:known-labels`.
3. Bring its catalog up to the current English key set. `tsc` and `check-i18n` list every missing and extra key.
4. Restore the tests and specs that belong to it from `tests/` and `e2e/`, updated to the current product.
5. Check it on screen.

The registry's history in git keeps each language's former entry and its notes (number format, plural rules, fonts).
