# Dense-graph pan usability (non-frozen design doc — DRAFT)

**Status: DESIGN PROPOSAL — no implementation. `DGP` prefix.** A non-frozen
design doc like [`large-graph-readability.md`](large-graph-readability.md),
[`edge-routing.md`](edge-routing.md), [`module-system.md`](module-system.md) —
no `loop-*/N`, no `Frozen` marker. **It changes no `src/` file yet.**
Implementation is a **separate PR that needs separate approval**; this doc only
locks the problem, the current React Flow input surface, the conflicts, and the
direction.

Ordered **before** contextual inline help (README Onboarding part 2): the
read/pan problem is already reproducible in the shipped Early-MMO and Coffee
examples.

---

## DGP0. Scope

### In scope

- **DGP1** — the problem + the *current* React Flow input configuration (what is
  set, what is default).
- **DGP2** — the conflict surface: RF props and the other canvas modes.
- **DGP3** — direction for **mobile** (view / run only).
- **DGP4** — direction for **desktop** (edit + view).
- **DGP5** — the independence guarantees.
- **DGP6** — the test boundaries.
- **DGP7** — the forks left open for the review.

### Not in scope (named so they are not assumed)

- **Requiring the minimap.** The minimap stays a *secondary* aid
  (`docs/mobile.md §MV-D10` already drops it on phones); the fix must work with
  it hidden.
- **Auto-layout / node re-positioning** to create empty space. This doc is about
  *input*, not layout.
- **A new saved viewport field.** The viewport is session state (Workspace
  already carries it); nothing here adds a serialized field.
- **Changing zoom behaviour** (wheel-zoom, `zoomOnPinch`, double-click zoom) —
  untouched.

---

## DGP1. The problem, and the current React Flow surface

### DGP1.1 The problem

On a **dense** graph the only way to pan is to grab a piece of **empty
canvas** and drag it. When nodes and edges are packed there is often no empty
pixel on screen:

- **Mobile** (always view-only): a one-finger touch that lands on a node or edge
  does nothing pannable — the user must fish for a gap. Panning a busy graph is
  near-impossible.
- **Desktop**: same, minus the minimap. Without the minimap the user hunts for a
  node-free / edge-free spot to start the drag.

### DGP1.2 What Loop Studio sets on `<ReactFlow>` today

`@xyflow/react` **12.11.5**. `src/components/Canvas.tsx` overrides **only two**
input props; everything else is the RF v12 default:

| prop | value in Loop Studio | effect |
|---|---|---|
| `nodesDraggable` | `{!noEdit}` — `noEdit = isMobile || canvasLocked` | nodes are **not** draggable on mobile or under the edit-lock |
| `panOnDrag` | `{!frameToolArmed}` — `true` unless the Frame tool is armed | a **pane** drag pans, unless the Frame tool is drawing a frame |
| `nodesConnectable` / `edgesReconnectable` | `{!noEdit}` | edge authoring off on mobile / locked |
| `zoomOnDoubleClick` | `{!isMobile}` | — |
| everything else | **RF default** | see below |

RF v12 defaults that matter here (not set by us):

- `panActivationKeyCode` — **`'Space'`**. Holding Space is supposed to let a drag
  pan from anywhere. *(Behaviour over a node needs a real-device check — DGP7.)*
- `panOnScroll` **`false`** → the wheel zooms; two-finger trackpad scroll zooms.
- `zoomOnPinch` **`true`**, `zoomOnScroll` **`true`**, `preventScrolling`
  **`true`** (a wheel over the canvas never scrolls the page).
- `selectionOnDrag` **`false`**, `nodeDragThreshold` **`1`**,
  `elementsSelectable` **`true`**.

### DGP1.3 Why "pan from on top of a node" does not work

DOM: `.react-flow__pane` (the d3-zoom target, `touch-action: none`) **contains**
`.react-flow__viewport`, which contains every node. A pointer-down on a node
*bubbles* to the pane, **but RF applies a `filter` to its d3-zoom that rejects
any drag whose target is a node, a handle, or a `.nopan` element** — so the pan
gesture never starts. This holds **whether or not `nodesDraggable` is true**:
turning off dragging does not turn on "pan through the node". There is no
`panFromNodes` prop.

A quick synthetic-input probe in the running app (canvas locked ⇒ nodes not
draggable) confirmed: neither a plain drag nor a Space+drag **starting on a
node** moved the viewport. Synthetic pointer events are an imperfect stand-in
for d3-zoom, so DGP7 keeps "does real Space+drag / middle-drag pan over a node"
as an open check — but the design must not *depend* on it.

