# Flow colour and compact nodes — design contract

Issue #325. This document is the contract for the milestone's three pull requests. Slice 0 measured the product at main `72c7f1a` (v0.18.2) in Google Chrome 154 (Blink) at 1280 x 800, device scale 1, `en-US`; the screenshots, their hashes and the raw measurements are kept outside the repository, and only the numbers that decide something are repeated here.

## FC-0. What a flow colour is

- A flow colour is a **decorative grouping aid**: the user picks it so a reader can follow one flow or one region of a large graph. It carries no simulation meaning and no product state.
- It never replaces what already carries meaning. A node's **kind** is its silhouette (§VL0.1); the neutral **structure line** that bounds every node stays on every node; **selection, keyboard focus, errors and warnings, run cues and Focus-mode dimming** keep channels of their own (FC-4).
- An uncoloured graph looks as it does today, except for the selection correction of FC-4.1, which applies to every graph.
- Under forced colours a flow colour is not drawn at all (FC-3.4).

## FC-1. Today, measured (main `72c7f1a`)

### FC-1.1 Where a node shows colour

A node carries its **kind hue** (`--hue-pool`, `--hue-source`, …; Parameter and Register use `--line-structure`) on four node surfaces and two views:

| place | element | strength |
|---|---|---|
| hue wash | `.nodef__hue`, inside the silhouette | fill opacity `--node-hue-opacity` 0.04 |
| kind chip | `.nodef__chip`, before the title | 8 x 8 px, radius 2 |
| L0 dot | `.nodef__cdot` | only below zoom 0.45 |
| outline | `.nodef__stroke` | **not** kind-coloured: 1.5 px (Parameter / Register 1.25, L0 2) `#c1beb4` light, `#63685f` dark, every kind |
| minimap | `MinimapDock` node fill | fill opacity 0.8 |
| timeline | series colour, cycling the kind hues by series index | Pool solid 1.5 px, Register dashed `4 3` |

### FC-1.2 State signals

| state | drawn as | colour light / dark |
|---|---|---|
| node selected | `.nodef__sel`: **the outline's own path**, 2 px solid, no offset | `#54524c` / `#9a9e96` |
| keyboard focus | `.nodef__focus`: 1.5 px dashed `3 2.5`, scaled 0.9 (inside) | `#3f6fb6` / `#83a9e6` |
| invalid Register | `.nodef__invalid`: 2 px dashed `4 3`, scaled 1.06 (outside), plus a 15 px `!` flag | `#a56332` / `#d59660` |
| fired / arrival / evaluated | wave and arrival motion in `--signal-primary`; a corner bracket | `#2f746e` / `#76b7ae` |
| Focus mode, out of focus | `lgr-deemph`: fill, hue, stroke, body, handles at opacity 0.26; chip and dot hidden | — |
| edge rest | resource 1.5 px solid; state 1 px dashed `4 4` | `#adaaa1` / `#575b56` (resource) |
| edge selected | **recoloured** to `--edge-selected` at 2 px, plus a start dot | `#54524c` / `#9a9e96` |
| edge activator satisfied / not | recoloured `--signal-primary` 1.8 px / opacity 0.5 | — |
| edge route-invalid | dashed `6 3` in `--warning`, plus a `!` flag | — |
| connecting | a `--signal-primary` halo on the dragged-from and the valid target handle; no cue for a target that cannot be connected | — |

The selected node differs from a resting one only by a darker stroke 0.5 px heavier, on the same path. §VL3 specifies "2 px ring, offset 2 px"; main does not draw the offset. A selected edge is told only by its recolour. Both would be lost under a flow colour drawn on the same line, and FC-4 corrects both.

### FC-1.3 Node geometry (zoom 1; Coffee, Gacha, MMO and a three-node graph; 180 nodes)

