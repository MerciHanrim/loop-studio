import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@xyflow/react/dist/style.css'
import './index.css'
import { StorageGate } from './components/StorageGate'
import { initI18n } from './i18n'
import { classifyFragment } from './model/share'
import { storageSession, type StorageMode } from './storage/storagePort'

// Issue #297 — the boot module: the gate in front of everything stored.
//
// This file imports nothing that reads the browser profile. The stores, and
// the App that uses them, live behind `import('./app')`, which runs only once
// the storage session is open. Until then the port is shut (every call
// throws), so the only storage read on this page is the mode key below.
//
// Three ways in:
//   remembered `personal`   the person asked to trust this browser: open the
//                           browser door and start, with no gate. The theme was
//                           already applied before the first paint by the boot
//                           script in <head>, which read the same mode key.
//   remembered `temporary`  open the in-memory door and start, with no gate.
//   nothing remembered,     show the gate, in the BROWSER's language (the port
//   or the portable file    is shut, so `initI18n` cannot see a stored one) and
//                           in the system theme. The answer opens a door, is
//                           remembered only when the box was ticked, and then
//                           the app starts.
//
// The gate shows nothing about stored work: it is drawn before anything stored
// is read, so there is nothing it could show.

// Service worker — Production / PWA-test build only. `__PWA_ENABLED__` is a
// compile-time constant, so this whole block (and `./pwa/register-sw`) is
// tree-shaken out of a plain `npm run build`, dev, and portable (docs/pwa.md
// §P7). The origin allow-list inside `registerPwa` is the second gate. The
// PWA's cache holds app files only, never user work, so registering it before
// the storage gate is allowed (issue #297).
if (__PWA_ENABLED__) {
  void import('./pwa/register-sw').then((m) => m.registerPwa())
}

/**
 * #420 item (3) — before any store exists, a personal session reads its saved
 * diagram. Readable or absent: on to the app. Unreadable, or storage that
 * cannot be read: the record is held at the port and the recovery screen is
 * drawn INSTEAD of the app — nothing that could write exists until the person
 * chooses. Resolves when the app may start (in the session that choice left).
 */
async function recoverIfUnreadable(): Promise<void> {
  if (storageSession.mode() !== 'personal') return
  const { readStoredRecord } = await import('./model/serialize')
  const first = readStoredRecord()
  if (first.kind === 'ok' || first.kind === 'none') return
  storageSession.holdWork()
  await initI18n()
  const { RecoveryScreen } = await import('./components/RecoveryScreen')
  await new Promise<void>((resolve) => {
    const root = createRoot(document.getElementById('root')!)
    const done = (outcome: 'start' | 'temporary') => {
      root.unmount()
      if (outcome === 'temporary') {
        storageSession.use('temporary') // the held record stays held, untouched
      } else {
        storageSession.releaseWork() // read again and readable, or discarded
      }
      resolve()
    }
    root.render(
      <StrictMode>
        <RecoveryScreen
          initial={first}
          reread={readStoredRecord}
          discardIfUnchanged={(expected) => {
            // #420 review — read again right before removing: another tab may
            // have saved since the screen showed `expected`; then nothing goes
            const now = readStoredRecord()
            if (now.kind !== 'unreadable' || now.text !== expected) return now
            storageSession.discardHeldWork()
            return null
          }}
          onDone={done}
        />
      </StrictMode>,
    )
  })
}

async function start(): Promise<void> {
  await recoverIfUnreadable()
  // issue #344 §DL2.8 — a legacy autosave record is re-placed on the grid once,
  // here, before `startApp` evaluates the stores that read it (no store is
  // imported by this module, and the session is open by now)
  const { convertAutosaveLayout } = await import('./store/layoutBoot')
  convertAutosaveLayout()
  const { startApp } = await import('./startApp')
  await startApp()
}

const remembered = storageSession.readRemembered()
if (remembered !== null) {
  storageSession.use(remembered)
  void start()
} else {
  // a share link in the address - plain (`g1`) or protected (`p1`) - is told to
  // the gate: a temporary session keeps the shared document out of this
  // browser's storage. The fragment itself is only classified here; it is read
  // and tidied by the app, after the gate (issue #300).
  const waiting = typeof location !== 'undefined' ? classifyFragment(location.hash).kind : 'foreign'
  const shareLinkWaiting = waiting === 'share' || waiting === 'protected'
  void initI18n().then(() => {
    const host = document.getElementById('root')!
    const root = createRoot(host)
    const answer = (mode: StorageMode, remember: boolean) => {
      root.unmount()
      storageSession.use(mode)
      if (remember) storageSession.remember(mode)
      void start()
    }
    root.render(
      <StrictMode>
        <StorageGate shareLinkWaiting={shareLinkWaiting} onAnswer={answer} />
      </StrictMode>,
    )
  })
}