---

## DGP2. Conflict surface

Anything the fix adds has to coexist with:

| feature | how it touches input | constraint |
|---|---|---|
| **Frame tool armed** (`§LGR6`) | sets `panOnDrag={false}` so a pane drag *draws a frame* | pan-from-node must be **inert while the Frame tool is armed** (or the two are mutually-exclusive modes) |
| **Edit mode** (desktop, unlocked) | `nodesDraggable` / `nodesConnectable` true — node drag-to-move, edge-from-handle, delete key, (future) marquee | with the fix **off / not engaged**, every edit gesture is byte-identical |
| **Edit-lock** (`canvasLocked`) | already `noEdit` → view-only on desktop | the fix should make locked-desktop pan like mobile |
| **Focus / Filter / frames / Activity overlay** | render-only; their panels are RF `<Panel>` / `<Controls>` (outside the pane, carry `nopan`) | a pan gesture must not clear a focus target, a filter selection, the armed states, **or the current selection** |
| **`zoomOnPinch`** | RF's own touch listeners on the pane | a two-finger gesture must still zoom; it must never be read as a one-finger pan or a tap |
| **`preventScrolling` / page scroll** | `touch-action: none` on the pane | any capture surface the fix adds needs the right `touch-action` so a canvas drag never scrolls the page, and a gesture that starts on the toolbar / a sheet still scrolls normally |
| **Read-through jump** (`ModelPanels`, `setViewport`) | writes the viewport | independent; unaffected |
| **Minimap `pannable`** | its own drag surface | unchanged, stays the secondary aid |

---

## DGP3. Direction — mobile (view / run only)

Mobile is already `nodesDraggable={false}` and has no edit gestures to protect,
so the rule is simple:

- **A one-finger drag pans the canvas even when it starts on a node or an
  edge.**
- **A short tap** (moved < ~`TAP_SLOP` px, held < ~`TAP_TIME` ms) keeps today's
  behaviour: it selects the node / edge and opens the read-only Inspector sheet
  (empty-canvas tap still clears + closes).
- Once a drag passes `TAP_SLOP`, it is a **pan** and the pending tap is
  cancelled (no selection change).
- **Two fingers** → RF's `zoomOnPinch`, untouched. A second finger landing
  mid-drag hands off to pinch.

**Mechanism (DGP7 fork).** Candidates:

1. **A transparent pan-capture layer** over the RF canvas that does the
   tap-vs-drag discrimination itself: on `pointerup` within the tap window it
   `elementFromPoint`s and dispatches a click to the node/edge underneath; on a
   drag it calls `setViewport` each move (delta × 1/zoom). Two-finger touches
   are passed straight through to RF. RF-agnostic, fully testable, does not
   fight d3-zoom. Cost: it reimplements momentum/inertia if we want it.
2. **Toggle `.react-flow__node` / `.react-flow__edge` `pointer-events: none` on
   `pointerdown`** so the very same gesture reaches the pane's own pan, then
   restore on `pointerup` (and, if it was a tap, replay a hit-test click).
   Smaller, but relies on RF's pane pan firing for a gesture that *began* on a
   now-transparent node — needs verification, and it briefly blinds hover.
3. **Fork RF's d3-zoom `filter`** to not reject node targets when
   `nodesDraggable` is false. Smallest surface if RF exposes it; 12.11.5 does
   not (it is internal).

Lean **(1)** unless a spike shows **(2)** is reliable.

---

## DGP4. Direction — desktop (edit + view)

Edit gestures are sacred, so the pan-from-node behaviour is **opt-in**, two
ways:

- **Space + drag** — a *held-key temporary* pan. RF's `panActivationKeyCode` is
  already `'Space'`; if a real check (DGP7) shows it does **not** pan over a
  node, the DGP3 mechanism is reused while Space is held. Works regardless of the
  toggle below. Nothing about the graph changes; releasing Space restores the
  edit cursor.
- **Pan mode** — an explicit sticky toggle, a `uiStore` preference in its own
  `localStorage` key, **exactly like `focusMode` / `filterPanelOpen`**, surfaced
  as a button in the canvas `<Controls>` column (next to Focus / Filter).
  **On:** the cursor is `grab` / `grabbing`; a left-drag anywhere — over nodes
  and edges included — pans; node drag-to-move and edge-from-handle are
  suppressed; a short click still selects (read-only inspect). **Off:** the
  editor is byte-for-byte as it is today.
