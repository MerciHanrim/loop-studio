# Dense-graph pan usability (non-frozen design doc — DRAFT)

**Status: DESIGN — direction approved (review round 1). The eight DGP7
decisions are locked; the mechanism + a few UX points are settled by a spike
next. `DGP` prefix.** A non-frozen design doc like
[`large-graph-readability.md`](large-graph-readability.md),
[`edge-routing.md`](edge-routing.md), [`module-system.md`](module-system.md) —
no `loop-*/N`, no `Frozen` marker. **It changes no `src/` file yet.** The spike,
then implementation, are **separate PRs each needing separate approval**; this
doc locks the problem, the current React Flow input surface, the conflicts, and
the direction.

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

## DGP3. Direction — mobile (view / run only)  *(decided — review round 1)*

Mobile is already `nodesDraggable={false}` and has no edit gestures to protect:

- **No toggle.** A one-finger drag is the **default pan**, and it pans **even
  when it starts on a node, an edge, or a frame**.
- **Tap vs drag by distance.** A pointer that moves **< `PAN_SLOP` (~8 px)**
  before it lifts is a **tap** — today's behaviour: it selects the node / edge
  and opens the read-only Inspector sheet (an empty-canvas tap still clears +
  closes). Time is not a factor — a long press that never moves is still a tap.
- **Once the pointer passes `PAN_SLOP` it is a pan**, and the pending tap is
  cancelled: **no selection change, no Inspector open**.
- **Two fingers / pinch** → RF's `zoomOnPinch`, unchanged. A two-finger gesture
  is never read as a one-finger pan or a tap; a second finger landing mid-pan
  hands off to pinch without a jump.

**Mechanism — decided by the spike (DGP8).** Candidates:

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

Lean **(1)** unless the spike shows **(2)** is reliable and simpler.

---

## DGP4. Direction — desktop (edit + view)  *(decided — review round 1)*

Edit gestures are sacred, so the pan-from-node behaviour is **opt-in**:

- **Pan mode** — a **sticky, session-only** toggle. It stays engaged until the
  user turns it off, **but it is *not* persisted**: it lives in `uiStore` only
  (no `localStorage` key, unlike `focusMode` / `filterPanelOpen`; nothing in the
  GraphDoc), so **every fresh load starts in edit mode**. Surfaced as a button
  in the canvas `<Controls>` column (next to Focus / Filter).
  - **On:** the cursor is `grab` / `grabbing`; a left-drag anywhere — over nodes,
    edges, and frames included — pans; node drag-to-move and edge-from-handle are
    **suppressed**; a short click still selects (read-only inspect).
  - **Off:** the editor is **byte-for-byte as it is today** — node move, connect,
    frame drawing, delete, marquee all unchanged.
- **`Space + drag`** — a held-key temporary pan (works regardless of Pan mode).
  **Supported only if the spike (DGP8) confirms it pans over a node in a real
  browser.** If RF's built-in `panActivationKeyCode: 'Space'` does not reach
  over a node, the DGP3 mechanism is reused while Space is held.
- **Middle-mouse drag** — a no-mode extra. **Supported only if the spike
  confirms** a middle-button drag pans *over a node* in 12.11.5
  (`panOnDrag={[0, 1]}` / `[1, 2]`).

Mobile does **not** get the toggle — it is effectively always panning (DGP3).

The **Frame tool armed** state takes precedence: while a frame is being drawn a
pane / node drag draws the frame and Pan mode is inert; disarming the Frame tool
restores Pan mode.

---

## DGP5. Independence guarantees

- **No GraphDoc / `loop-revision/*` digest / undo / `simulationRev` / node
  z-order change.** Pan mode is **session-only** `uiStore` state (no
  `localStorage`, nothing serialized); a pan writes only the viewport (already
  non-persisted session state).
- **Selection is preserved across a pan** — panning never selects, deselects,
  or re-centres anything on its own; and once a drag is established the tap that
  would have selected the row's node is not fired.
- **Orthogonal to Focus, Filter, frames, Activity overlay, undo** — the fix
  reads none of their state and clears none of it; a pan while any of them is
  active leaves them exactly as they were.
- **The read-through jump** (`ModelPanels`) and **Reset view** are unaffected.

---

## DGP6. Test boundaries (for the impl PR)

**Touch (mobile):**
- a one-finger drag **that starts on a node** pans the canvas; the node is not
  moved, selection does not change, no Inspector sheet opens.
