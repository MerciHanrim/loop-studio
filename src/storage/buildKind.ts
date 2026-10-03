// Issue #297 - which build this page is, decided by one attribute.
//
// The portable file follows stricter storage rules than the web and PWA builds
// (the gate is shown every time and no mode is remembered), because in Chrome
// every `file://` page in a profile shares one storage: a copy of the file at
// another path, or any other local HTML file, sees the same keys (MEASURED on
// 2026-10-01, Chrome 154).
//
// `vite.config.ts` writes `data-build="portable"` on the <html> element of the
// portable build and nothing on the others. The attribute is the single source
// for every reader: the classic script in <head> (`themeBoot.js`), which runs
// before any module and cannot import a constant, and the app, through this
// function. `location.protocol` would be a second, different answer (a
// portable file served over http is still the portable file), so it is not
// consulted.

export type BuildKind = 'web' | 'portable'

export function buildKind(): BuildKind {
  if (typeof document === 'undefined') return 'web'
  return document.documentElement.getAttribute('data-build') === 'portable' ? 'portable' : 'web'
}