- *(Fork)* **middle-mouse drag** as a no-mode extra (`panOnDrag={[0, 1]}` or
  `[1, 2]`). Whether a middle-drag pans *over a node* in 12.11.5 is unverified
  (DGP7).

Mobile does **not** get the toggle — it is effectively always in Pan mode.

The **Frame tool armed** state wins over Pan mode: while a frame is being drawn,
Pan mode is inert (or the Frame tool auto-exits Pan mode).

---

## DGP5. Independence guarantees

- **No GraphDoc / `loop-revision/*` digest / undo / `simulationRev` / node
  z-order change.** Pan mode is a UI preference; a pan writes only the viewport
  (already non-persisted session state).
- **Selection is preserved across a pan** — panning never selects, deselects, or
  re-centres anything on its own.
- **Orthogonal to Focus, Filter, frames, Activity overlay** — the fix reads none
  of their state and clears none of it; a pan while any of them is active leaves
  them exactly as they were.
- **The read-through jump** (`ModelPanels`) and **Reset view** are unaffected.

---

## DGP6. Test boundaries (for the impl PR)

**Touch (mobile):**
- a one-finger drag **that starts on a node** pans the canvas; the node is not
  moved, selection does not change.
- a one-finger drag that starts on an **edge** pans.
- a **short tap** on a node still selects it and opens the Inspector sheet; an
  empty-canvas tap still clears + closes it.
- a drag that ends near where it started (< `TAP_SLOP`) resolves to **tap**, not
  a jitter-pan (define + pin the threshold).
- the **page never scrolls** during a canvas drag; a drag that starts on the
  top bar / a sheet scrolls that element normally.

**Pinch:**
- a **two-finger** gesture zooms (RF `zoomOnPinch`) with the capture layer
  present; it is never read as a one-finger pan or a tap.
- a second finger landing mid-pan hands off to pinch without a jump.

**Desktop — Pan mode:**
- **On:** a left-drag over a node pans (node not moved); a drag from a handle
  does **not** start an edge; a plain click still selects; `Space + drag` still
  pans; the cursor is `grab`.
- **Off:** import a fixture, toggle Pan mode on then off, assert the **GraphDoc
  bytes and every node position are identical**; drag-move, connect, delete,
  marquee are unaffected.
- `Space + drag` pans over a node **without** Pan mode on, and edit behaviour is
  unchanged after Space is released.

**Cross-mode:**
- pan works with **Focus** on (focus target unchanged), with **Filter** hiding
  nodes (hidden set unchanged), with the **Activity overlay** on, and with a
  node **selected** (selection unchanged after the pan).
- with the **Frame tool armed**, a pane / node drag draws a frame (Pan mode
  inert); disarming restores Pan mode.

**Invariance:** a full `vitest` + e2e pass showing no `loop-revision/*` /
`loop-workspace/*` / Share digest or golden-fixture change.

---

## DGP7. Forks for the review

1. **Mobile mechanism** — pan-capture overlay (DGP3-1) vs `pointer-events`
   toggling (DGP3-2) vs a request to expose RF's zoom `filter` (DGP3-3).
2. **Desktop shape** — ship **both** the Pan-mode toggle *and* Space+drag, or is
   Space+drag (+ maybe middle-drag) enough without a mode? The steer says
   *review both*.
3. **Real-device checks before building**: does **Space + drag** pan over a node
   in 12.11.5? does a **middle-mouse drag** over a node pan? (Both would shrink
   the fix.)
4. **Thresholds** — `TAP_SLOP` (px) and `TAP_TIME` (ms); one pair for touch and
   mouse, or separate.
5. **Pan-mode persistence** — sticky across reload (like Focus), or per-session.
6. **Discoverability** — a one-time hint, a cursor change, the Controls button
   label / icon; and whether `Space` is announced anywhere.
7. **Does Pan mode auto-engage under `canvasLocked`** on desktop (locked ⇒
   view-only ⇒ behave like mobile), or stay a separate toggle?

---

## DGP8. Order this feeds into

1. **This design pass** — docs-only Draft PR. Review settles DGP7.
2. **Spike (small, throwaway or a tiny PR)** — the DGP7-3 real-device checks +
   a proof of the chosen mobile mechanism. No product code kept unless it is the
   real thing.
3. **Impl PR(s)** — mobile pan-from-node first (biggest pain, smallest risk —
   no edit gestures to protect), then the desktop Pan mode / Space+drag. Each
   held Draft; separate merge approval; a full invariance pass.
4. **Then** — contextual inline help (README Onboarding part 2).
