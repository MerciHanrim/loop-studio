import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { rowFitMeasureCount } from './components/nodes/rowFit'
import { directionOf, initI18n, useI18n } from './i18n'
import * as share from './model/share'
import { flushAutosave, useGraphStore } from './store/graphStore'
import './store/editPolicy' // #334 — registers the edit-lock guard on the document stores
import { useAutosaveStore } from './store/autosaveStore'
import { useMcStore } from './store/mcStore'
import { useProjectStore } from './store/projectStore'
import { usePwaStore } from './store/pwaStore'
import { useReviewStore } from './store/reviewStore'
import * as revisionIO from './store/revisionIO'
import { __resetProvisionalPeak, __resetRouteCache, __routeGenCount, __syncFullGeneration, currentRouteMap, routeDiagnostics } from './store/routeMap'
import * as shareLink from './store/shareLink'
import { useDataImportStore } from './store/dataImportStore'
import { useFilterStore } from './store/filterStore'
import { useFrameStore } from './store/frameStore'
import { useAutoFrameStore } from './store/autoFrameStore'
import { useHintStore } from './store/hintStore'
import { useSimStore } from './store/simStore'
import { useTourStore } from './store/tourStore'
import { useUiStore } from './store/uiStore'
import { useWhatsNewStore } from './store/whatsNewStore'
import * as workspaceIO from './store/workspaceIO'
import { installLossWarning } from './store/sessionActions'
import { storageSession } from './storage/storagePort'
import { applyStoredTheme } from './theme/theme'

// Issue #297 — the app, behind the storage gate.
//
// Evaluating this module evaluates every store, and the stores read the browser
// profile the moment they are created (the document, seven canvas flags, the
// hints, the import quick-start, the update-notice history). That is why
// `src/main.tsx` imports this file DYNAMICALLY, and only after the storage
// session is open: on a remembered personal browser at once, otherwise after
// the gate was answered. Nothing in this module may be imported by the boot
// module statically — `scripts/check-storage-port.mjs` does not know module
// graphs, but `e2e/storage-port-runtime.spec.ts` sees every storage call made
// before the gate, and there must be none but the mode key's.

/** Mount the app. Called once, by the boot module, with the storage session open. */
export async function startApp(): Promise<void> {
  if (storageSession.mode() === null) throw new Error('Loop Studio: startApp() before the storage session was opened')

  // Issue #302 — the stored theme is applied before anything is rendered. Until
  // this, the only reader of the key was the toggle inside the Settings menu, so
  // a reload opened in the system theme and the saved one appeared when that
  // menu was opened. Read through the storage port; an unreadable or unknown
  // value means `system`. In a temporary session the port holds nothing, so
  // this is the system theme, and it also clears whatever the gate showed.
  applyStoredTheme()

  // Dev-only store bridge for browser E2E (never in the production / portable
  // build — `import.meta.env.DEV` is statically false there and tree-shaken out).
  if (import.meta.env.DEV) {
    ;(window as unknown as { __loop: unknown }).__loop = {
      graph: useGraphStore,
      // audit ①-4 — the pending-save flush + its failure state, so a spec that
      // clears storage before navigating can first settle the debounce (the
      // pagehide flush would otherwise re-persist the graph after the clear)
      autosave: { store: useAutosaveStore, flush: flushAutosave },
      sim: useSimStore,
      mc: useMcStore,
      ui: useUiStore,
      filter: useFilterStore,
      frame: useFrameStore,
      dataImport: useDataImportStore,
      autoFrame: useAutoFrameStore,
      pwa: usePwaStore,
      project: useProjectStore,
      review: useReviewStore,
      tour: useTourStore,
      hint: useHintStore,
      whatsNew: useWhatsNewStore,
      i18n: useI18n,
      // §L9.2 — the direction resolver itself, so the RTL e2e can assert the value
      // the app's own `dir` attributes read rather than re-deriving it from the
      // locale code (which would be a second, divergent implementation living in
      // the test) or from `<html dir>` (which is the OUTPUT under test).
      directionOf,
      io: workspaceIO,
      revisionIO,
      routeMap: {
        genCount: __routeGenCount,
        reset: __resetRouteCache,
        get: (id: string) => {
          const g = useGraphStore.getState()
          return currentRouteMap(g.nodes, g.edges).get(id) ?? null
        },
        // issue #344 §ER14.4–5 — the last full generation's classes and fans,
        // the last provisional map and job, and whether a job is still running
        diagnostics: routeDiagnostics,
        pending: () => routeDiagnostics().pending,
        resetProvisionalPeak: __resetProvisionalPeak,
        // the map on screen, and the synchronous generation it must equal once
        // nothing is pending (computed aside; the cache is untouched)
        all: () => {
          const g = useGraphStore.getState()
          return currentRouteMap(g.nodes, g.edges)
        },
        syncFull: () => {
          const g = useGraphStore.getState()
          return __syncFullGeneration(g.nodes, g.edges)
        },
      },
      // issue #332 — how many node row-fit measurements have run, so the e2e
      // can assert none runs per animation frame
      rowFit: { count: rowFitMeasureCount },
      share,
      shareLink,
      // issue #297 — which door the port is open on, for the session specs
      storage: storageSession,
    }
  }

  // docs/localization.md §L5.2 — resolve + load the initial catalog BEFORE React
  // mounts, so the first paint is already in the right language (no flash). The
  // embedded `en` catalog makes this fast and un-failable. Run again here even
  // when the gate already ran it: the gate could only use the browser's
  // language, and a personal browser may have a stored one.
  await initI18n()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
  // issue #297 — a temporary session with work warns before a reload or a close
  // loses it (where the browser fires `beforeunload` at all)
  installLossWarning()
}
