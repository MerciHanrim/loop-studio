# The workbench (desktop)

**Status: in progress (2026-10, redesign step 5).** The desktop editing screen
is a workbench: a menu bar, a tool row, a left list, the canvas, a right
panel, an analysis area under the canvas and a status bar. The phone keeps
its own top bar, run bar and sheets ([`mobile.md`](mobile.md)); only the
panel its selection sheet shows is shared with the desktop (§WB6).

This supersedes the two-tier toolbar's structure in
[`toolbar-responsive.md`](toolbar-responsive.md) §TR1–§TR3. That document's
dialog-survival (§TR5), start-up theme and menu keyboard sections still hold.

## WB1. Layout

| Area | Size | Lives in |
| --- | --- | --- |
| Menu bar | 32px tall | `Toolbar.tsx` |
| Tool row | 42px tall | `Toolbar.tsx`, `workbench/toolRowFit.ts` |
| Left list | 272px wide | `workbench/LeftPanel.tsx` |
| Right panel | 344px wide | `Inspector.tsx`, `workbench/Relations.tsx` |
| Analysis area | 152px by default, resizable | `TimelineChart.tsx` |
| Status bar | 26px tall | `workbench/StatusBar.tsx` |

The styles are in `src/components/workbench/workbench.css`.

### WB1a. The side panels by width

Decided by Lumi on 2026-10-20 (`workbench/panelLayout.ts`). There are three bands above
the phone layout:

| Window | Model list | Properties |
| --- | --- | --- |
| 1280px and wider | open | open |
| 900–1279px | folded | open |
| below 900px | folded | folded |

- Each panel folds and opens from the status bar: **List** at its start, **Properties**
  at its end. Each is a disclosure (`aria-expanded`, `aria-controls`).
- A choice is kept for the band it was made in. Crossing into another band shows that
  band's defaults again.
- Below 900px an opened panel is an **overlay** over the canvas column, one at a time.
  The focus goes into it, and Escape closes it and returns the focus to its button.
  Clicking the canvas does not close it.
- A selection never opens a panel. An open properties panel shows the new selection.
- The width band, a fold and an open never move or zoom the canvas. The pane changes
  size and the viewport stays.
- A folded panel stays mounted (its search and tab are kept) and hidden.

Measured with a 23-node template (2026-10-20): the canvas is 800px wide at 800px,
680px at 1024px, 664px at 1280px and 824px at 1440px.

**Device scope (an opinion, not yet a decision, Hanrim and Lumi, 2026-10-20).**
The desktop and laptop are the main environment. A tablet is a secondary one, which must
really work by touch (select, move, connect, edit properties) in landscape and portrait.
The phone is not promised full editing; whether a view-only phone layout stays is decided
separately. The phone code is not removed meanwhile.

## WB2. Menus

The menu bar reads: File · Edit · View · Insert · Data · Run · Help, with
Share at the far end.

| Menu | Holds |
| --- | --- |
| File | New, Import; Templates ▸ and Export ▸ (two submenus, §WB2.2); the two structure rows (save a selected structure, insert a saved one); Set the export author…, Storage & privacy… |
| Edit | Undo, Redo, Tidy to grid, the two frame clear actions, Edit lock (a check item) |
| View | Theme, Language, Focus, Filters, Activity overlay, Reset view |
| Insert | The eight node kinds, Group frame, Suggest frames |
| Data | The spreadsheet import (unchanged) |
| Run | Play / Pause, Step, Reset to step 0, Monte Carlo… |
| Help | Unchanged |

