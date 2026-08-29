# Mobile layout (design draft, non-frozen)

**Status: design draft** for review. No wire format, no engine/graph semantics —
a responsive CSS + small-component layer over the existing app. Revised freely
as it lands; carries no `loop-*/N` id.

## M0. Why

The PWA install/offline work (`docs/pwa.md`) made "open Loop Studio on a phone"
a real path. It boots, but the layout is **desktop-fixed**: there is not one
width-based `@media` rule in `src/index.css`. On a portrait phone today —

- the toolbar (brand + 6 palette chips + 8 action buttons) wraps into a tall
  ragged stack, some buttons off-screen;
- the Inspector is `width: 300px; flex-shrink: 0` — on a 390 px screen it takes
  most of the width, permanently;
- Canvas + Timeline + Inspector all fight for space, so the editable area is a
  sliver;
- the body scrolls horizontally.

"Boots on mobile" is done; "usable on mobile" is not. This draft closes that.

## M1. Scope

**Release framing (DECIDE M-D0).** Two options:

1. **`v0.4.0` = desktop-first PWA.** Ship the offline PWA now; README says
   *"Desktop-first — a mobile editing layout is not yet supported."* The iOS /
   Android checklist is judged on **install + offline boot only**. Mobile layout
   becomes `v0.4.1`.
2. **Mobile layout is in `v0.4.0`.** Hold the release; land this layer first so
   the phone install the checklist exercises can actually be used.

Lumi recommends **(2)**. This draft is written for (2); if (1) is chosen it is
unchanged, just deferred.

**In scope for the mobile layer**

- a width breakpoint below which the app uses a **compact layout**;
- a **compact top bar**: brand mark, an **Add** button (palette as a bottom
  sheet), an **overflow ⋯ menu** for the rest;
- the **Inspector as a bottom sheet** — hidden until a node/edge is selected;
- a **Canvas / Timeline** switch — one visible at a time;
- **safe-area insets** for the iOS standalone notch / home indicator;
- **≥ 44 px touch targets** for every control in the compact layout;
- **no horizontal document scroll** at any supported width;
- **portrait + landscape** both work (portrait is the target).

**Out of scope for v0.4.0**

- drag-a-chip-onto-the-canvas on touch → mobile uses **tap-to-add-at-centre**
  (the palette chips already call `addCentered` on click);
- bespoke mobile onboarding, gesture tutorials;
- a separate mobile route / app;
- rethinking the desktop layout — it is untouched above the breakpoint.

## M2. Breakpoint

```css
/* compact layout */
@media (max-width: 720px), (orientation: landscape) and (max-height: 480px) {
  …
}
```

- `≤ 720 px` catches every phone in portrait and a narrow desktop window.
- the landscape-short clause catches a phone turned sideways (≈ 740 × 390).
- **> 720 px and tall** keeps the current desktop layout, untouched.

No `pointer: coarse` gate — a small window on a laptop should get the compact
layout too, and a touch laptop at full width should keep the desktop one.

## M3. The compact top bar

`.toolbar` at the breakpoint becomes a single non-wrapping row,
`env(safe-area-inset-top)` padding on top:

| slot | content |
|---|---|
| left | the Logo mark only — **no** word-mark, **no** `PREVIEW` tag, **no** build stamp (the stamp moves into the ⋯ menu as a muted line) |
| centre | **`＋ Add`** — opens the node palette as a bottom sheet (`Pool / Source / Drain / Gate / Converter / End`, each a full-width 48 px row; tap adds at canvas centre and closes the sheet) |
| centre | **`◫ Canvas` / `📈 Timeline`** segmented toggle (M5) |
| right | **`⋯`** — a menu with New, Import, Share, Export ▾ items, Templates ▾, Theme, Undo, Redo, and the build stamp line |

Undo/redo also stay reachable as the OS/browser back-gesture does nothing here;
they live in the ⋯ menu (not worth a always-visible slot on a phone).

The existing `ExportMenu` / `Templates` / `ShareButton` popovers are reused;
they just render from inside the ⋯ menu. `ShareButton`'s selectable-URL field
must fit — it already uses `max-width: 100%`.

## M4. Inspector as a bottom sheet

- Below the breakpoint, `.inspector` is **`position: fixed`**, full width, bottom
  aligned, `max-height: 70vh`, `env(safe-area-inset-bottom)` padding, its own
  scroll, a small grab-handle + a **Close** button. It is **not** a flex sibling
  of the canvas — it overlays.