- a one-finger drag that starts on an **edge** or a **frame** pans.
- a **tap** (moved < `PAN_SLOP` ≈ 8 px before lift) on a node still selects it
  and opens the Inspector sheet; an empty-canvas tap still clears + closes it; a
  long press that never moves is still a tap.
- a drag that ends near where it started (< `PAN_SLOP`) resolves to **tap**, not
  a jitter-pan.
- the **page never scrolls** during a canvas drag; a drag that starts on the
  top bar / a sheet scrolls that element normally.

**Pinch:**
- a **two-finger** gesture zooms (RF `zoomOnPinch`) with the capture layer
  present; it is never read as a one-finger pan or a tap.
- a second finger landing mid-pan hands off to pinch without a jump.

**Desktop — Pan mode:**
- **On:** a left-drag over a node pans (node not moved); a drag from a handle
  does **not** start an edge; a plain click still selects; the cursor is `grab`.
- **Off:** import a fixture, toggle Pan mode on then off, assert the **GraphDoc
  bytes and every node position are identical**; drag-move, connect, delete,
  frame drawing, marquee are unaffected.
- **Session-only:** Pan mode on → reload → the editor is back in **edit mode**
  (nothing persisted).
- **`Space + drag` / middle-drag** — only if the spike wired them: `Space + drag`
  pans over a node without Pan mode on and edit behaviour is unchanged after
  Space is released.

**Cross-mode:**
- pan works with **Focus** on (focus target unchanged), with **Filter** hiding
  nodes (hidden set unchanged), with the **Activity overlay** on, with a node
  **selected** (selection unchanged after the pan), and does not touch the
  **undo** stack.
- with the **Frame tool armed**, a pane / node drag draws a frame (Pan mode
  inert); disarming restores Pan mode.

**Invariance:** a full `vitest` + e2e pass showing no `loop-revision/*` /
`loop-workspace/*` / Share digest or golden-fixture change.

---

## DGP7. Decisions (review round 1) + what the spike still settles

**Decided:**

| # | decision |
|---|---|
| D1 | **Mobile: no toggle.** A one-finger drag is the default pan and works from on top of a node / edge / frame (DGP3). |
| D2 | **Tap vs drag by distance: `PAN_SLOP` ≈ 8 px.** Below it → today's tap-select; at/over it → a pan. Time is not a factor. |
| D3 | **Once a drag is established the row's node is NOT selected and the Inspector does NOT open.** |
| D4 | **Pinch / two-finger zoom keep today's behaviour**, and a two-finger gesture is never read as a one-finger pan or a tap. |
| D5 | **Desktop Pan mode is sticky but session-only** — `uiStore` in memory, **no `localStorage`, nothing serialized**; every fresh load starts in **edit mode**. |
| D6 | **`Space + drag` and middle-button drag are supported only if the spike confirms** they pan over a node in a real browser / on a real device. |
| D7 | **Pan mode OFF ⇒ node move, connect, frame drawing, delete, marquee are byte-for-byte unchanged.** |
| D8 | **Independent of Focus, Filter, frames, Activity overlay, selection, undo, and every digest.** |

**Still open (the spike / impl decides):**

- **Mobile mechanism** — pan-capture overlay (DGP3-1) vs `pointer-events`
  toggling (DGP3-2) vs forking RF's zoom `filter` (DGP3-3). The spike proves one.
- **Does Pan mode auto-engage under `canvasLocked`** on desktop (locked ⇒
  view-only), or stay a wholly separate toggle?
- **Discoverability** — cursor change, the Controls button icon / label, a
  one-time hint.

---

## DGP8. Order this feeds into

1. **This design pass** — Draft PR, decisions above folded in.
2. **Spike** (throwaway, or a tiny branch) — must show, at minimum:
   **(a)** a pan that starts on a node / edge / frame,
   **(b)** a short tap still selects,
   **(c)** pinch still zooms,
   **(d)** no edit-mode regression,
   plus the D6 real-browser checks for `Space + drag` / middle-drag. Kept code
   only if it is the real mechanism.
3. **If the spike result + the mechanism it needs match this doc's contract →
   implement and open a Draft PR.** Mobile pan-from-node first (biggest pain,
   no edit gestures to protect), then the desktop Pan mode. If the spike
   contradicts the contract, stop and report instead. Ready / merge is a
   separate approval; a full invariance pass on each.
4. **Then** — contextual inline help (README Onboarding part 2).