A check row (View's toggles, Edit lock) reads "mark | name" on one
line. The mark keeps its column when it is off, so the name starts at the
same place on and off.

View stays open across Focus and Activity overlay. Filters opens a panel on
the canvas, so it closes View, which would cover the panel; from the keyboard,
focus goes to the panel's first checkbox when it opens and back to View when
it closes. Reset view closes View too.

There is no Values table and no Notation entry. A Notation entry is added
only if the contextual help really explains the symbols and lines. The V / H
shortcuts are on hold.

### WB2.1 No minimap

The graph minimap, its restore button at the canvas's bottom-right corner
and View ▸ Minimap were removed in v0.30.0. On a whole fit it showed the
graph a second time as unnamed marks and covered part of the canvas; the
whole diagram is reached with Reset view and the status bar's Fit, and any
part of it by panning and zooming, which are unchanged.

A browser that ran an earlier version may still hold the minimap's choice
under `loop-studio:minimap-collapsed`. It is a retired key
(`RETIRED_STORAGE_KEYS` in `src/storage/storagePort.ts`): nothing reads it,
starting the app and reading a document are unaffected
(`e2e/minimap-removed.spec.ts`), and "Reset all Loop Studio data…" removes
it (`src/storage/storagePort.test.ts`). React Flow stays the
canvas, so its licence notice and its on-canvas attribution stay too.

### WB2.2 File and its two submenus

File's rows are names on one line, in four groups: New, Import | Templates ›,
Export › | Save selected structure…, Insert saved structure… | Set the export
author…, Storage & privacy…. Templates holds the eight Templates (the same
order as before, no groups; Early MMO is back after Coffee since 0.30.0). Export holds Graph JSON, Workspace JSON, Project
revision and Make a proposal. Set the export author… is a row of File's own
settings group, not an export format. What each row does is unchanged.

**The description area.** File and each submenu end in one description area
(`DescribedMenu.tsx`). It shows the description of the row under the
pointer, else of the row that has focus. A row without a description shows
none, never the previous row's. With no current row it reads "Select an item
to see its description". Every description is laid out in the area at once,
all but the current one hidden, so the area is as tall as the longest and
does not change height from row to row. There is no line clamp: past its cap
(30% of the window's height) the area scrolls. When the window is short, the
area gives way first, down to two lines, and only then do the rows scroll; a
submenu is capped at the window's height.

Each row is described by its own description (`aria-describedby`), read when
the row takes focus. Pointing at a row changes only what is drawn: focus
does not move and the area is no live region, so moving the pointer makes a
screen reader say nothing.

**A row that is off** says why in a short line under its name, which is
part of its description; its name stays its name: Make a proposal ("Export a
Project revision first", while no project is open) and Insert saved
structure… ("Unavailable while editing is locked"). The keyboard never lands
on a row that is off, so that line is how the keyboard and a screen reader
learn it; it is not a colour or a tooltip only.

**Opening and closing.** A submenu opens on a click on its row. There is no
hover timer and no close delay. Its row carries `aria-haspopup="menu"` and
`aria-expanded`, and stays marked while the submenu is open. One submenu is
open at a time. A click on its row again closes it; a click outside File
closes both.

| Where | Key | What happens |
| --- | --- | --- |
| A submenu's row | Arrow Right, Enter, Space | Opens it, focus on its first row |
| File | Arrow Down / Up, Home / End | As every menu (disabled rows skipped, wrapping) |
| A submenu | Arrow Down / Up, Home / End | The same, inside the submenu |
| A submenu | Arrow Left, Escape | Closes the submenu alone; focus back on its row |
| File, no submenu open | Escape | Closes File; focus back on File's button |
| Anywhere in File | Tab, Shift+Tab | Closes File and moves on from File's button |
| A row | Enter, Space | Runs it |

Focus moving to another of File's rows closes an open submenu. A choice
that opens a dialog (a Template's replace confirmation, Workspace JSON,
Project revision) gives focus to the dialog, which returns it to File's
button. A choice that opens none (a Template into an empty document, Graph
JSON) returns focus to File's button.

**Touch.** The two steps belong to the rows of the two submenus only, the
Templates and the export formats: there the choice is between options whose
descriptions are read before running one. A press on such a row selects it
and shows its description with an explicit Open (a Template) or Export (a
format) button, which runs it; a second press on the same row does not run
it. File's own rows (New, Import, Save selected structure…, Insert saved
structure…, Set the export author…, Storage & privacy…) run on a press, as
before, and a press on Templates › or Export › opens or closes its submenu.
A mouse click, Enter or Space runs any row at once; so does a screen
reader's activation, which has read the description already.

**Where a submenu goes.** Beside File at its inline end (the right, in
English and Korean), its first row level with its row; on the left when the
right has no room (File inside `⋯`, at the bar's end); then moved up as far
as it runs past the window's bottom. Measured at 1280 × 800, 1024 × 600, in
`⋯`, and by touch at 1024 × 768 and 768 × 1024
(`e2e/file-menu-submenus.spec.ts`, `e2e/workbench-menus.spec.ts`,
`e2e/toolbar-responsive.spec.ts`).

The menus open from their trigger's start, inside the window (`⋯`, at the bar's
end, keeps the end anchor). File and its submenus are the wide popover
(300px). A popover taller than the window scrolls, and the keyboard reaches its last
row: End, or ArrowUp from the closed trigger, scrolls it into view
(`e2e/workbench-menus.spec.ts`, at 1280 × 800 and 1024 × 600).

When the bar runs out of width, groups move into the `⋯` overflow menu in
`OVERFLOW_ORDER` (`toolbarOverflow.ts`): help, run, insert, view, edit, data,
file, share. The render order stays `GROUP_ORDER`: file, edit, view, insert,
data, run, help, share.

## WB3. Tool row

From the start of the row:

- The canvas tools: Select, Pan, Select a region, Group frame. Exactly one is
  on at a time (`workbench/canvasTools.ts`).
- Undo, Redo.
- Add: the eight node kinds. A click adds the node at the centre of the view;
  a drag places it.
- Connect: the connection kind (§WB4).
- Edit lock, at the end.

**Pressed state.** A pressed tool, the chosen connection kind, the status bar's Focus
and an open panel's button use the theme's selection role: the `--sel-soft` tint, the
`--sel` text, and a 2px inset ring in `--sel`. That is #335's tell, which is at least 3:1
against the unpressed button (`e2e/lock-control.spec.ts`, light and dark). The keyboard
focus keeps its own `--focus` outline over it. In forced colours the pair is
Highlight / HighlightText.

**Fit.** A row too narrow for its words gives up words, never buttons
(`toolRowFit.ts`). Each step hides more visible text. Every control keeps its
accessible name and its tooltip.

| Step | Hidden |
| --- | --- |
| 1 | The node kinds' names and the "Add" caption (the kinds show as their symbols) |
| 2 | Also the "Connect" caption and the Edit lock's word |
| 3 | Also the connection kinds' words (their line samples remain) |

The step is the first one that fits, measured on the row itself. A fixed
breakpoint can't work because the words' widths depend on the language.
Past step 3 the row scrolls.

Two different claims, checked apart (Lumi, 2026-10-20): that every button
**fits** at a width (the table below), and that a step's symbols and line
samples are **identifiable** without their words. The second is a visual
judgement, part of the final review at the narrow widths.

Measured on 2026-10-19 (dev build, empty document), and again on 2026-10-20 with the
tool row's icons at 14px (the same steps at every width):

| Width | ko | en |
| ---: | ---: | ---: |
| 1920 | 0 | 0 |
| 1600 | 0 | 0 |
| 1440 | 0 | 1 |
| 1366 | 0 | 1 |
| 1280 | 1 | 1 |
| 1024 | 1 | 2 |
| 900 | 2 | 3 |

## WB4. Connection kind

The Connect group picks the kind that every new connection takes: a drag
from a port, or a click from one port to another. The port decides only
where the connection attaches (`src/model/connectKind.ts`).

| Kind (en / ko) | Model |
| --- | --- |
| Flow / 흐름 | a resource connection |
| Condition / 조건 | a state connection that gates its target |
| Value change / 값 변경 | a state connection that changes a Pool's value |
| Trigger / 작동 | a state connection that fires its target ("작동" is provisional) |

The words Resource and State don't appear in the interface.

- A drawing the chosen kind can't make is refused, and the status bar says
  why. It never switches silently to another kind. The reasons are
  `connect.refused.*` (`src/components/connectReason.ts`).
- Changing a connection's kind (right panel, More settings) goes through
  `graphStore.setEdgeKind`. It updates the handles together, keeps the
  route, bends, colour and faces, and is one undo step. A refusal is shown
  in place. It is judged by the drawing rules on the connection as it would
  be, with the connection itself left out. "Already connected" is the
  drawing rule on the stored handles (`duplicateOf`), so a change between
  the state kinds, which keeps the handles, is never a repeat: two parallel
  state connections can each change. A change between Flow and a state kind
  is refused only when another connection already uses the new handles
  between the same two nodes.
- The chosen kind is screen state, held in memory until the page reloads
  (default Flow). No document or storage key holds it.

## WB5. Left list

Two tabs: Model and Inputs (arrow keys move between them).

- **Model** lists every node, grouped by kind, with a search box. Selecting a
  row selects the node. If the node is already in view, the view doesn't
  move. If it is off-screen, the view makes the smallest move that brings it
  in, at the current zoom (`useReveal`, `ModelPanels.tsx`).
- A row selects exactly as a click on the node does: the store's own
  `select` changes (`selectOnly`, `graphStore.ts`), never React Flow's
  `setNodes`. The canvas's drawn nodes carry display-only state — Focus
  mode's fade class, a filter's `hidden` — and a `setNodes` replace wrote it
  into the document's nodes (2026-10-20: under Focus a node picked from the
  list stayed faded, also after Focus was turned off). The phone selection
  sheet's Close clears the selection the same way.
  `e2e/workbench-left-list.spec.ts` checks A → B under Focus, Focus off, a
  list pick against a canvas click, and an off-screen pick.
- A multiple selection marks every row it holds with the selection's tint
  (`is-in-sel`). The representative keeps the bar (`is-sel`): the node the
  right panel shows, the store's `selectedNodeId`, which is the first selected
  node in the document's node order (`Canvas.tsx`, `onSelectionChange`), not
  the last one clicked. Under forced colours the tint is dropped, so the
  representative is filled with Highlight and each other selected row has its
  own 4 px Highlight bar at the start edge, 3 px short of the row's top and
  bottom so that neighbouring bars stay apart. A single selection looks as
  before. Ctrl+click in the list and a count of selected rows out of view are
  not part of this.
- A screen reader hears the same: every selected row is `aria-pressed`, and in
  a multiple selection the representative is described as "Shown in
  Properties" (`aria-describedby`, a hidden text in the list), its name
  unchanged. A single selection has one pressed row and no such description.
- Each kind's heading stays at the list's top while that kind's rows scroll
  under it. At the group's end, the next kind's heading pushes it out
  (`workbench.css`, `.wb-list__sub`, sticky at -4 px to meet the list's top
  padding). The list's `scroll-padding-top` is the heading's height (26 px),
  so a row the browser scrolls into view lands below the heading.
- The list follows a single node chosen elsewhere, such as a canvas click.
  If that node's row is outside the list's view, the list alone scrolls by the
  smallest amount that shows the row whole (`LeftPanel.tsx`). A row under the
  stuck heading counts as outside: the top's inset is the list's
  `scroll-padding-top`. Before 2026-10-27 the row stayed out of sight. Three
  cases are left alone:
  - A row picked in the list, even one cut by the list's edge.
  - A multiple selection, since there is no one row to follow.
  - A row the search hides.

  Tab only moves focus, and the browser scrolls the focused row into view.
  `e2e/workbench-left-list.spec.ts` checks rows below and above the view
  (above: just below the stuck heading), a row already in view, a partly cut
  row picked in the list, a multiple selection, the heading in view and its
  swap, and rows reached by Tab clear of the heading.
- **Inputs** holds the Parameter and Register panels that used to sit in the
  right column ([`parameter-inputs.md`](parameter-inputs.md)).

## WB6. Right panel

Three layers, in this order:

1. **Relation.** For a node: its connections, grouped by what they do to it
   and what it does to others. Each row selects its connection, and
   pointing at a row highlights its line. For a connection: one sentence
   saying when it acts and what happens, plus links to both ends.
2. **Edit.** The fields most edits need: a node's name and its kind's main
   values (a Pool's starting amount, current amount and capacity; a Gate's
   distribution; a Parameter's value; a Register's expression), a
   connection's amount, condition or change. A kind with no main value but
   its name (Source, Drain, Converter, End) shows only the name here; its
   settings follow under More settings.
3. **More settings** (folded). For a node: the flow mode (Pool, Source,
   Drain, Converter), a Pool's resource type, activation and accent colour.
   For a connection: its kind, label timing, resource type, route, ends,
   note and accent colour.

A resource-type mismatch is a finding, not a setting. It stays in view
between the editing fields and More settings, with a "Go to Resource type"
button that unfolds More settings and puts the caret in the field
(Lumi, 2026-10-20).

**A probabilistic Gate's chances (Lumi, 2026-10-20).** A probabilistic Gate's
outgoing rows read result · weight · chance, under the lead "Picks one result
by weight." and over "chance = weight ÷ the sum, N"; each of its connections
adds the same figure under its sentence ("Chance 6 ÷ 1,000 = 0.6% · of Roll's
weights in total"). The figures are read from the document by the engine's
own rules (`src/engine/gateChance.ts`, whose flow reading and router-cycle
order `step.ts` itself uses): the same lines, each flow as the weight the draw
reads (`@id` ⇒ the Parameter's value in a v2 document, `all` ⇒ 1, `n%` ⇒
n / 100), one branch per arrival by weight ÷ the sum. Nothing is drawn and no
run state is read or changed. What a static reading cannot fix is said, not
estimated: a random weight (`1-3`, `2D6`) or a line on a loop of Gates or
Converters with no Pool between them makes every chance "At run time"; weights
that sum to 0 say the Gate sends nothing (the engine's draw takes no branch).
A fixed weight is never negative or non-finite (the flow reading makes it a
number ≥ 0), so there is no "invalid weight" case to show. A chance above 0
that rounds to 0 at one decimal reads "< 0.1%".

On the phone the sheet shows the same panel, with More settings as a plain
heading and its fields open: nothing is folded away there. The fold's state
   is held in memory until the page reloads, across selections.

## WB7. Analysis area

The playback strip (run controls, Speed, Seed, Monte Carlo) and the
timeline sit under the canvas. The strip is **one row at every desktop width**
(Lumi, 2026-10-20; `PlayBar.tsx` `fitRunRow`). Reset, Step, Play, the current step
and the run's state beside it ("Steady state — flows continue") always stay: the run's
state comes before its settings. The state keeps its room while it is not shown, so it
moves nothing when it appears. Short of room the row folds, in steps, what has another
way in:

1. the Monte Carlo button (Run ▸ Monte Carlo… opens the same dialog; a run in progress
   keeps its progress and Cancel in the row),
2. then Speed and Seed, which fold into **Run settings**: a popover over its button
   (pulled in where the row's end is near) holding the same two inputs, closed with
   Escape or a click outside; under a right-to-left reader the pair keeps its physical
   order, as the row does (docs/localization.md §L9.3),
3. last, the state's text may shorten (an ellipsis, the whole text on its tooltip).

Measured 2026-10-20 (default panels): at 1440, 1600 and 1920 the row keeps everything;
at 1024 and 1280 it takes step 2, idle or running alike, because the state's room is
kept.

The step is the first that fits, measured on the row's children (not with `scrollWidth`,
which misses a right-to-left row's overflow) after every render, so an ended run's longer
text never wraps the row. The phone's run bar (`.pstrip--mobile`) keeps wrapping as
before. A splitter (`role="separator"`, pointer or
arrow keys in 16px steps) sets the height: at least 96px, and the canvas
keeps at least 160px. The default height is 152px; the Distribution view's least is
280px (the area rises to it on entering the view and returns on leaving it). The collapsed / expanded
rule is [`timeline-series-contract.md`](timeline-series-contract.md) §7.

## WB8. Status bar

From the start: the List toggle (§WB1a), the node and connection counts, the last
refused connection's reason (`role="status"`), then at the end Focus, zoom out, the zoom
level, zoom in, Fit the whole diagram (`useFitAll.ts`, shared with View ▸ Reset view), and
the Properties toggle.

**The zoom-out limit (2026-10-20).** The default limit for a hand (the wheel, a pinch,
zoom out) is 0.2. It is not fixed: for a diagram too large to fit the canvas at 0.2, the
limit extends down to just under the zoom that fits the whole diagram, computed from the
diagram's size and the canvas's, and recomputed when either changes (`Canvas.tsx`
`zoomFloor`: the same 0.3 padding as the fit, never below the saved view's 0.05). So Fit
always shows the whole diagram, and zooming out by hand stops near that fit. Measured at 1280 × 800 with the default panels: the Early MMO's Fit went from
0.2, with 67 of 97 nodes on the canvas, to 0.111 with all 97 nodes and names; the hand
stops at 0.109. Coffee, which fits at 0.364, keeps 0.2. Names are not enlarged
(§VL7.2) and no panel folds.

A template's opening view and an import's framing reserve no band on the left for the
canvas rail the desktop no longer has (`canvasFitInsets`; the phone's rail keeps its
44px).

## WB9. Verification

In progress. The e2e specs that read the old toolbar, Settings menu or right
column are being classified one failure at a time. The results go here when
the classification is done.

Shared helpers for the specs:

- `e2e/support/panel.ts`: `openPanelDetails` (More settings, as a user
  opens it) and `WORKBENCH_ROOMY_VIEWPORT` (1600 × 940). The second is for
  specs whose fixtures were placed for the two-tier bar's 980 px canvas.
- `e2e/support/workbenchMenus.ts`: File ▸ Templates, View, and the language
  switch, desktop and phone.
- `e2e/support/edgePoint.ts`: a point of a connection's line that the
  pointer really reaches, since a frame's border strip takes a click there
  ([`edge-routing.md`](edge-routing.md), recorded separately).
