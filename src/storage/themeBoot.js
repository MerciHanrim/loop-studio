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
// nothing. It is never transpiled, and runs before any of the app's code: so
// plain ES5 on purpose, with one exception — the optional catch binding
// (`catch {`, ES2019), which every browser that can run the app's bundle (Vite's
// default ES2020 target) parses (#420).
//
// An explicit theme also sets the browser's chrome colour (`theme-color`, the
// address bar) to that theme's, as `syncThemeColor` in src/theme/theme.ts does
// later: the two metas in index.html follow the SYSTEM scheme only. The colours
// are THEME_COLOR's, written out (this file cannot import).
;(function () {
  try {
    if (document.documentElement.getAttribute('data-build') === 'portable') return
    if (localStorage.getItem('loop-studio:storage-mode') === 'personal') {
      var v = localStorage.getItem('loop-studio:theme')
      if (v === 'light' || v === 'dark') {
        document.documentElement.setAttribute('data-theme', v)
        var metas = document.querySelectorAll('meta[name="theme-color"]')
        for (var i = 0; i < metas.length; i++) metas[i].setAttribute('content', v === 'dark' ? '#101215' : '#e3e6ea')
      }
    }
  } catch {
    /* storage unavailable: the system theme, as the module door would decide */
  }
})()
