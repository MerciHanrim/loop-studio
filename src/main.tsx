import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@xyflow/react/dist/style.css'
import './index.css'
import App from './App.tsx'
import * as share from './model/share'
import { useGraphStore } from './store/graphStore'
import { useMcStore } from './store/mcStore'
import { usePwaStore } from './store/pwaStore'
import * as shareLink from './store/shareLink'
import { useSimStore } from './store/simStore'
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
    pwa: usePwaStore,
    io: workspaceIO,
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
