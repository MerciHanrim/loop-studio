import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@xyflow/react/dist/style.css'
import './index.css'
import App from './App.tsx'
import { initI18n, useI18n } from './i18n'
import * as share from './model/share'
import { useGraphStore } from './store/graphStore'
import { useMcStore } from './store/mcStore'
import { useProjectStore } from './store/projectStore'
import { usePwaStore } from './store/pwaStore'
import { useReviewStore } from './store/reviewStore'
import * as revisionIO from './store/revisionIO'
import { __resetRouteCache, __routeGenCount, currentRouteMap } from './store/routeMap'
import * as shareLink from './store/shareLink'
import { useFilterStore } from './store/filterStore'
import { useFrameStore } from './store/frameStore'
import { useSimStore } from './store/simStore'
import { useTourStore } from './store/tourStore'
import { useUiStore } from './store/uiStore'
import * as workspaceIO from './store/workspaceIO'

// Dev-only store bridge for browser E2E (never in the production / portable
// build — `import.meta.env.DEV` is statically false there and tree-shaken out).
if (import.meta.env.DEV) {
  ;(window as unknown as { __loop: unknown }).__loop = {
    graph: useGraphStore,
    sim: useSimStore,
    mc: useMcStore,
    ui: useUiStore,
    filter: useFilterStore,
    frame: useFrameStore,
    pwa: usePwaStore,
    project: useProjectStore,
    review: useReviewStore,
    tour: useTourStore,
    i18n: useI18n,
    io: workspaceIO,
    revisionIO,
    routeMap: {
      genCount: __routeGenCount,
      reset: __resetRouteCache,
      get: (id: string) => {
        const g = useGraphStore.getState()
        return currentRouteMap(g.nodes, g.edges).get(id) ?? null
      },
    },
    share,
    shareLink,
  }
}

// Service worker — Production / PWA-test build only. `__PWA_ENABLED__` is a
// compile-time constant, so this whole block (and `./pwa/register-sw`) is
// tree-shaken out of a plain `npm run build`, dev, and portable (docs/pwa.md
// §P7). The origin allow-list inside `registerPwa` is the second gate.
if (__PWA_ENABLED__) {
  void import('./pwa/register-sw').then((m) => m.registerPwa())
}

// docs/localization.md §L5.2 — resolve + load the initial catalog BEFORE React
// mounts, so the first paint is already in the right language (no flash). The
// embedded `en` catalog makes this fast and un-failable.
void initI18n().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
