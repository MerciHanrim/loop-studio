// Protected share link - the opening flow (SEMANTICS-P.md, loop-share-protected/1).
//
// Fixed order (SS P6), after the #297 storage gate has let the app start:
//
//   structure check -> sealed bytes copied to memory, fragment removed
//     -> password prompt -> key derivation -> decrypt + authenticate
//     -> bounded inflate -> parse + validate -> replace confirmation
//     -> exactly one load
//
// Nothing before the load changes the graph, the sim or the MC state, and
// nothing from the shared document exists before a correct password: there is
// no plaintext to show.
//
// What this module holds:
//   - the SEALED bytes, in a module variable, between the prompt opening and
//     the flow ending. They are what was in the link; a reload drops them, and
//     the link then has to be opened again (SS P4).
//   - the prompt's UI state, in a store: a phase, a busy flag, a failure count.
// What it never holds: the password. `submitProtectedPassword` receives it as
// an argument, hands it to the sealed transport, and keeps no reference.
//
// Console output is one fixed line per outcome. A wrong password and a damaged
// link write the SAME line - the reason the browser gave is never printed.

import { create } from 'zustand'
import { deserialize } from '../model/serialize'
import { type FragmentKind, shareCompressionAvailable } from '../model/share'
import { ProtectedShareError, openProtectedBytes, protectedShareAvailable, readProtectedPayload } from '../model/shareProtected'
import { applySharedGraph, replaceConfirmed } from './shareApply'

export type ProtectedNotice =
  | 'damaged' // not a well-formed protected link; no password was asked for
  | 'unavailable' // no Web Crypto here; the fragment is left in place
  | 'newer' // a protected link from a newer version; the fragment is left in place
  | 'content' // the password was right and what was sealed is not a diagram
  // issue #301 decision 1 - no Compression Streams here, so NO share link opens
  // (there is no bundled fallback, SEMANTICS-U.md SS U1.3). The fragment is left
  // in place so the address can be opened in another browser. Two names only
  // for the dialog title: one for a protected link, one for a plain `g1` link.
  | 'no-compression'
  | 'plain-no-compression'

export type ProtectedOpenState =
  | { phase: 'idle' }
  | { phase: 'notice'; notice: ProtectedNotice }
  /** `failures` counts wrong-password answers; the dialog re-selects its input on each change */
  | { phase: 'prompt'; busy: boolean; failures: number }

export type ProtectedOutcome =
  | { kind: 'loaded' }
  | { kind: 'cancelled' }
  | { kind: 'failed'; reason: 'protected-damaged' | 'protected-unavailable' | 'protected-newer' | 'protected-content' | 'share-unavailable' }

type ProtectedFragment = Extract<FragmentKind, { kind: 'protected' | 'protected-unsupported' | 'protected-malformed' }>

export const useProtectedLinkStore = create<{ open: ProtectedOpenState }>(() => ({ open: { phase: 'idle' } }))

const LINE = {
  damaged: 'Loop Studio: ignored a damaged protected share link.',
  unavailable: 'Loop Studio: a protected share link cannot be opened here; a current browser and HTTPS are required.',
  newer: 'Loop Studio: this protected share link needs a newer version of Loop Studio.',
  auth: 'Loop Studio: a protected share link was not opened; the password is wrong or the link is damaged.',
  content: 'Loop Studio: a protected share link opened, but what it carries is not a diagram.',
  'no-compression': 'Loop Studio: this browser cannot open share links; a current browser is required.',
  'plain-no-compression': 'Loop Studio: this browser cannot open share links; a current browser is required.',
} as const

const NOTICE_REASON = {
  damaged: 'protected-damaged',
  unavailable: 'protected-unavailable',
  newer: 'protected-newer',
  content: 'protected-content',
  'no-compression': 'share-unavailable',
  'plain-no-compression': 'share-unavailable',
} as const

/** the sealed bytes of the link being opened - memory only */
let sealed: Uint8Array | null = null
/** bumped whenever the flow ends, so a derivation still running is ignored */
let generation = 0
/** one key derivation at a time; a plain variable, set and read synchronously */
let deriving = false
let confirmReplace: ((message: string) => boolean) | undefined
/** resolves the promise `openProtectedLink` returned */
let settle: ((outcome: ProtectedOutcome) => void) | null = null
/** the outcome a notice resolves with once it is dismissed */
let noticeOutcome: ProtectedOutcome | null = null

const setOpen = (open: ProtectedOpenState) => useProtectedLinkStore.setState({ open })

function end(outcome: ProtectedOutcome): void {
  sealed = null
  generation++
  noticeOutcome = null
  setOpen({ phase: 'idle' })
  const done = settle
  settle = null
  done?.(outcome)
}

