# Mobile View/Run mode (non-frozen)

**Status: implemented — shipped in `v0.4.0`** (Slices 1–3, PRs #21 / #22 / #23).
A responsive CSS + small-component layer. No native app, **no mobile editing** —
a phone gets a **view & run** layout: open a diagram (from a file or a Share
link), pan / pinch it, play it, run Monte Carlo, read a node's config.
Structural editing (add / move / connect / delete / property change) stays
desktop-only. No wire/engine semantics; carries no `loop-*/N` id; still revised
freely. §MV9 is the decision record; §MV10 the E2E; §MV11 the slices as landed.

## MV0. Why

Public `#g1=` Share links will be opened on phones. Today the desktop layout is
served as-is: the Inspector is a fixed 300 px column, the toolbar wraps
off-screen, the body scrolls sideways — it is not even a usable *viewer*. This
adds one small-screen layout so "someone sent me a Loop Studio link" works on a
phone.

`v0.4.0` is **held** for this. PR #18 merged the feature set and set the version
to `0.4.0`; a follow-up PR reopens it as `0.4.0-dev` so this layer ships inside
`v0.4.0`. The annotated tag is cut from the final Release PR once this lands.

## MV1. Scope

**In**

- a breakpoint below which the app uses the **view/run** layout;
- Canvas **full width + height**, `fitView` on open, finger **pan + pinch-zoom**;
- a **fixed bottom run bar** — Reset / Step / Play·Pause / Monte Carlo only;
- **Timeline** as a collapsible bottom sheet (collapsed by default);
- **Inspector** as a **read-only** bottom sheet — opens on a node/edge tap,
  every field disabled, Close dismisses;
- a compact top bar — Logo mark + a **`More`** menu (Share / Import / Export /
  Templates / Theme / build stamp);
- **structural editing locked** — see MV3a for the exact allow/deny split;
- portrait **and** landscape; iOS `safe-area` insets **reserved as real space**;
- **no** control ever outside the viewport at any supported width;
- a short in-UI note: *"View & run on mobile — edit on desktop."*

**Out**

- any structural touch editing (drag-to-move, drag-to-connect, tap-to-add,
  double-click-to-edit, context menu, structural keyboard shortcuts);
- editable Inspector fields on mobile — including simulation-input fields
  (see MV3a);
- a separate mobile route / bundle / PWA behaviour change;
- redesigning the desktop layout — byte-for-byte untouched above the breakpoint;
- a full responsive editor (a later, separate effort if ever).

## MV2. Breakpoint & detection

```css
@media (max-width: 720px),
       (max-height: 500px) and (max-width: 950px) and (pointer: coarse) {
  /* view/run layout */
}
```

- **`max-width: 720px`** — every phone in portrait, plus a genuinely narrow
  window. No `pointer` gate on this clause: a narrow desktop window is still a
  reasonable place to *view* a shared diagram, and structural editing there is
  only disabled, never destructive (MV3b).
- **the landscape-short clause** — `max-height: 500px` **and** `max-width: 950px`
  **and** `pointer: coarse` together, so a short-but-wide desktop window (a
  docked devtools panel, a split screen) is **not** mistaken for a phone in
  landscape (~844 × 390, coarse pointer).
- **anything else** — the desktop layout, unchanged.

CSS drives layout. React needs the same signal for the React-Flow props and the
sheet components: a **`useIsMobile()`** hook runs `matchMedia` on the *exact*
same query string (single source of truth — the query lives in one module,
imported by both the `<style>` build and the hook), and updates on the
MediaQueryList `change` event. Not `pointer: coarse` alone.

`<meta name="viewport">` gains `viewport-fit=cover`.

## MV3. Canvas

- `.app__body` at the breakpoint is a single column; the Inspector and Timeline
  become **overlays**, not flex siblings. Canvas fills the space between the top
  bar and the bottom run bar.
- `<ReactFlow>` props, mobile only (from `useIsMobile()`):
  - `nodesDraggable={false}`, `nodesConnectable={false}`, `edgesReconnectable={false}`
  - `elementsSelectable` stays **true** (the read-only Inspector needs selection)
  - `nodesFocusable` / `edgesFocusable` stay true for tap selection; **no**
    `deleteKeyCode` (set to `null`) so a paired keyboard can't delete
  - `zoomOnDoubleClick={false}`, `selectionOnDrag={false}`, no `onConnect`,
    no `onNodeDragStop`
  - `panOnDrag` and `zoomOnPinch` stay default-true (touch pan / pinch)
- `fitView` runs on mount as today. On rotation it runs again — see MV3c.
- React Flow `Controls` — 44 px targets, positioned **above** the reserved
  bottom-bar + safe-area band (MV7) so zoom/fit buttons are never covered; the
  **`MiniMap` is not rendered** on mobile.

### MV3a. Editing lock — exact boundary

The mobile layout is a **viewer + runner**. Precisely:

**Denied on mobile** (no-op, no `commit()`, no `bump()`):

| action | how it's blocked |
|---|---|
| add a node (palette / drag-drop / paste) | palette not rendered; drop handler ignored on mobile |
| move a node | `nodesDraggable={false}` |
| connect / reconnect an edge | `nodesConnectable={false}`, `edgesReconnectable={false}`, `onConnect` omitted |
| delete a node/edge | `deleteKeyCode={null}`; no delete control in the read-only Inspector |
| keyboard Delete / Backspace | `Shortcuts` component early-returns when `useIsMobile()` |
| structural keyboard shortcuts (undo/redo, duplicate, select-all, nudge) | same early-return |
| double-click / context-menu editing | `zoomOnDoubleClick={false}`; `onContextMenu` preventDefault on the canvas; no context menu wired |
| change any node/edge property | Inspector renders every field `disabled` / `readOnly` |

**Allowed on mobile** (these are *not* structural graph mutations):

| action | note |
|---|---|
| **node / edge selection** | drives the read-only Inspector only |
| **simulation config + run** | Reset / Step / Play·Pause / speed default; Monte Carlo dialog + run |
| **document replacement** — Import a file, load a Template | replaces the whole `GraphDoc`; **confirm first** (MV3b), then the same atomic `loadDoc()` path desktop uses |
| **Share / Export** | read-only serialisation of the current doc |
| pan / pinch-zoom / `fitView` | viewport only, never touches the doc |

**Simulation-input Inspector tabs** (e.g. a future "state interaction" panel that
feeds simulation inputs rather than graph structure): on mobile these are
**read-only too** in this first cut. Rationale — "view/run" means run with the
diagram's own configured inputs; changing inputs is a desktop task. If a later
revision wants live sim-input editing on mobile, it is added deliberately as its
own decision, gated separately from the structural lock (which stays hard).

### MV3b. Document replacement needs confirmation

Import / Template on mobile replace the entire document. Before doing so, the
same confirm gate the desktop uses applies: if the current session is **not** the
pristine first-boot sample, `window.confirm` ("Replace the current diagram?").
On cancel, nothing changes. On accept, the existing atomic paused-`loadDoc()`
path runs (one `simulationRev` bump). Mobile adds no new replace path — it reuses
the Share-loader / Import machinery already specced in `SEMANTICS-U.md` /
`SEMANTICS-W.md`.

### MV3c. Entering mobile never mutates state

Crossing the breakpoint — first load under it, a resize, a rotation — is a
**pure presentation change**:

- no `commit()`, no `bump()`, no `simulationRev` change;
- the undo/redo history is untouched;
- the `GraphDoc` in the store is **not** transformed, re-serialised, or
  re-normalised — the mobile layout renders the *same* store, read-only;
- `pristineSample` latch is not touched by the layout switch;
- returning to a desktop width **restores the full editing UI** with node
  positions, selection, undo stack, and run state exactly as they were.

### MV3d. Rotation & fitView

On `orientationchange` (or a `matchMedia('(orientation: portrait)')` `change`):

1. close any open exclusive overlay (MV5) first — the PWA update bar, if
   showing, stays;
2. run `fitView` **exactly once**, after the resize settles (one
   `requestAnimationFrame` / `resize`-debounced call).

Pan or pinch-zoom **within the same orientation never re-fits** — a
`lastOrientation` ref gates step 2 so the user's chosen viewport is preserved
until they actually rotate.

## MV4. Bottom run bar

- The existing PlayBar (`.pstrip`) becomes `position: fixed; bottom: 0`,
  full-width at the breakpoint, with **real** `padding-bottom:
  env(safe-area-inset-bottom)` (MV7).
- Keeps **Reset / Step / Play·Pause**, the **Monte Carlo** button, and the
  `step N` counter. The speed slider and seed field are **not rendered** on
  mobile (view/run uses defaults; a power user is on desktop).
- 44 px minimum touch targets.

### MV4a. Dynamic viewport height

The mobile layout sizes to **`100dvh`** with **`100vh` as the fallback**
(`height: 100vh; height: 100dvh`) — every full-height rule (`.app`, the canvas
pane, the sheets' max-height, the MC dialog) uses this pair, never a bare
`100vh`. Consequence: as the iOS address bar collapses/expands, and as the
software keyboard opens (it never does for editing here, but a "Save link?"
prompt or an OS autofill can still push the viewport), the **fixed bottom bar
stays inside the visible viewport** — `dvh` tracks the shrinking visual
viewport, and `env(safe-area-inset-bottom)` keeps it clear of the home
indicator. A `visualViewport` `resize`/`scroll` listener is the last-resort
nudge if a browser lags the CSS (translate the bar by
`window.innerHeight - visualViewport.height - visualViewport.offsetTop` when
that is positive).

### MV4b. iOS input focus-zoom

iOS Safari **zooms the page in** when a text / number `<input>` whose computed
`font-size` is **< 16px** receives focus, and does **not** zoom back out when
the field blurs — the app is left stuck at ~130 %. The Monte-Carlo dialog is the
only place a mobile user focuses a field (the run bar has no seed / speed
input), so:

- under the mobile media query, **`.mcdlg__field input` is `font-size: 16px`**
  — at 16px iOS does not trigger the focus-zoom at all;
- **`MonteCarloDialog` blurs `document.activeElement` before it closes** (every
  dismiss path — the ✕, the scrim, `Escape`), which drops focus and dismisses
  the soft keyboard so the page returns to 100 %.

Pinch / accessibility zoom is **never** blocked — the viewport meta stays
`width=device-width, initial-scale=1.0, viewport-fit=cover` with no
`maximum-scale` or `user-scalable=no`.

## MV5. Timeline & Inspector sheets

Both are bottom sheets. **Shared sheet contract:**

- exactly **one exclusive overlay** open at a time. The exclusive set is
  **Inspector, Timeline, the `More` menu, the Monte-Carlo dialog, the Share
  result popover, the Templates menu, and the Export menu** — opening any one of
  them closes whichever other exclusive overlay was open. (The PWA update bar is
  **not** in this set — MV8a.)
- the trigger carries `aria-expanded` / `aria-controls`; the sheet has
  `role="dialog"` + `aria-label`;
- a visible **Close** button (44 px), **Escape** closes, and focus **returns to
  the trigger** on close; focus moves into the sheet on open;
- `env(safe-area-inset-bottom)` padding; max-height leaves the top bar visible;
  the sheet body scrolls internally (`overflow-y: auto`; `overscroll-behavior:
  contain`);
- `prefers-reduced-motion` → no slide transition.

**Timeline** — collapsed by default; a "Timeline" handle expands it to ~45 vh.
Never a layout column.

**Inspector** — hidden until `selectedNodeId || selectedEdgeId`; opens ~55 vh;
**every field rendered read-only / disabled** (MV3a); Close and an empty-canvas
tap both dismiss it and clear selection.

## MV6. Compact top bar

`.toolbar` at the breakpoint: one non-wrapping row, real `padding-top:
env(safe-area-inset-top)`.

| slot | content |
|---|---|
| left | Logo mark only — no word-mark, no `PREVIEW`, no build stamp |
| left | a muted **"view & run — edit on desktop"** caption (or an `i` control that shows it) |
| right | **`More`** — Share, Import, Export, Templates, Theme, and the build-stamp line |

The palette chips, undo/redo, and **New** are **not rendered** on mobile.
`ShareButton` / `ExportMenu` / `Templates` / `ThemeToggle` render from inside the
`More` menu, reusing their existing popovers. The `More` menu follows the same
sheet contract as MV5 (`aria-expanded`, Escape, focus return, mutually
exclusive).

### MV6a. Getting your work onto the phone — no account sync

Loop Studio has no accounts and no server storage; desktop autosave lives in
that browser only. So a phone views another device's work by **opening a file**
or **a Share link** — the two things that already move a diagram between
machines:

- **`More` → `Import file`** — a `Graph JSON` *or* a `Workspace JSON` (the same
  `importFile()` desktop uses; a Workspace file also restores the run position,
  the last distribution, and the view). Confirm-before-replace per MV3b.
- **a `#g1=` Share link** — opened straight from the address bar / a message;
  graph only (no run state).

Because the mobile first screen is always the built-in sample until you load
something, a small **"Open a file"** card sits on that first screen while the
session is still `pristineSample`: the line *"No account sync — open a saved
file or a Share link to view it here."*, an **Open a file** button (the same
file picker as `More` → `Import file`), and a note that Graph/Workspace JSON
come from desktop Export. It disappears the moment any document / template /
Share link loads.

## MV7. Safe area, touch targets, overflow

- **Safe area is reserved as real space**, not just honoured visually:
  - top bar: `padding-top: env(safe-area-inset-top)`;
  - bottom run bar: `padding-bottom: env(safe-area-inset-bottom)`;
  - the Canvas / React-Flow pane reserves `padding-bottom` (or a spacer) equal to
    **bottom-bar height + `env(safe-area-inset-bottom)`**, and `padding-top`
    equal to the top-bar height, so nodes and the React Flow `Controls` are never
    rendered under a bar or under the notch;
  - left/right insets applied to the fixed bars in landscape.
- **Touch targets** — every control in the mobile layout is `min 44 × 44 px`.
- **Overflow** — `html, body, #root { overflow-x: clip }` and `.app { max-width:
  100vw }` are the floor, **not** the proof. The real guarantee is the E2E
  bounding-box check in MV10: every core control's rect sits fully inside the
  viewport rect.

## MV8. MC dialog on mobile

- The Monte-Carlo dialog fits **inside** the mobile viewport: `max-width:
  100vw`, `max-height: 100dvh` minus safe-area (`100vh` fallback, MV4a), centred;
  its inner run-list / result area scrolls (`overflow-y: auto`,
  `overscroll-behavior: contain`).
- It joins the exclusive overlay set (MV5) and follows the same
  Escape / focus-return / `aria` contract.
- The run itself is unchanged (worker on a secure origin; main-thread fallback).

## MV8a. PWA update bar on mobile

The `.pwa-update` bar (a new SW version is waiting) is **kept out** of the
exclusive overlay set — a pending update is orthogonal to viewing a diagram and
must not be dismissed just because a sheet opened, nor block a sheet from
opening. Its mobile placement rules:

- **Position — top.** On mobile the bar is fixed **directly below the compact
  top bar** (`top: calc(<top-bar height> + env(safe-area-inset-top))`),
  full-width minus the left/right safe-area insets. This keeps it away from the
  crowded bottom edge (run bar + rising sheets) entirely, so it can collide with
  neither.
- **Z-index — above everything**, so its two 44 px buttons (**Update** /
  **Dismiss**) stay reachable even while an exclusive sheet or the MC dialog is
  open: `--z-canvas < --z-runbar < --z-sheet <= --z-mc-dialog < --z-pwa-update`.
  Bottom sheets open to at most ~55 vh and the MC dialog is centred with a
  safe-area top margin, so the top-anchored bar and a sheet **do not overlap**
  in practice; the z-order is the guarantee if they ever do.
- **Never covers a core control** — it is above a strip of canvas just under the
  top bar; Reset / Step / Play·Pause / Monte Carlo, the `More` trigger, and a
  sheet's **Close** are all elsewhere on screen. It can only occlude canvas,
  which the user can pan. When it shows, the Canvas top padding (MV7) grows by
  the bar's height so no node hides behind it.
- Behaviour (waiting worker, one reload on Update, data-loss note) is unchanged
  from `docs/pwa.md` §P4 — this section is layout only.

## MV9. Decisions to settle

| # | decision | recommendation |
|---|---|---|
| **MV-D0** | hold `v0.4.0` for this **or** ship "mobile unsupported" now | **hold** — reopen `0.4.0-dev`, land this, then tag |
| MV-D1 | breakpoint | `max-width: 720px` **or** `(max-height: 500px) and (max-width: 950px) and (pointer: coarse)`; one shared query string feeds both CSS and `useIsMobile()` |
| MV-D2 | structural editing | **hard-locked** (MV3a table) — no add/move/connect/delete/property-change, no delete key, no dbl-click / context-menu / structural shortcuts |
| MV-D3 | selection & Inspector | selection **allowed**; Inspector is a **read-only** bottom sheet, auto-opens on selection |
| MV-D4 | simulation-input Inspector tabs | **read-only on mobile** in this cut; any future live sim-input editing is a separate, separately-gated decision |
| MV-D5 | document replacement | Import / Template **allowed**, but **confirm-before-replace** (MV3b), reusing the existing atomic `loadDoc()` path |
| MV-D6 | layout switch | **never** mutates the doc / undo history / latch (MV3c); desktop width fully restores the editing UI |
| MV-D7 | run bar | fixed bottom: Reset / Step / Play·Pause / Monte Carlo + `step N`; **no** speed slider or seed field |
| MV-D8 | Timeline | collapsible bottom sheet, collapsed by default |
| MV-D9 | secondary actions | a `More` menu (Share / Import / Export / Templates / Theme / stamp); palette + undo/redo + New not rendered |
| MV-D10 | MiniMap | **not rendered** on mobile |
| MV-D11 | exclusive overlays | Inspector / Timeline / `More` / MC dialog / **Share result / Templates / Export** are **mutually exclusive** (opening one closes the others); each has `aria-expanded` on its trigger, a 44 px Close, Escape-to-close, focus-return |
| MV-D12 | safe area | **reserved as real padding** on both bars and the canvas pane, not just visually honoured |
| MV-D13 | rotation | close open exclusive overlays, `fitView` **once**; no re-fit on pan/zoom within an orientation |
| MV-D14 | new state | a small UI-only `useUiStore` (`{ overlay: 'none' \| 'inspector' \| 'timeline' \| 'more' \| 'mc' \| 'share' \| 'templates' \| 'export' }`) + `useIsMobile()` |
| MV-D15 | E2E | see MV10 |
| MV-D16 | README | replace *"mobile editing is not currently optimized"* with *"Mobile browsers get a view & run layout — pan/zoom, play, Monte Carlo, inspect; editing is desktop-only."*; Roadmap line becomes `✅ Mobile view/run layout` |
| MV-D16a | opening files | no account / cloud sync (MV6a). `More` → `Import file` accepts Graph **and** Workspace JSON; a `#g1=` Share link is the other path. An **"Open a file"** card with the "No account sync" copy sits on the pristine first screen and clears once a document loads |
| MV-D17 | viewport height | `100dvh` with `100vh` fallback everywhere (MV4a); a `visualViewport` listener nudges the bottom bar if a browser lags; the fixed bottom bar stays on-screen through iOS address-bar / keyboard height changes |
| MV-D18 | PWA update bar | **not** in the exclusive set (MV8a) — a pending update never closes a sheet and a sheet never blocks it |
| MV-D19 | PWA update bar placement | fixed at the **top**, below the top bar (`top: calc(topbar + safe-area)`); **highest z-index** (`canvas < runbar < sheet <= mc-dialog < pwa-update`) so Update/Dismiss stay clickable with a sheet open; Canvas top padding grows by its height; can only ever occlude canvas |

## MV10. Required E2E

A dedicated **`mobile` Playwright project** — `devices['iPhone 13']`, run at
**390 × 844 (portrait)** and **844 × 390 (landscape)**. Diagram loaded from a
`#g1=` Share link (same `openPayloadLocally` helper the share specs use).

**Layout / viewport**

- no horizontal document scroll (`document.scrollingElement.scrollWidth <=
  clientWidth`) in both orientations;
- **every core control's bounding box is fully inside the viewport rect** — the
  `More` trigger, all four run-bar buttons, the `step N` counter, the React Flow
  `Controls`, and — when open — the Inspector sheet, the Timeline sheet, the
  `More` menu, the MC dialog, **the Share result URL field, and the PWA update
  bar**;
- Canvas occupies most of the viewport (canvas rect area ≥ ~60 % of viewport
  area) with both bars accounted for;
- with **mocked non-zero safe-area insets** (inject
  `env(safe-area-inset-*)` fallbacks via a test stylesheet / `--sai-*` vars),
  the bottom bar's buttons are still fully visible and hittable, and no node sits
  under a bar.

**Dynamic height & the non-exclusive update bar**

- shrink then grow the viewport height at runtime (`page.setViewportSize` from
  844 → ~620 → 844 in portrait, and a `visualViewport` resize simulation): after
  every step the bottom run bar's rect is still fully inside the visual
  viewport, and its buttons are hittable;
- force the `.pwa-update` bar to show (seed a fake waiting worker as the PWA
  specs already do): its bounding box is fully on-screen, anchored near the
  **top** (below the top bar), and its `bottom` is above the run bar's `top` —
  it overlaps no run-bar button;
- with the update bar **and** a sheet open at once (open the Inspector while the
  bar shows): the sheet's **Close**, the bar's **Update**, and the run bar's
  **Play** are each fully visible and independently clickable — none is occluded
  by another (the bar carries the highest z-index, MV8a);
- the Share result URL field: open `More` → Share, the selectable URL field's
  rect is fully within the viewport and the text is selectable.

**View / interaction**

- the Share-link diagram renders (expected node count visible);
- a pan gesture and a pinch-zoom gesture each change the React Flow viewport
  transform;
- **Step** advances `step N` (`step 0` → `step 1`); **Play** then **Pause**
  runs and halts; **Monte Carlo** opens the dialog, a small run completes, the
  distribution shows, and the dialog scrolls if its content overflows;
- Inspector: tap a node → read-only sheet opens, a field is `disabled`, Close
  returns focus to… (no trigger — empty-canvas tap path) / Escape closes;
- Timeline: handle opens the sheet, Close / Escape closes it;
- opening any second overlay closes the first (mutual exclusion).

**Editing is locked — the doc is byte-stable**

- capture `JSON.stringify(exportDoc())` (or the store's serialised `GraphDoc`)
  **before** any mobile interaction;
- attempt: drag a node ~100 px, `page.keyboard.press('Delete')` and
  `'Backspace'` with a node selected, a drag between two node handles (connect
  attempt);
- after each: node count, edge count, and the serialised `GraphDoc` string are
  **byte-identical** to the capture;
- also byte-identical after pan / zoom / Step / Play / Monte Carlo / select /
  sheet toggles (run state may change; the *document* may not).

**Document replacement still works**

- `More` → `Import file` is a real, visible entry; it accepts a **Graph JSON**
  *and* a **Workspace JSON** (the latter also restores the run position / last
  distribution / view);
- modified session → `window.confirm` before replacing; **Cancel** leaves the
  `GraphDoc`, `simulationRev`, and run state untouched and keeps the sheet open;
  **Accept** replaces via one `loadDoc()` (exactly `simulationRev + 1`), closes
  the sheet, and returns focus to `More`;
- **pristine first boot** → picking a Template (or Import) applies with **no
  confirm**, exactly one `simulationRev` bump;
- the same for a Template load from the `More` menu;
- the **"Open a file"** first-run card (MV6a) is present while `pristineSample`,
  carries the "No account sync" copy, its button opens the file picker, and it
  disappears once a document loads.

**Desktop is untouched**

- the existing desktop `state-ui` / `visual` Playwright snapshots are **byte-for-
  byte unchanged**;
- a test that starts at 390 × 844, then resizes to a desktop width, asserts the
  palette, undo/redo, and **New** are back, a node **is** draggable again, and a
  connect gesture succeeds — i.e. the editing UI fully restores.

## MV11. Implementation slices

1. **Breakpoint + `useIsMobile` + shared query module + overflow floor +
   `100dvh`/`100vh` height + safe-area reservation + Canvas full-bleed +
   `fitView` rotation handling + touch pan/zoom + MiniMap off.** Mostly CSS + a
   hook + a few `<ReactFlow>` props. E2E: no h-scroll, controls in-viewport,
   canvas fills, safe-area mock, dynamic-height shrink/grow keeps the run bar
   on-screen, pan/pinch move the viewport, rotation re-fits once; desktop
   snapshots unchanged.
2. **Compact top bar + `More` menu + fixed bottom run bar + Timeline sheet + the
   exclusive-overlay contract (`useUiStore`, mutual exclusion across Inspector /
   Timeline / `More` / MC / Share / Templates / Export, `aria-expanded`, Escape,
   focus return) + top-anchored PWA update bar placement (MV8a).** Reuse
   existing popovers; drop palette / undo-redo / New / speed / seed on mobile.
   E2E: `More` items present, Share still copies a link + its URL field is
   on-screen; Reset / Step / Play / Monte Carlo work from the bottom bar; MC
   dialog fits + scrolls; Timeline opens/closes; overlays mutually exclusive;
   update bar + a sheet open together leaves Close / Update / Play all
   clickable.
3. **Structural editing lock + read-only Inspector sheet + confirm-on-replace +
   layout-switch purity.** `nodesDraggable={false}` etc.; `Shortcuts`
   early-returns on mobile; Inspector fields `disabled`; Import/Template confirm.
   E2E: the byte-stable-doc battery, drag/Delete/connect no-ops, Import-with-
   confirm replaces, mobile→desktop restores full editing, **desktop snapshots
   unchanged**. Then the README/Roadmap wording (MV-D16) and, in the final
   Release PR, the `v0.4.0` tag.
