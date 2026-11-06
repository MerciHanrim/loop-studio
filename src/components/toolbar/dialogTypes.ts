import type { StorageStep } from '../StoragePrivacyDialog'
import type { ModelSemanticsVersion } from '../../model/modelVersion'

// docs/toolbar-responsive.md — the modal dialogs that used to live inside
// ExportMenu / DataImportMenu / HelpMenu / ModuleMenu (removed 2026-10) now
// render at Toolbar.tsx's stable top level (see `DialogHost.tsx`), so a
// group's own popover (File / Data / Help / the ⋯ overflow menu) can close
// without unmounting a dialog it triggered. This is the shared payload
// for that single `activeDialog` state. Share is deliberately NOT in this
// union — `.share-pop` is a non-modal anchored popover, not a `.mcdlg` modal;
// see `useShareSurface`.
//
// `module-promote` / `module-frames` carry a `run` callback rather than
// their own business logic, the same shape `export-workspace` already
// uses — `StructureMenuItems` (File's structure rows; `ModuleMenu` before
// 2026-10) keeps `runInsert`/`centre`/the graph-store calls entirely local;
// only the dialog's RENDERING moves here.
export type ToolbarDialog =
  | { kind: 'export-revision' }
  | { kind: 'export-workspace'; body: string; confirmLabel: string; run: () => void }
  | { kind: 'export-author' }
  // docs/data-import.md §DI17 — `quickStart: true` (the Data menu's "How to
  // prepare a spreadsheet…" entry) opens the wizard with its quick-start
  // block expanded regardless of the persisted collapsed state.
  | { kind: 'dataImport-wizard'; quickStart?: boolean }
  | { kind: 'dataImport-manage' }
  // SEMANTICS-M5.md §M5-10 — Data ▸ New timetable
  | { kind: 'timetable-import' }
  | { kind: 'about' }
  | { kind: 'contextualHelp' }
  // Help ▸ Example notes (2026-10-20): each menu Template's explanation, in the app
  | { kind: 'exampleNotes' }
  // SEMANTICS-M5.md §M5-12 — Help ▸ how a step fills and empties a Pool
  | { kind: 'stepOrder' }
  // SEMANTICS-M6.md §M6-9 — Help ▸ how a run rule reads a tank
  | { kind: 'runRule' }
  // issue #297 - the Storage and privacy area; `step` opens it on a confirmation
  | { kind: 'storage-privacy'; step?: StorageStep }
  // the version the insert would lift the document to (2: the model layer,
  // 3: the kinds table, loop-model/3) — the consent names it
  | { kind: 'module-promote'; to: ModelSemanticsVersion; run: () => void }
  | { kind: 'module-frames'; body: string; run: () => void }
  | null
