# Loop Studio

A browser-based editor and simulator for **Machinations-style diagrams** — model a
game's economy or feedback systems as resources flowing between pools, sources,
drains, gates, and converters, then run the model to see how it behaves over time.

**Live app: <https://cozy-loop-studio.pages.dev>**

> Status: **working preview.** The diagram editor and the simulation engine
> (deterministic + seeded randomness + Monte Carlo) are usable today. Execution
> semantics are pinned down in frozen spec documents (see [Semantics](#semantics));
> state connections are landing slice by slice.

## Why

Machinations is a well-established notation (Dormans & Adams, *Game Mechanics:
Advanced Game Design*) and a commercial SaaS. Loop Studio is an independent,
open, client-only take on the same idea: nothing is uploaded, the whole app runs
in your browser, and a graph is a plain JSON file you own.

## Develop

```bash
npm install
npm run dev            # http://localhost:5173
npm run build          # -> dist/            static SPA, deploy anywhere
npm run build:portable # -> dist-portable/   single self-contained index.html (file://)
npm run lint
npm test               # vitest (engine + store unit tests)
npm run e2e            # Playwright browser end-to-end
npm run e2e:dist      # Playwright against the production build
```

Requires **Node 22+** (`.nvmrc` pins `22`; `engines` requires `>=22.12.0`).

## Stack

- React + TypeScript + Vite
- [React Flow](https://reactflow.dev) (`@xyflow/react`) for the node canvas
- Zustand for graph + simulation state
- The simulation engine is a dependency-free TypeScript module (`src/engine/`),
  kept separate from the UI so its behaviour can be unit-tested against the
  frozen spec documents
- Monte Carlo runs on a Web Worker on a secure origin, with a cooperative
  main-thread fallback for `file://` / insecure origins
- `vite-plugin-singlefile` produces a portable, offline single-file build
- Deployed on **Cloudflare Pages**; CI on **GitHub Actions** (`main` is
  protected — PR + green `checks` / `e2e` required)

## Semantics

Behaviour is frozen in versioned spec documents; a behavioural change means a new
spec id, never an edit to a frozen one.

| Doc | Spec id | Covers |
|---|---|---|
| [`SEMANTICS.md`](SEMANTICS.md) | — | Engine A: deterministic step / pull / push, gates, converters, conservation |
| [`SEMANTICS-B1.md`](SEMANTICS-B1.md) | `loop-rng/1` | seeded keyed RNG, random flow (`1-3`, `2D6`), probabilistic gates |
| [`SEMANTICS-B2.md`](SEMANTICS-B2.md) | `loop-mc/1`, `loop-mc-seed/1` | Monte Carlo: many runs, per-timestep bands, final-value distribution |
| [`SEMANTICS-S.md`](SEMANTICS-S.md) | `loop-state/1` | state connections: `trigger` (+ delay), `activator`, `label` — historical baseline |
| [`SEMANTICS-S2.md`](SEMANTICS-S2.md) | `loop-state/2` | current: inherits v1; changes only the `label` event report shape to `delta` + `clampAdjustment` |

## Layout

| Path | What |
|---|---|
| `src/model/` | Graph data types, node factories, JSON load/save |
| `src/store/` | Zustand store — nodes, edges, selection, persistence, sim state |
| `src/components/` | Toolbar, canvas, inspector, custom node & edge views, Monte-Carlo dialog + charts |
| `src/engine/` | Simulation engine — deterministic step, RNG, Monte Carlo, state connections |
| `e2e/` | Playwright specs (app, portable `file://`, production build) |
| `examples/` | Importable graphs — `risky-factory.json` + an Engine-B verification fixture |

## Roadmap

- ✅ Diagram editor — add / connect / edit nodes, JSON import/export, autosave
- ✅ Deterministic engine (Engine A) — step / play / reset, single-run timeline
- ✅ Engine B — seeded RNG, random flows, probabilistic gates
- ✅ Monte Carlo — engine, dialog UI, percentile bands, result export/import
- ✅ Cloudflare Pages deployment + GitHub Actions CI + protected `main`
- ✅ Onboarding, part 1 — starter templates, verification fixture, Risky Factory example
- ◐ State connections (`loop-state/1` → `loop-state/2`)
  - ✅ Trigger + delay
  - ✅ Activator + comparison conditions
  - ◐ Label modifier — value semantics `loop-state/1`, event report `loop-state/2` *(current PR)*
  - ☐ Inspector fields + in-canvas state pulse / tint / flash
- ☐ Onboarding, part 2 — guided tour, inline docs, KO/EN localization
- ☐ Ship — workspace export, shareable URLs, offline PWA
- ☐ Advanced Monte-Carlo worker-count setting

## Credits

By Hanrim · [Cozy Shelter](https://cozyshelter.tistory.com). Not affiliated with
Machinations.io. The diagram notation and execution model derive from the
publicly documented academic work, not from Machinations' software.
