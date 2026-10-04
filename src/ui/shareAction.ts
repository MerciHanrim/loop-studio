import { SHARE_MAX_BYTES, SHARE_PREFIX, encodeShareText } from '../model/share'
import { PROTECTED_PREFIX, ProtectedShareError, sealShareText } from '../model/shareProtected'

// SEMANTICS-U.md §U7 — the shared parts of "make a share link", used by the
// desktop `ShareButton` and the mobile More menu. The one-time disclosure (an
// in-app ConfirmDialog, docs/localization.md Slice 2b) and the clipboard write
// stay in the callers; everything deterministic lives here.

export const shareKb = (n: number): string => `${(n / 1024).toFixed(1)} KB`

/** The effective byte cap — `SHARE_MAX_BYTES`, except dev/E2E may lower it via
 *  `window.__shareMaxBytes` to exercise the §U3.1 hard reject on small files. */
export function shareCap(): number {
  if (!import.meta.env.DEV) return SHARE_MAX_BYTES
  return (window as unknown as { __shareMaxBytes?: number }).__shareMaxBytes ?? SHARE_MAX_BYTES
}

/**
 * A share link is always built on the fixed public base (`__SHARE_BASE_URL__`,
 * §U1.1) — never on `location`. Returns `null` if that base is not a valid
 * http(s) URL (a build misconfiguration — the caller surfaces an error, never a
 * silent `null/...` link).
 */
export function buildShareUrl(payload: string, prefix: string = SHARE_PREFIX): string | null {
  try {
    const u = new URL(`#${prefix}${payload}`, __SHARE_BASE_URL__)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null
  } catch {
    return null
  }
}

export type ShareLinkResult =
  | { status: 'ok'; url: string }
  | { status: 'too-large'; bytes: number; cap: number }
  | { status: 'no-base' }

/** Encode `doc` → payload, enforce the §U3.1 cap, build the URL. No side effects. */
export async function prepareShareLink(doc: string): Promise<ShareLinkResult> {
  const { payload, bytes } = await encodeShareText(doc)
  const cap = shareCap()
  if (bytes > cap) return { status: 'too-large', bytes, cap }
  const url = buildShareUrl(payload)
  return url == null ? { status: 'no-base' } : { status: 'ok', url }
}

/**
 * Put a share link on the clipboard. Resolves `false` where the Clipboard API
 * is missing or refuses; the caller then leaves the link in its field for a
 * manual copy (§U7). The one copy path of desktop and phone, for a plain and a
 * protected link alike - and it is only ever handed the LINK, never a password.
 */
export async function copyShareLink(url: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url)
    return true
  } catch {
    return false
  }
}

export type ProtectedShareLinkResult =
  | ShareLinkResult
  | { status: 'unavailable' } // no Web Crypto on this page
  | { status: 'password' } // the 12..128 rule; the dialog checks it first, this is the second line

/**
 * SEMANTICS-P.md SS P5 - seal `doc` with `password`, enforce the SAME cap on the
 * protected payload (a hard reject, never a truncation), build the `#p1=` URL.
 * No side effects; the password is passed straight through and not kept.
 */
export async function prepareProtectedShareLink(doc: string, password: string): Promise<ProtectedShareLinkResult> {
  let sealed: { payload: string; bytes: number }
  try {
    sealed = await sealShareText(doc, password)
  } catch (e) {
    return { status: e instanceof ProtectedShareError && e.reason === 'password' ? 'password' : 'unavailable' }
  }
  const cap = shareCap()
  if (sealed.bytes > cap) return { status: 'too-large', bytes: sealed.bytes, cap }
  const url = buildShareUrl(sealed.payload, PROTECTED_PREFIX)
  return url == null ? { status: 'no-base' } : { status: 'ok', url }
}
