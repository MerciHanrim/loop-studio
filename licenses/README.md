# Third-party notices

Loop Studio ships third-party code and fonts. Every build carries their notices: the full licence text of each shipped component, its copyright lines and any NOTICE file.

| Build | Where the notices are |
|---|---|
| web (`npm run build`) | `dist/THIRD_PARTY_NOTICES.txt` |
| PWA (`npm run build:pwa`, and the Cloudflare Production build) | `THIRD_PARTY_NOTICES.txt` in the output, precached by the service worker |
| portable (`npm run build:portable`) | inside the single HTML file, in `<template id="third-party-notices">` |

## The files here

- `third-party-manifest.json` is generated. For each build it pins every shipped component's name, version, SPDX licence, licence and NOTICE files with their SHA-256, and copyright lines, plus the SHA-256 of the whole notices text. Every build compares itself with it and **fails** on any difference.
- `registry.json` is written by hand. It lists shipped code the bundler's module graph does not show (the Vite and Rolldown runtime helpers, and the PWA service worker's Workbox runtime and templates), with the evidence that proves each one is really in the output, and the reviews some licences need.
- A registry item can name its licence files one by one, each with what it `covers`, and a `licenceSummary`. Vite's `LICENSE.md` holds Vite's own MIT licence followed by the licences of the code Vite bundles, and Rolldown ships its own MIT `LICENSE` and a separate `THIRD-PARTY-LICENSE`; both are listed as "MIT + bundled third-party notices", with each file pinned by its own SHA-256. A summary must start with the component's SPDX licence, which is still the one the rules judge.

## Showing the notices: text, never HTML

Licence texts are third-party input. Wherever Loop Studio shows them, including the licence screen, they are text:

- The portable file carries them in `<template id="third-party-notices">` with `&`, `<` and `>` escaped, so no licence text can close the template or add an element. Read them with `template.content.textContent`; the result is byte-identical to `THIRD_PARTY_NOTICES.txt`.
- Render them as text (a React text child or `textContent`). Never pass them through `innerHTML` or `dangerouslySetInnerHTML`.
- The writer refuses a text holding U+0000 or CR, which an HTML parser would drop or rewrite.

The rules are in `scripts/third-party-notices/core.mjs` (`portableTemplate`, `readPortableTemplate`); a hostile text is tested there and in a real browser in `e2e/portable-file.spec.ts`.

## When a build fails on the notices

A dependency was added, removed or upgraded, or its licence files changed. Run, offline:

```
npm run licenses:update
```

It runs the three builds in update mode and rewrites `third-party-manifest.json`. Review `git diff licenses/` before committing it: every line is a change in what Loop Studio ships.

The update itself refuses to write when a component breaks a rule:

- the licence is missing, `UNKNOWN` or not a supported SPDX expression;
- the licence is not MIT, ISC, BSD-3-Clause or OFL-1.1. Apache-2.0 is accepted only for a component that `registry.json` marks as reviewed, so a new Apache-2.0 package needs its own review entry;
- GPL, LGPL, AGPL and similar licences are never accepted by this check;
- an `A OR B` licence has no recorded choice in `registry.json`;
- there is no licence file, or no copyright line and none recorded;
- a `registry.json` item is marked `unresolved`, or its evidence is not in the build.

## The checks

- The build step is `scripts/third-party-notices/vite-plugin.mjs`. It reads the module graph, Vite's own `build.license` list (as evidence, then removed from the output), the fonts named by CSS, and the registry. Its rules are in `scripts/third-party-notices/core.mjs`, tested in `scripts/third-party-notices.test.mjs`.
- `npm run check:third-party-notices` runs after the three builds. It checks that the notices are in each output, match the manifest, are precached by the PWA, and that every service-worker item's marker is present. It also checks that the portable copy is escaped and pinned to the same bytes as the web file, and that neither the notices nor the manifest hold a local absolute path.

Loop Studio itself is not open source: "Copyright © 2026 Hanrim. All rights reserved." These notices cover the third-party components only.
