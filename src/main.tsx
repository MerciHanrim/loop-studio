import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@xyflow/react/dist/style.css'
import './index.css'
import App from './App.tsx'
import { useGraphStore } from './store/graphStore'
import { useMcStore } from './store/mcStore'
import { useSimStore } from './store/simStore'

// Dev-only store bridge for browser E2E (never in the production / portable
// build — `import.meta.env.DEV` is statically false there and tree-shaken out).
if (import.meta.env.DEV) {
  ;(window as unknown as { __loop: unknown }).__loop = {
    graph: useGraphStore,
    sim: useSimStore,
    mc: useMcStore,
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
