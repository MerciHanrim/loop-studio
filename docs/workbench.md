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
| Analysis area | its least height by default (the chart at 140px), resizable | `TimelineChart.tsx` |
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

### WB1b. The observation view

**Decided** (#538, Hanrim and Lumi, 2026-11-10). One toggle hides both side panels and the
tool row, so the canvas and the analysis area take the window while a run is watched. The
menu bar, the run row (Reset, Step, Play, speed, the run guide line and the run notices),
the Timeline and the status bar stay.

- **Ways in.** The run row's "Observation view" toggle (`aria-pressed`), after Play, and
  View ▸ Observation view, which is always there. The run row folds the toggle at its fit
  step 3, after the Monte Carlo button and the run settings and before the steady-state text
  shortens (`PlayBar.tsx` `fitRunRow`): at 900 px with the properties panel open the row has
  no room for it in any of the 18 languages. In the view the row has room and the toggle
  comes back.
- **Ways out.** A second press, View ▸ Observation view, Esc, or a status-bar panel toggle,
  which also opens its panel. Esc goes to whatever is open on top first: a menu, a dialog or
  sheet, the run-settings popover. Only the next Esc leaves the view.
- **The canvas.** The zoom stays, and the model point at the pane's centre before the switch
  is at its centre after it. The drawing is not enlarged; Fit in the status bar does that.
  Leaving puts the saved viewport back exactly.
- **The panels.** The view never writes the panels' per-band choice (§WB1a); it hides them
  while on, so leaving restores the choice as it was by construction.
- **The run.** Screen state only: the simulation is not touched, so Play keeps running across
  the switch, and nothing is saved to the document or to storage.
- **Focus.** Focus never stays on what the view hides. Entering with focus in a panel or the
  tool row moves it to the toggle. Entering from View moves it to the toggle when the toggle
  is shown, else back to View. Leaving at a width where the row folds the toggle moves focus
  from the toggle to View.
- **The phone** has no side panels or tool row: no toggle, no View row, and the view ends if
  the window narrows to the phone layout.

## WB2. Menus

The menu bar reads: File · Edit · View · Insert · Data · Run · Help, with
Share at the far end.

| Menu | Holds |
| --- | --- |
| File | New, Import; Templates ▸ and Export ▸ (two submenus, §WB2.2); the two structure rows (save a selected structure, insert a saved one); Set the export author…, Storage & privacy… |
| Edit | Undo, Redo, Tidy to grid, the two frame clear actions, Edit lock (a check item) |
| View | Theme, Language, Focus, Filters, Activity overlay, Observation view (§WB1b), Reset view |
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
it closes. Reset view closes View too. Observation view closes View and puts focus on the run
row's toggle when it is shown, else back on View (§WB1b).

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
author…, Storage & privacy…. Templates holds the eight Templates (Early MMO is back since 0.30.0; Balanced production line and Capacity deadlock left the menu on 2026-11-07, and their files and checks stay; the coffee roasting batch joined on 2026-11-14). Since #545 (Hanrim and Lumi, 2026-11-10) the five game examples are a group: the submenu lists the process and industry Templates (desalination, coffee roasting batch, coffee roastery), then **Games ›**, described, which turns the submenu's rows into the game Templates (MMO, then the four gacha) under a **‹ Templates** row that turns them back. The phone's Templates sheet does the same inside its sheet. Going in, by a click, Enter, Space or Arrow Right on Games, puts focus on the first game; going back, by the back row, Escape or Arrow Left, puts it on Games. The row chosen is replaced either way, so focus moves with it. In the group the first Escape goes back to the Templates and the next closes the submenu, as before. Each Template's own row, its description and its Open are unchanged, and a Template's group (`group: 'games'` in `templates.ts`) is where it is listed, never what it holds. Help ▸ Example notes lists the game notes under a "Games" heading (a named group), after the others. On the phone each Template is a full-width row, its name on its own line and its description under it. Export holds Graph JSON, Workspace JSON, Project
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
- The list is the containing block of its rows' hidden text (`.wb-list` is
  `position: relative`). A row's heard comma between name and value is an
  absolutely positioned `.sr-only` span; with the list static, those spans
  escaped its clip to `.app__body` and a list longer than the window made the
  page itself scrollable (2026-10-30, the MMO example at 1920 × 1080: a wheel
  over the right panel, which had nothing to scroll, left the menu bar off the
  top). `e2e/workbench-left-list.spec.ts` checks the document's height against
  the window's after a wheel over each side.
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
- **Saved frames** (#499) open the Model list, when the document has any, one row
  per frame.
  - **Order:** stored order, which is the order the author made them. Titles are
    not sorted, because a number in a title is the author's text.
  - **Which frames:** a saved frame. A suggested frame is a session proposal, and
    it joins the list when it is promoted.
  - **A row goes to the frame.** It fits the view to the frame, title included,
    and centres it across when it is narrower than the pane. Nothing else moves:
    it selects nothing, opens nothing and leaves no undo entry. So it works under
    the edit lock, and Fit is the way back to the whole.
  - **Zoom:** the whole fit's range, up to 1.2 and down to the canvas's floor, so
    a small frame stops at 120 %, not 100 %.
  - **Keyboard:** a row is a button, in the list's Tab order. Enter or Space goes
    to the frame, and focus stays on the row.
  - **Find** filters these rows by name as it does nodes. The count beside the list
    heading stays a count of nodes.
  - The left panel is not on a phone, so neither is this list. While the panel
    is an overlay, the fit takes the whole pane, so the overlay can cover part of
    the frame until it is closed.

  `e2e/frame-list.spec.ts` checks the order, the fit, the lock, the keyboard and
  Find. `src/components/canvasFit.test.ts` holds the fit's numbers.
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
3. then the Observation view toggle (#538; View ▸ Observation view is always there, and in
   the view the row has room for the toggle again, §WB1b),
4. last, the state's text may shorten (an ellipsis, the whole text on its tooltip).

Measured 2026-10-20 (default panels): at 1440, 1600 and 1920 the row keeps everything;
at 1024 and 1280 it takes step 2, idle or running alike, because the state's room is
kept.

The step is the first that fits, measured on the row's children (not with `scrollWidth`,
which misses a right-to-left row's overflow) after every render, so an ended run's longer
text never wraps the row. The phone's run bar (`.pstrip--mobile`) keeps wrapping as
before. A splitter (`role="separator"`, pointer or
arrow keys in 16px steps) sets the height, and the canvas
keeps at least 160px. The area opens at its least height (below); the Distribution view's least is
280px (the area rises to it on entering the view and returns on leaving it). The collapsed / expanded
rule is [`timeline-series-contract.md`](timeline-series-contract.md) §7.

**The area's least height** (#534, Lumi, 2026-11-08) is what it must show: the splitter,
the run row, the run guide's line when it shows (#537: an auto-play pause or the checked-range note, `.pstrip-guide`), one notice row when the run has notices, the panel's head, the chart at
**140px** (`PLOT_MIN`) and one strip when there is one strip (two or more are a tab of their own, below; `TimelineChart.tsx`, measured
from the page, because the run row wraps in a narrow window or a long language). It is
never under 96px, and never so tall that the canvas falls under its 160px. Short of room,
the notices and the strips give way first, each down to one row or one strip, and scroll
inside; the chart keeps its 140px, so its axis labels stay apart. The one notice row
ends where the first notice's first line ends (measured, as a fallback font can make a
line taller), and the list has no bottom padding there, so no part of the next line
shows, a wrapped notice's second line included; scrolling shows the rest. When notices
or a strip appear, an area under its least rises to it; with one strip the area still
rises to the earlier comfortable height (280px), and two or more strips are tabs (below).

