# Toolbar — locale-independent responsive (non-frozen design doc)

**Status: implemented.** The desktop toolbar's row count and the Canvas top must
be **identical for every shipped locale at a given viewport width**. Before this,
the longer katakana palette labels (`コンバーター`, `パラメーター`, `レジスター`)
pushed the whole right-hand action group onto a second row at 1920px where EN /
KO stayed one row — so switching language alone moved the Canvas.

Lives in `src/components/toolbar/`: `toolbarOverflow.ts` (a pure fit
calculator), `useToolbarOverflow.ts` (the measured controller), `OverflowMenu.tsx`
(the `⋯` menu). No engine / schema / wire / GraphDoc change.

## TR1. The contract

- **Same viewport ⇒ same toolbar row count and same Canvas top**, in EN / KO / JA
  (and any future locale). The row count is decided by the **viewport width
  alone**, never by a branch on the language.
- **Wide desktop (`inner ≥ ONE_ROW_MIN`, ≈ a 1600px viewport): one row**, every
  locale. The `⋯` menu collapses as much of the utility tail as the active
  locale needs — more items for JA than EN at the same width, but the same row
  count.
- Below the breakpoint: a **controlled two rows** — the palette drops to its own
  second line; brand + actions stay on line 1. Never a surprise third row: at
  narrow widths the `⋯` menu may also absorb Theme / Language / New / Module to
  keep the actions on one line.
- **Never** solved by font-shrink, label truncation, or per-character wrapping.
  A button label is always one line (`white-space: nowrap; word-break: keep-all`).
- The overflow amount is decided by the **measured available width**, not the
  locale name. Widening the window, or switching back to a shorter language,
  restores the collapsed controls in a stable order (monotonic per mode).
- Keyboard navigation, focus return, ARIA names and tooltips are preserved for
  every control, whether inline or in the `⋯` menu.
- No horizontal document scroll; the toolbar never overlaps the Inspector.

## TR2. Overflow priority

Collapsed in this order (`OVERFLOW_ORDER`):

1. Help
2. Export
3. Share
4. Import
5. the `v… · <sha>` **build stamp** (hidden from the brand row — still in the
   `About` dialog and the brand's `title` / `aria-label`; the full SHA stays
   selectable there)
6. **go to two rows** — one-row mode never sheds more than the above

In the two-row layout only, if the actions line still would not fit, the "keep
exposed" tier is shed too, in the order Theme → Language → New → Module. Never
collapsed: undo, redo, Templates.

## TR3. Breakpoints

| viewport | behaviour (all locales) |
|---|---|
| ≥ ~1600px | one row; `⋯` collapses the utility tail as needed |
| ~1280px | two rows (palette on line 2), same policy for every locale |
| ~820px (tablet) | controlled two rows; button labels still one line |
| ≤ 720px | the separate mobile top bar (`MobileTopBar`) |

`ONE_ROW_MIN` (in `toolbarOverflow.ts`) is the one tuned constant — calibrated to
the width at which the widest shipped locale (JA) still reaches a clean single
row with only the utility tail + stamp shed. It is a width, not a locale test.

## TR4. Mechanism

- `useToolbarOverflow` runs one **pre-paint measurement pass** (`useLayoutEffect`,
  everything rendered expanded, `[data-measuring]` forcing `nowrap` +
  `overflow: visible` so nothing is clipped or squeezed) on mount, on
  `activeLocale` change, on the project-chip appearing/disappearing, and on any
  width change (ResizeObserver + window `resize`).
- It reads the true width of each region and calls `computeToolbarLayout` — a
  pure function returning `{ mode: 'row' | 'wrap', collapsed, hideStamp }`.
- A safety net escalates to the maximum one-row collapse if a `row` layout still
  rendered as two rows (a width estimate was low); it cannot loop.
- `.toolbar__brand` and `.toolbar__palette` are `flex-shrink: 0` so the
  controller measures the real space the actions have, rather than a squeezed
  approximation.

## TR5. Verification

`e2e/toolbar-responsive.spec.ts`:

- at 1920 / 1600 / 1280 / 820: EN / JA / KO agree on toolbar height, Canvas top,
  mode and visual row count; no button label wraps; no document h-scroll; no
  Inspector overlap; ≥1600 is one row; 820 is exactly two.
- resize wide → narrow → wide with no locale change: the layout recovers (row
  count and height return; the stamp comes back).
- the build stamp is only hidden when nothing else fits, and the brand carries
  the full build string in `title` + `aria-label`.
- an overflowed control (`Import`) is reachable by mouse and keyboard; Escape
  closes the `⋯` menu and returns focus to its trigger.

Unit: `src/components/toolbar/toolbarOverflow.test.ts` pins the pure calculator —
mode is a pure step function of the viewport width (the same threshold for every
locale), the collapse count is monotonic in width, and the stamp is only shed
after the utility tail.
