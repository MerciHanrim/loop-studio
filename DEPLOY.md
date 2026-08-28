# Deploying Loop Studio

Loop Studio is a static single-page app (`dist/`). It is deployed on
**Cloudflare Pages**, served at the domain root `/`.

Why Cloudflare Pages:

- short default URL (`cozy-loop-studio.pages.dev`), served at `/` — no
  GitHub-Pages-style `/loop-studio/` base path to special-case
- HTTPS everywhere ⇒ the Monte-Carlo **Web Worker path is active** (a `file://`
  or insecure origin falls back to the slower cooperative path)
- auto build + deploy on every push to `main`
- custom domain is a one-click add later

---

## One-time setup (manual — needs a Cloudflare account holder)

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git** → authorise the GitHub app and pick
   `MerciHanrim/loop-studio`.
2. Build settings:

   | field | value |
   |---|---|
   | Project name | `cozy-loop-studio` (⇒ `cozy-loop-studio.pages.dev`) |
   | Production branch | `main` |
   | Framework preset | *None* (Vite) |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
   | Root directory | *(repo root)* |

3. Node version: the repo pins it in **`.nvmrc`** (`22`). Cloudflare reads
   `.nvmrc` automatically; no dashboard env var needed. (Local dev may run a
   newer Node — Vite 8 supports `^20.19 || ^22.12 || >=24`.)
4. Save. The first deploy runs immediately; every later push to `main` triggers
   an automatic production deploy, and every PR gets a preview URL.

No secrets or environment variables are required — the app is fully client-side.

---

## Repo-side (already in place)

- `vite.config.ts` — `base: './'` (relative asset URLs; works at `/` and in the
  portable single-file build alike).
- `index.html` — favicon is an inline `data:` URI; no external asset requests.
- Fonts (`@fontsource/*`) are bundled into `dist/assets/` at build time — no CDN.
- No client-side routing yet, so no `_redirects` / SPA fallback is needed. Add
  `public/_redirects` with `/*  /index.html  200` when URL-hash sharing lands.
- `.nvmrc` = `22`; `package.json` `engines.node` `>=22.12.0`.

## Pre-deploy check (local)

```bash
npm run build          # tsc -b && vite build  → dist/
npm run e2e:dist       # builds, serves dist/ with `vite preview`, runs e2e/dist.spec.ts
```

`e2e/dist.spec.ts` verifies the **production build** the way Cloudflare serves
it:

- boots at `/`, no console errors, **no failed or cross-origin requests**, no
  dev bridge
- Import `examples/risky-factory.json` → 18 nodes
- MC dialog **pre-filled** from `recommendedRunConfig` (500 × 40, seed 1)
- runs on the **real Worker path** (`Worker` constructed, jobs dispatched) →
  Risky Factory **424 / 500**, populated termination sparkline
- Export ▾ → JSON (`loop-mc/1`, `endedRuns[-1] === 424`); Export → graph file
  carries `recommendedRunConfig`
- hard **reload** → app re-boots and restores the graph from `localStorage`

`vite preview` on `localhost` is a secure context, so the Worker path check is
valid; still run one manual smoke on the live `*.pages.dev` URL after the first
deploy.

## Post-deploy smoke (on the live URL)

1. open `https://cozy-loop-studio.pages.dev/` — canvas + toolbar render, no console
   errors
2. **Templates ▾ → Flowing equilibrium**, press Play — the timeline moves
3. **Import** `examples/risky-factory.json`; open **Monte Carlo** — fields show
   `500 / 40 / 1`; **Run**
4. DISTRIBUTION appears; termination sparkline flattens near **85 %**; the
   pre-run cost line reads *Parallel, N workers* (Worker path, not "Local")
5. **Export ▾ → JSON**, reopen it — `"spec": "loop-mc/1"`,
   `endedRuns.atOrBeforeStep` last value **424**
6. **Export** (graph), **New**, **Import** that file back — graph returns and the
   MC dialog is pre-filled again
7. hard-refresh the tab — the app reloads and the graph is still there
