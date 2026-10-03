// Issue #297 — the share disclosure's body: the four facts about a link (it
// contains the whole diagram, nothing is uploaded, it can remain in the
// browser history / a messenger / the clipboard, sensitive work travels as a
// file), and in a temporary session the one thing that session guarantees
// about it. Shared by the desktop share flow and the phone's More sheet; kept
// out of the component files so fast refresh keeps working there.

type ShareDisclosureKey = 'share.disclosure.body' | 'share.disclosure.temporary'

export function shareDisclosureBody(t: (key: ShareDisclosureKey) => string, temporary: boolean): string {
  return temporary ? `${t('share.disclosure.body')} ${t('share.disclosure.temporary')}` : t('share.disclosure.body')
}
