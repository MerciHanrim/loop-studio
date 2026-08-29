# Mobile View/Run mode (design draft, non-frozen)

**Status: design draft** for review. A responsive CSS + small-component layer.
No native app, **no mobile editing** — a phone gets a **view & run** layout:
open a diagram (usually from a Share link), pan / pinch it, play it, run Monte
Carlo, read a node's config. Editing (move / connect / delete / add) stays
desktop-only. No wire/engine semantics; carries no `loop-*/N` id; revised freely.

## MV0. Why

Public `#g1=` Share links will be opened on phones. Today the desktop layout is
served as-is: the Inspector is a fixed 300 px column, the toolbar wraps
off-screen, the body scrolls sideways — it is not even a usable *viewer*. This
adds one small-screen layout so "someone sent me a Loop Studio link" works on a
phone.

`v0.4.0` is **held** until this lands (README already merged with the version
bump but the tag is not cut).

## MV1. Scope

**In**

- a width breakpoint below which the app uses the **view/run** layout;
- Canvas **full width + height**, `fitView` on open, finger **pan + pinch-zoom**;
- a **fixed bottom run bar** — Reset / Step / Play·Pause / Monte Carlo only;
- **Timeline** as a collapsible bottom sheet (collapsed by default);
- **Inspector** as a **read-only** bottom sheet — opens on a node/edge tap,
  shows its fields disabled, Close dismisses;
- a compact top bar — Logo mark + a **`⋯ More`** menu (Share / Import / Export /
  Templates / Theme / build stamp);
- **editing locked** — nodes not draggable, not connectable; no add; delete
  disabled. Selection stays on (so the read-only Inspector works);
- portrait **and** landscape; iOS `safe-area` insets;
- **no horizontal document scroll** at any supported width;
- a short in-UI note: *"View & run on mobile — edit on desktop."*

**Out**

- any touch editing (drag-to-move, drag-to-connect, tap-to-add);
- a separate mobile route / bundle / PWA behaviour change;
- redesigning the desktop layout — untouched above the breakpoint;
- a full responsive editor (a later, separate effort if ever).

## MV2. Breakpoint & detection

```css
@media (max-width: 720px), (orientation: landscape) and (max-height: 480px) { … }
```

- `≤ 720 px` — every phone in portrait, plus a narrow desktop window.
- the landscape-short clause — a phone turned sideways (~844 × 390).
- **> 720 px and tall** — the desktop layout, byte-for-byte unchanged.

CSS handles layout. React needs the same signal for the React-Flow props and
the sheet components, so a `useIsMobile()` hook (`matchMedia` on the same query,
updates on `change` and `orientationchange`). Not `pointer: coarse` — a small
laptop window should get view/run too.

`<meta name="viewport">` gains `viewport-fit=cover`.

## MV3. Canvas

- `.app__body` at the breakpoint is a single column; the Inspector and Timeline
  are **overlays**, not flex siblings. Canvas fills the space between the top bar
  and the bottom run bar.
- `<ReactFlow>` props, mobile only:
  `nodesDraggable={false}`, `nodesConnectable={false}`, `elementsSelectable`
  stays **true**, `panOnDrag`, `zoomOnPinch` (both default-true on touch),
  `zoomOnDoubleClick={false}`, no `onConnect`. `onNodesChange` still fires for
  selection but a `position` change can never originate (not draggable).
- `fitView` already runs on mount; add a `fitViewOptions` padding that looks
  right on a narrow viewport, and re-`fitView` on `orientationchange`.
- React Flow `Controls` — enlarge to 44 px, moved clear of the bottom bar; the
  `MiniMap` is **hidden** on mobile (too small to help, eats space).

## MV4. Bottom run bar

- The existing PlayBar (`.pstrip`) becomes `position: fixed; bottom: 0`,
  full-width, `env(safe-area-inset-bottom)` padding, at the breakpoint. It keeps
  **Reset / Step / Play·Pause** and the **Monte Carlo** button; the speed
  slider and seed field are dropped on mobile (view/run defaults are fine; a
  power user is on desktop).
- The step counter (`step N`) stays.

## MV5. Timeline & Inspector sheets

- **Timeline** — a bottom sheet above the run bar, **collapsed** by default; a
  small "Timeline ▲" handle expands it to ~45 vh with its own scroll, "▼"
  collapses it. Never a layout column.
- **Inspector** — a bottom sheet, **hidden** until `selectedNodeId ||
  selectedEdgeId`; opens ~55 vh; **every field rendered read-only / disabled**
  (it is a viewer); a Close button and tapping empty canvas both dismiss it.