| kind | n | width min / median / max | height, one-line title | height, two-line title |
|---|---|---|---|---|
| pool | 75 | 118 / 125 / 181 | 64 (74 with a capacity row) | 74 / 74 / 90 |
| converter | 23 | 118 / 133 / 166 | 64 | — |
| gate | 30 | 134 / 158 / 209 | 64 | 64 |
| source | 12 | 138 / 153 / 191 | 64 | 72 |
| drain | 9 | 147 / 182 / 191 | 64 | 72 |
| end | 2 | 165 / 165 / 177 | 64 | — |
| parameter | 19 | 162 / 179 / 179 | — | 86 |
| register | 16 | 127 / 260 / 260 | 86 | 102 |

CSS: min-width 118 (Gate 134), max-width 260, base height 64 (`BASE_NODE_H`); body padding `6px 16px`, Source right 26, Drain left 26, Gate `8px 30px`, End right 24, Parameter and Register inline 15. Title 14 px / 600 / line-height 1.15, max-width 135, wraps to two lines; value 18 px mono; sub 12 px; title-to-value gap 1 px; chip-to-title gap 6 px. The height is measured in JS from the content and clamped per kind; the width is CSS. Ports: an 8 x 8 resource circle and a 7 x 7 state diamond, both with an 18 px hit area (`::before`, inset -5 px). Levels of detail: L2 at zoom 0.8 and above, L1 from 0.45 (no sub line), L0 below (no text, outline 2 px, kind dot).

## FC-2. Data

### FC-2.1 The field

- `data.accent?: string` on **every node kind** (Pool, Source, Drain, Gate, Converter, End, Parameter, Register) and on **both edge kinds**. It lives in `data`, because `serialize()` writes only `id`, `type`, `position` and `data` for a node.
- The stored value is exactly `^#[0-9A-F]{6}$`: upper-case, six digits, one spelling per colour, so equal colours give equal digests.
- No `accent` means no flow colour. Returning to the default **deletes** the key; `null`, an empty string or a default colour are never written.

### FC-2.2 Input

| entered | result |
|---|---|
| `#3a7bd5`, `3A7BD5`, ` #3a7bd5 ` | `#3A7BD5` |
| `#3ad`, `3ad` | `#33AADD` |
| `#3a7bd580`, `#3ad8` (alpha) | not applied; the field says why |
| `red`, `rgb(…)`, `#12345`, anything else | not applied; the field says why |
| an empty field | no change (returning to the default is its own control) |

### FC-2.3 Reading

- A value matching `^#[0-9A-Fa-f]{6}$` is kept and upper-cased. Any other value is **dropped**, and the node or edge is kept, with no notice and no failed load (the rule for an unknown frame colour).
- A file without `accent` opens as it does today. No migration.
- Every reader validates: the flow-node reader (which today spreads `data` unchecked), `readParameterData`, `readRegisterData` and `normalizeEdge` (which today rebuild `data` field by field and would drop the key) share one `readAccent()`.

### FC-2.4 A colour change is not a model change

- Changing, applying or removing a flow colour **does not reset the run** and **does not mark a Monte-Carlo result stale**: `updateNodeData` treats `accent` like `label`, and `setEdgeData`'s cosmetic set (`route`, `waypoints`) gains `accent`.
- One apply is **one undo entry**, however many nodes and edges are selected; re-applying the colour an element already has adds no entry.

### FC-2.5 Digests

- The **engine and structure digest** (`semanticDigest`, Monte-Carlo staleness) never includes `accent`: it reads an allowlist that does not name it. A test pins this.
- The **full revision digest** includes it: `accent` is appended, last, to every list in `NODE_FIELDS`, `MODEL_NODE_FIELDS` and `EDGE_FIELDS`, emitted only when set, so every document without a flow colour projects byte-identically to before. `fieldTag` reports it `cosmetic`, and it joins `OPTIONAL_PROJECTED_KEYS` so a selective Apply can remove it.
- A revision side that carries any `accent` is **`loop-revision/9`** (`docs/specs/SEMANTICS-R9.md`).

### FC-2.6 Boundaries

