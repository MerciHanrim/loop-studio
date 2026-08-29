import { usePwaStore } from '../store/pwaStore'

// docs/pwa.md §P4 / §P7 — service-worker registration and the update lifecycle.
//
// Called from main.tsx behind `if (__PWA_ENABLED__)`, so this module is dead
// code (and `sw.js` is guaranteed present) in every other build. Nothing here
// is automatic: a new SW stays `waiting`; only the user's Update click posts
// `SKIP_WAITING`; the page reloads once, on the resulting `controllerchange`.

/** the only origins allowed to register — the canonical Production host, plus an
 *  explicit E2E preview origin (a build-time constant, never a window global). */
const ALLOWED_ORIGINS = ['https://cozy-loop-studio.pages.dev']

export async function registerPwa(): Promise<void> {
  if (!('serviceWorker' in navigator)) return

  const allowed =
    ALLOWED_ORIGINS.includes(location.origin) ||
    (__PWA_TEST_ORIGIN__ !== '' && location.origin === __PWA_TEST_ORIGIN__)
  if (!allowed) return

  const reg = await navigator.serviceWorker.register('sw.js', { scope: '/' }).catch(() => null)
  if (!reg) return

  const store = usePwaStore.getState()
  store.setApplyFn(() => reg.waiting?.postMessage({ type: 'SKIP_WAITING' }))

  // a worker already waiting when this tab loaded (tab reopened after a deploy)
  if (reg.waiting && navigator.serviceWorker.controller) store.markWaiting()

  // a worker that installs later, with a controller already in place ⇒ an update
  reg.addEventListener('updatefound', () => {
    const sw = reg.installing
    sw?.addEventListener('statechange', () => {
      if (sw.state === 'installed' && navigator.serviceWorker.controller) store.markWaiting()
    })
  })

  // WE triggered skipWaiting (Update) ⇒ the controller changes ⇒ reload once
  let reloaded = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return
    reloaded = true
    window.location.reload()
  })

  // update checks: on focus, and at most hourly (§P4)
  const check = () => {
    if (document.visibilityState === 'visible') void reg.update().catch(() => {})
  }
  document.addEventListener('visibilitychange', check)
  window.setInterval(check, 60 * 60 * 1000)
}