- Only one sheet visible at a time (opening one collapses the other).
- `prefers-reduced-motion` → no slide.

## MV6. Compact top bar

`.toolbar` at the breakpoint: one non-wrapping row, `env(safe-area-inset-top)`.

| slot | content |
|---|---|
| left | Logo mark only — no word-mark, no `PREVIEW`, no build stamp |
| left | a muted **"view & run — edit on desktop"** caption (or an `ⓘ` that shows it) |
| right | **`⋯`** — Share, Import, Export ▾, Templates ▾, Theme, and the build-stamp line |

The palette chips, undo/redo, and **New** are **not rendered** on mobile
(editing is off). `ShareButton` / `ExportMenu` / `Templates` / `ThemeToggle`
render from inside the `⋯` menu, reusing their existing popovers.

## MV7. Safe area, touch targets, overflow

- **Safe area** — the top bar, run bar, and both sheets pad with
  `env(safe-area-inset-*)`.
- **Touch targets** — every control in the mobile layout is `min 44 × 44 px`.
- **Overflow** — `html, body, #root { overflow-x: clip }`, `.app { max-width:
  100vw }`; audit flex rows for `min-width: 0`.

## MV8. Decisions to settle

| # | decision | recommendation |
|---|---|---|
| **MV-D0** | hold `v0.4.0` for this **or** ship "mobile unsupported" now | **hold** (Lumi) — small, bounded |
| MV-D1 | breakpoint | `max-width: 720px` + landscape-short; no `pointer` gate; a `useIsMobile()` hook mirrors it |
| MV-D2 | editing | **hard-locked** on mobile — `nodesDraggable`/`nodesConnectable` `false`, no add, no delete; selection stays on |
| MV-D3 | Inspector | a **read-only bottom sheet**, auto-open on selection (not just hidden — a viewer wants to inspect config) |
| MV-D4 | run bar | fixed bottom: Reset / Step / Play·Pause / Monte Carlo; **no** speed slider or seed field |
| MV-D5 | Timeline | collapsible bottom sheet, collapsed by default |
| MV-D6 | secondary actions | a `⋯` **More** menu (Share / Import / Export / Templates / Theme / stamp); palette + undo/redo + New not rendered |
| MV-D7 | MiniMap | **hidden** on mobile |
| MV-D8 | new state | a small UI-only `useUiStore` (`{ sheet: 'none' \| 'inspector' \| 'timeline', moreMenuOpen }`) + `useIsMobile()` |
| MV-D9 | E2E | a `mobile` Playwright project — `iPhone 13` (390 × 844) portrait **and** landscape (844 × 390); asserts: no horizontal doc scroll; Canvas fills most of the viewport; a Share-link diagram renders; pan + pinch-zoom change the viewport; Step / Play / Monte Carlo work from the bottom bar; Inspector & Timeline sheets open/close; a node **cannot be dragged**; the desktop `state-ui` / `visual` snapshots are **unchanged** |
| MV-D10 | README | replace *"mobile editing is not currently optimized"* with *"Mobile browsers get a view & run layout — pan/zoom, play, Monte Carlo, inspect; editing is desktop-only."*; the Roadmap line becomes `✅ Mobile view/run layout` |

## MV9. Implementation slices

1. **breakpoint + `useIsMobile` + overflow kill + safe-area + Canvas full-bleed
   + `fitView` re-fit + touch pan/zoom + MiniMap hidden.** Mostly CSS + a hook +
   a few `<ReactFlow>` props. E2E: no h-scroll and Canvas fills at
   `390 × 844` / `844 × 390`; pinch/pan move the viewport; desktop snapshots
   unchanged.
2. **compact top bar + `⋯` More menu + fixed bottom run bar + Timeline sheet.**
   Reuse the existing popovers; drop palette / undo-redo / New / speed / seed on
   mobile. E2E: More-menu items present, Share still copies a link; Reset / Step
   / Play / Monte Carlo work from the bottom bar; Timeline opens/closes.
3. **editing lock + read-only Inspector sheet.** `nodesDraggable={false}` etc.;
   the Inspector sheet renders fields disabled, opens on tap, closes on Close /
   empty-tap. E2E: a node cannot be dragged (position unchanged after a drag);
   tap a node → read-only sheet; a Monte-Carlo run still completes; **desktop
   snapshots unchanged**. Then the README/Roadmap wording (MV-D10) and the
   `v0.4.0` tag.