| boundary | behaviour |
|---|---|
| save and reopen, autosave | written by `serialize`, read through FC-2.3 |
| undo and redo | whole node and edge arrays per entry; FC-2.4 |
| export and import of a graph file, workspace, module file | `serialize` / `deserialize` |
| inserting a module, opening a template | normalised, then FC-2.3 |
| share link, protected link | the exported text; about 19 bytes per coloured element before compression, inside the existing size check |
| revision and proposal files | written whole; read through FC-2.3; `loop-revision/9`. An older build opens the diagram but refuses the project header, keeps a flow node's colour and drops a Parameter's and an edge's — measured, `docs/specs/SEMANTICS-R9.md` §R9-5 |
| portable file and installed app | the same code path |
| locale relabel | spreads `data`; the colour is untouched |
| CSV export | not affected (label and id only) |
| copy and paste | **the product has no copy and paste of nodes today**; not part of this milestone |

### FC-2.7 Recent colours

- Up to **8**, newest first, stored as a per-browser **preference** behind the storage port under `loop-studio:recent-accents`. A temporary session keeps them in memory only; "Reset all Loop Studio data" removes them. Never in a document or a link.
- "Colours in this document" are the distinct `accent` values of the open graph, derived, never stored.

## FC-3. Colour, theme and contrast

### FC-3.1 One value, both themes

The stored `#RRGGBB` is drawn **unchanged** in the light and the dark theme. There is no per-theme shift.

### FC-3.2 The default palette

| name | value | light canvas | light node face | dark canvas | dark node face |
|---|---|---|---|---|---|
| Slate | `#638EA5` | 3.47 | 3.53 | 4.49 | 3.48 |
| Sage | `#74906B` | 3.47 | 3.53 | 4.49 | 3.48 |
| Gold | `#A78243` | 3.49 | 3.55 | 4.47 | 3.46 |
| Violet | `#9182A8` | 3.46 | 3.52 | 4.51 | 3.49 |
| Rose | `#B47599` | 3.47 | 3.53 | 4.49 | 3.48 |

- The five names and hues are the frame accents'. Each value is the point between that accent's light and dark frame values whose lowest contrast against the four surfaces is highest (relative luminance about 0.247): a frame's tokens are tuned per theme, a stored flow colour is one value, so a node's Slate is the same hue as a frame's Slate, not the same hex.
- Equal luminance is the price of passing all four surfaces: the five differ by hue alone (closest pairs in OKLab: Violet and Rose 0.063, Slate and Violet 0.068), so under a colour-vision deficiency two of them may look alike. That is acceptable for a decorative aid that carries no meaning; where a colour identifies something (a timeline series, FC-6), the name and the line style identify it too.
- No Blue: the user can enter any hex.
- The palette never contains the run teal, the focus blue, the warning orange or the selection grey.
- **Every palette colour is used with no notice of any kind** (FC-3.3); a unit test asserts it.

### FC-3.3 Notices — advice, never a block

A notice appears in the colour control when the chosen colour, at the places it will actually be drawn, is weak or easily confused. The colour is applied either way.

| where the colour is drawn | measured against | notice below |
|---|---|---|
| an edge (line, arrow, label mark) | the canvas, light and dark | 3:1 |
| a node's L0 dot | the canvas, light and dark | 3:1 |
| a node's colour band and chip | the node face **and** the canvas around the node, light and dark | 3:1 |

- The notice names the theme ("hard to see on the dark canvas", "… on light nodes") and reflects the current selection: nodes, edges or both.
- A second notice, also advice only, says when the colour is close to a **state colour** (OKLab distance below 0.06 to the run teal, the focus blue or the warning orange, light or dark values). The nearest palette colour is 0.078 away (Gold to the light warning orange), so the palette never triggers it. The selection grey is not on the list: selection keeps its own ring (FC-4.1).

### FC-3.4 Forced colours

Under `forced-colors: active` no flow colour is drawn: the colour band, the chip, the wash, the dot, the edge stroke and arrow and the label mark take the system colours the canvas already uses. Kind stays readable by silhouette and state by dash, weight, flag and icon. The colour control keeps each swatch's name, the pressed state (a `Highlight` outline) and the hex field; its swatches keep their own fill (`forced-color-adjust: none`), because a colour chooser that shows no colour cannot be used — the canvas still draws none.