- **Shown** when `selectedNodeId || selectedEdgeId` is set (it slides up);
  **hidden** otherwise. Selecting a node on the canvas opens it; Close or
  tapping empty canvas (which clears the selection) dismisses it.
- `prefers-reduced-motion` → no slide, just show/hide.
- The desktop Inspector (right rail) is unchanged above the breakpoint.

## M5. Canvas / Timeline switch

- `.app__body` at the breakpoint is `flex-direction: column`; the Inspector is
  removed from the flow (M4), so the column is just the canvas region.
- Inside `.canvas-col`, only **one of Canvas / Timeline** renders at a time,
  chosen by the M3 segmented toggle (state in a tiny `useUiStore`, default
  `canvas`). The **PlayBar (`.pstrip`) stays visible in both** — it is the run
  control; it gets compacted (smaller gaps, the speed slider drops to an icon +
  popover if needed).
- React Flow's own `Controls` (`.react-flow__controls`) are enlarged to 44 px
  and moved clear of the PlayBar.

## M6. Safe area, touch targets, overflow

- **Safe area** — the app shell, the compact top bar, the palette sheet, and the
  Inspector sheet pad with `env(safe-area-inset-*)`. `<meta name="viewport">`
  gains `viewport-fit=cover`.
- **Touch targets** — every button/menuitem/chip in the compact layout is
  `min-height: 44px; min-width: 44px` (icon-only buttons) or full-width rows.
- **Overflow** — `html, body, #root { overflow-x: clip }` and `.app { max-width:
  100vw }`; audit every flex row for `min-width: 0`. Wide content (the Timeline
  SVG, code-ish text) already scrolls inside its own container.

## M7. Decisions to settle

| # | decision | recommendation |
|---|---|---|
| **M-D0** | `v0.4.0` = desktop-first PWA (mobile → v0.4.1) **or** mobile layout inside `v0.4.0` | **inside `v0.4.0`** (Lumi) — hold the release |
| **M-D1** | breakpoint | `max-width: 720px`, plus landscape-short; no `pointer` gate |
| **M-D2** | palette on mobile | an **Add** button → bottom sheet, **tap-to-add-at-centre** (no touch DnD) |
| **M-D3** | secondary actions | an **⋯ overflow menu** (New / Import / Share / Export / Templates / Theme / Undo / Redo / build stamp) |
| **M-D4** | Inspector | a **bottom sheet**, auto-open on selection, `position: fixed`, not a layout column |
| **M-D5** | Canvas vs Timeline | a **segmented toggle**, one at a time; PlayBar always visible |
| **M-D6** | brand area | mark only; word-mark / `PREVIEW` / build stamp hidden (stamp → ⋯ menu) |
| **M-D7** | new state | a small `useUiStore` for `{ panel: 'canvas' \| 'timeline', paletteSheetOpen, moreMenuOpen }` — UI only, not persisted, not in `__loop` beyond dev |
| **M-D8** | E2E | a `mobile` Playwright project — `iPhone 13` + `Pixel 7` viewports; asserts no horizontal doc scroll, the compact bar, palette-sheet add, Inspector-sheet open/close, the Canvas/Timeline toggle, PlayBar Step; portrait + landscape |

## M8. Implementation slices

1. **breakpoint + overflow kill + safe-area + touch-target pass** — pure CSS
   (`src/index.css` media block) + the `viewport-fit=cover` meta. The app is
   already "less broken" (no horizontal scroll, buttons reachable by scroll)
   before any component work. E2E: no-horizontal-scroll at `iPhone 13` /
   `Pixel 7`, portrait + landscape.
2. **compact top bar** — the Logo-only brand, the `＋ Add` palette bottom sheet,
   the `⋯` overflow menu (reusing `ExportMenu` / `Templates` / `ShareButton` /
   `ThemeToggle` inside it), the `useUiStore`. E2E: Add opens the sheet, a chip
   adds a node at centre; ⋯ shows the items; Share still copies a link.
3. **Inspector bottom sheet + Canvas/Timeline toggle** — `.inspector`
   `position: fixed` sheet driven by selection; the segmented toggle; PlayBar
   compaction; enlarged React Flow controls. E2E: select a node ⇒ sheet up;
   Close / empty-tap ⇒ down; toggle switches Canvas ↔ Timeline; Step works from
   the PlayBar in the compact layout.
4. **the `mobile` Playwright project + one real-device pass** (Hanrim: Android
   install→edit→airplane-mode; iOS A2HS→edit→offline), then the README/Ship
   flip and the Release PR.
