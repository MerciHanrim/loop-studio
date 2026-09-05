# Dense-graph pan usability (non-frozen design doc)

**Status: SHIPPED.** The eight DGP7 decisions are locked (review rounds 1–2),
the SPIKE has run (`spike/dense-graph-pan`), and **two real-phone rounds have
passed** on the Early-MMO template. `DGP` prefix. Two additions from review
round 2 became **mandatory merge contracts** and are both built and verified:

- **§DGP-C1** — the mobile short-tap must still select an **edge** (nearest
  path within ~12–16 px) and open the read-only Inspector, in the order
  node → edge → empty canvas. *(Built — see "As built" in DGP7.)*
- **§DGP-C2** — native / OS gestures (back-swipe, pull-to-refresh) are **not**
  fully suppressed; the pass criterion is that the overlay is never left stuck
  and the **next touch works normally** — recovery, not prevention.

**Round 1 (Hanrim, Preview `18f2706`):** one-finger pan — pass; two-finger
pinch — **fail, did not zoom at all**. Root cause: the original mechanism
handed pinch off to React Flow's own `zoomOnPinch` by dropping the overlay's
`pointer-events` on a 2nd pointer, but the 1st finger's `pointerdown` was
already captured by the overlay while it was still the hit target —
`.react-flow__pane` never received that finger at all, so d3-zoom's pinch
math only ever saw one touch. **Redesigned: the overlay computes pinch zoom +
pan itself** from the two live pointers' distance and midpoint (§DGP-C4) — RF
is no longer involved in pinch at all.

**Round 2 (Hanrim, Preview `436c26a`): pass.** One-finger pan normal,
two-finger pinch zoom-in/out works, the round-1 total block is gone. Noted —
**not a defect, an observation:** the pinch motion isn't perfectly smooth.
Candidate follow-up *if real usage shows it matters*: batch `setViewport`
calls through `requestAnimationFrame` instead of once per `pointermove`, as
its own separate performance pass — **not required for v1**, not scheduled.

A non-frozen design doc like
[`large-graph-readability.md`](large-graph-readability.md),
[`edge-routing.md`](edge-routing.md), [`module-system.md`](module-system.md) —
no `loop-*/N`, no `Frozen` marker. The spike and the implementation are
**separate PRs each needing separate approval**; this doc locks the problem,
the current React Flow input surface, the conflicts, and the direction.

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
| **`zoomOnPinch`** | RF's own touch listeners on the pane — but the overlay covers the pane, so a hand-off to them failed on a real device (§DGP-C4); the overlay computes pinch itself | a two-finger gesture must still zoom; it must never be read as a one-finger pan or a tap |
| **`preventScrolling` / page scroll** | `touch-action: none` on the pane | any capture surface the fix adds needs the right `touch-action` so a canvas drag never scrolls the page, and a gesture that starts on the toolbar / a sheet still scrolls normally |
| **Native / OS edge gestures** (back-swipe, pull-to-refresh) | the browser may claim a touch mid-gesture | **not suppressed** (§DGP-C2); the overlay must self-heal — a missed `pointerup` / `pointercancel` is cleared on the next `pointerdown`, so the next touch is normal |
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
- **Two fingers / pinch** → the overlay computes it directly (not RF's
  `zoomOnPinch` — see "As built"). A two-finger gesture is never read as a
  one-finger pan or a tap; a second finger landing mid-pan cancels the pan and
  starts a pinch without a jump.

**Tap resolution order — a mandatory contract (§DGP-C1).** Mobile has no editing,
so *reading the graph* is its whole job, and today a tap can select **either** a
node **or an edge** and open the read-only Inspector — edge included, because
that is the only way on a phone to read a connection's `flow` value and its
state condition. The pan overlay must preserve that. A short tap resolves in
this order:

1. **Inside a node's box** → select that node.
2. **Else within a small tolerance of an edge path** (~12–16 px, screen space) →
   select the **nearest** such edge.
3. **Neither** → an empty-canvas tap (clear selection, close the sheet).

