import type { LocaleDir } from './registry'

/** docs/localization.md §L9.3 — the direction a CALLER states for a value it
 *  hands to a shared component.
 *
 *  It is the registry's own direction type plus `auto`, never a fresh
 *  `'ltr' | 'rtl'`: re-typing the pair beside the registry is how the two
 *  drift, and a component contract that has drifted from the locale registry
 *  is worse than one that never existed.
 *
 *  `auto` is not a third direction. It means "take it from the value's first
 *  strong character" — the right answer for text a person typed, and the wrong
 *  one for anything the app generated. */
export type ContentDir = LocaleDir | 'auto'
