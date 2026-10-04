# Storage sessions: the gate, the personal browser and the temporary session

Issue #297. "Saved locally" means the work is not uploaded. It does not mean the work is private: it stays in this browser profile and is restored the next time the app opens, author name and note and imported spreadsheet values included. On a shared computer that is an exposure, and closing the browser does not remove it. This document is the contract that stops the next person at the keyboard from seeing the previous person's work by opening the app, and the mechanics that hold it.

It prevents accidental exposure. It is not a lock: it authenticates nobody and does not stop a person who deliberately looks at the same browser profile. A password lock and encrypted storage are a separate feature (issue #300). The app identifies a browser profile, never a person.

## The gate

Before anything stored is read, the app asks: personal browser, or temporary session.

- The gate is drawn by the boot module (`src/main.tsx`) while the storage port is still shut, so nothing stored can appear on it: no title, no preview, no node count. It is in the browser's language, not a stored one, and in the system theme, not a stored one, for the same reason.
- Two equal choices, nothing pre-selected, focus on the heading. Under each choice an unticked box: "Trust this personal browser and restore automatically" (with "Choose this only in a browser that you alone use") and "Always start a temporary session". Pressing a button without its box remembers nothing: the gate returns at the next start.
- A ticked box writes the one non-sensitive mode key, `loop-studio:storage-mode`, with `personal` or `temporary`. That key is the only thing read before the gate and the only thing a temporary session may write.
- When the address carries a share link, the gate says so: a temporary session keeps the shared document out of this browser's storage.
- The portable file shows the gate every time, recommends the temporary session, has no boxes, and warns that in Chrome other local HTML files opened in the same profile may share its storage. A stored mode key is ignored there, and the boot script reads no theme for it.

## Two kinds of session

| | Personal browser | Temporary session |
| --- | --- | --- |
| Reads stored work | yes | no |
| Reads the stored author name and note | yes | no |
| Reads stored preferences | yes | no |
| Writes work to permanent storage | yes, autosave as before | no: an in-memory store that lives as long as the page |
| Restores the last work next time | yes | no |
| How the work is kept | autosave | the person exports a file |
| Language | the stored one, else the browser's | the browser's |
| Theme | the stored one, else the system's | the system's |

A temporary session never relies on clearing data when the browser closes. A crash or a forced close skips that step. It writes no work, no author information and no preference; the one thing it may store is the start-up choice, when the person ticked "Always start a temporary session". It warns before a reload or a close would lose the work where the browser fires `beforeunload` at all (iOS Safari does not), and it offers the export in three places: the `Temporary session` chip in the toolbar (and the Storage row of the More sheet on a phone), every confirmation step of the Storage and privacy area, and the update bar of the installed app, which asks before a temporary session with work is restarted.

## The port and its session

`src/storage/storagePort.ts` is the one door to browser storage, and behind it sits a session with four states:

| State | When | Reads | Writes |
| --- | --- | --- | --- |
| `gate` | from the first byte until the gate is answered | throw `StorageGateError` | throw |
| `browser` | a personal browser | `localStorage` | `localStorage` |
| `memory` | a temporary session | a `Map` | the `Map` (never fails: no quota) |
| `closed` | after "Reset all Loop Studio data", until the reload | nothing | dropped |

The `gate` state fails closed on purpose: a store that read storage before the gate would see an exception, not the previous person's data. The stores are not evaluated before the gate at all, because `src/main.tsx` imports nothing that reads the profile; the app and every store live behind `import('./startApp')`, which runs only once the session is open.

The boot script in `<head>` (`src/storage/themeBoot.js`, inlined by `vite.config.ts`) reads the mode key first and the theme only inside an `if` whose condition is that read being `personal`; the portable build (`<html data-build="portable">`) reads nothing. `scripts/check-storage-port.mjs` checks the nesting on the syntax tree, and the run-time trap in `e2e/storage-port-runtime.spec.ts` records every storage call of a page from before any product code runs.

The unit tests open the port before each test (`src/test/setup.ts`), because they exercise the stores behind the port, not the gate in front of it.

## Settings: Storage and privacy

Desktop `Settings` and the phone's More sheet open the area (`src/components/StoragePrivacyDialog.tsx`). It shows the storage mode, a plain statement of what a personal browser keeps, the `Restore automatically` box (the gate's "trust this browser" choice, the same key; in a temporary session, the "always temporary" box), the way into the other kind of session, and the two deletions. Every action is a step with an explanation, an `Export the diagram first` button, Cancel and Confirm; nothing happens before Confirm.

