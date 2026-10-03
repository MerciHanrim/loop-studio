// The storage port's second door (issue #302): the theme, read before the
// first paint.
//
// The module door, `storagePort.ts`, runs when the bundle runs, and the
// browser can paint before that: MEASURED on the production build, the first
// frame was painted at 36 ms on a phone-sized window and at 952 ms on a slow
// network, while the bundle applied the stored theme at 67 ms and 1,725 ms. A
// person who chose the dark theme saw one or two light frames at every start.
// Only a classic script in <head> runs before the first paint, and it cannot
// import a module, so this file is inlined into index.html by vite.config.ts
// (`themeBoot()`), for the web, PWA and portable builds alike.
//
// It is still the port's door, not a bypass: it is the only file besides
// storagePort.ts that may touch browser storage, it reads exactly one key with
// `getItem` and writes nothing, and `scripts/check-storage-port.mjs` fails if
// it does anything else. The run-time trap in e2e/storage-port-runtime.spec.ts
// sees this read and expects exactly one, before any module runs.
//
// The same rule as src/theme/theme.ts: `light` and `dark` set `data-theme`,
// anything else leaves it off (`system`), and an unreadable storage throws
// nothing. Plain ES5 on purpose: this runs in every browser that loads the page,
// before any of the app's code, and is never transpiled.
;(function () {
  try {
    var v = localStorage.getItem('loop-studio:theme')
    if (v === 'light' || v === 'dark') document.documentElement.setAttribute('data-theme', v)
  } catch {
    /* storage unavailable: the system theme, as the module door would decide */
  }
})()