function showNotice(notice: ProtectedNotice): void {
  sealed = null
  generation++
  console.warn(LINE[notice])
  noticeOutcome = { kind: 'failed', reason: NOTICE_REASON[notice] }
  setOpen({ phase: 'notice', notice })
}

/**
 * Start opening a protected fragment. Resolves when the whole flow has ended -
 * loaded, cancelled, or a notice dismissed - so the caller can hold back what
 * must come after it (the first-run Welcome card).
 *
 * `strip` removes the fragment from the address bar. It is called for a broken
 * link and for a well-formed one (as soon as its bytes are in memory), and NOT
 * for a link this build cannot open here: an unknown `p<n>` and a page without
 * Web Crypto both leave the address as it is, so the link can be opened again
 * after an update or in another browser.
 */
export function openProtectedLink(
  fragment: ProtectedFragment,
  opts: { strip: () => void; confirm?: (message: string) => boolean },
): Promise<ProtectedOutcome> {
  return new Promise((resolve) => {
    if (settle) end({ kind: 'cancelled' }) // a second link while one is open: the first is dropped
    settle = resolve
    confirmReplace = opts.confirm

    if (fragment.kind === 'protected-unsupported') return showNotice('newer')
    if (fragment.kind === 'protected-malformed') {
      opts.strip()
      return showNotice('damaged')
    }
    let bytes: Uint8Array
    try {
      bytes = readProtectedPayload(fragment.payload)
    } catch {
      opts.strip()
      return showNotice('damaged')
    }
    // no Compression Streams: no link of any kind opens here - checked before
    // Web Crypto, so the message names the real limit
    if (!shareCompressionAvailable()) return showNotice('no-compression')
    if (!protectedShareAvailable()) return showNotice('unavailable')

    sealed = bytes
    opts.strip()
    setOpen({ phase: 'prompt', busy: false, failures: 0 })
  })
}

/**
 * Issue #301 decision 1 - a plain `g1` link on a page without Compression
 * Streams. Nothing is decoded and the fragment is NOT removed, so the same
 * address can be opened in another browser; the notice says why. Resolves when
 * the notice is dismissed, like `openProtectedLink`, so what must come after
 * the boot flow (the first-run Welcome card) still waits for it.
 */
export function openUnavailableShareLink(): Promise<ProtectedOutcome> {
  return new Promise((resolve) => {
    if (settle) end({ kind: 'cancelled' })
    settle = resolve
    confirmReplace = undefined
    showNotice('plain-no-compression')
  })
}

/**
 * One password attempt. Ignored unless the prompt is open and idle. A wrong
 * password leaves the prompt open; there is no limit and no lock-out.
 */
export async function submitProtectedPassword(password: string): Promise<void> {
  const state = useProtectedLinkStore.getState().open
  if (state.phase !== 'prompt' || deriving || !sealed) return
  deriving = true
  const mine = generation
  setOpen({ phase: 'prompt', busy: true, failures: state.failures })
  try {
    let text: string
    try {
      text = await openProtectedBytes(sealed, password)
    } catch (e) {
      if (mine !== generation) return // cancelled meanwhile: the result is dropped
      const reason = e instanceof ProtectedShareError ? e.reason : 'auth'
      if (reason === 'content') return showNotice('content')
      if (reason === 'unavailable') return showNotice('unavailable')
      console.warn(LINE.auth)
      setOpen({ phase: 'prompt', busy: false, failures: state.failures + 1 })
      return
    }
    if (mine !== generation) return
    let parsed: ReturnType<typeof deserialize>
    try {
      parsed = deserialize(text)
    } catch {
      return showNotice('content')
    }
    if (!replaceConfirmed(confirmReplace)) return end({ kind: 'cancelled' })
    applySharedGraph(parsed)
    end({ kind: 'loaded' })
  } finally {
    deriving = false
  }
}

/** Cancel the prompt. The current document and any run stay as they are; a
 *  derivation still running is ignored when it finishes. */
export function cancelProtectedOpen(): void {
  if (useProtectedLinkStore.getState().open.phase === 'prompt') end({ kind: 'cancelled' })
}

/** Close a notice. */
export function dismissProtectedNotice(): void {
  if (useProtectedLinkStore.getState().open.phase === 'notice') end(noticeOutcome ?? { kind: 'cancelled' })
}

/** test seam: back to a cold module */
export function __resetProtectedLinkForTests(): void {
  sealed = null
  generation++
  deriving = false
  settle = null
  noticeOutcome = null
  confirmReplace = undefined
  setOpen({ phase: 'idle' })
}
