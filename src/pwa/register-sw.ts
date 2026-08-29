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

/** §P7 — Production host only. A Cloudflare **Preview** deploy
 *  (`<hash>.cozy-loop-studio.pages.dev`), `localhost`, and `file://` (`origin`
 *  === `"null"`) all fall through to `false`. `__PWA_TEST_ORIGIN__` is a build
 *  define — `''` (and this clause dead) in every build except the PWA E2E one. */
export function isRegistrationAllowed(origin: string): boolean {
  return (
    ALLOWED_ORIGINS.includes(origin) ||
    (__PWA_TEST_ORIGIN__ !== '' && origin === __PWA_TEST_ORIGIN__)
  )
}

type Store = Pick<
  ReturnType<typeof usePwaStore.getState>,
  'markWaiting' | 'clearWaiting' | 'setApplyFn'
>

/**
 * Wire a registration to the update store. Pure of `navigator` lookups so it is
 * unit-testable with fakes. An update is only surfaced when this page is already
 * **controlled** by an older SW — a first install (no `container.controller`)
 * shows no bar (§P4 / test 7).
 */
export function wireRegistration(
  reg: ServiceWorkerRegistration,
  container: ServiceWorkerContainer,
  store: Store,
): { recheck: () => void } {
  const surfaceIfUpdate = (worker: ServiceWorker | null | undefined): void => {
    // an update only counts when this page is already CONTROLLED by an older SW;
    // a first install (no controller) shows no bar (§P4 / test 7)
    if (worker && worker.state === 'installed' && container.controller) {
      store.markWaiting(worker)
    }
  }

  // (a) a worker ALREADY waiting when this tab registered — check immediately,
  //     otherwise a SW that finished installing before we ran is missed.
  surfaceIfUpdate(reg.waiting)

  // (b) a worker that finishes installing later
  reg.addEventListener('updatefound', () => {
    const sw = reg.installing
    sw?.addEventListener('statechange', () => {
      if (sw.state === 'installed') surfaceIfUpdate(sw)
      else if (sw.state === 'redundant') store.clearWaiting() // superseded before we acted
    })
  })

  // Update handler. Re-read `reg.waiting` — it may have changed or vanished.
  // Register the `controllerchange` one-shot listener BEFORE messaging the
  // worker, and reload only once no matter how many times it fires.
  store.setApplyFn(() => {
    const waiting = reg.waiting
    if (!waiting || waiting.state !== 'installed') {
      store.clearWaiting() // gone / moved on — resync, no message, no reload
      return
    }
    let reloaded = false
    const onControllerChange = (): void => {
      if (reloaded) return
      reloaded = true
      container.removeEventListener('controllerchange', onControllerChange)
      window.location.reload()
    }
    container.addEventListener('controllerchange', onControllerChange) // FIRST
    waiting.postMessage({ type: 'SKIP_WAITING' }) // THEN
  })

  // re-poll `reg.waiting` (a tab that missed `updatefound` still catches up).
  // The same worker ⇒ `markWaiting` is a no-op and any Dismiss survives.
  return { recheck: () => surfaceIfUpdate(reg.waiting) }
}

export async function registerPwa(): Promise<void> {
  if (!('serviceWorker' in navigator)) return

  if (!isRegistrationAllowed(location.origin)) return

  // `updateViaCache: 'none'` — an update check always re-fetches sw.js from the
  // network, never the HTTP cache, so a new deploy is seen promptly (§P4).
  const reg = await navigator.serviceWorker
    .register('sw.js', { scope: '/', updateViaCache: 'none' })
    .catch(() => null)
  if (!reg) return

  const { recheck } = wireRegistration(reg, navigator.serviceWorker, usePwaStore.getState())

  // update checks: on focus, and at most hourly (§P4)
  const check = (): void => {
    if (document.visibilityState !== 'visible') return
    recheck() // catch a worker that is already waiting
    void reg.update().catch(() => {})
  }
  document.addEventListener('visibilitychange', check)
  window.setInterval(check, 60 * 60 * 1000)
}
