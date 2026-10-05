# Loop Studio

Loop Studio is a browser-based **visual systems editor and simulator** —
draw a Machinations-style diagram of pools, sources, drains, gates, and
converters, then run a deterministic, seeded simulation to see how the
system behaves over time. Built primarily for **game economies**, the same
step-based model generalises to inventory/supply chains, service queues,
cash flows, and other resource-flow systems; it's an independent, client-only
implementation — nothing is uploaded, the whole app runs in your browser, and
a graph is a plain JSON file you own. Work is kept in your browser profile
only when you say it is your own browser; on a shared computer a temporary
session neither reads nor saves stored work, author information or settings
([docs/storage-sessions.md](docs/storage-sessions.md)).

**Run it now: <https://cozy-loop-studio.pages.dev>** — available in
[18 languages](#languages), with five bundled Templates ranging from a small
production flow to a large game economy and a three-zone probability/pity
comparison.

![Loop Studio's two-tier toolbar in a temporary session, its orange-bordered Temporary session button beside the menu buttons, and the Coffee roastery Template, grouped into three labelled zone frames, a few steps into a run with the Timeline filling in below](docs/assets/hero-coffee.png)

## Key features

- **Visual diagram editor** — pools, sources, drains, gates, and converters;
  resources move between them on a deterministic, discrete-step simulation;
  select a region of nodes from the rail and move them together, or place nodes
  in a named frame that moves with its contents
- **Seeded RNG + Monte Carlo** — probabilistic gates and flows, and
  many-run outcome distributions with percentile bands
- **A small model language** — `parameter` / `register` nodes with a safe
  arithmetic expression grammar, guided `@`-autocomplete authoring, and a
  name-and-value read-back
- **Executable state connections** — `trigger` (+ delay), `activator`, and
  `label` Pool modifiers, with in-canvas pulse / tint / flash feedback
- **Simulation playback** — resources visibly depart, travel the real edge
  path, and arrive before values update, in dependency order
- **Data import & collaboration** — bring the numbers you already keep in a
  spreadsheet (CSV/TSV paste or upload) in as adjustable Parameters, with a
  manual refresh and a three-way diff — see [`docs/import-guide.md`](docs/import-guide.md);
  plus file-based project revisions & proposals for asynchronous
  collaboration — no accounts, no server
- **Runs anywhere** — an installable offline PWA, a portable single-file
  build, shareable links (optionally protected with a password), and a UI translated into
  [18 languages](#languages)

## Languages

<!-- LOCALES:BEGIN — the codes in this table are checked against the locale
     registry by `src/i18n/readmeLocales.test.ts`. Adding or removing a shipped
     language must update this table in the same change. -->

The UI ships in 18 languages, listed here the way the in-app picker orders
them. Pick one under **Settings → Language**; the first visit follows your
browser's language, and the choice is remembered on that device.

| Code | Language | In its own words |
|---|---|---|
| `ar` | Arabic | العربية |
| `zh-Hans` | Chinese (Simplified) | 简体中文 |
| `zh-Hant` | Chinese (Traditional) | 繁體中文 |
| `nl` | Dutch | Nederlands |
| `en` | English | English |
| `fr` | French | Français |
| `de` | German | Deutsch |
| `it` | Italian | Italiano |
| `ja` | Japanese | 日本語 |
| `ko` | Korean | 한국어 |
| `pt-BR` | Portuguese (Brazil) | Português (Brasil) |
| `pt-PT` | Portuguese (Portugal) | Português (Portugal) |
| `ru` | Russian | Русский |
| `es-419` | Spanish (Latin America) | Español (Latinoamérica) |
| `es-ES` | Spanish (Spain) | Español (España) |
| `th` | Thai | ไทย |
| `tr` | Turkish | Türkçe |
| `vi` | Vietnamese | Tiếng Việt |

<!-- LOCALES:END -->

Regional pairs are separate locales, not one catalog with a flag: a browser
asking for `pt-PT` gets European Portuguese, while `pt`, `pt-BR` and the
African Portuguese tags get Brazilian — and the same split holds for the two
Spanish and the two Chinese catalogs. See
[`docs/localization.md`](docs/localization.md) for the resolution order and
the per-locale notes.

## Representative use cases

The *3-zone gacha banner comparison* Template runs three pity/pickup rule
sets — **General/Free**, **Premium Standard** (hard-pity ceiling), and
**Premium Pickup** (hard-pity + a pickup guarantee) — side by side, 200 pulls
per zone under identical run settings. Once a run completes, its hit and
pickup rates are easy to compare; run Monte Carlo analysis to inspect the
distribution across many runs.

![The gacha Template after a completed 200-pull-per-zone run: five comparison cards reading real hit-rate/pickup-rate percentages, a Timeline with per-zone SSR/pickup curves, and a Register's expression read-back open in the right column](docs/assets/gacha-overview.png)

*Premium Pickup, framed on its own* — the hard-pity counter forces the next
roll's SSR once it hits the ceiling; whether that (or any ordinary) SSR lands
as pickup or standard depends on the `Pickup owed` guarantee flag, which a
miss sets and the next SSR consumes.

![The Premium Pickup zone alone after the same completed run: the hard-pity counter against its ceiling, the Pickup-owed guarantee flag, a real Pickup/Standard hit split, and a selected Pool's Inspector open in the right column](docs/assets/gacha-pickup-guarantee.png)

## Develop locally

```bash
npm install
npm run dev             # http://localhost:5173
npm run build            # -> dist/            static SPA, deploy anywhere
npm run build:portable   # -> dist-portable/   single self-contained index.html (file://)
npm run lint
npm test                 # vitest (engine + store unit tests)
npm run e2e              # Playwright browser end-to-end
```

Requires **Node 22+** (`.nvmrc` pins `22`). React + TypeScript + Vite,
[React Flow](https://reactflow.dev) for the canvas, Zustand for state; the
simulation engine is a dependency-free, unit-tested TypeScript module kept
separate from the UI. Deployed on Cloudflare Pages; CI on GitHub Actions.

## Technical reference

Behaviour is frozen in versioned spec documents; a behavioural change means a
new spec id, never an edit to a frozen one.

- **Engine & simulation** — [`SEMANTICS.md`](docs/specs/SEMANTICS.md), [`SEMANTICS-B1.md`](docs/specs/SEMANTICS-B1.md) (seeded RNG), [`SEMANTICS-B2.md`](docs/specs/SEMANTICS-B2.md) (Monte Carlo)
- **State connections** — [`SEMANTICS-S4.md`](docs/specs/SEMANTICS-S4.md) (`trigger` / `activator` / `label`; the latest of a sequential S1→S4 series, each frozen on its own)
- **Model language & expressions** — [`SEMANTICS-X.md`](docs/specs/SEMANTICS-X.md), [`SEMANTICS-M2.md`](docs/specs/SEMANTICS-M2.md) (the latest of a sequential M1→M2 series)
- **File formats & revisions** — [`SEMANTICS-W.md`](docs/specs/SEMANTICS-W.md) (Workspace), [`SEMANTICS-U.md`](docs/specs/SEMANTICS-U.md) (Share links, with [errata](docs/specs/SEMANTICS-U-ERRATA.md)), [`SEMANTICS-P.md`](docs/specs/SEMANTICS-P.md) (password-protected share links), [`SEMANTICS-R8.md`](docs/specs/SEMANTICS-R8.md) (revision projection/diff/Apply — the latest of a sequential R1→R8 series)

**Project revisions & proposals** — a worked, file-based walkthrough of the
create → propose → review → apply flow lives in
[`examples/revision/README.md`](examples/revision/README.md).

**Where the model could grow** (not on a committed schedule — continuous-time
models, spatial/grid models, external-engine integration for specialized
physics) is recorded in [`docs/product-direction.md`](docs/product-direction.md).

Additional feature-specific design documents (localization, mobile, module
system, large-graph readability, simulation playback, edge routing, data
import, …) live under [`docs/`](docs/).

## Latest — v0.18.1

A fix release: the menus answer the keyboard the same way.

- **Every menu button** opens at its first item from the keyboard, moves with the arrows,
  Home and End, and closes with Escape or Tab, back to its button
- **Settings and `⋯`** are disclosures you Tab through; Theme is a choice of one
- **On a phone**, a sheet takes focus when it opens, and Escape in a sheet opened from
  More goes back to More; the run bar and the update bar stay usable

## v0.18.0

The third-party open-source licenses, inside the app.

- **About Loop Studio → Third-party open-source licenses** shows the full license text of
  every third-party component the build includes, in its original English, in the same
  dialog; Back returns to About
- **Offline too**: the installed app has the text precached, and the single-file version
  carries it inside the file; the web and installed builds also open it as a text file
- **Loop Studio's own notice is unchanged**: the licenses cover the included components only

## v0.17.2

A fix release: the Temporary session button looks like the menu buttons beside it.

- **The same height, corners, text size and colours** as the toolbar's menu buttons, and
  their hover and keyboard focus; its orange border still marks a temporary session

## v0.17.1

A fix release: share links use the browser's own compression.

- **Share links are compressed with the browser's built-in Compression Streams**; the
  bundled compression code is removed. Existing links still open and the link format is
  unchanged
- **A browser without them** makes no link and says so, and the open diagram is kept

See [`CHANGELOG.md`](CHANGELOG.md) for the full notes of these releases, v0.17.0
(password-protected share links), v0.16.0 (the storage gate, temporary sessions and the
Storage and privacy area), the v0.15 releases and every earlier one.

## Credits

Created by Hanrim · [Cozy Shelter](https://cozyshelter.tistory.com/).

Loop Studio is an independent project and is not affiliated with or
endorsed by Machinations.io. Its modeling approach is informed by
publicly documented academic work on game-economy diagrams.

## Copyright

Copyright © 2026 Hanrim. All rights reserved.

Loop Studio includes third-party open-source components. Their licenses are in the app
(About Loop Studio → Third-party open-source licenses) and in every build
([`licenses/README.md`](licenses/README.md)); they cover those components only.