Losing edge-tap-to-Inspect on mobile is a **merge-blocking regression, not a
follow-up** — the pan gain does not outweigh it.

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
  and opens the Inspector sheet; **a tap on (or within ~12–16 px of) an edge
  still selects that edge and opens the Inspector sheet** (§DGP-C1); an
  empty-canvas tap still clears + closes it; a long press that never moves is
  still a tap.
- **node beats edge**: a tap where a node box and an edge overlap selects the
  node.
- a drag that ends near where it started (< `PAN_SLOP`) resolves to **tap**, not
  a jitter-pan.
- the **page never scrolls** during a canvas drag; a drag that starts on the
  top bar / a sheet scrolls that element normally.

**Pinch — computed by the overlay itself, not RF's `zoomOnPinch` (see DGP7
"As built" for why the hand-off approach failed on a real phone):**
- spreading two fingers zooms **in**, pinching them together zooms **out**,
  around the pinch midpoint; it is never read as a one-finger pan or a tap.
- a second finger landing mid-pan cancels the pan and starts a pinch without
  the viewport jumping.
- **2 → 1 (one finger lifts mid-pinch):** the remaining finger does nothing —
  no jump, no accidental single-finger pan resuming — until it *also* lifts;
  only a genuinely fresh touch afterward pans again.
- an **incidental 3rd finger** (or more) is tracked but does not disturb the
  pinch; releasing it does not end the pinch — only releasing one of the two
  fingers actually driving it does.
- zoom clamps to the same `minZoom` / `maxZoom` `<ReactFlow>` itself uses.
- a `pointercancel` on a pinch finger never resolves a tap, and self-heals the
  same as the single-finger path (below).

**Native / OS gestures (mobile) — §DGP-C2.** The app **does not** try to fully
suppress a browser's own edge gestures (back-swipe, pull-to-refresh, the
Android nav bar): that is neither always possible nor desirable. The pass
criterion is **recovery, not prevention** — if the browser claims a gesture
mid-touch, the overlay must not be left in a stuck state (no wedged
`pointer-events: none`, no half-open pan), and **the very next touch behaves
normally** (a tap selects, a drag pans). A missed `pointerup` / `pointercancel`
must self-heal: the next `pointerdown` the browser itself considers *primary*
(no other same-type pointer active — the user agent's own signal, not
dependent on whether our `setPointerCapture` happened to succeed) clears any
stale pointer bookkeeping.

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
| D4 | **Pinch / two-finger zoom keep today's behaviour**, and a two-finger gesture is never read as a one-finger pan or a tap. — the "keep RF's own pinch" mechanism failed a real-phone pass; the overlay now computes pinch itself (§DGP-C4, "As built") — the *behaviour* target is unchanged, the *mechanism* is not. |
| D5 | **Desktop Pan mode is sticky but session-only** — `uiStore` in memory, **no `localStorage`, nothing serialized**; every fresh load starts in **edit mode**. |
| D6 | **`Space + drag` and middle-button drag are supported only if the spike confirms** they pan over a node in a real browser / on a real device. |
| D7 | **Pan mode OFF ⇒ node move, connect, frame drawing, delete, marquee are byte-for-byte unchanged.** |
| D8 | **Independent of Focus, Filter, frames, Activity overlay, selection, undo, and every digest.** |

**Settled by the spike (`spike/dense-graph-pan`):**

- **Mechanism = DGP3-1, the pan-capture overlay** — a transparent `<div>` over
  the canvas (`z-index: 4`, below RF Controls / Panels / MiniMap;
  `pointer-events` only when active). Verified with **real** input:
  - a drag **starting on a node** pans by the delta; the node does not move;
    no selection change — **PASS**
  - a **short tap on a node selects it** and opens the Inspector; no pan —
    **PASS**
  - with the overlay **inactive** (Pan mode off) a node drag moves the node
    normally — **PASS**
- **The tap → select must be geometric, not `elementFromPoint`.** When
  `nodesDraggable={false}` React Flow makes non-draggable nodes
  non-hit-testable — `elementFromPoint` / `elementsFromPoint` never return a
  node. So the overlay converts the tap's screen point to flow coords via the
  live viewport and tests it against each node's `{ position, measured }` box
  (last painted wins), then selects that node directly.
