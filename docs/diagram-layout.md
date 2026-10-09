# Diagram layout — the grid, the port row and re-placement (non-frozen design doc)

Issue #344 (Diagram Readability). The six steps ship together as ONE migration, v0.25.0, so coordinates, routes, Templates, node outlines and the visual baselines change once:

1. the grid, the fixed port row, snapping and the layout migration (this document, §DL1–§DL3);
2. automatic orthogonal routing (the guarded C′ router) and label placement;
3. the connection shape choice and manual route editing (§DL4);
4. all five bundled Templates re-placed;
5. node outline and text containment (#337) on this base;
6. an automated collision check over all 18 languages, then the final baselines.

The release notes, the change declaration and the baselines are settled once, after step 6. Steps 2–6 extend this document as they land.

## DL1. The grid and the port row

- DL1.1 The layout grid is **16 px** in flow coordinates: the dots the canvas already draws at L2.
- DL1.2 A node's resource ports (`in` left, `out` right) sit on a fixed **port row 28 px below the node's top**, whatever its height, text or language. 28 is half the 56 px floor, so a one-line node draws its ports where it always did; a taller node grows downward and its ports stay.
- DL1.3 The routing lane is the port row; the DRAWN port is projected onto the outline on that row (a Pool's slanted side, a Drain's notch tip, a Converter's waist, a Source's point), as the fraction of the width where the outline is (`portInsetFraction`). The router starts a route at that same point (`routeMap.ts`).
- DL1.4 A position is **on the grid** when the node's left edge `x` and its port row `y + 28` are multiples of 16 (the stored `y` is `16k − 28`). Frames and waypoints are on the grid when their coordinates are multiples of 16.
- DL1.5 State ports (top / bottom centre) are unchanged.

## DL2. Re-placing a graph

- DL2.1 **Canonical geometry.** Re-placement never measures the DOM or a font. Each node's box is its canonical box (`canonicalBox.ts`): the widest the content can take in any supported language — an upper-bound advance per character for its script, the title wrapped at 135 px under the strictest UI-language rule (Korean keeps words whole, Japanese / Chinese break by phrase, Parameter and Register titles wrap narrower), the kind's paddings, minimum / maximum widths and height rules. Checked against every bundled Template in all 18 languages: never smaller than the drawn box.
- DL2.2 **Rules** (`replace.ts`), pure and deterministic, ties broken by node id:
  1. every node: left edge and port row to the nearest grid line;
  2. rows: two related nodes (a flow connects them, or they share a direct flow neighbour) whose port rows were less than 16 px apart share one row; two unrelated neighbours 8–16 px apart never do (the lower takes the next row). A row move is made only when it reverses no order;
  3. overlaps: space is inserted — an overlapping pair is separated along the axis its centres are further apart on, by moving every node on the far side by the same grid step, until nothing overlaps. No left/right or above/below order between two nodes is ever reversed;
  4. frames: snapped outward, grown to keep every node they held;
  5. waypoints: snapped; one that lands inside a node is dropped.
- DL2.3 Idempotent: re-placing a re-placed graph changes nothing.
- DL2.4 Engine digest and simulation results never change; the full content digest changes (positions are cosmetic content).

## DL2.8. The one-time conversion and `layoutVersion`

- The file carries `layoutVersion` (`LAYOUT_VERSION = 1`), written on every save; absent means 0, a pre-grid layout. It is not part of either digest.
- A document with an older `layoutVersion` is re-placed ONCE when it is opened — a graph file, a Workspace, a share link, the autosave record (converted by the boot module before the stores read it) — **before its history starts**: never an undo entry. The next save writes the current version, so it never runs again.
- **Records are never re-placed automatically** (Lumi, 2026-10-09). A revision or proposal payload is a record with its own digest and a comparison base, not an ordinary document:
  - a revision file and a proposal payload always keep their recorded coordinates — opened, opened as a document, or applied;
  - a Project autosave based on a revision (an autosave record carrying a Project header) is not converted either;
  - the base revision and the proposal source stay as recorded, so Review shows the real layout differences;
  - **Tidy to grid** on such a document changes only the current document, as one cosmetic change and one undo step, like any other edit.
  Converting them on open would make a document differ from its own revision the moment it opens and turn every exact proposal into a non-exact one.
- Ordinary documents, files and share links are converted once, by their `layoutVersion`.
- Bundled Templates and modules are never converted: they open at their source coordinates (step 4 re-places those).
- A position placed freely with Alt in a current document is kept.

## DL2.10. Tidy to grid

The Controls rail's **Tidy to grid** re-places the current document by the DL2.2 rules as ONE undo entry (graph and saved frames together). Desktop only; disabled while the canvas is locked. Nothing to move ⇒ no entry.

## DL3. Snapping while editing

- DL3.1 New nodes land on the grid: a palette click takes the nearest free grid spot from the canvas centre (no random jitter); a drop snaps the drop point; Insert module snaps the module's anchor; imported Parameters land on the grid (frames snapped outward).
- DL3.2 A pointer drag snaps: every dragged node moves by the ONE correction that puts the grabbed node on the grid, so a selection keeps its relative positions. A frame drag snaps the frame's top-left; a resize snaps the dragged corner.
- DL3.3 Modifiers: **Alt** — a free move (no snapping) for that drag, for nodes, selections and frames, or a free drop; releasing it mid-drag snaps again. **Ctrl / Command** — move a frame alone (it was Alt before #344). **Shift** — unchanged (selection, the large keyboard step).
- DL3.4 Arrow keys move a node or frame by one grid step (16 px), Shift + arrow by four (64 px), landing on the grid; still one undo entry per held gesture (§LGR6.7).
- DL3.5 An off-grid position in a current document stays valid and is drawn as it is.
- DL3.6 Smart guides (Hanrim / Lumi, 2026-10-10; `src/model/layout/smartGuides.ts`, `SmartGuideLayer.tsx`). The offset between the pointer and the node is kept for the whole drag; the snap reference is the node's position and its port row, never the grabbed point, so where a node is grabbed cannot change where it lands. Per axis the first of these within 6 screen px wins: another node's **port row** (vertical only), another node's **centre or left / right (top / bottom) edge**, then the **16 px grid**; ties go to the smaller distance, then the node id. A selection is referenced by its bounding box (centre and edges) and the grabbed node's port row. During the drag a dashed line runs through where it will land, on both axes, and a solid line reaches every other node it is exactly aligned with. Alt shows the guides faint and pulls nothing. After an arrow-key move the row and column it sits on show for 1.2 s. Not on the phone. Only the nodes within 1,200 flow px are compared (grid buckets built once per drag). Display and input only: no stored field, revision, digest or simulation result depends on it.

## DL4. Connection shapes and route editing (step 3 — built; `SEMANTICS-R10.md`, `docs/edge-routing.md` §ER15–§ER16)

- DL4.1 Shapes: **Auto orthogonal** (the C′ router) is the default for new and converted connections; **Curved** (today's Bézier) and **Straight** (a direct line) are choices; **Manual orthogonal** keeps the author's bend points.
- DL4.2 Editing an automatic route by hand (adding, moving or removing a bend point) turns the connection into Manual orthogonal; **Reset to automatic** returns it to the C′ route.
- DL4.3 Bend points snap to the 16 px grid; Alt moves one freely. Each add, move or delete is one undo step. Nothing changes a route while the canvas is locked.
- DL4.4 The shape and the bend points are saved in files and share links; they never change the engine digest or a simulation result.
- DL4.5 The phone draws every shape and route but offers no route editing.
- DL4.6 Bundled Templates use automatic routes; a manual bend point only where the router cannot resolve a case.
- DL4.7 Out of scope for v0.25.0: editing Bézier control points, and line decorations beyond today's.
- DL4.8 Stored form (Lumi, 2026-10-09): Curved = no `route` (never `"bezier"`); Straight = `route: "straight"`, no bend points; Auto = `route: "orthogonal"` with no bend points; Manual = `route: "orthogonal"` with 1 to 64. Manual is not a value of its own. An invalid value, or bend points beside Straight or Curved, is removed on reading and reported. A revision or proposal written before `loop-revision/10` keeps its bytes and its digest.
- DL4.9 Curved and Straight give up obstacle avoidance by choice, but their labels still take a free slot on their own line, by the same rule as a routed label. A revision or proposal recorded before `loop-revision/10` keeps its Curved labels where they were recorded (the Bézier middle) until its first shape edit or Tidy to grid (Lumi, 2026-10-10).
- DL4.10 A bend point is added with **Add bend** and then a click on the route (on the segment clicked) or **Enter** (the middle of the longest editable segment; the focus moves to the new handle); it is snapped along its segment, so adding it moves nothing. A drop inside a node or on the connection's own port stub puts the point back; it is never adjusted. Arrow keys move a selected bend point 16 px, Shift + arrow 64 px; Delete or Backspace removes it; Escape cancels the edit in progress or disarms Add bend.
