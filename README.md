# Loop Studio

Loop Studio is a browser-based **visual systems editor and simulator** —
draw a Machinations-style diagram of pools, sources, drains, gates, and
converters, then run a deterministic, seeded simulation to see how the
system behaves over time. Built primarily for **game economies**, the same
step-based model generalises to inventory/supply chains, service queues,
cash flows, and other resource-flow systems; it's an independent, client-only
implementation — nothing is uploaded, the whole app runs in your browser, and
a graph is a plain JSON file you own.

**Run it now: <https://cozy-loop-studio.pages.dev>** — available in English,
한국어, and 日本語, with five bundled Templates ranging from a small
production flow to a large game economy and a three-zone probability/pity
comparison.

![Loop Studio's two-tier toolbar and the Coffee roastery Template, grouped into three labelled zone frames, a few steps into a run with the Timeline filling in below](docs/assets/hero-coffee.png)

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
  build, shareable links, and a localized UI (EN / KO / JA)

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
- **File formats & revisions** — [`SEMANTICS-W.md`](docs/specs/SEMANTICS-W.md) (Workspace), [`SEMANTICS-U.md`](docs/specs/SEMANTICS-U.md) (Share links), [`SEMANTICS-R8.md`](docs/specs/SEMANTICS-R8.md) (revision projection/diff/Apply — the latest of a sequential R1→R8 series)

**Project revisions & proposals** — a worked, file-based walkthrough of the
create → propose → review → apply flow lives in
[`examples/revision/README.md`](examples/revision/README.md).

**Where the model could grow** (not on a committed schedule — continuous-time
models, spatial/grid models, external-engine integration for specialized
physics) is recorded in [`docs/product-direction.md`](docs/product-direction.md).

Additional feature-specific design documents (localization, mobile, module
system, large-graph readability, simulation playback, edge routing, data
import, …) live under [`docs/`](docs/).

## Latest — v0.12.0

- **Frames that carry their contents** — dragging a group frame moves the nodes
  inside it (`Alt` moves the frame alone), as one undo entry, with nothing new
  written to the file
- **Frames from the keyboard** — focus, move, resize and delete a frame without
  a pointer, each action announced
- **An import wizard that explains itself** — a quick start with a one-click
  example, role help on every column, inline errors that point at the cell, and
  a review breakdown that matches what the commit creates
- **An accessibility pass** — forced-colours edge and control tells, ≥ 3:1
  control boundaries, larger and higher-contrast descriptive text, Korean word
  wrapping, arrow-key menus, and focus that stays where you put it
- **Fixes** — an arrow-key node move is one undo entry; a Register expression no
  longer reorders what you type; the import wizard no longer takes focus back
  mid-sentence

No save-format change and no migration: v0.11.0 files open unchanged.

See [`CHANGELOG.md`](CHANGELOG.md) for the full v0.12.0 notes, the v0.11.0 and
v0.10.x releases and every earlier one.

## Credits

Created by Hanrim · [Cozy Shelter](https://cozyshelter.tistory.com/).

Loop Studio is an independent project and is not affiliated with or
endorsed by Machinations.io. Its modeling approach is informed by
publicly documented academic work on game-economy diagrams.

## Copyright

Copyright © 2026 Hanrim. All rights reserved.