## FC-4. Drawing

### FC-4.1 Nodes

The spatial order is fixed, measured from the silhouette in screen pixels (every stroke is non-scaling, so it holds at any node size, height and zoom; `NODE_RINGS` in `src/components/nodes/silhouette.ts`):

| layer | where | drawn as |
|---|---|---|
| **invalid** (Register) | 6.5 – 8.5 px **outside**, the outermost | `--warning`, dashed `4 3`, plus the `!` flag |
| **selection** | 2.5 – 4.5 px **outside** | `--state-selected`, solid — §VL3's "2 px ring, offset 2 px" |
| **structure line** | on the silhouette | the neutral `.nodef__stroke`, unchanged in colour and width for every node |
| **colour band** | 0 – 3 px **inside**, clipped to the silhouette | the flow colour |
| **keyboard focus** | 4.5 – 6 px **inside**, the innermost | `--state-focus`, dashed `3 2.5` |

- Each ring is cut out of a wider stroke on the same path by a mask, so the rings never overlap and nothing is painted in the gaps between them: an edge that reaches a port stays visible. With selection, focus, invalid and a flow colour on one Register, all four show at once.
- The structure line is the node's boundary, so even a colour with no contrast never erases the edge of a node.
- The selection ring applies to every selected node, coloured or not; it replaces main's recolour of the structure line's own path, which §VL3 never specified.
- Run cues keep their own channels: the fired wave is a transient animation outside the rings; the arrival disc and the evaluated corner bracket are unchanged.

Inside the node, **"the flow colour if set, else the kind hue"** decides the chip, the hue wash (opacity unchanged at 0.04: the body stays neutral) and the L0 dot. The body, the text and the fill do not take the colour. Focus-mode dimming applies to the band, the chip, the wash and the dot like everything else; the chip and the dot stay hidden when dimmed.

### FC-4.2 Edges

- A coloured edge draws its path and its arrowhead in the flow colour at its usual width, and its flow or condition label takes a 1 px border in the colour.
- **Selection** no longer recolours: a selected edge keeps its colour (flow colour or default) at 2 px, over a **selection underlay** — a wider, translucent `--state-selected` stroke beneath the path — plus the existing start dot. Uncoloured edges get the same underlay.
- The colour never overrides a state or a rule: a state edge stays dashed; a satisfied activator keeps its `--signal-primary` stroke over the colour and an unsatisfied one keeps opacity 0.5; a route-invalid edge keeps its `--warning` dash and `!` flag; run tokens, pulses and cues keep `--flow-strength` and `--signal-primary`; Focus-mode dimming applies.

### FC-4.3 The rule

The flow colour is a rest colour. Every state that restyles an element today still does, on a channel of its own, and the flow colour never replaces a state's colour, line style, weight or glyph.

## FC-5. The colour control

- An Inspector section, **Colour**, under the selected node's or edge's own fields.
- **What a choice applies to.** The selection model is not changed: the targets are every node and edge React Flow marks `selected`; with none marked, the one element the Inspector shows (`selectedNodeId` / `selectedEdgeId`). The Inspector's anchor and Focus mode's node stay the first selected element, as before. The flags are temporary UI state: `serialize` never writes them, so they reach no document, digest or autosave.
- One choice is one `setAccent` call: **one undo entry** for the whole selection, no simulation change. A selection whose elements differ shows **Mixed** with no swatch pressed; with more than one target the section says how many it applies to.
- In order: **Default** and the five palette swatches; **Recent** (FC-2.7); **In this document**; a **hex** field (FC-2.2: applied on Enter or when the field loses focus, Escape restores it, an invalid entry is not applied and the field says why); and the browser's own colour input for any other colour. There is no built-in colour grid.
- The browser's colour input applies on its real `change` event only: never on opening it and never on the live `input` events while its dialog is open, so opening it on Default or on a mixed selection applies nothing (in particular, never black).
- Each swatch is a `<button>` with the colour's name (or its hex for recent and document colours) and `aria-pressed`, plus a visible pressed ring that survives forced colours. Everything works with the keyboard alone.
- Notices (FC-3.3) sit under the controls, in a polite live region.
- Each colour is offered once (PR 2): Recent leaves out the palette's colours, and In this document leaves out the palette's and Recent's, so the current colour's ring shows once. A row left empty is not shown.
- Phone: the Inspector is a read-only sheet there (`docs/mobile.md` MV-D3), and the section is one line of read-only text, with no control (PR 2): a dot and the colour's name and hex for a palette colour (`Rose #B47599`), the dot and the hex alone for any other, **Default** with an empty ring, **Mixed** with no dot, since a dot would read as one particular colour. The hex is a `dir="ltr"` run. A locked desktop canvas keeps the editor inside `<fieldset disabled>`: every control disabled, the hex field and the colour input drawn with the disabled ink and boundary of the other read-only fields and no pointer cursor, the swatches still showing the current colour and its ring. A colour set anywhere renders everywhere.

