# Canvas text layer

At low zoom the canvas's own text is too small to read: React Flow zooms with a CSS scale, so a node's 13 px name is 2.25 px at the overview and a zone's 11 px title 1.95 px. The canvas text layer draws two kinds of name at a readable size there, and nothing else. It was decided in the colour review of 2026-11-11 (the text rounds 1–6) and implemented on main afterwards.

Code: `src/components/canvasText/textPlacement.ts` (the placement rules, pure, unit-tested in `textPlacement.test.ts`) and `CanvasTextLayer.tsx` (the layer), rendered by `FrameLayer`. Styles: `index.css`, `.canvas-text`.

## CTL1. What is drawn

- **Each zone's name** (a saved or a suggested frame): the title its own chip shows, at 12 px, semibold, on a chip.
- **The selected node's name**: only when exactly one node is selected (React Flow's `selected`, the flag the selection ring is drawn from), at 12 px on a chip, at most 200 px wide (it wraps).
- **When:** a name is drawn only while the text it stands for is under **8 px on screen** — a zone's below zoom 8/11 (≈ 0.73), the selected name below 8/13 (≈ 0.62). A zone also needs at least half of its area in view.
- No other node name is drawn, at any zoom.

## CTL2. The layer

- Above the nodes and lines, below the canvas's panels and popovers. It takes **no pointer events** and is hidden from assistive technology (`aria-hidden`); the names it repeats are already the zones' and nodes' accessible names.
- Clipped to the canvas pane.
- While the layer draws a zone's name, the zone's own small chip (`.lgr-frame.is-layer-named`) shows nothing but keeps its place, its click target and its keyboard focus. Keyboard focus on a zone is shown on the name the reader sees as well, since at the overview the zone's own ring lies on its edge and the chip may be small and away from the name: the **zone** focused — a 2 px **dashed** ring on the name; the zone's **chip** focused (reachable on an unlocked canvas) — a 2 px **solid** ring. `Highlight` in forced colours. The zone and its chip keep their own rings and keys; a selected zone's dashed outline runs around the zone's box, never around the name.
- At the overview the chip is as small as the zoom makes it and lies under the zone's edge strip; a click on the layer's name does not reach it. The layer is not a target, by design.
- Forced colours: the chips are `Canvas` with a `CanvasText` border and text.

## CTL3. Where a zone's name goes (kept on the top border)

- Along the zone's **top border**, left to right: standing on it, then hanging just inside it. The first place that covers no node, no label placed before it and no line; else the one crossing the fewest line points and covering no node.
- The place is **kept**: a pan moves zone and name together, and a zoom or a route change is no reason to move it. It is chosen again only when, there, the name would no longer fit the zone's width, or would cover a node or a label placed before it. A line through it is allowed.
- **During a node drag no zone name moves** for a node passing under it (zone names first); only a lost fit moves it. After the drop a name that still covers a node is placed again, once.
- A **new** place chosen before the routes have **settled** (a line still waiting for its first route, or a full route generation running) is provisional: it is **not shown** and not kept, and is chosen again on the next draw. So a name appears once, at its final place, instead of standing somewhere first and jumping (a document opens with its routes drawn over several slices). A kept place that still holds stays shown throughout.
- **Never hidden for good:** a name is held back for at most 1.5 s (`SETTLE_WAIT_MS`, counted from when it was first held back); then it is shown and kept with the lines read so far, so a slow or failing route generation never hides it longer. The wait ends 50 ms early, so the draw that shows it (a timer, then an animation frame) still lands inside the 1.5 s.

## CTL4. Where the selected name goes (kept side)

- 8 px out from its node in eight directions (below, right, left, above, then the diagonals), then 14 px if every one covers something. Never off the pane, on a node, on the selection ring or on a zone name; among the allowed, the one crossing the fewest line points.
- The side is **kept** while zooming, panning and dragging. It is chosen again, once, only when there it would cover another node, the ring or a zone name — and **during a drag it is hidden** where it would cover one of them instead (its side kept), then placed again after the drop.
- **Its node off screen:** the name is hidden and comes back on its own side.
- **The canvas edge** (option ii): a name that would be cut by the pane's edge slides inward on the **same** side just enough to be whole, and shows only if there it covers no node (its own included), the ring or a zone name; otherwise it is hidden. It is never cut and never moved to another side; it returns to its side once there is room.
- The chip's measured size is locked, so near the pane's edge it never shrinks and wraps.

## CTL5. Geometry and cost

- The node symbols, the node names and the lines' points are read from the rendered canvas only when they change (a node moved or resized, a route settled, a language switch), converted to world coordinates and kept. A pan or a zoom only transforms them.
- Reading the lines is the costly step: every line is sampled every 3 world px. On the MMO (144 lines, about 52,000 points) one read took about 0.9 s on the development machine (#554). So what each change asks for is decided per change (`geometryNeed.ts`):
  - **the lines too:** a node or a line added or removed; a line's path (`d`) changed; the routes settling; a drag ending;
  - **the nodes only:** a node moved or resized (its box style, or its position or measured size in the graph); anything inside a node rewritten (its name, its value, its symbol);
  - **a draw only:** a line's colour, width or activity tint (`style` on its path), the same `d` written again, an edge label, a selection, a pan or a zoom.
- When the lines are read, each line keeps the points it was sampled to, with the path (`d`) and the path's own transform they came from. Only a line whose `d` or transform changed, or a new line, is sampled again; the others are reused as they are, so the overlap tests and the places stay what a full read gives. On the MMO (dev machine, #554): opening reads all 144 lines (0.9–1.3 s), then the 50 that changed once the routes settled (about 0.43 s); a route notification with nothing redrawn 1–2 ms; one line's new `d` 3–4 ms; a node with one line moved 11–13 ms, then about 0.12 s for the 8 lines re-routed after it.
- During a node drag the lines are not read again; they are read once the drag ends.
- Nothing is read while nothing goes on the layer (zoom above both thresholds).

## CTL6. Accepted costs (from the review)

- In dense areas lines may run under the selected name (2–5 in the gacha overview).
- A zone name re-placed ~80 px after a node is dropped under it.
- A selected name hidden at the canvas edge while its node is in view, when the slide inward would cover something.
- Long names (Italian "Generale / Gratuito") may have a line through them.

## CTL7. Tests

- `src/components/canvasText/textPlacement.test.ts` — the thresholds, the kept places, the drag rule, off screen, the edge slide and hide.
- `e2e/canvas-text-layer.spec.ts` — the layer in the browser: names shown and gone at the thresholds, no clicks taken (a node under a name is still clicked, a zone's chip still opens the zone), the zone chip's text hidden while the layer names it, the selected name for one selection only, and the kept places over a pan. The drag and the canvas-edge behaviour are held by the unit tests; they were also measured on real screens with the colour review's own scripts.