Switching never copies or deletes a document silently:

- Personal to temporary, `Start empty`: a fresh in-memory door, an empty diagram; the stored document is not deleted.
- Personal to temporary, `Take this diagram into a temporary session`: the diagram stays open and is saved to memory only; the stored copy remains until deleted.
- Temporary to personal, `Save in this browser`: the first write happens after the confirmation, and it replaces whatever document the browser held. Settings made during the session are written as they next change.

Two deletions, apart:

- `Delete work data`: the document record only (`loop-studio:graph:v1`): the diagram, group frames, imported spreadsheet data, project lineage and the Timeline series choice. In a personal browser the open diagram is emptied too, and the autosave that follows holds the empty diagram. In a temporary session the browser's stored record is removed and the session's own diagram is left alone. The author name and note, preferences and onboarding state stay.
- `Reset all Loop Studio data`: every registered key, the mode key included, then the port closes so the flush on the way out stores nothing, and the page reloads into the gate.

## Share links

A share link always carries the whole document and always names the public address. The share dialog states that the link itself contains the whole diagram, that nothing is uploaded, that the link can remain in the browser history, in a messenger or on the clipboard, and that sensitive work should travel as a file. A temporary session guarantees one thing about a link: the document opened from it is not left in Loop Studio's own storage. It promises nothing about the browser's history and does not claim to delete it.

## What is verified where

| Claim | Where |
| --- | --- |
| Before the gate: exactly two storage calls, both reads of the mode key (boot script, then port); no document, author, theme or language | `e2e/storage-port-runtime.spec.ts` |
| A temporary session with a previous person's theme, language, author and document: the gate and the app are in the browser's language and the system theme, the label appears nowhere, the only write that reaches `localStorage` is the mode key, and the storage is byte for byte what it was, through edits, an import, a share link and a reload | `e2e/storage-port-runtime.spec.ts` |
| The boot script reads the mode key once, the theme once, and the theme only under `personal` | `scripts/check-storage-port.mjs`, `e2e/storage-port-runtime.spec.ts` |
| The port's four states, the mode key, reset | `src/storage/storagePort.test.ts` |
| Switches, the two deletions, the loss warning | `src/store/sessionActions.test.ts`, `e2e/storage-sessions.spec.ts` |
| The area, the chip, the share dialog's facts, the phone's row | `e2e/storage-sessions.spec.ts` |
| The portable file: gate every time, recommendation, no boxes, no theme before the gate, a temporary session leaves the storage byte for byte as it was | `e2e/portable-file.spec.ts` |
| Before the gate, the ONLY storage traffic is the mode key: two reads (boot script, port), no other key read, nothing written | `e2e/storage-port-runtime.spec.ts` |
| A deletion that fails is reported as failed, on its step, never as done | `src/store/sessionActions.test.ts`, `e2e/storage-sessions.spec.ts` |
| The installed app's update bar asks a temporary session with work | `src/components/PwaUpdateBar.tsx` (the confirm), `e2e/pwa.spec.ts` for the bar itself |

## Limits, stated

- A `beforeunload` warning is not fired by every browser; on iOS the close goes through without it. The export offers before that point are the real safety.
- The app cannot tell that a different person is now at the keyboard. The gate and the Storage area say so.
- Browsers other than Chrome were not measured for the portable file's shared storage; the warning names Chrome and promises nothing about others.