- **`setViewport` must come from `Canvas`'s `useReactFlow()`** — a bare
  `useReactFlow()` from a component outside `<ReactFlow>`'s subtree no-ops
  (same issue `ModelPanels` hit). Canvas passes `setViewport` / `getViewport`
  into the overlay as props.

**Round 1 real-phone result (Hanrim, Preview `18f2706`, Early-MMO template):
one-finger pan PASS, two-finger pinch FAIL** (never zoomed at all — see
§DGP-C4 below for the root cause and the fix).

**Round 2 real-phone result (Hanrim, Preview `436c26a`, Early-MMO template):
PASS.** One-finger pan, two-finger pinch zoom-in/out, node/edge short-tap, and
2→1 recovery into a fresh pan all confirmed working; the round-1 total pinch
block is gone. Observation (not a defect, not a merge blocker): the pinch
motion isn't perfectly smooth — a candidate follow-up, only if real usage
shows it matters, is batching `setViewport` through `requestAnimationFrame`
instead of once per `pointermove`, as its own later performance pass.

- **Native / OS gesture recovery (§DGP-C2)** — confirmed: after a browser
  edge gesture interrupts a touch, the next tap / drag works normally.
- **`Space + drag` and middle-mouse drag over a node** (D6) — still
  **deferred out of v1**, unrelated to this gate.

**Still open (impl decides):**

- **Does Pan mode auto-engage under `canvasLocked`** on desktop (locked ⇒
  view-only), or stay a wholly separate toggle? — kept a **separate toggle**
  for v1; auto-engage can come later without a contract change.
- **Discoverability** — cursor change (`grab` is wired), the Controls button
  icon / label, a one-time hint. — v1 ships the `grab` cursor + a Controls
  button (four-arrows icon, `aria-pressed`); the one-time hint is deferred.
- **Robustness** — the overlay must reset its pointer bookkeeping if a
  `pointerup` / `pointercancel` is ever missed. — done, and hardened after
  round 1: an `onDownGuard` clears leftover pointer state on the next
  `pointerdown` the browser itself marks `isPrimary` (not
  `hasPointerCapture` — that call can silently not take even for a
  legitimate pointer, which is exactly what broke a first cut of the pinch
  e2e tests), `window`-level `pointerup` / `pointercancel` catch releases
  outside the box, and `lostpointercapture` resets everything.

### §DGP-C4 — pinch is computed by the overlay, not handed off to RF

Added after the round-1 real-phone failure. The original mechanism dropped
the overlay's `pointer-events` on a 2nd pointer so both touches would reach
`.react-flow__pane` and React Flow's own `zoomOnPinch` would run. **This never
actually zoomed on a real device.** Root cause: the 1st finger's `pointerdown`
was captured by the overlay (`setPointerCapture`) while the overlay was still
the hit target — dropping `pointer-events` later doesn't retroactively deliver
that finger's down/move to the pane, capture or no capture. `.react-flow__pane`
only ever received the 2nd finger; d3-zoom's pinch math needs both touches on
the *same* element and never got a legitimate pair.

**Fix:** `PanSurface` now tracks every live pointer itself and computes pinch
zoom + pan directly — RF is not involved in pinch at all. A `Mode = 'idle' |
'pan' | 'pinch' | 'settling'` state machine: 0 pointers → idle, 1 → pan
(unchanged tap-vs-drag path), 2 → pinch (cancels any in-progress pan; a 3rd+
finger is tracked but does not affect which two fingers drive the gesture),
2 → 1 mid-pinch → `settling` (the remaining finger does nothing until it also
lifts — no accidental pan resume), settling → 0 → idle. Zoom is a distance
ratio between the two driving pointers, computed **incrementally each move**
against the *previous* move's distance/midpoint (not a fixed gesture-start
baseline), so panning while pinching — real fingers rarely hold a perfectly
still centre — falls out for free; the flow point under the previous midpoint
is re-anchored under the new one, and the result is clamped to the same
`minZoom` / `maxZoom` `<ReactFlow>` itself uses (passed into the overlay as
props from `Canvas`). `pointercancel` on a driving finger, at any point, drops
straight to `settling` / `idle` without ever resolving a tap.

