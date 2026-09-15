// docs/toolbar-responsive.md — the modal dialogs that used to live inside
// ExportMenu / DataImportMenu / HelpMenu / ModuleMenu now render at
// Toolbar.tsx's stable top level (see `DialogHost.tsx`), so a group's own
// popover (File / Data / Settings / Help / Module / the ⋯ overflow menu) can
// close without unmounting a dialog it triggered. This is the shared payload
// for that single `activeDialog` state. Share is deliberately NOT in this
// union — `.share-pop` is a non-modal anchored popover, not a `.mcdlg` modal;
// see `useShareSurface`.
//
// `module-promote` / `module-frames` carry a `run` callback rather than
// their own business logic, the same shape `export-workspace` already
// uses — `ModuleMenu` keeps `runInsert`/`centre`/the graph-store calls
// entirely local (it already needs `useReactFlow()`/`useGraphStore()` for
// them); only the dialog's RENDERING moves here.
export type ToolbarDialog =
  | { kind: 'export-revision' }
  | { kind: 'export-workspace'; body: string; confirmLabel: string; run: () => void }
  | { kind: 'export-author' }
  | { kind: 'dataImport-wizard' }
  | { kind: 'dataImport-manage' }
  | { kind: 'about' }
  | { kind: 'contextualHelp' }
  | { kind: 'module-promote'; run: () => void }
  | { kind: 'module-frames'; body: string; run: () => void }
  | null