Measured 2026-11-08 on the desalination Template, at the least: 216px with no notices or
strips, 272px with strips, 309px with strips and notices (1920px wide). The cost is the
canvas: at a 600px window it keeps 191px, and the drawing fits at
about 20% zoom. The area also opens at its least height, 64px over the earlier 152px
default, so the canvas gives up that room at every window. A drawing fitted near a level
of detail can fall under it: the gacha Pickup Template at a 1440 × 900 window fits at zoom
0.413, under the 0.45 from which connection labels and value chips are drawn (0.458
before), so they show once the canvas is zoomed in. That is the price of the
chart's least height, kept on purpose; the collapse gives the canvas its room back.

**Tabs for two or more strips** (#538, Hanrim and Lumi, 2026-11-10). A document with two
or more strips (timetable rates and run rules together) shows the pools' chart and the
strips as two tabs, **Pools** and **Timetables and run rules**, after the "Timeline"
heading. Both tabs share one area. Its least height is the one above without the strip:
216px with nothing over the chart, and only the run guide line and the notices raise it.
A tab switch never changes it, and nothing raises the area for strips. On the strips tab:

- one strip shows, picked from a **Chart** list in that tab (by id, so the pick survives
  a switch and an edit, and a strip that is gone falls back to the first);
- the chart and its step reading are hidden;
- the legend's chips give way but keep their room, so Series and CSV do not move;
- the CSV is the same file from either tab;
- the pinned step is kept, and the picked strip reads it while the pointer is elsewhere:
  - the strip draws the pinned step's guide, as the chart's pin line is drawn;
  - its values are shown in the reader's wording (`timeline.run.at`, `timeline.rate.at`, or an available table's own reading);
  - a status line says the reading once for a screen reader, the pinned step's, never the pointer's;
- the strip takes the chart's step keys: Left, Right, Home and End move the pinned step, Escape lets it go, and the Pools tab reads the step it moved to (Lumi's review of #546).

The tabs are a tablist: one Tab stop on the chosen tab, and Left, Right, Home and End move
and choose. Both panels stay in the document, each a `tabpanel` named by its tab
(`aria-labelledby`) and named by that tab's `aria-controls`: the chart in its own panel,
the strips in theirs. The panel not chosen is `hidden`, so it takes no height and has no
Tab stop, and it is not in the accessibility tree (Lumi's review of #546). One strip stays under the chart, with no tabs, as above. The phone's sheet keeps
its stacked strips. The Live / Distribution switch is a separate control, and the tabs are
not shown in the Distribution view.

Measured on the prototype, 2026-11-10 (the desalination Template, en, ko, de and ru, at
1920, 1280 and 1024 px): the area is 216px with the chart at 140px on both tabs, and the
height changes by 0px across a switch in all 34 readings. At a 1920 × 600 window the
canvas goes from 164px (stacked strips) to 284px. With the #537 line and notices, the area
rises by 61px, or by 77px when the line wraps; the chart keeps 140px and the picked strip
is whole.

**The end labels keep clear of the step label.** The lowest end label (and "+N") is
centred at most 6px above the x axis (`END_LABEL_CLEAR`), so its box ends above the
"step N" label under the chart's right end. Centred on the axis, it had overlapped that
label by 4px (the MMO Template's Deaths at step 30, at the 140px floor). The test checks
every end label against the axis labels and the other end labels on five Templates.

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
