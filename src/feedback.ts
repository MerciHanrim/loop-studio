// The in-app feedback form — a Typeform (Korean-language) linked from the Help
// menu, added after a request on the DCInside promo thread for an in-app
// feedback channel.
//
// Opened in a new tab with `rel="noreferrer noopener"`, so the referring URL is
// not sent and the new tab gets no `window.opener` handle. Loop Studio does NOT
// attach model content, document data, user identifiers, or current-page
// information to this URL — it is a fixed link with no query string. (Opening
// any external site still exposes normal connection metadata, e.g. IP and
// user-agent, to that site.)
//
// Single source of truth: both the desktop Help menu and the mobile Help
// sub-sheet import this. If a multilingual form ships later, drop the
// "(Korean form)" note from `tour.help.feedback` (EN/JA).
export const FEEDBACK_URL = 'https://form.typeform.com/to/zMG3huYC'
