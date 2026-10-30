// Shareable URL - boot-time load (SEMANTICS-U.md, loop-share/1, step 2).
//
// Turns a `#g1=...` fragment into a loaded graph, defensively and atomically:
//
//   schedule fragment-strip -> decode -> inflate + size check -> JSON.parse
//     -> deserialize -> re-place an older layout (#420)
//     -> (if not the pristine sample) replace confirm
//     -> stop any active run -> loadDoc  x1
//
// Nothing before the run-stop in that order changes the graph, the sim, or the
// MC state. A damaged / oversized / unsupported link, a link whose layout cannot
// be re-placed, or a Cancel, only removes the URL fragment - the graph and any
// run in progress are left exactly as they were (no run-stop, no
// `simulationRev` bump). §U5. Should the load itself throw after the run-stop,
// the fragment still goes and the outcome is `bad-graph`: this function never
// rejects, so what waits on it (the first-run Welcome card) always settles.
//
// The Share *encoder* / UI is step 3.

import { deserialize } from '../model/serialize'
import {
  type ShareFailure,
  ShareError,
  classifyFragment,
  decodeShareText,
  shareCompressionAvailable,
} from '../model/share'
import { type ProtectedOutcome, openProtectedLink, openUnavailableShareLink } from './protectedLink'
import { type SharedGraph, applySharedGraph, prepareSharedGraph, replaceConfirmed, replacePrompt } from './shareApply'

export { replacePrompt }

export type ShareLoadOutcome =
  | { kind: 'none' } // not a Loop Studio fragment - left in the address bar
  | { kind: 'loaded' } // a valid link was applied
  | { kind: 'cancelled' } // a valid link, but the user declined the replace (or the password prompt)
  | { kind: 'failed'; reason: ShareFailure | 'bad-graph' | 'unsupported-version' | 'malformed' }
  | Extract<ProtectedOutcome, { kind: 'failed' }> // a protected link that did not open (SEMANTICS-P.md)

type Options = {
  /** defaults to `location.hash` */
  hash?: string
  /** defaults to `window.confirm` */
  confirm?: (message: string) => boolean
  /** defaults to `history.replaceState(state, '', pathname + search)` */
  stripFragment?: () => void
}

function defaultStrip(): void {
  if (typeof window === 'undefined' || !window.history || !window.location) return
  const { pathname, search } = window.location
  // remove ONLY the fragment; keep path + query; replace, do not push (§U5.6)
  window.history.replaceState(window.history.state, '', pathname + search)
}

/**
 * Consume a share link from the URL fragment, once, at boot. Safe to call when
 * there is no fragment. Never throws.
 */
export async function consumeShareLink(opts: Options = {}): Promise<ShareLoadOutcome> {
  const hash =
    opts.hash ?? (typeof location !== 'undefined' ? location.hash : '')
  const fragment = classifyFragment(hash)
  const strip = opts.stripFragment ?? defaultStrip

  // Not ours - a section anchor, a router path, another app's fragment. Leave it
  // exactly as it is (§U5.1 / U6).
  if (fragment.kind === 'foreign') return { kind: 'none' }

  // A protected link (`p1`, SEMANTICS-P.md) has its own flow: a structure check,
  // a password prompt, then the same replace confirmation and the same one load.
  // The promise resolves when that whole flow has ended.
  if (fragment.kind === 'protected' || fragment.kind === 'protected-unsupported' || fragment.kind === 'protected-malformed') {
    return openProtectedLink(fragment, { strip, confirm: opts.confirm })
  }

  // Ours, but not a link this build can open. Still Loop Studio's to tidy up:
  // warn, leave the graph + run untouched, and strip the dead fragment (§U6).
  if (fragment.kind === 'unsupported') {
    strip()
    console.warn('Loop Studio: this share link uses an unsupported version; opening the local graph.')
    return { kind: 'failed', reason: 'unsupported-version' }
  }
  if (fragment.kind === 'malformed') {
    strip()
    console.warn('Loop Studio: ignored a malformed share link.')
    return { kind: 'failed', reason: 'malformed' }
  }

  // No Compression Streams on this page: no link can be read here, and there
  // is no bundled fallback (§U1.3, issue #301 decision 1). The fragment stays,
  // so the address still opens in another browser; a notice says why.
  if (!shareCompressionAvailable()) return openUnavailableShareLink()

  const payload = fragment.payload

  // ---- validate fully BEFORE touching any store (§U5.2) --------------------
  let text: string
  try {
    text = await decodeShareText(payload)
  } catch (e) {
    strip()
    const reason = e instanceof ShareError ? e.reason : 'inflate-failed'
    console.warn(`Loop Studio: ignored an unreadable share link (${reason}).`)
    return { kind: 'failed', reason }
  }

  let parsed: SharedGraph
  try {
    parsed = deserialize(text)
  } catch {
    strip()
    console.warn('Loop Studio: ignored a share link whose graph did not parse.')
    return { kind: 'failed', reason: 'bad-graph' }
  }
  // #420 — an older layout is re-placed here, not inside `loadDoc`: a document
  // the layout code cannot read fails before the confirm and before any store
  // changes, like every other stage of §U5.2
  try {
    parsed = prepareSharedGraph(parsed)
  } catch {
    strip()
    console.warn('Loop Studio: ignored a share link whose graph could not be opened.')
    return { kind: 'failed', reason: 'bad-graph' }
  }

  // ---- replace confirmation (§U5.4) --------------------------------------
  if (!replaceConfirmed(opts.confirm)) {
    strip() // Cancel: only the fragment goes; no run-stop, no bump
    return { kind: 'cancelled' }
  }

  // ---- apply (§U5.5): stop any run, then exactly one loadDoc -------------
  try {
    applySharedGraph(parsed)
  } catch (e) {
    // #420 — a throw here comes after the run-stop; whatever `loadDoc` left
    // stays, but the fragment goes and the boot flow ends (never rejects)
    strip()
    console.warn('Loop Studio: a share link could not be applied.', e)
    return { kind: 'failed', reason: 'bad-graph' }
  }

  strip()
  return { kind: 'loaded' }
}
