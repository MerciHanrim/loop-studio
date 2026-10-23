// The Web App Manifest, as a source object (docs/pwa.md §P1 / §P9 D1).
//
// It is NOT emitted as a file by a plain `npm run build` or the portable build
// — only the Production / PWA-test build's `vite-plugin-pwa` consumes this and
// writes `manifest.webmanifest` + injects `<link rel="manifest">` (§P9 D8a,
// added in Slice 2). Keeping it here lets it be unit-tested now and reused then.

/** Minimal shape we assert on; `vite-plugin-pwa` accepts a superset. */
export type WebManifest = {
  name: string
  short_name: string
  description: string
  id: string
  start_url: string
  scope: string
  display: 'standalone' | 'minimal-ui' | 'browser' | 'fullscreen'
  background_color: string
  theme_color: string
  icons: { src: string; sizes: string; type: string; purpose?: 'any' | 'maskable' }[]
}

/** The workbench `--bg-app`, light (src/index.css), and the light
 *  `theme-color` (`THEME_COLOR` in src/theme/theme.ts; dark is `#101215`).
 *  The installed app's splash and title bar use it. The icon PNGs keep their
 *  own fixed brand colours (scripts/gen-icons.mjs): a brand mark does not
 *  follow the screen theme. */
export const PWA_BACKGROUND = '#e3e6ea'

export const manifest: WebManifest = {
  name: 'Loop Studio',
  short_name: 'Loop Studio',
  description: 'Model and simulate how resources flow and how state changes.',
  // `id`, `start_url`, `scope` are all the origin root — the whole app is one
  // page and the install identity is stable across any future `start_url` tweak.
  id: '/',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: PWA_BACKGROUND,
  theme_color: PWA_BACKGROUND,
  icons: [
    // plain marks — edge-to-edge, transparent
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    // maskable — a SEPARATELY composed image: opaque field, mark in the safe
    // zone (not the same file as icon-512 with a different `purpose`).
    {
      src: 'icons/icon-maskable-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    },
  ],
}
