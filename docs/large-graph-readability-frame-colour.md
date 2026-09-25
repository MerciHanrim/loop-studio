# Large-graph readability — frame accent colour (Slice 4a/4b follow-up)

`FC` — a small, render / UI-only follow-up to the group-frame work. Lets a user
give a **manual** frame (or a promoted auto frame) a distinguishing accent from
a **small preset palette**, so hand-built regions read apart at a glance.

Origin: the #118 Production hands-check — every hand-drawn manual frame was the
same colour, giving no per-group visual separation. Not an auto-frame algorithm
defect; recorded as this follow-up.

Ships as **one Draft PR, two commits** (spec + cross-references, then
implementation + tests + baselines). No `docs-only` predecessor PR — there are
no architectural forks: transient state, the promote/cancel contract (§AF5
R5/R6) and the back-layer render are all already established by 4a/4b.

---

## FC0. Fixed scope

- Only a **manual** frame, or an **auto frame promoted to manual**, can carry an
  accent. A **pure auto (suggested) frame stays neutral + dashed** — the
  manual-vs-auto tell (§AF5 R1) must not weaken.
- **Committing a colour on an auto frame promotes it to a transient manual
  frame** (§AF5 R5), exactly like a committed rename / resize. **Cancelling the
  picker keeps it auto** with its rect and label unchanged (§AF5 R6).
- The colour is **session-only in §FC**: in memory on `frameStore` only,
  dropped on a whole-graph (re)load (`graphStore.loadRev`), same as the frame
  itself (§LGR3.4). Never `localStorage`, never a URL param.
  **→ LGR Slice 5** (`docs/large-graph-readability-saved-frames.md`) makes a
  **manual** frame's `color` persist *with the frame*, in the doc, as
  `loop-revision/5` cosmetic content. The §FC contract below is unchanged —
  Slice 5 only adds a serialization boundary for the manual `frameStore.frames`.
- **§FC changes nothing** in GraphDoc / schema / `serialize` / digest /
  revision / undo / engine / Monte-Carlo / Share / Workspace / autosave, and a
  colour change is **not a graph undo entry**. (**LGR Slice 5** — §SF11 —
  reverses this for a *saved* manual frame: a colour commit / Neutral return
  becomes **one undo entry each** and moves the `loop-revision/5` cosmetic
  digest. The engine result is still untouched.)
- A *pure auto* (untouched suggested) frame never persists, in §FC or Slice 5.

---

## FC1. The palette — decided

