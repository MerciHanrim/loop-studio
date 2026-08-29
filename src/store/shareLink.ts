// Shareable URL - boot-time load (SEMANTICS-U.md, loop-share/1, step 2).
//
// Turns a `#g1=...` fragment into a loaded graph, defensively and atomically:
//
//   schedule fragment-strip -> decode -> inflate + size check -> JSON.parse
//     -> deserialize -> (if not the pristine sample) replace confirm
//     -> stop any active run -> loadDoc  x1
//
// Nothing before `loadDoc` in that order changes the graph, the sim, or the MC
// state. A damaged / oversized / unsupported link, or a Cancel, only removes the
// URL fragment - the graph and any run in progress are left exactly as they were
// (no run-stop, no `simulationRev` bump). §U5.
//
// The Share *encoder* / UI is step 3.

import { deserialize } from '../model/serialize'
import {
  type ShareFailure,
  ShareError,
  classifyFragment,
  decodeShareText,
} from '../model/share'
import { useGraphStore } from './graphStore'
import { useMcStore } from './mcStore'
import { useSimStore } from './simStore'

export const REPLACE_PROMPT =
  'Open the shared diagram? Your current diagram will be replaced. Export it first if you want to keep it.'

export type ShareLoadOutcome =
  | { kind: 'none' } // not a Loop Studio fragment - left in the address bar
  | { kind: 'loaded' } // a valid link was applied
  | { kind: 'cancelled' } // a valid link, but the user declined the replace
  | { kind: 'failed'; reason: ShareFailure | 'bad-graph' | 'unsupported-version' | 'malformed' }

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

  let parsed: ReturnType<typeof deserialize>
  try {
    parsed = deserialize(text)
  } catch {
    strip()
    console.warn('Loop Studio: ignored a share link whose graph did not parse.')
    return { kind: 'failed', reason: 'bad-graph' }
  }

  // ---- replace confirmation (§U5.4) --------------------------------------
  const pristine = useGraphStore.getState().pristineSample
  if (!pristine) {
    const ask = opts.confirm ?? (typeof window !== 'undefined' ? window.confirm : () => true)
    if (!ask(REPLACE_PROMPT)) {
      strip() // Cancel: only the fragment goes; no run-stop, no bump
      return { kind: 'cancelled' }
    }
  }

  // ---- apply (§U5.5): stop any run, then exactly one loadDoc -------------
  useSimStore.getState().pause() // first point that run state changes
  useGraphStore.getState().loadDoc({ nodes: parsed.nodes, edges: parsed.edges }) // the ONE bump
  useMcStore.getState().applyRecommended(parsed.recommendedRunConfig)

  strip()
  return { kind: 'loaded' }
}
