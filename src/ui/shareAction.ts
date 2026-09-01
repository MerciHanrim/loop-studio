import { SHARE_MAX_BYTES, encodeShareText } from '../model/share'

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
export function buildShareUrl(payload: string): string | null {
  try {
    const u = new URL(`#g1=${payload}`, __SHARE_BASE_URL__)
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
