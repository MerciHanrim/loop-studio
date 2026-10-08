# Canvas edit lock and document boundaries

Status: shipped in v0.21.3 (issues #334 and #335).

The Canvas edit lock (`uiStore.canvasLocked`) keeps a document from being changed by accident while it is read, explained or run. This page is the one place its contract lives; the code points here.

## 1. What the lock blocks

While the lock is on, every **user edit** of the document is refused:

- adding a node from the palette (a click or a drag onto the canvas);
- Insert module (a bundled module or a module file);
- moving, connecting, reconnecting and deleting nodes and connections, with the mouse or the keyboard (the arrow keys, Delete, Backspace);
- every Inspector field and button, the flow colour, the Inputs panel values, the Register expression;
- saved frames: drawing, moving, resizing, renaming, colouring, deleting, keeping a suggested frame;
- Undo and Redo (the buttons and the keys);
- the data import wizard, a data refresh and renaming a bound table;
- a revision Apply (Review → Apply).

Copy, cut, paste and duplicate of nodes do not exist today. If they are added, copy stays available and the others follow the lock.

## 2. What stays available

- Selection, region select, the read-only Inspector, pan and zoom, the minimap.
- Focus, Filters, the Activity overlay, Pan mode and every other view setting.
- Run, Step, Play, Monte Carlo, the seed, the speed, the Timeline series: they change the run, not the document.
- Export (Graph JSON, Workspace JSON, CSV, a project revision, Make a proposal, Save selection as a module) and creating a share link.
- Opening another document (section 4).
- Unlocking.

## 3. Where it is enforced

Twice, on purpose:

- **The UI** disables each entry point while locked (`disabled`, not hidden), so nothing invites an edit that will not happen.
- **The stores** refuse it anyway. `src/store/editPolicy.ts` registers one guard on `graphStore` (`setEditGuard`); every user-edit action of `graphStore`, the saved-frame changes of `frameStore` and `projectStore.applyProposal` start with it and return without any change: no state, no undo entry, no autosave, no `simulationRev`. Actions that report a result return `{ ok: false, reason: 'locked' }`, which their callers drop silently (the control was disabled first). `onNodesChange` / `onEdgesChange` keep `select` and `dimensions` changes and drop the rest, so selection and layout keep working.

The guard is registered rather than imported because `graphStore` cannot import `uiStore` (`uiStore` → `mcStore` → `graphStore` would be a cycle); `startApp` imports `editPolicy.ts` once for every build (web, portable, PWA). A bare store in a unit test has no guard.

The runtime is outside the guard by construction: `simStore` and `mcStore` never call a document-changing action.

## 4. Document boundaries

Opening another document is not an edit of the open one, so it is allowed while locked. Each whole-document replacement is a **document boundary**:

| Path | Code |
|---|---|
| File → New | `graphStore.newGraph` |
| A temporary session started without the open document | `switchToTemporary(false)` → `newGraph` |
| Delete work data (personal browser) | `deleteWorkData` → `newGraph` |
| A Template (desktop menu, the phone's ⋯ menu) | `loadGraph` |
| A Graph / Workspace / Project revision file | `workspaceIO` → `loadDoc` `document-boundary` |
| A share link | `shareApply` → `loadDoc` `document-boundary` |
| Open proposal as document | `projectStore.openProposalAsDocument` → `loadDoc` `document-boundary` |

At a boundary:

1. **The undo history starts empty.** Undo and Redo are disabled; Undo can never go back into the previous document. The confirmation the app asks before replacing a diagram (unless it is the untouched first-run sample) is the safety net.
2. **The lock is the new document's.** A document whose `recommendedRunConfig.canvasLocked` is `true` opens locked; every other one, a new empty document included, opens unlocked. The value is written once, as part of the swap and before the new graph is set, so a locked Template or file never shows, renders or autosaves an unlocked moment, and the `applyRecommended` the caller runs afterwards finds it already set.

`loadDoc` takes a required `mode` with no default, so a new caller has to say which load it is:

- `{ mode: 'document-boundary', canvasLocked }` — another document, as above;
- `{ mode: 'revision-apply' }` — the open document edited in place by a revision Apply: one undo entry (`SEMANTICS-R.md` R-INV-8), refused while locked.

`loadGraph` (a Template) is always a boundary and takes `canvasLocked` the same way.

A temporary session that takes the open diagram along, and Reset all Loop Studio data (which reloads the app), are not boundaries of this kind.

## 5. The lock control (issue #335)

The Controls rail's lock button reads at a glance, without colour:

- **Unlocked:** an open padlock, its shackle swung to the side; the free end stands clear of the body by a measurable gap at the real 1× size (2 px for the 14 px icon).
- **Locked:** the closed padlock (both legs meet the body) with the rail's pressed tell, the same as the Focus toggle: the soft signal tint, an inset 2 px ring and the signal colour, at least 3 : 1 against the unlocked button. In forced colours: the system `Highlight` / `HighlightText` pair, like every rail toggle.
- **Name and state:** the accessible name is fixed, "Edit lock" (`canvas.lock.name`), and `aria-pressed` carries the state; the tooltip names the next action ("Lock editing — …" / "Unlock editing — …").
- The keyboard focus ring (the global `:focus-visible` outline) stays visible on the pressed button.
- The phone has no lock button (section 6).

## 6. Persistence

The lock is kept in `localStorage` (`loop-studio:canvas-locked`) so a plain reload or a PWA update keeps it. It is never part of the GraphDoc content, the digest, undo or `simulationRev`; a file carries it only as `recommendedRunConfig.canvasLocked`, written by an export while the lock is on.

The phone is view-only (`docs/mobile.md` §MV3a) and has no lock control; a Template opened there still sets the lock a later desktop visit sees.

## 7. Tests

- `src/store/editPolicy.test.ts` — every refused action leaves the document, the frames, the history and the digest unchanged; selection, a Step, export and unlocking still work.
- `src/store/graphStore.boundary.test.ts` — each boundary empties the history; a revision Apply keeps one entry; the lock takes only its final value (no unlocked moment for a locked document).
- `e2e/document-boundary.spec.ts` — the boundaries through the real UI: File → New, a temporary session, Delete work data, a Template, a file and a share link.
- `e2e/canvas-lock.spec.ts` — the controls are disabled and change nothing while locked, the keyboard neither reaches nor runs them; the allowed ones work.
- `e2e/lock-control.spec.ts` — the 1× gap of the open icon and none for the closed one, the fixed name, `aria-pressed` and the tooltip, the pressed tell in light and dark (the same as Focus, at least 3 : 1) and `Highlight` in forced colours, and the focus ring on the pressed button.