Neutral (the default, = today's frame look) **plus five accents**. Each accent
reuses an already-shipped, already-theme-tuned canvas hue, under its own
semantic token so it can move independently later:

| id | token | light | dark | reuses | why safe |
|---|---|---|---|---|---|
| `neutral` *(default)* | — (existing `--line-strong` border, `--signal-primary` fill @ 0.05) | — | — | — | today's frame |
| `slate` | `--frame-accent-slate` | `#527a91` | `#78a6be` | `--hue-pool` | blue-grey; clear of teal |
| `sage` | `--frame-accent-sage` | `#66805e` | `#91af85` | `--hue-source` | green |
| `gold` | `--frame-accent-gold` | `#9a7639` | `#c6a05b` | `--hue-gate` | yellow-brown; heavier + `!`-glyphed `invalid` cue and the orange `--warning` stay distinct at border weight |
| `violet` | `--frame-accent-violet` | `#78678f` | `#a99bc0` | `--hue-converter` | purple |
| `rose` | `--frame-accent-rose` | `#9e5a83` | `#c58bab` | **new** | magenta-shifted, clear of `--danger` red |

**Deliberately excluded hues:** teal (`--signal-primary` — selection, Activity
overlay, the effective pulse, the evaluated bracket) and red / orange
(`--danger` / `--warning` — `invalid` / `blocked` / diagnostics). `rose` is the
one new value; it is a fixed brand-neutral magenta, not derived from any signal.

Contrast: every accent is an existing node hue that already clears the canvas
contrast bar in both themes; `rose` is picked to match their L\* range
(≈ 45 light / ≈ 68 dark). Verified in the `frame-colours` light **and** dark
baselines (FC6).

Accents are **not** node-kind labels — a `slate` frame does not imply it holds
Pool nodes. The hue is a picker preset, nothing more.

---

## FC2. Where the accent applies

On the frame's own chrome only, one accent value driving three surfaces:

| surface | neutral | accent |
|---|---|---|
| **back-rect border** (`.lgr-frame__fill` stroke) | `--line-strong` @ 0.5 | the accent token @ **0.7** |
| **label chip** (`.lgr-frame__label` text + border) | `--text-secondary` / `--line-hairline` | the accent token |
| **back-rect fill** | `--signal-primary` @ **0.05** | the accent token @ **0.06** |

Fill opacity is capped at **0.06** — below the 4a Activity-overlay ceiling
(≈ 0.15) so a coloured frame plus an Activity tint stay separable, and low
enough that **two overlapping accented frames (≈ 0.116 combined) still do not
obscure the nodes or edges beneath**. Three-plus overlapping accented frames is
a degenerate manual arrangement and is not tuned for.

The accent never touches a node, an edge, a handle, the minimap, or any run /
diagnostic cue. It is drawn in the existing 4a **back layer** (z-index 0, below
the RF pane), so nodes, edges, selection rings, `invalid` / `blocked` flags, the
`effective` pulse, the `evaluated` bracket, Activity tint, and diagnostic
markers all still render **above** it, unchanged (§AF7 AF-INV-3).

---

## FC3. Selection stays clearer than any accent

Today the selected frame is told by re-colouring its border / label to
`--signal-primary`. That channel is now needed for the accent, so **selection
moves to its own channel**:

- a **2 px dashed `outline`** (with `outline-offset`) on the `.lgr-frame` chrome
  div — a channel orthogonal to border *colour*, and one that **survives
  `forced-colors`** (the pattern already used for the Focus / Filters ON tell);
- the back-rect keeps a **weight + opacity bump** when selected (stroke-width
  1.5 → 2.25, opacity → 0.95) **in whatever colour the frame already is** —
  neutral or accent. Selection changes weight, never hue.

So a `rose` frame that is selected shows: rose border (heavier) + rose label +
the dashed selection outline. The outline is the unambiguous "this one is
active" tell regardless of accent.

---

## FC4. The picker

> **Superseded in placement by FC10 (2026-09-25).** The swatch row's contents,
> semantics, auto-frame rules and mobile scope below are all still current; only
> WHERE it lives changed — it is now inside the frame's properties popover,
> opened from its title, instead of glued to the frame's bottom edge.

- Desktop, on a **selected manual frame** (or a selected auto frame — see
  below): a compact **swatch row** in the chrome, rendered under the ✕ / resize
  corner. Six buttons: `neutral` + the five accents.
- Each swatch is a real `<button>` with:
  - an **accessible name** — the localised colour name (`canvas.frame.color.*`),
    not just a colour fill;
  - `aria-pressed` on the frame's current accent (or `neutral`);
  - a visible **checked ring** on the active one (so `forced-colors` and
    colour-blind users have a non-hue tell).
- **Not** a free hex / HSL picker. Five presets + neutral, nothing else.
- **Auto frame + desktop:** the same swatch row shows. Picking **any accent**
  commits → `adoptFrame(rect, label, accent)` + `removeAuto` (promote, §AF5 R5).
  Picking **neutral**, pressing **Esc**, or clicking away is a **no-op — the
  frame stays auto** (§AF5 R6). An auto frame never *holds* an accent; the
  accent is only chosen at the moment of promotion.
- **Mobile:** **no picker this pass.** A manual frame on mobile keeps its
  current select / rename behaviour but shows **no swatch row**; a pure auto
  frame stays **display-only** (`§AF-INV-7` — no hit-test surface, no chrome).
  Accents chosen on desktop **do render** on mobile. Adding a mobile colour-edit
  UI is explicitly deferred.

---

## FC5. State model + transitions

`frameStore`:

```ts
export type FrameColor = 'slate' | 'sage' | 'gold' | 'violet' | 'rose'
export type Frame = { id; n; label; rect; color?: FrameColor }   // absent ⇒ neutral
```

- `adoptFrame(rect, label, color?)` — the existing promote target gains an
  optional third arg. The rename-promote path (`commitLabel`) passes no colour
  (rename-promoted frames start **neutral**).
- `setFrameColor(id, color: FrameColor | null)` — set / clear a **manual**
  frame's accent. `null` ⇒ back to neutral. **Not** an undo entry.
- No other store surface changes. `clearFrames` / the `loadRev` subscription
  already drop the whole `frames` array, colour included.

| transition | result |
|---|---|
| a **new** manual frame (draw tool) | **neutral** |
| manual `neutral → accent → other accent → neutral` | `setFrameColor` each time; rect / label / ordinal untouched; **one undo entry each** since Slice 5 (§SF11.1 — this row predates saved frames) |
| **auto** frame, pick an accent | **promotes** to a manual frame with that accent (solid border, `Group N` / `그룹 N` ordinal rules, §AF5 R5) |
| **auto** frame, open picker then Esc / pick neutral / click away | **stays auto** — rect + label unchanged (§AF5 R6) |
| rename / resize / colour of an auto frame | all three follow the **same** §AF5 promote contract |
| a **promoted** (now manual, possibly accented) frame, next **Suggest** | **preserved** — Suggest replaces only the auto set (§AF5 R3/R7) |
| **Dismiss** (✕) | applies to a **pure auto** frame only — unchanged |
| **Clear suggested frames** | removes the auto set; **an accented manual frame is kept** |
| **Clear all frames** | removes everything, accented frames included |
| **Filter / Focus / Activity / a sim run / Step / Reset** | never change a frame's colour (nor its rect / label) |
| **graph reload** (`loadRev`) / **browser refresh** | frame **and** its colour dropped |
| GraphDoc / digest / undo | **unchanged** by any colour operation |

---

## FC6. forced-colors, reduced-motion, and "colour is not a label"

- **`forced-colors: active`** — the whole accent palette is **dropped**. The
  existing rule already forces `.lgr-frame__fill` to `fill: none; stroke:
  CanvasText`; that keeps winning. The manual-vs-auto tell falls back to
  **solid vs dashed border** and the label word (`Group` / `Area`); selection
  is the dashed `outline` in `Highlight`. Swatch buttons render as
  `ButtonText`-bordered boxes distinguished by their **name** and the checked
  ring, not by fill.
- **`prefers-reduced-motion`** — no new animation or transition. The accent
  applies instantly on commit; there is no cross-fade. (`.lgr-frame__fill` has
  no `transition` today and gains none.)
- **Colour never carries meaning alone.** The label is always shown; the accent
  is a redundant "which region is which" aid on top of it. A frame with no
  label still shows its `Group N` / `Area N` default.

---

## FC7. Test boundaries

**unit** (`frameStore.test.ts`):

- a new manual frame has no `color`;
- `setFrameColor` sets / changes / clears (`null`) a manual frame's colour;
  cycling `neutral → slate → violet → neutral` leaves `rect` / `label` / `n`
  identical and bumps no undo counter;
- `adoptFrame(rect, label, 'rose')` creates a manual frame with `color: 'rose'`,
  the next `Group N` ordinal, and selects it;
- `adoptFrame(rect, label)` (no colour) creates a **neutral** manual frame;
- `clearFrames()` and a `loadRev` bump drop coloured frames like any other.

**e2e** (`large-graph-readability.spec.ts`, Slice 4a/4b blocks):

- select a manual frame → swatch row visible → pick `slate` → the back-rect
  stroke, the label colour, and the fill all read `--frame-accent-slate`;
  `aria-pressed` moves to that swatch;
- pick `neutral` again → back to the default look;
- select an **auto** frame → pick `gold` → it **promotes**: leaves the auto set,
  becomes a **solid** manual frame with `color: 'gold'` and a `Group N` label;
- select an auto frame → open the picker → **Esc** → still in the auto set,
  dashed, rect + label unchanged;
- a promoted accented frame **survives** the next **Suggest** and **Clear
  suggested frames**; **Clear all frames** removes it;
- **Filter** that hides every node inside an accented frame → the frame + its
  colour + rect unchanged; a **sim run / Step / Reset** never changes the
  colour;
- **`forced-colors`** emulation → the accent is gone, manual (solid) vs auto
  (dashed) vs selected (outline) are still all distinguishable;
- **reduced-motion** emulation → the colour applies with no transition;
- **mobile** → a selected manual frame shows **no** swatch row; a pure auto
  frame stays display-only; a desktop-set accent still renders;
- **graph reload** → frame and colour both gone;
- GraphDoc / digest / undo asserted unchanged across a colour change.

**visual baselines** (`e2e/…-snapshots/`):

| baseline | contents |
|---|---|
| `frame-colours.png` (light) | a neutral manual frame + one frame in **each** of the five accents + a pure auto (neutral, dashed) frame + one accent frame **selected** (showing the dashed outline over the accent) |
| `frame-colours-dark.png` | the same arrangement, dark theme |
| `frame-colours-overlap.png` | two accented frames overlapping — the combined fill still lets the nodes / edges through |
| `frame-colours-forced.png` | `forced-colors` — manual / auto / selected all still tell apart with the palette dropped |
| `frame-colours-promote.png` | an auto frame **before** (dashed `Area N`) and a spatially-matching manual frame **after** an accent commit (solid `Group N`, accented) — side by side in one shot |

---

## FC8. Doc changes in this PR (commit 1)

- **new** — this file.
- `docs/large-graph-readability.md`
  - §LGR6.1 / §LGR6.2 — one line: a **transient** frame may also carry a
    session-only **accent colour** from a fixed preset palette (`FC`); dropped
    on reload, never serialized.
  - §LGR3.4 persistence table — the **Transient frames** row already covers
    "drawn rects + labels"; extend its wording to "drawn rects + labels **+
    accent colour**".
- `docs/large-graph-readability-auto-frames.md`
  - §AF5 R5 / R6 — the promote / cancel contract now covers **rename, resize,
    _and colour_**; §AF5's state-transition table gains a `colour` row mirroring
    `rename`.
  - §AF7 AF-INV-3 — note that a frame **accent** (like the frame itself) is
    drawn in the back layer and never covers a required signal.
  - §AF9.2 — the accent is a redundant aid; the label is never replaced by
    colour.

## FC9. Implementation in this PR (commit 2)

- `src/store/frameStore.ts` — `FrameColor` type, `Frame.color?`, `setFrameColor`,
  `adoptFrame` third arg.
- `src/components/frames/FrameLayer.tsx` — pass `color` through `RenderFrame`;
  `data-color` on the back `<rect>` and the chrome `<div>`; the swatch row
  (desktop, selected, not a mobile auto frame); the auto-frame colour-commit →
  promote path; the picker Esc / click-away = no-op.
- `src/index.css` — the five `--frame-accent-*` tokens (light / dark /
  `[data-theme]`), `.lgr-frame__fill[data-color=…]` + `.lgr-frame[data-color=…]
  .lgr-frame__label` rules, the selection **outline** on `.lgr-frame.is-selected`
  (replacing the `--signal-primary` recolour), the `.lgr-frame__swatches` row,
  the `forced-colors` additions.
- `src/i18n/locales/{en,ko}.ts` — `canvas.frame.colorRow` (picker aria-label) +
  `canvas.frame.color.{neutral,slate,sage,gold,violet,rose}`.
- tests + baselines per FC7.

**If, while writing this, a genuinely new product decision on the palette,
contrast, or mobile behaviour is needed — stop and ask before implementing.**
Otherwise the spec above is the contract.

---

## FC10. The picker moves into a frame PROPERTIES popover (2026-09-25)

**This supersedes FC4's placement — not its content.** The palette, the
accessible names, `aria-pressed`, the checked ring, the auto-frame promote /
neutral-no-op rules and the mobile scope are all unchanged. What changes is
WHERE the six swatches are and what opens them.

### The defect

FC4 put the swatch row in the frame's own chrome at `top: 100%` — the frame's
BOTTOM edge, in canvas coordinates. That binds the control to the frame's
GEOMETRY rather than to the interaction that opens it, and on a frame taller
than the viewport it puts the only colour control off screen.

**Measured (2026-09-25, production `a2989c2`):** the shipped gacha Template's
`zone_pickup` frame — `Premium Pickup`, `{x: 2440, y: 330, w: 1790, h: 1000}`,
the largest of its four — has its title and its bottom edge more than a screen
apart at zoom 1. Reading the title and recolouring the frame could not be done
from the same place. Every other frame edit is already reached from the title.

### The shape

- Clicking (or pressing Enter on) a frame's **title chip** opens one
  **properties popover** holding that frame's **name** and its **accent**,
  in that order, left-aligned under the title.
- The chip stays in place and becomes the popover's **anchor** and its
  `aria-expanded` disclosure. The frame's chrome does not reflow when it opens.
- The popover is **portaled to `document.body`** and positioned `fixed` from
  the chip's measured screen rect — never inside `<ViewportPortal>`. A panel in
  canvas coordinates would be scaled by the zoom and pushed off screen by
  exactly the geometry that caused the defect.
- Placement uses the toolbar's shared `computeBelowAnchorPos`: below the
  anchor, **flipped above** when there is no room below, **clamped** inside the
  viewport on both axes. Left-aligned (`'start'`), because a frame's title sits
  at its top-left corner.
- A colour applies **immediately** and the popover stays open. A name commits
  on Enter (which closes it) or on any dismissal; **Escape cancels the name**
  and closes, exactly as FC4's inline rename box did. A colour already picked
  stays — it was its own committed edit the moment it was clicked.
- Opening it, and recolouring from it, **move nothing**: not the frame, not a
  node, not an edge, not the viewport.

### The canvas is frozen while it is open

`uiStore.frameProps` holds the open frame's id — session-only, never persisted,
never in the `GraphDoc` or on the undo stack. `Canvas.tsx` reads it and turns
off `panOnDrag`, `zoomOnScroll`, `zoomOnPinch` and `zoomOnDoubleClick` while it
is set. The placement is measured once, so a pan or a zoom underneath would
slide the panel off its own anchor.

Two consequences, **both measured rather than reasoned** (2026-09-25):

1. **A wheel over the canvas does nothing and does NOT dismiss.** Dismissing
   from the wheel re-armed zoom inside that same event: one notch zoomed the
   canvas `1 → 0.717` with the popover still on screen. React Flow keeps
   `zoomOnScroll` / `panOnDrag` in a mutable pan-zoom object refreshed from an
   effect, so flushing the closing state update mid-dispatch re-enables them
   before the event reaches its own handler. With nothing to dismiss, there is
   nothing to race.
2. **Every other dismissal closes on a TASK of its own**, not inside the
   dispatch of the event that asked for it — and `setTimeout`, not
   `queueMicrotask`: a microtask checkpoint runs BETWEEN two listeners for the
   same event, so a microtask is still inside the dispatch. With a microtask the
   wheel still zoomed; with a task the dismissing gesture moves nothing.

Because the popover is a `[role="dialog"]`, `isTypingTarget` / `isModalOpen`
(§LGR6.6) already cover it: Backspace / Delete with a **swatch** focused cannot
delete the frame being edited, not just with the text field focused.

### Scope is unchanged — LGR-D12 / D6 still holds

Desktop **and** an unlocked canvas only. On mobile, and on a locked desktop
canvas, a saved frame stays **view + select only**: the title is a static span,
no popover is rendered, and asking the store to open one is refused by the same
render gate. An accent chosen on desktop still renders everywhere. Whether
mobile should ever be allowed to edit a frame is a separate product decision
and is **not** taken here.

### Files

- `src/components/frames/FramePropsPopover.tsx` — new; the panel, its placement,
  focus, dismissal and the deferred close.
- `src/components/frames/FrameLayer.tsx` — the title chip becomes a disclosure
  button; the inline swatch row and the inline rename input are gone; the
  popover is rendered outside `<ViewportPortal>`; a promotion re-points an open
  popover at the new frame id.
- `src/store/uiStore.ts` — `frameProps` / `openFrameProps` / `closeFrameProps`.
- `src/components/Canvas.tsx` — the pan / zoom freeze.
- `src/components/toolbar/useAnchoredPosition.ts` — an `align` argument
  (default `'end'`, so existing callers are untouched).
- `src/components/toolbar/useOutsideDismiss.ts` — `alsoInside` (the anchor
  counts as inside, so the chip can toggle) and `keepOnWheel`.
- `src/index.css` — `.lgr-frame-props*`; `.lgr-frame__swatches` is gone and the
  swatch buttons are unchanged.
- `src/i18n/locales/*/canvas.ts` — `canvas.frame.props.title` /
  `canvas.frame.props.name`, all 14 locales.
- `e2e/frame-props-popover.spec.ts` — 8 regressions, `Premium Pickup` first.
- Baselines: `auto-frames`, `auto-frames-mixed`, `frames-activity`,
  `frame-colours`, `frame-colours-dark`, `frame-colours-forced` lose the swatch
  row under the selected frame. `frame-colours-overlap` has no selected frame
  and is unchanged.
