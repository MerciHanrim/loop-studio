# Loop Studio

Loop Studio is a browser-based **visual systems editor and simulator** for
modelling **how resources flow and how state changes** over time. Draw a
diagram of pools, sources, drains, gates and converters, connect the values
and conditions that drive them, then run a deterministic, seeded simulation —
step by step, or as many runs at once — to see how the system behaves. The
same step-based model fits a game economy, a production line or supply chain,
a service queue, a budget or cash flow, and any other system where amounts
move and rules react to them. It's an independent, client-only implementation
— nothing is uploaded, the whole app runs in your browser, and a graph is a
plain JSON file you own. Work is kept in your browser profile
only when you say it is your own browser; on a shared computer a temporary
session neither reads nor saves stored work, author information or settings
([docs/storage-sessions.md](docs/storage-sessions.md)).

**Run it now: <https://cozy-loop-studio.pages.dev>** — available in
[18 languages](#languages), with eight bundled Templates ranging from two
small production flows and a coffee roastery's daily operations to an early MMO's
levelling economy and gacha banners: three single-banner rule sets and a
three-zone probability/pity comparison.

![Loop Studio's workbench in a temporary session: the menu bar with its Temporary session button at the far end, the tool row, the list of every node on the left, and the Coffee roastery Template as node symbols with each name below, grouped into three labelled zone frames with its money in $/day, a few steps into a run with the Timeline filling in below](docs/assets/hero-coffee.png)

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
  build, shareable links (optionally protected with a password), and a UI in
  [18 languages](#languages)

## Languages

<!-- LOCALES:BEGIN — the codes in this table are checked against the locale
     registry by `src/i18n/readmeLocales.test.ts`. Adding or removing a shipped
     language must update this table in the same change. -->

The UI ships in 18 languages, listed here the way the in-app picker orders
them. Pick one under **View → Language**; the first visit follows your
browser's language when it is one of these, and English otherwise, and the
choice is remembered on that device.

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

The text added or changed in the 2026-10 redesign is a translation draft in
every language but English and Korean: it has not yet been read by a native
speaker. [`docs/localization.md`](docs/localization.md) §L2.0a records each
language's review status, and describes how the language is chosen.

## Representative use cases

The bundled Templates come from different fields — a small production flow, a
coffee roastery's daily operations, and a game's probability rules — because
the model is about flows and states, not about one genre. The one with the most
moving parts is a game example:

The *3-zone gacha banner comparison* Template runs three pity/pickup rule
sets — **General/Free**, **Premium Standard** (hard-pity ceiling), and
**Premium Pickup** (hard-pity + a pickup guarantee) — side by side, 200 pulls
per zone under identical run settings. Once a run completes, its hit and
pickup rates are easy to compare; run Monte Carlo analysis to inspect the
distribution across many runs.

![The gacha Template after a completed 200-pull-per-zone run, its comparison row above the zone frames side by side below it: five comparison cards reading real hit-rate/pickup-rate percentages, a Timeline with per-zone SSR/pickup curves, and a Register's expression read-back open in the right panel](docs/assets/gacha-overview.png)

*Premium Pickup, framed on its own* — the hard-pity counter forces the next
roll's SSR once it hits the ceiling; whether that (or any ordinary) SSR lands
as pickup or standard depends on the `Pickup owed` guarantee flag, which a
miss sets and the next SSR consumes.

![The Premium Pickup zone alone after the same completed run, with the Timeline and the node list folded away: the hard-pity counter against its ceiling, the Pickup-owed guarantee flag, a real Pickup/Standard hit split, and a selected Pool open in the right panel with its current amount](docs/assets/gacha-pickup-guarantee.png)

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

## Latest — v0.31.0

Eighteen languages again, and a round of workbench clarity.

- **Eighteen languages**: besides English and Korean, the interface is available again in
  Arabic, Chinese (Simplified and Traditional), Dutch, French, German, Italian, Japanese,
  Portuguese (Brazil and Portugal), Russian, Spanish (Latin America and Spain), Thai, Turkish
  and Vietnamese; the text added with the redesign is a translation draft in these languages.
  Arabic text reads right to left while the layout keeps the same places as every language
- **Clearer run buttons**: Reset, Step and Play are redrawn at full size, Play is filled with
  the accent colour, and the main button keeps one width while its label changes
- **Keyboard focus visible everywhere it was not**: on the chosen canvas tool and connection
  kind, on the open List, Properties and Focus toggles, in the model list next to the selection
  bar, and around every menu row — in high-contrast mode too
- **The model list follows the canvas**: it scrolls to a node selected on the canvas, keeps the
  kind heading in view while you scroll, and marks every selected node of a multiple selection
- **Smaller fixes**: View ▸ Filters closes the menu; a region-select drag can start on a
  connection or a frame's name; Run settings stays put as the step count grows

## v0.30.1

The workbench and the automatic lines, tidied.

- **Values in the model list**: each Parameter's and Pool's value at the end of its row, with
  the name giving way first when room is short; bold kind headings with counts
- **Larger small text**: the run bar's and the timeline's smallest labels and buttons
- **No stray text selection**: a drag that starts between the menus, on a tool-row label or on
  the status bar no longer selects their words
- **Automatic lines**: fewer steps and hooks next to a node, room kept for the arrowhead, and
  a bend point placed by a port kept on the line

## v0.30.0

The menus and the canvas, tidied.

- **A shorter File menu**: names only, with Templates ▸ and Export ▸ submenus; the item you
  point at is described at the foot of the menu
- **Early MMO is back under Templates**, after Coffee, as it was — eight Templates
- **Check marks beside their names** in the View menu and Edit ▸ Edit lock
- **No minimap**: Reset view and Fit show the whole diagram; panning and zooming are unchanged

## v0.29.0

The workbench release: the desktop editing screen is redesigned as a workbench
([`docs/workbench.md`](docs/workbench.md)).

- **The workbench**: a menu bar, a tool row, a searchable list of every node on the left, the
  properties panel on the right (what the selection does in the model first, then its fields),
  the run controls and timeline under the canvas, and a status bar; the list and the panel fold
  at narrower widths
- **Nodes as symbols**: each kind of node is a small symbol with its number inside and its name
  below; your documents keep their positions, names, formulas and line routes
- **New colours, light and dark**, and names that stay when you zoom all the way out
- **Structures in the File menu**: save a selected structure to a file and insert such a file
  as one undo step; the Insert module menu is gone
- **Languages at this release**: English and Korean only — the other sixteen returned in
  v0.31.0

See [`CHANGELOG.md`](CHANGELOG.md) for the full notes of these releases, v0.28.4 (starting
and finishing a connection responds faster), v0.28.3 (Undo and Redo leave nothing selected),
v0.28.2 (resource connections on two sides of one port branch on their own), v0.28.1 (a
connection's label keeps off the bend points you placed on it), v0.28.0 (a
connection turned around without drawing it again), v0.27.0 (a
connection's end moves without drawing the connection again), v0.26.2 (playback
in the chosen colours, and the moving `+N` badges kept off the nodes), v0.26.0 (the
compact node with its name outside, connections from any side, notices under the toolbar),
v0.25.0 (nodes
on a grid, orthogonal connections around them, editable connection shapes and text inside
nodes), v0.24.0 (three
playback speed tiers, and a speed choice and fewer moving markers on the phone), v0.23.0 (a Pool
lights up as a marker arrives and a Converter shows that it converts), v0.22.0 (the
Gate's path lights up and a `+N` rides beside every moving marker), v0.21.4 (the
canvas controls keep their place while editing is locked), v0.21.3 (the edit
lock is exact, and its button shows the state), v0.21.2 (values
and detail rows sit inside their node), v0.21.1 (Focus
mode dims the connections too), v0.21.0 (compact
nodes, so more of a large graph fits in view), v0.20.0 (flow
colours in the minimap and the timeline), v0.19.0 (flow
colours on nodes and connections), v0.18.2 (the
guided tour says each step once), v0.18.1 (one
keyboard contract for every menu), v0.18.0 (the third-party open-source licenses in the About dialog), v0.17.2 (the
Temporary session button drawn like the menu buttons), v0.17.1 (share
links compressed with the browser's own Compression Streams), v0.17.0
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