## FC-6. Minimap, timeline and templates (PR 2)

- The minimap mark of a node with a flow colour takes it; others keep the kind hue (`MinimapDock`).
- A Pool or Register series in the timeline takes its node's flow colour, for its line, its legend mark, its endpoint dot and label; others keep their colour by index, so colouring one node never recolours another series (`TimelineChart`). Edge colours are not passed to the timeline. The Register dashed line and the Pool solid line stay. CSV export and simulation data are unaffected.
- Under forced colours neither view draws a flow colour (FC-3.4). Both paint inline SVG `fill` / `stroke`, which the system palette does not replace, so they ask `useForcedColors()` (`src/ui/media.ts`) and fall back to the colours they draw today.
- Templates get restrained colours, three each, on their main flows; their simulation results do not change. The colours are data in the shipped file, written by the Template's builder through `withTemplateFlowColours` (`src/engine/templateFlowColours.ts`): each listed node takes its flow's palette colour, and so does every resource edge whose two ends are in the same flow; a Parameter, a Register, a missing id or a node listed twice fails the build.

| Template | Sage | Gold | Violet | Rose |
|---|---|---|---|---|
| Coffee roastery operations flow | green beans | roasted beans, from the roast on | — | desserts |
| 3-zone gacha banner comparison | General / Free zone | — | Premium Standard zone | Premium Pickup zone |
| Early MMO progression | items and loot | gold | experience and level | — |

The gacha zones take the colour their frames already carry. Uncoloured: every Parameter and Register, the gacha comparison row, the MMO combat chain, encounters and upkeep. Each Template's engine digest equals the one recorded before the colours; its content and full revision digests change with them.

## FC-7. Compact nodes (PR 3)

- A typical one-line flow node is 64 px high and needs about 32–38 px of it for its content. First estimate, to confirm with before / after shots against the Slice 0 set: base height 64 → 56 (-12.5 %), inline padding 16 → 12 px (Source and Drain 26 → 22, Gate 30 → 26), title max-width unchanged so long titles still wrap in every language.
- The visible port may shrink; its 18 px hit area does not. No saved coordinate moves; edges may reroute, and the MMO graph is checked for it (`routeMap` assumes 130 x 64 when a size is missing; auto frames use a 150 x 40 canonical size).

## FC-8. Tests that hold this contract

Unit:

- `src/model/model/accent.test.ts` — every row of FC-2.2 and FC-2.3.
- `src/model/flowColour.test.ts` — `serialize` → `deserialize` keeps `accent` on all eight node kinds and both edge kinds, and a file without it gains nothing; an invalid value is dropped and the element kept; a module insert keeps every colour; selection flags never reach the file; `semanticDigest` is unchanged by setting, changing and removing colours and by selection flags; the full revision digest changes and comes back; equal colours in either case give equal digests; a document with no colour projects byte-identically and the `/1` projection never emits it; a side with a surviving colour is `loop-revision/9` and its stored digest verifies; `fieldTag` is `cosmetic`; a colour-only diff is neither engine- nor advisory-affecting; a selective Apply adds, changes and removes it.
- `src/store/graphStore.accent.test.ts` — `setAccent` over several nodes and edges is one undo entry; undo and redo restore each element's colour or its absence and never move `simulationRev`; re-applying is no entry; an invalid value changes nothing; `updateNodeData` / `setEdgeData` with only `accent` move no `simulationRev`, a real change still does; `accentTargets` follows the `selected` flags, else the Inspector's element.
- `src/store/recentAccents.test.ts` — at most 8, newest first, de-duplicated, stored form only; memory only in a temporary session; removed by the reset.
- `src/engine/templateFlowColours.test.ts` (PR 2) — `withTemplateFlowColours` colours the listed nodes and the resource edges inside one flow and fails closed; each Template carries exactly its builder's colours, never on a Parameter or a Register, an edge coloured exactly when it is a resource edge inside one flow; its engine digest is the one recorded before the colours (`sha256Baseline.fixture.ts`), and its content and full revision digests are pinned at their values with the colours. `src/model/sha256Baseline.test.ts` keeps the recorded #301 digests: for these three files it checks the engine digest as recorded, and an explicit legacy test removes `accent` and checks all three recorded digests.
- `src/ui/flowColour.test.ts` — every palette colour gives no notice and passes 3:1 on the four surfaces; the measured faint colours give the right notice for the right place and theme; the state-colour notice; the DOM id fragment.

End to end (Chrome; desktop, the `mobile` project, forced colours, both themes):

- `e2e/flow-colour.spec.ts` — a palette colour and Default on a node; an edge's line, its own arrow (one marker per colour, no `#` in an id) and its label; one choice over a multi-selection as one undo step, and Mixed; the browser colour input applying on `change` only, also on a mixed selection; the hex field, its refused alpha, its notices and Escape; keyboard only; the step and a Monte Carlo result kept through a colour change, its undo and redo; autosave and reload, Graph JSON export, an invalid file value dropped with the element kept; a share link's codec; the four layers at once on one Register, read from the pixels; a faint colour keeping the structure line; a selected coloured edge over its underlay and a state edge still dashed; Focus mode dimming; forced colours drawing no flow colour; the pinned surface and state colours against the computed tokens of both themes, and no frame token holding a palette value.
- `e2e/flow-colour-mobile.spec.ts` (`mobile` project) — a desktop-set colour renders on the phone; the read-only sheet shows the colour as one line of text with no control: a palette colour's dot, name and hex, another colour's dot and hex, Default with an empty ring, Mixed with no dot.
- `e2e/flow-colour-views.spec.ts` (PR 2) — the minimap marks and the timeline series (lines and legend) of coloured nodes take their colours while every other mark and series keeps its own, Registers stay dashed and an edge colour reaches neither; the run and its CSV are identical with and without colours; under forced colours both views equal the uncoloured graph's, and leaving forced colours brings the colours back; each colour offered once with the current one pressed once; a locked canvas showing the hex field and the colour input disabled, like the Label field, and the swatches with their colour; each of the three Templates opening with exactly its file's colours on the canvas and the minimap.
- `e2e/flow-colour-visual.spec.ts` — baselines of every kind and both edge kinds coloured, light and dark, L2 and L0, and every state at once.
- Every existing baseline whose only difference is the new selection ring or the edge underlay is updated and listed by name in the pull request.
- Not part of the done-when: a manual check of the browser's own colour dialog (it differs by browser and OS and cannot be opened by automation) and a manual screen-reader check.

## FC-9. Decisions

| id | decision |
|---|---|
| D-1 | the stored `#RRGGBB` is drawn unchanged in both themes |
| D-2 | no Blue in the palette; any hex can be entered |
| D-3 | low contrast and closeness to a state colour give a notice, never a block |
| D-4 | chip, wash and L0 dot follow the flow colour, else the kind hue |
| D-5 | the node selection ring moves outside the silhouette; a selected edge gets an underlay; both apply to existing files |
| D-6 | copy and paste is not part of this milestone; #325 records that the product has none |
| D-7 | palette, recent and document swatches, the browser's colour input and a hex field; no built-in grid |
| D-8 | one stored spelling, upper-case `#RRGGBB` |
