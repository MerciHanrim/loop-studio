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
[18 languages](#languages), with eight bundled Templates: a seawater
desalination plant from intake to the city and the sea, checked over 90 days with
chemical deliveries every 14 days; one coffee roasting batch from the hopper to roasted
beans, a minute per step; a coffee roastery's daily operations; and, under
Games, an early MMO's levelling economy and gacha banners: three single-banner rule
sets and a three-zone probability/pity comparison.

![Loop Studio's workbench in a temporary session: the menu bar with its Temporary session button at the far end, the tool row, the list of every node on the left, and the Coffee roastery Template as node symbols with each name below, grouped into three labelled zone frames with its money in $/day, three steps into a run: the run row with Play and its Observation view button, and the Timeline filling in below](docs/assets/hero-coffee.png)

## Key features

- **Visual diagram editor** — pools, sources, drains, gates, and converters;
  resources move between them on a deterministic, discrete-step simulation;
  select a region of nodes from the rail and move them together, or place nodes
  in a named frame that moves with its contents
- **Kinds, units, timetables and run rules** — name a document's resource
  kinds and their units, say how long a step is, keep a kind balanced, drive a
  connection from a timetable, and run a stage by a rule, all made on screen
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

The bundled Templates come from different fields — a desalination plant's water
balance, a coffee roastery's daily operations, and a game's probability rules — because
the model is about flows and states, not about one genre.

The *Seawater desalination process* Template follows water from intake through
pretreatment, reverse osmosis and post-treatment to the city and the sea, in five
numbered frames. A day of demand drives it, six run rules move its stages, and its
six chemical tanks are refilled by deliveries every 14 days; it is checked over 90
days. The Timeline shows the tanks in one tab and, in the other, each stage's run
against its target and each delivery against what moved.

![The Seawater desalination Template fifteen days into a run: its five numbered process frames from Intake to Discharge and solids on the canvas, the list of every node on the left with each Pool's amount, the run row with Play and the Observation view button, and the Timeline on its Timetables and run rules tab showing the hypochlorite deliveries: what a delivery made available, dotted, standing at 300 kg per day above what moved, solid, with the words "available" and "moved" at the line ends](docs/assets/desalination-process.png)

The game example with the most moving parts is the *3-zone gacha banner
comparison* Template, which runs three pity/pickup rule
sets — **General/Free**, **Premium Standard** (hard-pity ceiling), and
**Premium Pickup** (hard-pity + a pickup guarantee) — side by side, 200 pulls
per zone under identical run settings. Once a run completes, its hit and
pickup rates are easy to compare; run Monte Carlo analysis to inspect the
distribution across many runs.

![The 3-zone gacha Template after a completed 200-pull-per-zone run, its Comparison row across the top of the canvas with five cards: 200 pulls per zone, the hit rates of General / Free at 0.5 %, Premium Standard at 1 % and Premium Pickup at 2 %, and Premium Pickup's pickup rate at 1.5 %; below them only the top of the General / Free zone and the left edge of Premium Standard; the run row at its end with Replay and the Observation view button; the Timeline with each zone's SSR count and the Pickup wins as stepped lines; and the selected pickup-rate Register's read-back, Pickup wins 3 / Pulls per zone 200 = 1.5 %, in the right panel](docs/assets/gacha-overview.png)

How the Premium Pickup zone's hard-pity counter and pickup guarantee work, with
that zone framed on its own, is in
[`docs/gacha-banner-zones.md` §GZ5](docs/gacha-banner-zones.md#gz5-engine-mapping--the-pickup-guarantee-zone-3-only).

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

- **Engine & simulation** — [`SEMANTICS.md`](docs/specs/SEMANTICS.md), [`SEMANTICS-B1.md`](docs/specs/SEMANTICS-B1.md) (seeded RNG), [`SEMANTICS-B2.md`](docs/specs/SEMANTICS-B2.md) (Monte Carlo), [`SEMANTICS-E.md`](docs/specs/SEMANTICS-E.md) (a step's moves are exact and recorded; what is moved and what is shown)
- **State connections** — [`SEMANTICS-S4.md`](docs/specs/SEMANTICS-S4.md) (`trigger` / `activator` / `label`; the latest of a sequential S1→S4 series, each frozen on its own)
- **Model language & expressions** — [`SEMANTICS-X.md`](docs/specs/SEMANTICS-X.md), [`SEMANTICS-M7.md`](docs/specs/SEMANTICS-M7.md) (a table of what a line can move — the latest of a sequential M1→M7 series; [`SEMANTICS-M6.md`](docs/specs/SEMANTICS-M6.md) is run rules, [`SEMANTICS-M5.md`](docs/specs/SEMANTICS-M5.md) is timetables, [`SEMANTICS-M4.md`](docs/specs/SEMANTICS-M4.md) units and the step length, [`SEMANTICS-M3.md`](docs/specs/SEMANTICS-M3.md) resource kinds and per-kind conservation)
- **File formats & revisions** — [`SEMANTICS-W2.md`](docs/specs/SEMANTICS-W2.md) (Workspace — the latest of a sequential W1→W2 series), [`SEMANTICS-U.md`](docs/specs/SEMANTICS-U.md) (Share links, with [errata](docs/specs/SEMANTICS-U-ERRATA.md)), [`SEMANTICS-P.md`](docs/specs/SEMANTICS-P.md) (password-protected share links), [`SEMANTICS-R8.md`](docs/specs/SEMANTICS-R8.md) (revision projection/diff/Apply — the latest of a sequential R1→R8 series)

**Project revisions & proposals** — a worked, file-based walkthrough of the
create → propose → review → apply flow lives in
[`examples/revision/README.md`](examples/revision/README.md).

**Where the model could grow** (not on a committed schedule — continuous-time
models, spatial/grid models, external-engine integration for specialized
physics) is recorded in [`docs/product-direction.md`](docs/product-direction.md).

Additional feature-specific design documents (localization, mobile, module
system, large-graph readability, simulation playback, edge routing, data
import, …) live under [`docs/`](docs/).

## Latest — v0.34.0

Fixes found in a review of the whole code, across running, editing, data and the keyboard.

- **Runs and charts**: on the phone, the run bar says why Play paused; a Pool keeps one colour
  in Live and Distribution; a run rule's strip puts a step where the timetable strips do;
  Cancel stops a Monte Carlo run that has just started, and the dialog says how a small run
  will really run; renaming no longer resets the run
- **Keyboard**: Escape no longer closes a dialog while you type with an input method, clears
  the phone's language search first, and closes an open Timeline popover first in the
  observation view; keyboard focus shows in Storage and privacy, the phase popover and the
  Relations list
- **Editing**: selecting a frame lets go of the nodes selected before it; dragging a bend point
  or drawing a frame ends cleanly when the window loses the pointer; arrow keys with a modifier
  no longer move a node; a colour typed in the Hex field stays with its node; a minus in a
  Pool's capacity no longer makes it unlimited, a trigger's Delay keeps whole steps, and a
  Parameter's fields say when what you type is not a number
- **Data import and refresh**: the wizards keep your choices when you go Back and Next, take a
  number on Enter or on leaving a field, keep each table's problems with that table, and say
  what in a file or the diagram they cannot read
- **Downloads**: in the run and Monte Carlo CSVs, a name that begins with `=`, `+`, `-` or `@`
  opens as text

## v0.33.1

Fixes to what is already there, on the phone and in the right-to-left and Japanese interfaces.

- **Phone**: a pinch keeps what is under your fingers in place; sharing or exporting keeps the
  canvas lock and the Timeline's series; the first-run tour matches the layout when the phone
  is held sideways
- **Save selected structure** works on a selection that holds a delivery line
- **Data refresh errors** say which table, row, column and cell is wrong
- **Right-to-left sentences**: a connection in a review line reads from its start to its end,
  and names and ids inside a few more sentences keep their own direction
- **Japanese text** is no longer drawn bold everywhere on a computer with Noto Sans JP installed
  in one weight only

## v0.33.0

Run engine fixes, documents that say when they cannot run, and a canvas that stays readable
when zoomed out.

- **Run engine fixes**: the losses, and the moves of more than was taken, found between Gates
  and Converters with several feeds, in loops and with very small amounts
- **A document that cannot run says so**: right after a reload and everywhere a run can start,
  with its reason; a Monte Carlo run stays with the document it started on
- **A coffee roasting batch** joins the Templates
- **Readable when zoomed out**: zone names, the selected node's name and paths, and keyboard
  focus stay visible at the overview
- **The run row names the current phase**, and keeps its controls in place when a run ends
- **Safer edits**: moving through the step length no longer declares one hour, a change of
  kind counts as a change to the model, and Undo after a project revision export keeps the
  revision
- **Phone**: a selection no longer hides More and the canvas buttons, and Details opened from
  the keyboard puts focus in its sheet

## v0.32.0

Timetables, run rules and units, shown in a seawater desalination process example, and a
Timeline built for reading a run.

- **Timetables and run rules**: a connection can follow a rate that changes over time, as a
  plan or as what a supply can give, and a stage can be run by a rule; both are made on screen,
  and the Timeline draws each under the chart, with a word at each line's end
- **Resource kinds with units**: a document can name its kinds and their units, say how long
  one step is, and keep a kind balanced; the Inspector, the Timeline and downloads read in the
  units you chose
- **The seawater desalination process**: a facility example from intake to the city and the
  sea, checked over 90 days, with chemical deliveries every 14 days and a pause when the plant
  first stops
- **A Timeline for reading a run**: one height whatever it holds, strips in a tab of their own,
  a step preview under the pointer, and one meaning for each line pattern
- **An observation view**: hides the side panels and the tool row while a run plays
- **Node icons**, a state light on every Gate, and the game examples under Templates ▸ Games
- **The run engine no longer loses resources** between Gates, Converters and capped Pools

See [`CHANGELOG.md`](CHANGELOG.md) for the full notes of these releases, v0.31.0 (eighteen
languages again, clearer run buttons, and keyboard focus visible everywhere it was not),
v0.30.1 (values in
the model list, larger small text, and automatic lines with fewer steps next to a node),
v0.30.0 (a shorter
File menu with Templates ▸ and Export ▸ submenus, and no minimap), v0.29.0 (the
workbench: a menu bar, a tool row, the node list and the properties panel around the canvas,
and nodes as symbols; [`docs/workbench.md`](docs/workbench.md)), v0.28.4 (starting
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

Loop Studio is directed by Hanrim, who defines the product direction and
concept and tests the application. Lumi (OpenAI Codex) works on design and
review; Daisy (Claude) writes the documentation and code. Lumi and Daisy also
help with testing when needed.

Loop Studio is an independent project and is not affiliated with or
endorsed by Machinations.io. Its modeling approach is informed by
publicly documented academic work on game-economy diagrams.

## Copyright

Copyright © 2026 Hanrim. All rights reserved.

Loop Studio includes third-party open-source components. Their licenses are in the app
(About Loop Studio → Third-party open-source licenses) and in every build
([`licenses/README.md`](licenses/README.md)); they cover those components only.
