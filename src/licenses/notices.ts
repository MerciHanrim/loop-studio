import { buildKind } from '../storage/buildKind'

// Issue #301 - where the third-party notices are, and how the licence view in
// the About dialog reads them. Every build carries them (licenses/README.md):
//
//   web, PWA   THIRD_PARTY_NOTICES.txt beside index.html, same origin; the PWA
//              precaches it, so it opens offline once the app is installed
//   portable   the same text inside the single HTML file, escaped, in
//              <template id="third-party-notices"> - read with
//              `template.content.textContent`, never as HTML
//   dev        the dev server answers THIRD_PARTY_NOTICES.txt with the web
//              build's text, rebuilt from the committed manifest
//
// The text is third-party input. It is shown as TEXT (a React text child), and
// never passed through `innerHTML` or `dangerouslySetInnerHTML` -
// `scripts/check-licence-screen.mjs` fails the build if this file or the view
// ever does.

export const NOTICES_FILE = 'THIRD_PARTY_NOTICES.txt'
export const PORTABLE_TEMPLATE_ID = 'third-party-notices'

/** the first line of every notices text (scripts/third-party-notices/core.mjs `NOTICES_HEADER`) */
const FIRST_LINE = 'Loop Studio\n'

/** the portable file carries the text in its own document; the others serve a file */
export const noticesHaveFile = (): boolean => buildKind() !== 'portable'

/** the same-origin address of THIRD_PARTY_NOTICES.txt (web, PWA, dev) */
export const noticesFileUrl = (): string => new URL(NOTICES_FILE, document.baseURI).href

export class NoticesUnavailable extends Error {}

function fromTemplate(): string {
  const el = document.getElementById(PORTABLE_TEMPLATE_ID)
  if (!(el instanceof HTMLTemplateElement)) throw new NoticesUnavailable(`no <template id="${PORTABLE_TEMPLATE_ID}"> in this file`)
  const text = el.content.textContent ?? ''
  if (!text.startsWith(FIRST_LINE)) throw new NoticesUnavailable('the notices template does not hold the notices text')
  return text
}

async function fromFile(): Promise<string> {
  const res = await fetch(noticesFileUrl())
  if (!res.ok) throw new NoticesUnavailable(`${NOTICES_FILE} answered ${res.status}`)
  // a host that falls back to index.html for an unknown path answers 200 too
  if (!/^text\/plain\b/i.test(res.headers.get('content-type') ?? '')) throw new NoticesUnavailable(`${NOTICES_FILE} is not plain text`)
  const text = await res.text()
  if (!text.startsWith(FIRST_LINE)) throw new NoticesUnavailable(`${NOTICES_FILE} does not hold the notices text`)
  return text
}

let pending: Promise<string> | null = null

/**
 * The notices text of this build, read once per page: later calls share the
 * first result. A failure is not remembered, so "Try again" reads again.
 */
export function loadNotices(): Promise<string> {
  if (!pending) {
    pending = (noticesHaveFile() ? fromFile() : Promise.resolve().then(fromTemplate)).catch((err: unknown) => {
      pending = null
      throw err
    })
  }
  return pending
}

/** tests only: forget the shared read */
export function resetNoticesForTest(): void {
  pending = null
}
