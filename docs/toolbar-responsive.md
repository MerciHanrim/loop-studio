# Toolbar — fixed two-tier structure (desktop only)

**Status: implemented.** The desktop toolbar is a **fixed two-tier
structure**, not a width-driven row/wrap layout: Tier 1 (brand + project/app
commands) is always exactly one row; Tier 2 (the 8-item node-creation
palette) is always its own row, directly below. The row count never varies
by viewport width or by locale — only how many Tier-1 GROUPS have collapsed
into the `⋯` overflow menu does. Mobile is unaffected — it renders a
completely separate `MobileTopBar` component below `≤720px`.

This supersedes the earlier one-row/two-row locale-independent contract
(pre-2026-09; that story is preserved in git history, not here). The
underlying insight carries over: canvas-authoring tools (the palette) and
document/app commands are functionally different kinds of controls and
should never be rendered at identical visual weight in one undifferentiated
row — this redesign makes that split permanent instead of width-conditional.

Lives in `src/components/toolbar/`: `toolbarOverflow.ts` (a pure fit
calculator over Tier 1 only), `useToolbarOverflow.ts` (the measured
controller), `OverflowMenu.tsx` (the `⋯` menu), `FileMenu.tsx` /
`SettingsMenu.tsx` (the two new grouped dropdowns), `dialogTypes.ts` /
`DialogHost.tsx` (the lifted-modal contract, below), `useShareSurface.ts` /
`ShareSurface.tsx` / `useAnchoredPosition.ts` (Share's lifted, anchored
confirm→panel flow). No engine / schema / wire / GraphDoc change.

## TR1. Structure

**Tier 1 — one row, always:**

`Loop Studio · Preview` (brand) — Undo/Redo — Templates — Insert module —
**File** (New, Import, Export) — **Data** (the spreadsheet-import workflow;
trigger reads `Data ▾` — the spreadsheet detail lives inside its own two menu
items, not the trigger) — **Share** (kept standalone, never merged into
another group — an explicit accessibility/discoverability decision) —
**Settings** (Theme, Language — personal app-environment prefs only, never a
junk drawer for anything else) — `?` (Help: Take a tour, Contextual help,
Send feedback, About).

The `v{version} · {sha}` build stamp is removed from the visible bar
entirely — it lives in the brand row's own `title`/`aria-label` tooltip and
in `AboutDialog`'s version line, unchanged.

**Tier 2 — the node palette, its own row, always (even at 1920px):**

`Pool · Source · Drain` — `Gate · Converter · End` — `Parameter · Register`,
three groups separated by a thin `.palette-divider`, the whole row rendered
as one low-contrast band (`--surface-sunken`) rather than each chip carrying
its own border/background at rest. A chip's border/background appears on
hover, keyboard focus, or while it is the one being dragged
(`[data-dragging]`, set by `Toolbar.tsx`'s `onDragStart`/`onDragEnd` —
**not** CSS `:active`, which native HTML5 drag does not reliably sustain for
the duration of a drag gesture).

## TR2. Render order vs. collapse order

**Render order is fixed and always canonical**: `Module → File → Data →
Share → Settings → Help`, whether a group is inline or inside `⋯`. This is a
single array in `Toolbar.tsx` (`GROUP_ORDER`), filtered by `isInline`/
`overflowedItems` — it is never itself reordered.

**Collapse order is a separate, narrower question**: `OVERFLOW_ORDER` in
`toolbarOverflow.ts` — `['help', 'data', 'settings', 'file', 'share',
'module']` — decides only which groups have moved into `⋯` and how many
(first-listed collapses first). A partial collapse never reorders what's
left on Tier 1; it only removes entries from the one fixed `GROUP_ORDER`
sequence. Inside `⋯` itself, the same canonical order applies to whichever
subset is present.

## TR3. Breakpoints

| viewport | behaviour |
|---|---|
| `≤720px` | the separate mobile top bar (`MobileTopBar`) — unaffected by this redesign |
| `721×720` | the desktop two-tier structure begins; Tier 1 must fit here even at its widest `RevisionChip` state (open revision or proposal, dirty) |
| `721–819px` | if Tier 2's palette doesn't fit as a single row even fully grouped, `.toolbar__palette` gets `overflow-x: auto` — scoped to that one band, and to the palette only; the document and the rest of the toolbar never scroll horizontally, and there is still no 3rd toolbar row |
| `820×720` and wider (`1280×720`, `1600×900`, `1920×900`, …) | the palette fits as a single row with no scroll needed |

`RevisionChip` renders nothing when no project is open — its **widest**
state (an open revision or proposal, `dirty`) is a real, separate width
condition from the "no project" baseline, and both (plus their clean
counterparts) are worth checking at the 721px boundary specifically, since
Tier 1 has no group left to shed there.

If a future measurement shows Tier 1 itself overflowing at 721px even with
the palette's own fallback in place, the first thing to give up is the
brand's decorative `.toolbar__tag` ("Preview" badge) below a new width
threshold — chrome, not document state — before ever touching
`RevisionChip`'s content or any core command (Undo/Redo/Templates,
never-collapsible, and the `RevisionChip` status area itself, never hidden
in a menu).

## TR4. Mechanism

