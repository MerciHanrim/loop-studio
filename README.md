# Loop Studio

A browser-based editor and simulator for **Machinations-style diagrams** — model a
game's economy or feedback systems as resources flowing between pools, sources,
drains, gates, and converters, then run the model to see how it behaves over time.

> Status: **early preview.** The diagram editor works; the simulation engine is
> under construction. Execution semantics are being pinned down in
> [`SEMANTICS.md`](SEMANTICS.md) as they land.

## Why

Machinations is a well-established notation (Dormans & Adams, *Game Mechanics:
Advanced Game Design*) and a commercial SaaS. Loop Studio is an independent,
open, client-only take on the same idea: nothing is uploaded, the whole app runs
in your browser, and a graph is a plain JSON file you own.

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # -> dist/  (static, deploy anywhere)
npm run lint
```

Requires Node 20+.

## Stack

- React + TypeScript + Vite
- [React Flow](https://reactflow.dev) (`@xyflow/react`) for the node canvas
- Zustand for graph + simulation state
- Simulation engine is a dependency-free TypeScript module (`src/engine/`, WIP),
  kept separate from the UI so its behaviour can be unit-tested against
  `SEMANTICS.md`

## Layout

| Path | What |
|---|---|
| `src/model/` | Graph data types, node factories, JSON load/save |
| `src/store/` | Zustand store — nodes, edges, selection, persistence |
| `src/components/` | Toolbar, canvas, inspector, custom node & edge views |
| `src/engine/` | Simulation engine (WIP) |

## Roadmap

1. ✅ Diagram editor — add/connect/edit nodes, JSON import/export, autosave
2. ⬜ Deterministic engine — step/play/reset, single-run timeline chart
3. ⬜ Randomness + Monte Carlo — dice, probabilistic gates, percentile bands
4. ⬜ Onboarding — starter templates, guided tour, inline docs, KO/EN
5. ⬜ Ship — GitHub Pages + offline PWA, shareable URLs

## Credits

By Hanrim · [Cozy Shelter](https://cozyshelter.tistory.com). Not affiliated with
Machinations.io. The diagram notation and execution model derive from the
publicly documented academic work, not from Machinations' software.