### As built (impl PR, stacked on this doc)

- **Overlay = a child of `.react-flow`, not a sibling of `<ReactFlow>`.**
  `.react-flow` is its own `z-index: 0` stacking context, so a sibling at any
  `z-index ≥ 1` paints over the Controls too. As a child, `z-index: 4` ties it
  with `.react-flow__renderer` and — later in the DOM — it paints above the
  nodes / edges but still below every `.react-flow__panel` (Controls, MiniMap,
  the hint panels), which stay clickable.
- **Zoom is forwarded, not lost.** d3-zoom's `wheel` handler is bound to
  `.react-flow__pane`, which the overlay covers, so the overlay re-dispatches a
  clone of every `wheel` (deltas + client point + `ctrlKey` for trackpad
  pinch) to the pane. Double-click-to-zoom is suppressed while Pan mode is on —
  wheel / pinch / the Controls +/- cover it.
- **The tap resolves node → edge → empty (§DGP-C1).** Edges are inside
  `.react-flow__viewport` (`pointer-events: none` while
  `nodesDraggable={false}`), so they are not in `elementsFromPoint` and not a
  box test. Two passes keep it fast on a dense graph: **(1)** a
  pure-arithmetic reject on every edge's *endpoint* bounding box (the
  `source` / `target` node boxes from the store — plus any `waypoints` — padded
  route-aware: ~60 flow-units for a default Bézier's bulge, ~220 for an
  orthogonal detour) — no DOM, no layout; **(2)** only the few survivors get
  the precise test — sample the drawn `.react-flow__edge-path` with
  `getPointAtLength` roughly every half a tolerance-width of path length, map
  each sample to screen space through the shared `getScreenCTM()` (one matrix
  for all edge paths), take the **nearest** within `EDGE_TAP_TOL` (~14 px).
  Pass 2 is authoritative; pass 1 only widens the set, so a detour that
  escapes the padded box just costs one extra precise test. Node box wins over
  an overlapping edge; nothing near either → empty-canvas tap.
  **Profiled on the 144-edge Early-MMO example: a first, un-tuned cut of this
  algorithm cost ~110ms on a dense-crossing tap (`getPointAtLength` call
  volume, not layout, was the entire cost) — route-aware padding + tolerance-
  scaled sampling brought a worst-case tap to < 40ms.**
- **Filter panel clearance.** The Pan-mode button lengthens the bottom-left
  Controls stack by one; `.lgr-filter`'s fixed reserve went 195px → 224px so
  its last row still clears the buttons on a short canvas.
- **Native-gesture recovery (§DGP-C2).** No attempt to suppress the browser's
  own edge gestures. The overlay self-heals instead: `window`-level `pointerup`
  / `pointercancel`, a `lostpointercapture` reset, and an `onDownGuard` that
  clears leftover tracked pointers on the next `pointerdown` the browser marks
  `isPrimary` — so a touch the browser stole never wedges it. e2e simulates a
  mid-drag `pointercancel` and a `pointercancel` mid-pinch, each asserting the
  next tap still selects.
- **Pinch is computed by the overlay, not RF (§DGP-C4).** Added after a
  real-phone round found the original hand-off approach never actually zoomed
  — the overlay tracks live pointers and drives `setViewport` itself from
  their distance / midpoint. See §DGP-C4 above.
- **Real-phone verified (round 2, Preview `436c26a`):** the redesigned pinch
  (zoom-in/out, the 1→2→1 finger transition), §DGP-C2 recovery, and node/edge
  short-tap all pass. The pinch motion isn't perfectly smooth on real hardware
  — an observation, not a defect; a `requestAnimationFrame`-batched
  `setViewport` is a candidate later performance pass, only if real usage
  shows it matters, not scheduled. `Space + drag` and the middle button remain
  out of v1.

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
   separate approval; a full invariance pass on each. — **done**: impl PR
   (#132), round-1 real-phone pinch failure diagnosed and fixed (§DGP-C4),
   round-2 real-phone pass, Ready → merged.
4. **Then** — contextual inline help (README Onboarding part 2).
