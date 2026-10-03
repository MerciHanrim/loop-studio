// The storage port's second door (issues #302 and #297): the theme, read before
// the first paint - but only in a browser that asked to be trusted.
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
// Issue #297 puts a gate in front of everything stored: until a browser profile
// has said that it is a personal one, nothing it holds is read - the theme
// included, because a theme is one person's setting shown to the next. So this
// script reads the ONE non-sensitive mode key first, and reads the theme only
// when that key says `personal`. A profile that has not answered, one that
// always starts a temporary session, and the portable file (which shows the
// gate every time and never remembers a mode; `data-build` is written on
// <html> by vite.config.ts) all start in the system theme, exactly as the
// module door will decide for them.
//
// It is still the port's door, not a bypass: it is the only file besides
// storagePort.ts that may touch browser storage, it reads exactly these two
// keys with `getItem`, in this order and this nesting, and writes nothing;
// `scripts/check-storage-port.mjs` fails if it does anything else. The run-time
// trap in e2e/storage-port-runtime.spec.ts sees these reads and expects the
// mode read before any module runs, and the theme read only after `personal`.
//
// The same rule as src/theme/theme.ts: `light` and `dark` set `data-theme`,
// anything else leaves it off (`system`), and an unreadable storage throws
// nothing. Plain ES5 on purpose: this runs in every browser that loads the page,
// before any of the app's code, and is never transpiled.
;(function () {
  try {
    if (document.documentElement.getAttribute('data-build') === 'portable') return
    if (localStorage.getItem('loop-studio:storage-mode') === 'personal') {
      var v = localStorage.getItem('loop-studio:theme')
      if (v === 'light' || v === 'dark') document.documentElement.setAttribute('data-theme', v)
    }
  } catch {
    /* storage unavailable: the system theme, as the module door would decide */
  }
})()