- `useToolbarOverflow` runs one pre-paint measurement pass (`useLayoutEffect`,
  Tier 1 rendered expanded via `[data-measuring]`, forcing `nowrap` +
  `overflow: visible` so nothing is clipped or squeezed) on mount, on
  `activeLocale` change, on the project-chip appearing/disappearing, and on
  any width change (ResizeObserver + window `resize`). Tier 2 (the palette)
  is never part of this measurement — it has no fit decision to make; it is
  always one row, with the CSS-only 721–819px scroll fallback above.
- It reads Tier 1's true widths and calls `computeToolbarLayout` — a pure
  function returning `{ collapsed }`, the number of leading `OVERFLOW_ORDER`
  groups now in `⋯`.
- A safety net escalates to the maximum collapse if Tier 1 still overflows
  (a width estimate was low); it cannot loop.
- `.toolbar__brand` and `.toolbar__actions-core` are `flex-shrink: 0` so the
  controller measures the real space the collapsible groups have.

## TR5. Nested-menu close, focus-return, and dialog survival (review condition 3)

Every dialog that used to live *inside* a collapsible group (`ExportMenu`'s
`ConfirmDialog`s and `AuthorDialog`, `DataImportMenu`'s wizard and manage
dialog, `HelpMenu`'s `About`/`Contextual help`, `ModuleMenu`'s promote/frames
confirms) now renders at `Toolbar.tsx`'s own stable top level via
`DialogHost.tsx`, driven by one `activeDialog: ToolbarDialog` union
(`dialogTypes.ts`) — the same pattern `Toolbar.tsx` already used for `New`'s
own `ConfirmDialog`. Doing this only inside the group itself would mean
closing that group's popover (or `⋯`, when the group is collapsed) — needed
so no stray popover is left open behind the dialog — unmounts the component
that owns the dialog, silently killing it mid-flow. Lifting the dialog
state/JSX to a permanent sibling fixes this.

- **One `closeAncestors(origin, collapsed)`**, defined and called only
  inside `Toolbar.tsx`, never by a child component directly: closes File's
  own popover (when `origin === 'file'`) and the `⋯` overflow menu (whenever
  the acting group is currently collapsed into it) — always *before* the
  dialog/state change that follows. It backs every terminal action, not just
  ones that open a dialog: New, Export's 5 actions (including the two that
  open no dialog — Graph JSON's download, Proposal), Import's native file
  picker, Share's confirm, Data's wizard/manage, Help's 4 actions (including
  Take a tour and Send feedback, which open no dialog either), Module's
  insert/pick-file/extract. **Settings (Theme/Language) is the one
  deliberate exception** — cycling Theme or picking a Language is a
  plausible multi-click adjustment; auto-closing the menu after each click
  would be actively annoying.
- **`returnFocusTo` always resolves to an element guaranteed to still
  exist**: the group's own trigger when it was inline at the moment the
  action started, the `⋯` trigger when it was collapsed — captured
  synchronously before anything closes, never read lazily afterward.
- **Share is not a modal** and is not part of `activeDialog` — `.share-pop`
  is a non-modal, anchored popover (`useShareSurface.ts` owns `confirming` /
  `busy` / the copied-link `panel`; `ShareSurface.tsx` renders both the
  confirm `ConfirmDialog` and the panel). Once lifted off its original
  `.menu { position: relative }` ancestor, its position is computed by
  `useAnchoredPosition.ts`: default below-right of the anchor, clamped
  inside the viewport horizontally, flipped above (or clamped) when there
  isn't room below — recomputed on open and on `window resize`.

## TR6. Verification

`e2e/toolbar-responsive.spec.ts`:

- at `720×720` (mobile), `721×720`, `820×720`, `1280×720`, `1600×900`,
  `1920×900`: EN/JA/KO agree — 2 toolbar rows, the palette is 1 row, no
  button label wraps, no toolbar/inspector overlap, no document h-scroll
  outside the 721–819px exception band.
- `721×720` specifically: Tier 1 fits across every `RevisionChip` state (no
  project; revision/proposal × clean/dirty), EN/JA/KO.
- resize wide → 721 → wide with no locale change: the layout recovers.
- a partial collapse, and every group collapsed, both read in canonical
  `Module → File → Data → Share → Settings → Help` order inside `⋯`.
- `⋯ → File → Export` all open: Escape closes only Export.
- opening a lifted dialog (Export's Project revision) from a collapsed File
  closes File and `⋯` (no stray popover) and returns focus to `⋯`; from an
  inline File, focus returns to File's own trigger.
- Help's Take a tour / Send feedback close Help and `⋯` first.
- Share: no clipboard write before Confirm, exactly one after, still one
  after a rapid double-click on the lifted Confirm button; the copied-link
  panel survives `⋯` closing and stays fully inside the viewport, inline and
  collapsed.
- Settings does not close on a Theme click.
- dragging a palette chip sets `[data-dragging]` on that chip only, for the
  drag's duration.
- an overflowed control is reachable by mouse and keyboard; Escape closes
  `⋯` and returns focus to its trigger.
- Templates / Settings→Language dropdowns are never clipped at 1920/1280px,
  every locale.

Unit: `src/components/toolbar/toolbarOverflow.test.ts` pins the pure
calculator — the collapse count is monotonic in width, and
`overflowedItems`/`isInline` are checked against the 6-group
`OVERFLOW_ORDER`.
