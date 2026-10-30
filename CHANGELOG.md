# Changelog

All notable Loop Studio releases, newest first. Behavioral changes are pinned
in versioned spec documents (see the [README](README.md#technical-reference));
this file is the narrative history, not the contract. What has not shipped in
a release yet is under **Unreleased** ([`docs/release-notes.md`](docs/release-notes.md)).

## Unreleased

- **The export-author dialog shows the current session's name.** After switching from a temporary session to this browser, File ▸ Set the export author… opened with empty fields although the browser held a name, and pressing Save without typing deleted that name; after switching to a temporary session it still showed the browser's name. The dialog now reads the stored author each time it opens, so it shows what the current session holds (nothing in a temporary session), an untouched Save changes nothing, and a Save in a temporary session never reaches the browser's record. Text you are typing is never replaced while the dialog is open.
- **A saved Monte Carlo distribution is no longer shown as current when a Parameter's value was changed in the Workspace file.** Since Parameters became simulation inputs (a connection's amount written as `@p`), a Workspace whose Parameter value was edited outside the app, or whose results block was moved onto a sibling file with another value, imported its distribution as current although the simulation now moves a different amount. The file check now sees the value: such a result loads marked "graph changed" with Export disabled, and a new run clears it. One-time effect: a Workspace saved before this release whose diagram has a Parameter shows its saved distribution as "graph changed" once on import; re-run to refresh. Files without a Parameter are unaffected.
- **Dragging a node is one Undo step, however long you pause.** If you held a node still for more than about half a second during a drag and then kept moving, Undo took the node back only to where you paused, and a second Undo finished the job. A drag now counts from press to release: one Undo returns the node (or every node of a selection) to where the drag started, a drag that ends where it began leaves nothing to undo, and Redo puts it back at the drop.
- **The Early MMO example opens editable.** It used to open with the edit lock on, so the first change you tried in the Properties panel was refused until you found the lock button in the tool row. It now opens like the other examples; the lock button still locks and unlocks any document, and a file you saved while locked still opens locked. The 3-zone gacha banner comparison keeps opening locked, by its own design.
- **A Monte Carlo result is marked "graph changed" on arrival when you edited the diagram during the run.** The run still finishes and shows the distribution of the diagram as it was when the run started; before, that result came in as current, with Export enabled, although the diagram no longer matched it. Now it arrives with the same tag and disabled Export that an edit after a run produces, and a new run at the current diagram clears the tag.
- **A Pool's Starting amount above its Capacity stops the run instead of being cut down in silence.** Such a Pool used to show the amount you typed at step 0 and the capacity from step 1, with no connection or notice to explain the drop, in the Timeline and Monte Carlo too. Now the run strip refuses to start and names the Pool with both numbers ("initial 20, capacity 10"); the document keeps what you typed, and the run works again once either field is changed. A file saved with such a pair loads unchanged and is refused the same way.
- **The page no longer scrolls under the app.** When the model list was longer than the window — the Early MMO example in a tall window — a mouse wheel over the Properties panel scrolled the whole page: the menu bar left the top and empty space opened below the status bar, until Ctrl+Home. The list's screen-reader separators (the heard comma between a name and its value) reached past the list; the list now contains them, and only the list scrolls.
- **Parameter fields: type a negative or long number freely.** In the Properties panel's Value, Min, Max and Step fields of a Parameter, and in the Inputs list's value field, what you type now stays in the field until it is a number; before, each keystroke was stored at once, so a leading minus sign became 0 and a value too large to hold (such as 1e400) made the Parameter unreadable until Undo. An unfinished entry is dropped when you leave the field; the stored value changes only when the text is a number.
- **Properties panel: "Connections that use this value" lists exactly the connections that read the Parameter.** The rows are found by reading each connection's amount or condition the way the simulation does; before, they were found by text, so a Parameter whose id is the start of another's (`@a` and `@ab`) listed the other's connections too, and a reference written as `@{id}` was not listed at all.
- **Keyboard shortcuts stop at a dialog.** While a dialog is open — About, Monte Carlo, the data-import wizard, a frame's properties popover and the others — Ctrl+Z / Ctrl+Y, `f` (Focus) and `[` / `]` (walk the connected nodes) no longer act on the diagram behind it; before, Ctrl+Z undid an edit you could not see and `]` moved the selection. They work again as soon as the dialog closes.
- **Project and file boundaries.** File ▸ New, a Template, a pasted graph, an opened file or share link, and "Delete work data" now also close the open project: the revision chip clears and the next Export starts a new lineage instead of recording the new document as a child of the old project. And a graph file whose node has no id or no position is refused at import with the message "A node in this file has no id or no position."; before, such a file (hand-made or edited outside the app) blanked the canvas and was kept by autosave, so every later start failed the same way.
- **Undo and redo of a frame change keep the run.** Undoing or redoing a frame's rename, colour, resize, move or deletion no longer resets the run to step 0 or marks the Monte Carlo result as out of date; before, it did, although making the change had not. The same now holds for undoing a node move. Undoing a change the simulation reads — a flow, a capacity, a connection — still resets the run, as before.
- **Canvas: clicking a connection's label changes nothing but the selection.** Where another connection's line runs under a label, a click on the label selects the label's connection; before, that click also rewrote the stored port faces of every connection with a chosen face into the canvas's own drawing ids, so the document counted as changed, its export and share link carried the drawing ids, and the lines of several connections could move after the click. Under the edit lock the same click selected nothing. Now the click selects the connection and leaves the document as it was, locked or not.
- **Flow: a dice count has a limit.** A flow such as `2D6` may roll at most 10 000 dice; a larger count (a stray digit, as in `99999999D6`) used to be rolled die by die and froze the tab for the whole run. Such a flow now contributes 0 and the run reports it, as it does for `0D6` or `2D0`.
- **Run: nothing disappears between a Gate, a Converter and the next node.** Four shapes made resource vanish during a step, with the step reporting the upstream node as run and no notice: a Gate or Converter routing into a Gate, Converter, Drain or End that does not run this step (passive, or interactive without a pulse); a Gate fed by another Gate or a Converter and delivering into a Pool with a capacity, where the room set aside for it blocked it; a Converter delivering into a Pool with a capacity where other Converters also deliver, which could leave the Pool over its capacity and lose the excess; and a Converter delivering into a Gate or another Converter, whose output was dropped. In each case the amount now stays in its source Pool or arrives where it was routed. The bundled Templates have none of these shapes, so their runs are unchanged.

## v0.31.0 — 2026-10-29

Eighteen languages again, with Arabic reading right to left in the same layout every language has, and a round of workbench clarity: clearer run buttons, keyboard focus visible on every chosen tool and toggle, and a model list that follows the canvas and marks the whole selection.

- **Eighteen languages again.** Besides English and Korean, the interface is available again in Arabic, Chinese (Simplified and Traditional), Dutch, French, German, Italian, Japanese, Portuguese (Brazil and Portugal), Russian, Spanish (Latin America and Spain), Thai, Turkish and Vietnamese; if you had chosen one of them before, Loop Studio starts in it again. In these languages the text added with the redesign is a translation draft that native speakers have not yet reviewed. Arabic text reads right to left, while the menus, panels and run bar keep the same places as in every other language, and a menu item starts at its row's left, as in every language.
- **Clearer run buttons.** In the run bar, Reset, Step and Play are redrawn and shown at their full size instead of squeezed, so their shapes are crisper; Play (Pause while running, Replay at the end) is filled with the accent colour, so the main action stands out. The buttons keep their place, height and names; in high-contrast mode the main button has a thicker edge. The phone's run bar is unchanged.
- **Model list: selection and keyboard focus both visible.** In the left panel's list, a selected row reached with the keyboard keeps its focus ring next to the selection bar; before, the bar covered the ring. In high-contrast mode a selected row is now shown in the system highlight colour and the keyboard-focused row has its own ring; before, neither showed.
- **Canvas tools: keyboard focus visible on the chosen tool.** In the tool row, Select, Pan, Select a region and Group frame: when the chosen tool has keyboard focus, a dark ring is now drawn inside its pressed ring; before, the focus ring sat on the pressed ring in the same colour and could not be seen, in high-contrast mode too. A tool that is only chosen, or only focused, looks as before.
- **Menus: the keyboard focus ring shown whole.** In the File menu and its submenus, the ring around the row reached with the keyboard was cut off at both sides, and above the first row; it is now drawn just inside the row, so all four sides show. The same applies to the rows of every other menu.
- **Menu bar: the open menu's button stands out.** In the menu bar (File, Edit, View and the others, also inside More), the button of the open menu now takes the menu's own surface and a thin edge, so it reads as that menu's tab; before, it looked the same as a button under the pointer. In high-contrast mode it has a thin outline; before, nothing showed which menu was open.
- **Run bar: the main button keeps its width.** Play, Pause and Replay now share one width, so the run bar no longer shifts when the label changes; before, in Korean, Pause and Replay widened the button and pushed the step count and the rest of the bar to the right.
- **Connection kinds and Focus: keyboard focus visible when chosen.** In the tool row, when the chosen connection kind has keyboard focus, a dark ring is now drawn inside its pressed ring; in the status bar, Focus when on and keyboard-focused takes a dark dashed edge on its pressed ring. Before, the focus ring sat on the pressed ring in the same colour and could not be seen. High-contrast mode is unchanged; a control that is only chosen, or only focused, looks as before.
- **List and Properties toggles: keyboard focus visible when open.** In the status bar, an open List or Properties toggle with keyboard focus now takes a dark dashed edge on its pressed ring, as Focus does; before, the focus ring sat on the pressed ring in the same colour and could not be seen. High-contrast mode is unchanged; a closed toggle, or an open one without focus, looks as before.
- **Run bar: Run settings stays put.** The step count now keeps room for its longest text, so Run settings and the steady-state note no longer move right as the step count grows or when the run ends; before, they moved by up to about 80 px. Where the run bar is tight (about 900 px wide), the steady-state note now reads "Steady" (Korean "흐름 계속") instead of being cut off; its tooltip and the screen reader keep the whole text.
- **Canvas tools: keyboard focus told apart from the chosen tool.** In the tool row, Select, Pan, Select a region and Group frame: a tool that has keyboard focus but is not chosen now has a dashed ring; the chosen tool keeps its solid ring. Before, both rings were the same, so the chosen tool and the focused one looked alike, above all in the dark theme. High-contrast mode, and a chosen tool with keyboard focus, look as before.
- **Model list: follows a node chosen on the canvas.** When you select a single node on the canvas and its row in the left panel's list is out of sight, the list now scrolls just far enough to show it; before, the selected row stayed hidden. Picking a row in the list, moving through it with Tab, and selecting several nodes leave the list where it is.
- **Model list: the kind heading stays in view.** In the left panel's list, the heading of the kind you are scrolling through (Parameter, Pool, Gate and the others) now stays at the top of the list until the next kind's heading takes its place, so in a long list you can tell which kind you are looking at. A row reached with Tab, or brought into view by a selection on the canvas, shows whole below the heading.
- **Model list: every selected node marked.** When several nodes are selected on the canvas, each of their rows in the left panel's list now shows the selection colour; the row of the node shown in the right panel keeps its bar. Before, only that one row was marked. In high-contrast mode the right panel's node is filled and the other selected rows each have a short bar. A single selection looks as before.
- **Model list: a multiple selection heard in full.** With several nodes selected, a screen reader now hears every selected row in the left panel's list as pressed, and the row of the node shown in the right panel also as "Shown in Properties" (Korean "속성에 표시됨"). Before, only that one row was heard as pressed. A single selection sounds as before.
- **View ▸ Filters closes the menu.** Choosing Filters in the View menu now closes the menu, so it no longer covers the filter panel it opened. With the keyboard, focus moves to the panel's first checkbox, and back to View when the panel is closed.
- **Select a region: a drag can start on a connection or a frame's name.** With the Select a region tool on, a drag that starts on a connection or on a frame's name now draws the selection box, as one from the empty canvas does. Before, it did nothing and the tool stayed on. A click there still selects the connection or opens the frame's properties, and a drag on a node or a frame's border still moves it.

## v0.30.1 — 2026-10-25

The workbench and the automatic lines, tidied: values in the model list, larger small text in the run bar and the timeline, no stray text selection in the bars, and fewer steps, hooks and cramped arrowheads in automatic lines.

- **A short value in the model list is shown whole.** Beside a long name, a short value such as 10 or 200 was cut short too (2… or 1…), because the name and the value gave way together. The name now gives way first; only a value wider than a third of the row is cut short, and the row's name and the value's tooltip still read it whole.
- **Values in the model list, clearer groups, larger small text.** The model list shows each Parameter's value and each Pool's value (its start value, or the run's value while it runs) at the end of its row; a long value is cut short there, and the row's name still reads it whole. Each kind's heading (Parameters, Sources, Pools…) is bold with its count at the end, and the groups have a little space between them. With the timeline hidden, its button in the run bar reads Timeline, and New results once the run has moved on since it was hidden; the timeline still opens only when you open it. The run bar's and the timeline's smallest labels (Speed, Seed, Timeline, CSV, Live / Distribution) are larger, their small buttons are one height, and a canvas hint's close button is easier to press. The strip that holds a canvas hint under the tool row is a little thinner.
- **No stray text selection in the bars, no frame round the first screen's title.** A drag that starts between the menus, on a tool-row label such as Connect, or on the status bar no longer selects their words, which a canvas click could not clear; panels, menus, fields and help text select as before. Clicking the title of the first screen (Before Loop Studio opens) no longer draws a focus frame round it; Tab still shows the focus on its buttons and boxes.
- **Fewer steps and hooks in automatic lines.** Dashed lines on different sides of one node were wrongly routed as one bundle, which gave them small steps or hooks next to the node; they are now routed per side, so those steps and hooks are reduced. A node where one side has a dashed line coming in and one going out keeps the earlier bundling. A line whose first bend point sits right by its port now leaves straight to it. Not every automatic-line problem is solved: a line leaving a node's bottom can still go round that node's own name when all four sides of the node have connections, and one pickup-gacha line keeps a detour.
- **Room for the arrowhead, and bend points by a port kept on the line.** When a line's last bend point was on the short stretch just before the node it points to, closer than the arrowhead's size, the line turned there and drew a very short end: the arrowhead covered the corner and could read as coming in from the side (the General gacha Template's line into Pulls made). The line now runs through that bend point straight into the node; the bend point stays where it is, and the line takes a small step before its end (two more corners), so it is not smoother. The last corner before an arrowhead is rounded a little less where full rounding left the arrowhead too little straight line. A line whose bend point next to a node is straight in line with its port now goes straight there instead of stepping aside and missing that point (the Pickup gacha Template's line into Pulls made); the other lines on that port can shift slightly, those without bend points included. A line end that is itself shorter than the arrowhead, as in a crowded bundle, is not lengthened.

## v0.30.0 — 2026-10-24

The menus and the canvas, tidied: the File menu is short again, check marks sit beside their names, the graph minimap is gone, and the Early MMO example is back under Templates.

- **A shorter File menu.** The File menu lists names only, one per line: the Templates and the export formats are in two submenus, Templates ▸ and Export ▸, and Set the export author… sits next to Storage & privacy…. The description of the item you point at or move to is shown in full at the foot of the menu — on a touch screen, a press on a Template or an export format shows it with an Open or Export button. An item that is unavailable says why under its name.
- **Early MMO is back under Templates.** File ▸ Templates and the phone's More ▸ Templates offer the Early MMO progression (levels 1–15) example again, after Coffee, as it was: it opens edit-locked and framed on its first steps, and Help ▸ Example notes explains it. There are eight Templates.
- **Check marks beside their names.** In the View menu (Focus, Filters, Activity overlay) and in Edit ▸ Edit lock, the check mark sits on the same line as the item's name again, instead of above it.
- **No minimap.** The graph minimap, its button at the canvas's corner and View ▸ Minimap are removed; it repeated the graph as unnamed marks and covered part of the canvas. Reset view and the status bar's Fit show the whole diagram, and panning and zooming are unchanged. A choice an earlier version stored for it is ignored. The canvas is still React Flow, so its licence notice and its attribution on the canvas stay.

## v0.29.0 — 2026-10-23

The workbench release: the desktop editing screen is redesigned as a workbench ([`docs/workbench.md`](docs/workbench.md)), and the supported languages are English and Korean — if you had chosen another language, Loop Studio starts in English, and your saved documents are kept as they are.

- **Languages: English and Korean.** The app is offered in English and Korean only. If you had chosen one of the sixteen other languages it used to offer, Loop Studio now starts in English; the names and text in your documents are not changed. Those translations are kept, unsupported, in [`archive/i18n/`](archive/i18n/README.md).
- **Structures in the File menu.** "Save selected structure…" saves the selected nodes and the connections between them to a file, and "Insert saved structure…" adds such a file to the open document as one undo step. The Insert module menu and its two bundled blocks are gone.
- **No in-app release notes.** The update notice, the What's new panel and its Help menu entry are removed; changes are listed here and in the GitHub release notes.
- **New colours, light and dark.** Both themes use the redesigned workbench palette: cool neutral surfaces, white node faces in light, selection drawn in blue. Disabled menu rows are now clearly weaker than live ones, connections dimmed by Focus stay readable above the dot grid in light, and in dark the browser's own fields (such as the Inputs panel's number fields) are dark too instead of white. Your System / Light / Dark choice is kept.
- **Nodes as symbols.** Each kind of node is drawn as a small symbol — a circle for a pool, a diamond for a gate, a hexagon for a converter, a square for a parameter, a readout for a register, triangles for sources and drains, an octagon for an end — with its number inside and its name below. A pool's capacity and a parameter's or register's unit are shown beside the symbol, and a number too long for its symbol is written out in full there. Your documents keep their positions, names, formulas and line routes; connections now end on the symbol's outline.
- **The workbench.** On desktop the editing screen is laid out as a workbench ([`docs/workbench.md`](docs/workbench.md)): a menu bar (File, Edit, View, Insert, Data, Run, Help), a tool row with the canvas tools, Add and Connect, a list of every node on the left with search, the panel on the right, the run controls and timeline under the canvas at a height you can drag, and a status bar with the counts and zoom. Templates and Storage & privacy are in the File menu; Theme, Language, Filters and the Activity overlay are in the View menu. The right panel says first what the selection does in the model (a node's connections, or a connection as one sentence), then its editing fields, then the less used settings — such as the flow mode and the resource type — folded; a resource-type mismatch stays in view, with a button that goes to the setting. The run controls and timeline are open from the start. On the phone the selection sheet shows the same panel, with nothing folded; the rest of the phone layout is unchanged.
- **The workbench at narrower widths.** The model list and the properties panel fold and open from the two ends of the status bar. Below 1280 px the list starts folded; below 900 px both do, and each opens over the canvas, one at a time. Selecting something never opens a panel, and folding or opening one never moves or zooms the diagram. The run controls stay on one row: when room runs short, Monte Carlo is reached from the Run menu and Speed and Seed fold into Run settings.
- **Fit shows the whole diagram, however large.** Fit and View ▸ Reset view used to stop at 20 % zoom, leaving part of a large model off screen in a small window. They now zoom out as far as the whole diagram needs. Zooming out by hand stops at 20 % by default; for a diagram too large to fit at 20 %, it stops near the zoom that fits it, which depends on the diagram's size and the window's.
- **The Monte Carlo distribution fits its area.** Switching to the Distribution view raises a low analysis area to 280 px, and switching back restores the height you had; a taller area is left as it is. In a window too low for that, the view scrolls inside the area and the canvas keeps its room.
- **Every drawn line is named in the run chart's legend.** The legend stays one row, but it now holds every series the chart draws and scrolls sideways when they do not fit; a faded edge with "+N" says how many lie that way. Before, a series that did not fit was drawn with its name nowhere on screen.
- **The steady state stays in view.** "Steady state — flows continue" now sits beside the current step whenever a running model is steady. When the run row is short of room, Monte Carlo moves to the Run menu and Speed and Seed into Run settings instead; before, the note was hidden.
- **Names stay when you zoom out.** At the smallest detail level the nodes keep their names, shrinking with the diagram, so fitting a whole diagram into a small window no longer leaves it without a single name. Values and the line beside them still appear from the next level up.
- **A General gacha template.** File ▸ Templates now offers one banner with no pity on its own: each ticket is rolled into SSR, SR or R by weight, the result counts add up to the pulls made, and the run stops when the pulls reach the target. Its description says what the SSR hit rate is counted against — the target pulls, so it matches the observed rate once the target is reached. It opens unlocked, ready to change; the 3-zone banner comparison stays as it was ([`docs/gacha-general.md`](docs/gacha-general.md)).
- **Example notes in the Help menu.** Help ▸ Example notes lists every example in File ▸ Templates; choose one to read what it models and how it runs — for the General gacha, what its hit rate is counted against and when the run stops. The notes are in the app, in your language, and can be read at any time.
- **A Standard gacha template.** File ▸ Templates now also offers one banner with a hard pity ceiling: a counter of pulls without an SSR, and at the ceiling the next pull is a forced SSR. Every SSR, natural or forced, goes through the same SSR result, and the ceiling hits count the forced ones apart; its note in Help ▸ Example notes says what that shows while it runs. It opens unlocked; the 3-zone banner comparison stays as it was ([`docs/gacha-standard.md`](docs/gacha-standard.md)).
- **A Pickup gacha template.** File ▸ Templates now also offers the Standard gacha's banner with a pickup guarantee: after an SSR that is not the pickup, the next SSR is the pickup. The guarantee applies to the next SSR, not the next pull — SR and R pulls in between keep it — and it holds at the ceiling too. Its note in Help ▸ Example notes walks through it. It opens unlocked; the 3-zone banner comparison stays as it was ([`docs/gacha-pickup.md`](docs/gacha-pickup.md)).
- **A value change's label no longer reads as added twice.** While a run shows a step, a `+1` line used to read "+1 +1". When the change is exactly the line's own `+n` or `−n`, the label now shows it once; the run's own highlight says it applied. When the line sets a value or the change differs, the label shows both on two lines — "=0" over "Δ −14" — and a screen reader hears "set =0, applied change −14". So that the taller label meets nothing, one line in the 3-zone banner comparison (the forced SSR's counter reset) now leaves the forced SSR's left side; nothing else in that Template changed.
- **Value changes on the same two nodes leave each other room.** A document can hold two or more value changes between the same two nodes and ports (one cannot be drawn that way, but a file can contain it); in a run their labels grew into each other and the applied change was hidden. Their labels are now placed with room for everything they can show in a run, on their line or just beside it with a short tick to it, and they stay put while it runs. Where there is no safe room a label keeps its place as before. No other line or label moves.
- **Errors are red, warnings amber, a run's normal states neutral.** A wrong input, a failed import or deletion, a share-link problem, an expression that cannot be computed (such as a division by 0), a node that cannot be read and, in the Model panel, the error code of a Register with no value are now shown in red; a route point to check, a stale result, unsaved revision changes, the temporary-session chip and a refused connection's note keep the amber warning colour. A condition that is not met, a blocked step and a change limited by a capacity are part of a normal run, so they are drawn in the normal text colour — their ring, label, clamp note and numbers are unchanged. A frame's delete button is neutral until you point at it or reach it with the keyboard, when it turns red.
- **Frames and the guided tour no longer use the run's teal.** A group frame with no colour chosen has a light grey fill instead of a teal one, the selected frame's resize corner is dark grey so it stands apart from the blue dashed selection outline, and the guided tour outlines the part it is describing in the text colour. A colour you chose for a frame is unchanged.
- **The minimap outlines where you are.** The outline around the part of the diagram on screen was drawn far too thin to see on a large diagram; it is now a thin dark line at any zoom and diagram size. The minimap's size and how it pans and zooms are unchanged.
- **Teal is the run's colour.** Play and Pause, the Monte Carlo dialog's Run button and what a run shows keep the teal; buttons and controls that only open, choose or set something are neutral now — a dialog's main button (it keeps its darker outline), the chosen tab and toggles, the speed slider, the Monte Carlo button that opens the dialog — and a port you are connecting to is ringed in the selection blue. In light the teal is a little darker so the Play label reads clearly on its button, a coloured group frame's title is written in the normal text colour (the frame keeps its colour on its border and fill), the success message is darker, and the armed "Insert reference" button's label reads clearly in dark. The logo, the run chart's series colours and every colour you or an example chose are unchanged.
- **The Add buttons and the model list draw the canvas symbols.** Each kind's mark in the tool row and in the list on the left is now its canvas symbol, small: a triangle pointing down for a Source, one pointing up for a Drain, an octagon for an End (with a small square inside, so that at this size it is not taken for a Pool's circle), and so on. Before, the Add buttons showed + and − for Source and Drain, = for Register and a circled × for End, and in the list an End looked like a Pool's circle. An interactive Drain's pointer mark also sits a little lower, clear of its left side.
- **The minimap starts folded.** On desktop the minimap now opens folded to its button in the canvas's bottom-right corner, so a whole-diagram view has nothing under it; open it from that button or View ▸ Minimap. If you had already opened or folded it, that choice is kept. Opening or folding it never moves or zooms the diagram or changes what is selected.
- **A node picked from the list stays in focus.** With Focus on, a node picked from the model list on the left stayed faded although it was selected, and the nodes faded at that moment stayed faded after Focus was turned off. A pick from the list now does what a click on the node does: the node and its neighbours are shown, the rest faded, and turning Focus off leaves nothing faded.
- **A probabilistic Gate shows its chances.** Its outgoing connections in the panel now read result, weight and chance, with the sum the chances divide by, and each of those connections says its own chance. The figures follow the model's own weights; where a weight is drawn anew each step, the panel says the chances are decided while the model runs instead of estimating them.
- **A line's value shows when the whole diagram fits.** The amount on a flow and the condition or change on a state connection used to appear only from 80 % zoom, so a whole-diagram view of an ordinary model showed its lines without their weights, +1s or end conditions. They now show down to 45 %, shrinking with the diagram like the names; below that they are hidden as before.
- **Choose the kind of connection before drawing it.** Connect in the tool row sets what a new connection is: a flow, a condition, a value change or a trigger. Any drawing — a drag from a port or a click from port to port — makes that kind; where you start only decides where it attaches. On every side of a node, a press on the port starts a connection out of that node and a drop on it ends the connection there. A connection the chosen kind cannot make is refused, and the status bar says why; it is never made as another kind instead.
- **Changing a connection's kind keeps it whole.** Changing the kind in the panel now also updates the connection's ends, so it stays that kind after a reload, and it keeps its route, bends, colour and sides, as one undo step. Before, the ends were left as they were and the colour and sides were dropped, and a connection changed from a state connection to a resource connection came back as a state connection after a reload.
- **Read a past step on the run chart.** Click the chart to pin the nearest recorded step: a line marks it and a small panel lists every drawn series' value at that step. Click elsewhere to move it; close it with its button or Escape. With the chart focused, the left and right arrow keys step through the record. The run itself is not moved back, and it can keep going while you read.
- **Lines between close nodes reach their target.** When two connected nodes were placed closer than about two short line ends (16 px each), the automatic line stopped at the source's end or ran past the target. It now runs straight from one to the other, and nodes that touch or overlap are still joined end to end.
- **What Loop Studio is for.** The installed app's description, like the README, now says what the model is about — how resources flow and how state changes — with game economies as one use case among production, operations, queues and budgets. The examples keep their own, field-specific descriptions.
- **Korean wording.** A typo in the selection count shown while editing is locked ("unlock to move") is fixed.
- **The next tap after a touch connection counts.** On a touch screen, after drawing a connection, or moving a connection's end, with a finger lifted while it still moved, the next tap — on Step, a zoom button or anything else — could be ignored and had to be repeated. It now counts the first time. Taps, moving nodes and panning or pinching the canvas work as before.
- **The run chart's end values read clearly.** The value at the end of each line in the run chart sat on the line itself, so the line ran through the digits and a "20" or a "10" could be taken for "28" or "18". The digits now stand on a background of their own, in light, dark and high-contrast themes; the values, the lines and the chart's scale are unchanged.

**No migration.** Documents, share links and digests open as before; the language change never rewrites a document's names or text. **Not verified:** real tablets and phones (touch was checked under Chromium's touch emulation only), real Windows high-contrast themes, Firefox and Safari, and manual screen-reader passes. A quick swipe on the properties panel or the timeline in portrait can leave the next tap unanswered under that emulation; whether a real tablet does the same is not known.

## v0.28.4 — 2026-10-17

Starting and finishing a connection drag responds faster ([`docs/edge-routing.md`](docs/edge-routing.md) §ER17.1).

- **What was slow.** While a connection or an end grip is dragged, every node shows all of its sides so the drop can choose one, and when the drag ends the unused ones go. Each node then measured its handles again on its own — one update of the canvas's state per node, each passed to everything listening to it — so the start and the end of a drag grew slow on large diagrams.
- **Now.** One measurement covers every node: at the start at once, before anything is drawn; at the end on the next frame, as before. A new drag started right after one ends is measured on its own. While drawing, every side of every node is still offered.
- **How much.** On one machine's production build, the 63-node 3-zone gacha banner comparison started a drag in about 70–80 ms instead of 100–120 ms, and in about 370–460 ms instead of 800–850 ms with the processor slowed four times; releasing the drag on the empty canvas improved about as much; Coffee roastery operations flow did not get slower. Only those two gestures were timed: a release that makes a connection and an end grip drag take the same path and were checked to work as before, not timed. The full measurement is kept with the work, not in the app.

**Notes.** Three What's new lines in 18 languages: the translation contract tests pass, and none had native-speaker review.

## v0.28.3 — 2026-10-15

Undo and Redo leave nothing selected, on the canvas as in the Inspector ([`docs/large-graph-readability.md`](docs/large-graph-readability.md) LGR-D17); a module insert restores its own selection ([`docs/module-system.md`](docs/module-system.md) §MS3.5).

- **What was wrong.** A history step kept the canvas selection as it was when the step was taken, while Undo and Redo emptied the Inspector. A connection or node could stay highlighted with nothing in the Inspector: a click on it changed nothing, and Delete or an arrow key acted on it (an arrow-key move also discarded what Redo could bring back). Where the kept selection differed from the current one, Undo or Redo brought an old selection back.
- **Now.** Undo and Redo end with nothing selected, on the canvas and in the Inspector. The document is unchanged by this, and it adds no undo step.
- **The one exception.** Inserting a module keeps its rule: Undo selects again what was selected before the insert, Redo the inserted nodes, the canvas and the Inspector together, however often the step is undone and redone. The insert itself no longer leaves a connection that was selected before it highlighted beside the inserted nodes.

**Notes.** Four What's new lines in 18 languages: the translation contract tests pass, and none had native-speaker review.

## v0.28.2 — 2026-10-15

A resource port's connections on two sides branch on their own ([`docs/edge-routing.md`](docs/edge-routing.md) §ER14.3).

- **The rule.** The router groups the connections of one port into a fan — they share the port's stub and split at their branch points. For a RESOURCE port that group is now per side (node, handle id and face): an `out` leaving the bottom face and one leaving the right face are two stubs in two places, no longer one fan. The same per-fan grouping decides which connections count as siblings while routing, so two resource lines on two sides of one port no longer excuse each other's stub. A resource `in` and `out` are never one fan. STATE ports keep one fan across their sides, as before. The port use behind "no label on a shared stub", a route's exemption from its own ports' reserved stubs and the parallel sets are unchanged.
- **What looks different.** Six automatic routes in the bundled Templates: Coffee roastery operations flow's green wholesale line now goes straight down instead of an S-jog, and five lines in 3-zone gacha banner comparison change (same-view checks: three easier to follow, two with no real difference). Every other bundled example draws as before.
- **Why state ports are not included.** Grouping them by side too was measured: it fixes Coffee the same way but makes three lines harder to follow on the gacha banner, all where an arriving and a leaving state connection meet one side of a node at one point — the old cross-side fans happened to push one of the two aside. That meeting is a separate, later unit. A general cost for running beside another line was tried for it and rejected.

**Notes.** Three What's new lines in 18 languages: the translation contract tests pass, and none had native-speaker review. One screenshot baseline changed (the forced-colours Coffee view at zoom 0.5, the straightened line).

## v0.28.1 — 2026-10-14

A connection's label keeps off the bend points you placed on it, where its line has room ([`docs/edge-routing.md`](docs/edge-routing.md) §ER14.3); the Early MMO example leaves the Templates menu.

- **The rule.** A routed label takes the first free slot of its own line; free now also means clear of a 16 px square on each of the connection's own STORED bend points (the 12 px bend marker plus 2 px), in the first two placement passes. The last-resort passes ignore the bends, so a line with no slot clear of them still has its label, possibly over a bend: the overlap is avoided where a slot allows, not ruled out. The rule reads stored data only, so selecting or deselecting a connection, or zooming, does not by itself move a label.
- **Measured on the screen** (the bundled examples with bends added to one connection at a time, its rendered label compared with its rendered bend markers): a label touching one of its own markers went from 23 / 202, 49 / 262 and 29 / 254 (three ways to place the bends) to 1, 6 and 0. Most of the 7 left are short lines with bends close together.
- **Other connections.** Labels are placed in order and lines are rerouted around labels, so a label that moves off a bend can move another one: in the same measurement another label moved in 18 of 934 cases and another line changed in 20, in Early MMO, the gacha banner and the playback choreography; none in the other examples. In one MMO case a neighbouring line now runs along a different line for longer and its label sits on that line; it did not reproduce in the two small diagrams checked in the browser, so it is recorded as a limit of that stress case.
- **Early MMO leaves the Templates menu.** The Early MMO progression example is no longer offered by Templates ▾ or the phone's More → Templates; it stays in the repository — `examples/mmo-progression.json`, its Template entry and its translations — as developer stress material for large diagrams. A document made from it still opens, from its file, an autosave or a share link, and its node names still follow a language switch. The menu checks (first screen, language) moved to Coffee and the gacha banner; MMO's own behaviour and performance are still tested, by opening its file. Its two colour-view baselines were removed with its menu case.

**Notes.** Four What's new lines in 18 languages: the translation contract tests pass, and none had native-speaker review. The router's port grouping by face and React Flow's one-render gap after a change of face are separate, later work.

## v0.28.0 — 2026-10-14

A connection can be turned around without drawing it again — the second line-editing release ([`docs/edge-routing.md`](docs/edge-routing.md) §ER19).

- **One check and one change.** A reversal keeps the connection: its id, kind and handles, its amount or condition, mode, timing, delay, resource type, colour and line shape. The two ends swap, each end keeps the side of the node it is on (so the sides swap with the ends, stored canonically), and the user's bends keep their points in reverse order. The same text is then read in the new direction: an amount such as `25%` is taken from the new source, an activator's comparison reads the new source, a label changes the other Pool. One undo step; the run is reset, on the reversal and on its undo and redo (a self-loop keeps its node and the run).
- **Refused, with the reason shown**, judged on the result, in this order: the new source has no output or the new target no input (a Source cannot become a target, a Drain or End a source); the result would repeat another connection by the drawing rule; a state connection would break its mode's or timing's rule in the new direction — an activator needs a Pool source, an "Always" label a Pool at both ends, a "When the source fires" label a Gate, Converter, Drain or End source and a Pool target (so a working one cannot be reversed), and a mode or timing that never has an effect is refused. The engine's rules themselves are unchanged. A reversal that closes a loop of Gates and Converters with no Pool, or that makes an amount a probabilistic Gate's branch weight, is applied, and the engine's existing warnings say what follows.
- **What may look different.** The automatic route is recomputed, and the stretch between a port and its nearest bend, a neighbour's lane at a shared port and a label's place may change; the bends themselves stay where they are. Neither the router nor label placement changed in this release.
- **The Inspector's Reverse.** Beside the Ends group's folded summary, its own button: pressing it never opens or closes the group, and it applies at once, with no confirmation and no Apply; focus stays on it. A note below it, visible folded and in the plain hint colour: what a reversal keeps; after it, that the amount and condition are kept and read in the new direction, that the user's bends stay where they were (when there are bends), and that the automatic route, the line next to each end and the label's place may change; a refusal's reason, node names bidi-isolated; after a reversal that cannot be reversed back (one that made an activator or a "When the source fires" label work), the result and, on a line of its own, that it cannot be reversed back and why; and, while a pick in the open group is not applied, a request to apply or revert it first, with Reverse waiting. Waiting or refused, the button stays in the Tab order. Not on the canvas, and the phone stays read-only.

**Notes.** Three What's new lines and 13 interface strings in 18 languages. The translation contract tests pass; that is evidence of the catalogs' structure and terms, not a review of how the lines read, and none had native-speaker review. User-shaped curves and moving a connection's label are separate, later work.

## v0.27.0 — 2026-10-13

A connection's end can move without drawing the connection again — the first line-editing release ([`docs/edge-routing.md`](docs/edge-routing.md) §ER18).

- **One check and one change for every way of moving an end.** An end is a node and a side of it. A move keeps the connection: its id, kind, direction and handles, its amount or condition, resource type, colour, line shape and the user's bends; only the end node and its side change (`data.ports`, canonical). Refused, with the reason shown: an end on a node without the port this connection needs there (a Source has no input, a Drain or End no output, a Parameter or Register no ports), and — only when an end changes node — a result that repeats another connection by the drawing rule (the same two ends and stored handles), the moved connection itself excluded; a change of side alone is never refused as a duplicate, since documents hold parallel connections of one kind between the same nodes. One undo step per applied move; a cancel, a refusal or the same ends record nothing. A side-only move keeps the run; a move to another node resets it, as drawing does. User bends are never removed by a move: one the bend rule would refuse at the new ends is said before applying. Drawing runs the same duplicate check before it records, so a refused drawing no longer adds an undo step or resets the run.
- **The canvas end grips.** On the one selected connection (never on hover, not on the phone, not under the edit lock), a round grip on the connection's own line near each end: a 24 px screen target at every zoom, 44 px with a touch pointer, at the nearest spot within 24 screen px of the first one past the port where its target meets no other line, port, node or grip and covers no label or outside name. Where no such spot exists near an end, that end has no grip — a small mark, not a target — and the Ends group says, folded or open, to move it from there; this is measured on the cases checked, not a guarantee for every layout. Drag a grip onto a node's face, by mouse, pen or touch, to move the end; a refused face changes nothing and says why; elsewhere, Esc, a deselection, a deletion or the lock during the drag change nothing. Click, tap, Enter or Space on a grip opens a small popover that names the end and its node and offers the four sides, the current one marked; it opens away from that node and inside the canvas; a choice moves the end and focus returns to the grip.
- **The Inspector's Ends group.** Folded by default to its name and a From → To summary; opened, a node list and a four-side choice per end, then Apply or Revert. A node that cannot take the end is listed disabled with its reason in its own text, so a keyboard or screen-reader user reads it; the reason stays visible while the group is folded.

**Notes.** Three What's new lines and 24 interface strings in 18 languages, none with native-speaker review. `@xyflow/system` (the version React Flow pins) is now a direct dependency. Turning a connection around, user-shaped curves and moving a connection's label are separate, later work.

## v0.26.2 — 2026-10-13

Playback cues follow the colours a user chose, and the moving `+N` badge keeps off the nodes it travels between.

- **A run cue takes the colour of the element it is about** ([`docs/flow-colour-and-compact-nodes.md`](docs/flow-colour-and-compact-nodes.md) FC-4.3, rewritten; a flow colour is no longer a rest colour only). A connection with a chosen colour draws its run signals in it: the moving marker, the path highlight and the very fast tier's flash, the `+N` badge's border, the departure and arrival rings, the L0 travel pulse, the reduced-motion highlight and role tells, and on a state connection the bead, the held highlight and the satisfied-activator ring; a satisfied activator keeps its colour on the line and is told by its weight. A node with a chosen colour draws its own fired ticks, arrival tint and conversion mark in its colour; an incoming connection's colour never reaches a node. Without a chosen colour, the usual run colour. Selection, focus, errors and warnings keep their own colours; the badge's amount and a label's run amounts keep the primary ink.
- **A thin neutral case for a colour short of contrast.** Where a chosen colour is under 3:1 against what a signal is drawn on in the current theme (the canvas, or the node face for the marks inside a node), the signal gets a 0.75 px `--line-strong` rim: beside a path signal with its own width cut out, under a marker, bead or filled tell, under a ring, outside the badge, under the ticks (never onto the invalid ring) and the conversion mark, and as the arrival tint's own 1 px inner edge. The colour itself is never changed or swapped for the default; no case at rest or where the contrast is enough, a dark theme included; none under forced colours, where run signals draw no flow colour at all.
- **The L2 travelling `+N` badge in its connection's own place** ([`docs/simulation-playback.md`](docs/simulation-playback.md) §PB4.8; the L2 badge of the full tier only). One of four places beside the marker per connection, planned from the layout and kept for the whole step; shown only while its whole box is clear of both end nodes' bodies, tested every frame on the exact geometry. Guaranteed: no shown badge over an end body, no change of place within a step. A plan, not a guarantee: that the badges of one fan stay apart and that names and bodies are not covered — on the Coffee roastery the first step starts two members of one fan at different moments and their badges meet for one frame. L1, the faster tiers' arrival badge, the very fast tier and the reduced-motion static badge are unchanged; amounts at L1 are not made easier to read.
- **The colour goes to the node the Inspector shows.** A node added from the palette (a click or a drop) now becomes React Flow's selection too, as an inserted module's nodes already did, and the keyboard neighbour walk (`]` / `[`) moves that selection with it; before, a node dragged just before, or the node the walk started from, stayed selected and took a colour picked for the node the Inspector showed. Multi-selection is unchanged.

**Notes.** Four What's new lines in 18 languages, none with native-speaker review.

## v0.26.1 — 2026-10-12

Corrects the wording of two lines of the v0.26.0 What's new note, in all 18 languages, which promised more than holds. The new node line now says that with the name outside the body, the size of a node no longer depends on the length of a translation (it no longer says a diagram reads the same in every language). The connections line now says that existing documents are not re-placed, their values and the meaning of their connections are kept and they look different with the new node, and that a document with chosen sides, saved again by an older version, loses those sides and its connections go back to their default sides (it no longer says that existing connections stay where they were or that nothing else changes). No behaviour changes. The README's three screenshots are reshot from the v0.26.0 production deployment with the new node (the Coffee roastery in $/day, the re-placed gacha banner comparison), and its Latest section describes v0.26.0.

## v0.26.0 — 2026-10-12

The node structure becomes the default: each node is a compact body with its role and value inside and its name just outside, and a connection can leave or enter a node on any of its four sides (PR #347; documents gain the optional port sides under `loop-revision/11`, the placement rules are in [`docs/diagram-layout.md`](docs/diagram-layout.md)).

- **The new node.** The body is a fixed 56 px high, as wide as its value needs (88 to 260 px), with the role symbol and the value inside. The name is separated from the body, so the body's size does not depend on the length of a translation. It sits just outside the body, on the first side no connection uses (below, then right, left, top), and is shown from the middle zoom level up. Pointing at the name or the body is pointing at the node; hover and keyboard focus mark the name too. A value too long for the body ends in an ellipsis and stays complete in the tooltip, the DOM text and the Inspector. A fired node shows a ring of ticks.
- **Connections from any side.** Every port is offered on all four sides while a node is selected, focused or a connection is being drawn; a new connection remembers the side it was drawn from, stored as a cosmetic face on the connection (`data.ports`), outside the engine digest. Existing documents are not re-placed automatically: their values and the meaning of their connections are kept, and a port with no chosen side uses its default side. Their look changes with the new node.
- **Notices under the toolbar.** The update notice and the two first-time canvas hints move into a strip under the toolbar. The diagram does not move when a note appears or closes, and a hint never appears in the middle of a press or a drag.
- **A Pool's current amount.** The Inspector shows, beside the starting amount, a read-only Current amount that follows the run, on the desktop and on the phone sheet, reachable by keyboard and touch.
- **A label beats another line.** A click on a connection's label selects that connection even where another connection's line passes under the label.
- **Re-placed Templates.** The Coffee roastery (money now in dollars per day) and the 3-zone gacha banner comparison are laid out again for the new node; both declare a placement clearance of 0 as their own explicit value, not as a rule for every Template.
- **The previous body** stays reachable with `?nodes=inside` for its own rule specs; it is not a user setting.

**Compatibility.** A document with chosen sides, saved again by v0.25.0 or earlier, loses those sides: its connections go back to their default sides. **Reader.** From v0.26.0, when a project file's revision header declares a newer format than the reader knows and its digest does not verify, the reader says the project data was written by a newer version of Loop Studio, and the diagram itself still opens; v0.25.0 shows a different warning for such a file.

**Notes.** Six strings in 18 languages (6 added: the five release-note lines and the Inspector's Current amount), none with native-speaker review. Verification is recorded in PR #347: the full local e2e on the release tree, the 39 reviewed baselines and the new state matrix, the unit suite, and CI on the final commit, where the MMO playback frame-rate floor failed once and passed on one agreed confirmation re-run. The new node's rendering cost is measured (a fast-beat frame about 20 % slower than the previous body); reducing it is the first follow-up.

## v0.25.0 — 2026-10-10

Diagrams are easier to read, in one migration (issue #344, Diagram Readability): nodes line up on a grid, connections run at right angles around them, and every node keeps its text inside its outline, as [`docs/diagram-layout.md`](docs/diagram-layout.md), [`docs/edge-routing.md`](docs/edge-routing.md) §ER14–§ER16 and [`docs/specs/SEMANTICS-R10.md`](docs/specs/SEMANTICS-R10.md) describe.

- **The port row.** A node's resource ports (`in` / `out`) sit on a fixed row 28 px below its top, on its drawn outline, whatever its height, text or language. A node with a long name grows downward and its connections do not move; one-line nodes draw their ports where they always did.
- **The 16 px grid.** A node is on the grid when its left edge and its port row are multiples of 16, so two nodes on one grid row have level connections. A palette click places the new node on the nearest free grid spot from the canvas centre (no random offset any more); a drop, Insert module and an imported Parameter land on the grid.
- **Dragging snaps, with smart guides.** A dragged selection moves as one, so it keeps its shape; a frame drag snaps the frame's top-left and a resize the dragged corner. Within 6 screen px a drag is pulled to another node's port row, then to its centre or edges, then to the grid; a dashed line shows where it will land and a solid line reaches every node it lines up with. Where a node is grabbed never changes where it lands. After an arrow-key move its row and column show for a moment. The arrow keys move a node or a frame one grid step, 16 px (Shift: 64 px), instead of 5 px (20 px). The phone shows no guides.
- **Modifiers.** Alt now means a free move, off the grid, for nodes, selections, frames, drops and bend points; the guides show faint and pull nothing. Moving a frame without its contents is Ctrl (⌘ on a Mac), no longer Alt; the frame hint says so. Shift is unchanged.
- **Automatic orthogonal connections.** New connections are orthogonal: drawn at right angles and routed around every node, their own two nodes included, leaving and entering each node along a short stub. Where room is short the clearance shrinks, then the route goes around the outside of the diagram; only a port that another node covers is crossed, by that one node. Connections from the same port share only its 16 px stub and branch apart there, so none run on top of each other past it. A label takes the first free spot on its own line, clear of every node and label, and a connection that runs through other labels is routed again when that crosses fewer. A run, a selection or a zoom never moves a route.
- **Connection shapes and bend points.** A selected connection's Route offers Orthogonal, Curved (the earlier curve) and Straight. An orthogonal connection is automatic until it has a bend point: Add bend, then a click on the line, or Enter, adds one without moving the line; a bend point is dragged, moved with the arrow keys (16 px, Shift: 64 px) or removed with Delete, snaps to the grid (Alt: freely) and makes the route manual. Reset to automatic removes the bend points. Each add, move, delete, reset or shape change is one undo step; nothing changes while editing is locked. Curved and Straight connections do not avoid nodes, but their labels still take a free spot.
- **The phone shows, and does not edit.** It draws every shape, route and bend point; route editing is desktop only.
- **Text inside the outline.** The Pool, Source, Drain, Converter and Gate are drawn for their own width: their slanted sides, notch, point and waist keep a fixed depth instead of stretching, and the title, value and every other line stay at least 8 px inside the drawn outline, in every language. Ports and the Converter's conversion mark sit on the outline as drawn.
- **Older diagrams are lined up once.** An ordinary document saved by an earlier version — a graph file, Workspace, share link or autosave — is re-placed once when it opens, before its undo history starts, so the conversion is never an undo step. Nodes move to the grid; related rows a few pixels apart merge into one; nodes closer than 48 px across or 32 px down are moved apart by inserting space, so no left / right or above / below order is reversed; each frame is rebuilt around the nodes it held and the nodes that sat in it, keeping its padding (at least 24 px); waypoints snap (one that would land inside a node is dropped); and every connection without a shape becomes automatic orthogonal. The re-placement uses each node's widest size over the 18 languages, so it is the same in every language. Records are not converted (see Migration).
- **Tidy to grid.** A new button in the canvas controls (desktop) applies the same re-placement to the open diagram at any time, graph and frames together, as ONE undo step; with nothing to move it adds no step, and it is off while editing is locked. On a revision-based document it changes only the current document, like any other edit. It never changes a connection's shape.
- **The Templates.** All five bundled Templates are placed again on the grid by their widest boxes in all 18 languages, every connection automatic orthogonal with no hand-placed bend point: no connection runs through a node, no label sits on a node, no frame cuts a node and two frames keep at least 32 px apart. The coffee roastery Template opens on its operating flow at about 0.5 in a 1280 x 800 window. Early MMO opens on its first steps at about 1.04 in a 1600 x 1000 window, with Character creation, Active character, Starter encounters and Starter Lv 1–5 whole in every language, with the minimap open or collapsed. The gacha Template keeps its overview. Reset view and the minimap show the whole diagram.

**Migration.** Files now carry `layoutVersion` (1), written on every save; a file without it reads as 0 and is re-placed once on opening. It is not part of any digest. Records keep their recorded layout and are never converted automatically: a project revision and a proposal payload — opened, opened as a document or applied — and a Project autosave based on a revision keep their positions and connection shapes, and the base revision and the proposal source stay as recorded. Their digests cover the positions; converting them would make a document differ from its own revision the moment it opens and turn every exact proposal into a non-exact one. This is intended: Review shows the real layout differences between a converted document and its recorded revision. Such a record also keeps its curved connections' labels where they were recorded until its first shape change or Tidy to grid. A position placed freely with Alt in a current document is kept. A Straight connection is stored as `route: "straight"` (`loop-revision/10`); a diagram without one has the same revision bytes and digests as before. The engine digest and simulation results are unchanged; the content digest of a re-placed diagram or Template changes with its positions and shapes. 17 strings in 18 languages (15 added, 2 revised: the connection shape and bend point controls, the connection note, Tidy to grid, the frame hint and five release-note lines), 16 of them without native review. The informational `meta.tool` string is now `loop-studio/0.25.0`.

**Compatibility.** v0.24.0 and earlier open a v0.25.0 diagram with a Straight connection but draw that connection Curved, and refuse the project header of such a project revision, without a warning; saving it again there drops `route: "straight"`, so the Straight shape is lost. Opening a v0.25.0 document in an earlier version and saving it is not supported.

## v0.24.0 — 2026-10-09

Playback speed changes what a step draws (issue #330, the last of three), and the phone gets a speed choice of its own, as [`docs/simulation-playback.md`](docs/simulation-playback.md) §PB6.1 and [`docs/mobile.md`](docs/mobile.md) §MV4 describe.

- **Three speed tiers.** At 400 ms a step or slower, the round marker travels with its `+N` beside it, as before. From 200 to 399 ms it travels and `+N` appears when it arrives. Below 200 ms the moved path flashes, then the marker appears at the end with `+N`. The tier is read when a step starts, so changing the speed during a step changes its pace but not what it draws; the next step takes the new tier.
- **Step always draws the full movement,** whatever the speed is set to.
- **Playback speed on the phone.** More → Playback speed offers Slow (1 s a step), Normal (0.6 s, the default), Fast (0.3 s) and Very fast (0.12 s); the current one is checked. There is still no seed in the phone's run bar.
- **Fewer moving markers on the phone.** A phone shows at most 12 marker-and-badge pairs a step — the first 12 of the same stable order as the desktop's 24 — and no departure ring; every other move keeps its path highlight and arrival cue. This is fixed when a step starts, so rotating the phone mid-step makes nothing in that step appear or disappear.
- Reduced motion and the far-zoomed map view keep their forms, unchanged.

**No migration.** Engine, RNG, files, share links, digests and simulation results are unchanged; the speed is still not saved. A current limit, measured: a step with about 300 simultaneous moves draws slowly (roughly 70–200 ms a frame on a desktop development build), before this change as after it. Twelve release-note and phone strings in 18 languages, 16 of them without native review. The informational `meta.tool` string is now `loop-studio/0.24.0`.

## v0.23.0 — 2026-10-09

Playback shows what happens inside the nodes (issue #330, second of three): a Pool lights up as its first marker arrives, and a Converter shows a conversion mark while its markers move, as [`docs/simulation-playback.md`](docs/simulation-playback.md) §PB4.7 describes.

- **The Pool arrival pulse.** When the first moving marker of a step reaches a Pool, a soft tint fills the Pool from 7 px inside its outline, under its title and value, for half a second; it carries on across the end of the step. The value still changes when the step ends. Past the 24 marker pairs and when zoomed far out, where no marker is drawn, the pulse plays at the same moment. It replaces the disc that used to play after the marker had gone.
- **The conversion mark (option A).** While a Converter's markers move, a small two-arrow mark shows inside it and fades after the step; its inputs and output still move together. Each Converter has its own spot for the mark, at least 6 px inside the outline and clear of its title and mode text, worked out once per text, language or size change. When zoomed far out it takes the place of the type dot.
- **Focus mode, reduced motion and forced colours.** Both are cues inside a node, so Focus mode never fades them. Under reduced motion they stay still for the step; in forced colours the pulse is a 2 px system-colour line under the text and the mark takes the same colour.

**No migration.** Engine, RNG, files, share links, digests and simulation results are unchanged; node sizes and text placement are unchanged. Three release-note lines in 18 languages, 16 of them without native review. The informational `meta.tool` string is now `loop-studio/0.23.0`.

## v0.22.0 — 2026-10-09

Playback shows what moved where (issue #330, first of three): the path a Gate took, every amount as a `+N` badge beside its round token, and Focus mode winning on connections, as [`docs/simulation-playback.md`](docs/simulation-playback.md) §PB4.6 and [`docs/large-graph-readability.md`](docs/large-graph-readability.md) §LGR2.3 describe.

- **The Gate path.** For every Gate, deterministic or probabilistic, each outgoing connection that carried a move this step is highlighted under its round token, from its onset to settle; several can be at once. A branch with no move keeps its usual look, with no faded or crossed-out cue.
- **`+N` beside the round token.** The round token still travels wherever it did; the step's summed amount now always rides beside it as a `+N` badge, from `+1` (before, a bare number sat above the dot only when the amount was above 1). The badge is drawn above every connection label. At the map zoom level the badge is left out with the dot, as before.
- **The connection's own label stays put.** It dims only while the token or its badge covers its real box; no other connection's label is tested.
- **24 token-and-badge pairs per step** replace the budget of 60 travelling cues. Past them, every resource connection that moved keeps the path highlight and its arrival cue.
- **Focus mode wins on connections.** Outside the focus set, the path highlight, the token and badge, the depart and arrive cues and the reduced-motion forms are drawn at the connection's own low strength; cues inside a node keep full strength.
- **Reduced motion and high contrast.** Under reduced motion nothing travels: the moved paths, the arrival tells and the `+N` badges stay, static, for the step. In forced colours the highlight is told by width, the badge is a system-colour pill, a covered label gives way, and outside the focus set the cues take a dash instead of fading.

**No migration.** Engine, RNG, files, share links, digests and simulation results are unchanged; Monte Carlo draws no tokens, as before. Five release-note lines in 18 languages, 16 of them without native review. The informational `meta.tool` string is now `loop-studio/0.22.0`.

## v0.21.4 — 2026-10-08

A fix release (issues #338 and #340): while the Canvas is edit-locked, the Controls rail keeps every button where it is, as [`docs/canvas-edit-lock.md`](docs/canvas-edit-lock.md) describes; and on a phone, focusing a text field no longer zooms the page in, as [`docs/mobile.md`](docs/mobile.md) §MV4b describes.

- **The frame buttons stay, disabled.** "Group frame" and "Clear all frames" remain in the rail while editing is locked, as disabled buttons left out of the Tab order, so in the same document the rail has the same buttons and the same height locked and unlocked. Since v0.12.0 the two had been removed from the rail while locked, so the rail grew shorter and every button above them moved down by a button's height.
- **Locking turns the frame tool off.** A frame tool armed before locking used to stay armed: a drag on the empty canvas started a frame the lock then refused, and did not pan. Locking now turns it off, so the drag moves the view.
- **Unchanged:** the buttons that appear only when they apply ("Clear all frames" with no frame, "Suggest frames", "Clear suggested frames"), and everything the lock allows or refuses.
- **The phone's language search no longer zooms the page in.** On an iPhone, Safari zooms in on a focused text field smaller than 16 px and does not zoom back out; the More sheet's language search was 12 px, so after a search the page stayed zoomed until it was pinched back. Every text field the phone shows now takes at least 16 px (the Monte-Carlo fields and the share password field already did, one at a time). Pinch zoom is never blocked.

**No migration.** Files, share links, digests and simulation results are unchanged. Four release-note lines in 18 languages, 16 of them without native review. The informational `meta.tool` string is now `loop-studio/0.21.4`.

## v0.21.3 — 2026-10-08

A fix release (issues #334 and #335): the Canvas edit lock is exact at every document boundary and refuses every edit, and its button shows the state at a glance, as [`docs/canvas-edit-lock.md`](docs/canvas-edit-lock.md) describes.

- **A new document starts unlocked.** File → New, starting a temporary session without the open diagram, and Delete work data leave an unlocked, empty document. Before, a locked example or file kept the new document locked, even after a reload.
- **Every other document brings its own lock and no history.** A Template, a file, a share link and Open proposal as document open with their own lock (a locked example stays locked) and with an empty undo history: Undo can no longer go back into the previous document. The confirmation before a replacement is the safety net.
- **While locked, nothing edits the document.** The palette, Insert module, Undo and Redo, the data import wizard, a data refresh, renaming a bound table and a revision Apply are disabled, and the stores refuse them too. Selecting, panning, zooming, Focus and the other view settings, Run and Step, export and sharing stay available.
- **The lock button shows its state.** Unlocked is an open padlock with its shackle swung clear of the body; locked is the closed padlock with the same pressed tell as Focus (the system highlight in forced colours). Its name stays "Edit lock" and `aria-pressed` carries the state; the tooltip names the next action.

**No migration.** Files, share links, digests and simulation results are unchanged. One new string (the button's name) and three release-note lines in 18 languages, 16 of them without native review. The informational `meta.tool` string is now `loop-studio/0.21.3`.

## v0.21.2 — 2026-10-07

A fix release (issue #332): a Pool's, a Parameter's and a Register's value and detail rows sit inside the node, as [`docs/node-shell-content-in-vessel.md`](docs/node-shell-content-in-vessel.md) "Follow-up — value and detail rows" describes.

- **Rows start with the title.** The value, a Pool's capacity, a Parameter's unit and a Register's `= expr` now start where the title text starts, at least 8 px inside the drawn outline at both ends. Before, they started 14 px earlier, and a Pool's value sat on or across its slanted side.
- **Wider only where needed.** A node whose row would not fit grows by the minimum, up to the 260 px maximum; in the three templates that is one node, by under 6 px. A row too long even for the widest node, or one whose widening would bring a title closer to the outline or change a node's height, is cut with a visible "…".
- **Unchanged:** node heights and positions, saved files, digests and simulation results; Source, Drain, Converter, Gate and End rows.

**No migration.** Three release-note lines in 18 languages, 16 of them without native review. The informational `meta.tool` string is now `loop-studio/0.21.2`.

## v0.21.1 — 2026-10-07

A fix release (issue #329): Focus mode dims the connections outside the focus set, as [`docs/large-graph-readability.md`](docs/large-graph-readability.md) §LGR3.1 always said.

- **Connections fade with the nodes.** A connection outside the focus set is drawn at 0.26, its path and its arrowhead. Before, every connection path carried an inline `opacity` that beat the dimming rule, so only the nodes were dimmed.
- **Focus wins over an activator.** An unsatisfied activator connection stays at 0.5 inside the focus set and goes to 0.26 outside it.
- **High contrast keeps its own tell.** Under forced colours a dimmed connection is not faded; its fine `1 5` dash marks it, as before.
- **Unchanged:** labels, the selection highlight, nodes, the playback tokens and cues, files, digests and simulation results.

**No migration.** Three release-note lines in 18 languages, 16 of them without native review. The informational `meta.tool` string is now `loop-studio/0.21.1`.

## v0.21.0 — 2026-10-07

Compact nodes (issue #325, the last of three parts): more of a large graph fits in view. The contract is [`docs/flow-colour-and-compact-nodes.md`](docs/flow-colour-and-compact-nodes.md) FC-7.

- **Shorter, a little narrower.** A one-line node is 56 px tall instead of 64 (a one-line Pool 58, which its title and value need), with 12 px of side padding instead of 16 (Source and Drain 22 instead of 26 at their pointed end, Gate 26 instead of 30). Of the 386 nodes in the bundled templates and a sample of every kind, 235 got shorter.
- **Content still decides.** 56 is a floor, not a forced height: a two-line title, a capacity row, every Parameter and every Register keep the height their content needs, the title's maximum width is unchanged so long titles wrap where they did, and no outline is squeezed or reversed at any height.
- **Nothing a file holds changes.** Node positions, saved diagrams, share links, digests and simulation results are the same; connections attach 3 to 4 px higher and orthogonal routes are recomputed. The ports and their 18 px hit area keep their size, and the selection, focus, invalid, run and Focus-mode marks keep their order.

**No migration.** Three release-note lines in 18 languages, 16 of them without native review. The informational `meta.tool` string is now `loop-studio/0.21.0`.

## v0.20.0 — 2026-10-07

Flow colours beyond the canvas (issue #325, the second of three parts). The contract is [`docs/flow-colour-and-compact-nodes.md`](docs/flow-colour-and-compact-nodes.md) FC-5 and FC-6.

- **The minimap and the timeline.** A coloured node's minimap mark takes its colour, and a coloured Pool or Register draws its timeline line, its legend mark and its endpoint in it. Every other mark and series keeps its colour, so colouring one node never recolours another; the Register's dashed line and the Pool's solid line stay, and connection colours never reach the timeline. Under forced colours neither view draws a flow colour.
- **Three templates in colour.** The Coffee roastery, gacha banner and early MMO templates open with three colours on their main flows: green beans, roasted beans and desserts; the gacha banner's three zones, in the colours their frames already carry; items, gold and experience. Parameters and Registers stay uncoloured. Their simulation is unchanged: the engine digest of each template is the one recorded before.
- **Each colour once.** In the Inspector's Colour section, Recent leaves out the palette's colours, and In this document leaves out both, so the current colour's ring shows once; a row with nothing left is hidden.
- **The phone shows a colour as one line.** The read-only Inspector on a phone shows the colour as text, a dot with the colour's name and hex (its hex alone off the palette), Default with an empty ring, Mixed with no dot, instead of the disabled editor. A locked canvas on the desktop keeps the disabled editor.

**No migration.** Run results and the run CSV are unchanged for any diagram. The three templates' files now carry `accent` fields, so their content and revision digests differ from v0.19.0's. Four release-note lines in 18 languages, 16 of them without native review. The informational `meta.tool` string is now `loop-studio/0.20.0`.

## v0.19.0 — 2026-10-06

Flow colours (issue #325, the first of three parts): nodes and connections can carry a colour so the flows of a large graph read apart at a glance. The contract is [`docs/flow-colour-and-compact-nodes.md`](docs/flow-colour-and-compact-nodes.md).

- **Colour from the Inspector.** A new Colour section sets or removes the colour of every selected node and connection in one step: five palette colours (Slate, Sage, Gold, Violet, Rose), the recently used colours, the colours already in the diagram, a hex value (`#rgb` or `#rrggbb`; no transparency) or any colour from the browser's own picker. Default removes it. A selection whose colours differ shows Mixed.
- **Where it shows.** On a node, a band just inside its outline, the small kind marker, the faint fill tint and the low-zoom dot; the node's shape, outline and text are unchanged, so a node with no contrast colour still has its edge. On a connection, its line, arrow and a thin border on its label. The same colour is drawn in the light and the dark theme.
- **Nothing a run computes changes.** A colour change, its undo and its redo never reset the run or make a Monte Carlo result out of date. Colours are kept in the saved diagram, autosave, exports, share links, inserted modules and Project revisions; a colour value a file cannot use is dropped and the node or connection kept.
- **Selection, focus and warnings stay clear on any colour.** A selected node now shows its ring outside the outline, as the visual design always specified, instead of a darker outline; a selected connection keeps its colour and shows a highlight beneath it. Focus, the invalid warning, run cues and Focus mode keep their own marks. This applies to every diagram, coloured or not.
- **Advice, never a block.** A colour that would be hard to see where it is drawn, in either theme, or that looks like the colour the canvas uses for focus, warnings or a run, is applied with a note; the palette colours never get one.

**No migration.** A file without colours opens and looks as before, apart from the new selection ring. A Project revision with a colour is a new revision format (`loop-revision/9`): an older version opens the diagram but not the revision, and keeps only the colours of flow nodes. The recent colours are a browser preference: a temporary session keeps them in memory only, and "Reset all Loop Studio data" removes them. Sixteen strings and four release-note lines in 18 languages, 16 of them without native review. The informational `meta.tool` string is now `loop-studio/0.19.0`.

## v0.18.2 — 2026-10-06

A fix release (issue #308): the guided tour says each step once and never loses focus.

- **Each step is announced once.** Step 1 is read as the tour opens, by its title and text; every later step is read once, as its number, title and text, when Next or Back reaches it. The visible step counter no longer repeats it. The welcome card's question is now read with its title.
- **Focus stays where you are.** The tour opens with focus on Next and keeps it on Next or Back while the steps change; going Back to the first step moves focus to Next instead of losing it.
- **Ending the tour lands somewhere.** Done, Escape and the close button, on a first run or a replay, return focus to the Help button (to the overflow button when Help is folded into it, to More on a phone), never to the page itself.

**No migration.** One new spoken sentence and three release-note lines in 18 languages, 16 of them without native review. The informational `meta.tool` string is now `loop-studio/0.18.2`.

## v0.18.1 — 2026-10-06

A fix release (issue #307): the menus answer the keyboard the same way, and the phone's sheets take focus and step back one level at a time.

- **Every desktop menu button opens, moves and closes alike**: Templates, Insert module, File, Data, Help, the temporary-session chip, Theme and the Distribution export. A keyboard open puts focus on the first item, and Arrow Down or Arrow Up on a closed button opens it at the first or last item. Inside, the arrows wrap, Home and End jump, and disabled items are skipped. Escape returns to the button; Tab and Shift+Tab close the menu and move on. After a keyboard choice that opens no dialog, focus returns to the button; a dialog returns it there when it closes. Pointer use is unchanged.
- **Settings and the `⋯` button are disclosures**, not menus: Tab moves through them, and Escape closes them and returns to their button. Theme's three choices are announced as a choice of one. Language keeps its search field, and Arrow Down or Arrow Up on its closed button opens it at the first or last language.
- **On a phone, each sheet takes focus when it opens.** Escape in a sheet opened from More goes back to More, on the row that opened it; Close still closes everything. A sheet stays non-modal: the run bar and the update bar are still usable while it is open, by touch, keyboard and screen reader, and only what the sheet covers leaves the keyboard order. A dialog opened from a sheet returns focus to the row that opened it.
- **A dialog is modal for real, on every screen**: while one is open (the Monte Carlo dialog, a confirmation, About, the guided tour), nothing outside it can be reached by pointer, keyboard or screen reader. The update notice waits behind it and is back, unchanged, the moment it closes; while only a sheet is open it stays usable.

**No migration.** Three release-note lines in 18 languages, 16 of them without native review. The informational `meta.tool` string is now `loop-studio/0.18.1`.

## v0.18.0 — 2026-10-05

The third-party open-source licenses, inside the app (issue #301).

- **About Loop Studio has a Third-party open-source licenses button.** It turns the same dialog into a licence view, not a second dialog: the view says first that these are the notices of the third-party software Loop Studio includes and that they cover those components only, not Loop Studio itself, then shows every component's full licence text, in its original English, in a scrollable block that can be searched, selected and copied. Back to About returns to the button; Escape closes the dialog.
- **The text is the build's own notices file**, the one every build has carried since the previous change: the web and installed builds read `THIRD_PARTY_NOTICES.txt` from their own origin (the installed app has it precached, so it opens offline) and also offer it as a text file in a new tab; the single-file version reads the copy inside its own HTML. It is shown as text, never as HTML, and a new check, `check:licence-screen`, fails if that ever changes. Loading and a failed read have their own states, with Try again.
- **The dev server serves the same text**, rebuilt from the committed manifest and the installed packages, and checked against the manifest byte for byte. On the dev server, the production bundle, the installed app offline and the single-file version, the end-to-end tests compare the text on screen with the manifest's SHA-256.
- **The About dialog's links are readable in the dark theme**: they had the browser's default blue.

**No migration.** Nine new interface strings and three release-note lines in 18 languages, 16 of them without native review. The informational `meta.tool` string is now `loop-studio/0.18.0`.

## v0.17.2 — 2026-10-05

A fix release. The Temporary session button in the toolbar was a 20 px pill with 10 px grey text and read as a status badge.

- **It is drawn as the menu buttons beside it**: 28 px tall, the 8 px control radius, 12 px text, the primary ink on the raised face, their hover boundary and their keyboard focus. Its orange border still marks a temporary session at rest. Nothing in how sessions switch or save changed.

**No migration.** The informational `meta.tool` string is now `loop-studio/0.17.2`.

## v0.17.1 — 2026-10-04

A fix release (issue #301). Share links used a bundled compression library whose origin the repository's record does not establish.

- **Share links are compressed and decompressed only with the browser's own Compression Streams**; the bundled code is removed. Every browser the build targets has them. Links the removed code made still open, and the link format, limits and opening order are unchanged.
- **A page without them** makes no plain or protected link, and opening a link there shows one sentence, asks for no password and leaves the open diagram untouched.

**No migration.** The informational `meta.tool` string is now `loop-studio/0.17.1`.

## v0.17.0 — 2026-10-04

Optional password protection for share links (issue #300).

- **Protect with a password**, unticked by default: the diagram is sealed inside the link with AES-256-GCM under a key derived from the password (PBKDF2-HMAC-SHA-256, 600,000 iterations), with Web Crypto only (`docs/specs/SEMANTICS-P.md`). A plain link is created and opened exactly as before.
- **Opening a protected link** checks its structure first, removes the fragment, then asks for the password; nothing from the shared diagram is drawn before a correct one. A wrong password and altered link data give the same message. Loop Studio does not store or transmit the password or the key, and a lost password cannot be recovered.

**No migration.** The informational `meta.tool` string is now `loop-studio/0.17.0`.

## v0.16.0 — 2026-10-04

Storage on a shared computer (issue #297).

- **A storage gate**: before anything stored is read, Loop Studio asks whether this is a personal browser or a shared computer. A temporary session neither reads nor saves stored work, author information or settings; only the start-up choice can be stored. The single-file version asks every time and never remembers.
- **A Storage and privacy area in Settings**: the storage mode, the restore toggle, switching to the other kind of session, deleting the stored work and resetting everything Loop Studio keeps. A failed deletion is never shown as done.
- **A temporary session shows a standing button** with export and the ways out, warns before a reload would lose work, and is asked before the installed app restarts. The share dialog says that the link itself contains the entire document.

**No migration.** The informational `meta.tool` string is now `loop-studio/0.16.0`.

## v0.15.3 — 2026-10-03

A fix release. The symbols on the buttons were characters an operating-system font drew, so a button looked different from Windows to iPhone, and on iPhone some of them were colour emoji.

- **Every functional icon is the app's own drawing.** Play, Pause, Replay, Step and Reset, the canvas lock and focus buttons, the close and more buttons, the menu arrows, the selected marks in the Language and Theme menus, the external-link mark, undo and redo, the revision marks, the five palette marks and the trigger mark on a connection are inline SVG from one shared component, drawn with `currentColor`, so they look the same on every platform and in every theme, including forced colours. No icon package is added. Measured on the shipped font before the change: it drew three of the symbols; the operating system drew the rest.
- **Names are words.** A translated label no longer carries a symbol (`▶ Play` is `Play` beside an icon, in all 18 languages), so a screen reader reads the words alone; the desktop Reset and Step buttons have explicit names; the "type mismatch" note in the Inspector says "on the connection, on the node" instead of a `↔`.
- **Nothing moved.** Every replaced icon takes the box its character had, measured before and after on desktop and mobile, in English and Arabic; the width of an edge label is unchanged. The arrows that follow the reader (external link, submenu, undo, redo) ship two drawings and pick one by direction, never a transform; the transport and the menu arrows keep theirs.
- A new check, `check:functional-glyphs`, fails when one of the replaced characters returns to a component or to a translation catalog. `©`, the formula characters, `＋ － ＝` and the names of control characters stay text on purpose.

**No migration.** A v0.15.2 file opens unchanged. The informational `meta.tool` string is now `loop-studio/0.15.3`.

## v0.15.2 — 2026-10-03

A fix release. The theme you chose was saved but not applied when the app started.

- **The saved theme comes back at start-up.** Since the two-tier toolbar (v0.10.0) the only code that read the saved theme was the toggle inside the Settings menu, which is mounted only while that menu is open, so a reload opened in the system theme and the saved one appeared when Settings (or, on a phone, the More sheet) was opened. The theme is now read and applied before the first render, through the storage port, and an unreadable or unknown value means the system theme.
- **No light flash before a dark start.** Reading the theme in the bundle is still too late for the browser's first paint: measured on the production build, one light frame on a phone-sized window and two on a slow network. A tiny classic script in the page head, the storage port's second door, reads the one key before anything is painted. It is scanned by the same check as the port and seen by the same run-time trap.

**No migration.** A v0.15.1 file opens unchanged, and the stored theme value and its key are the same. The informational `meta.tool` string is now `loop-studio/0.15.2`.

## v0.15.1 — 2026-10-03

A fix release. The playback bar grew taller than the space the layout gave it, and the layout did not notice.

- **On a phone**, the run bar wraps to a second row at 320 and 340 px in every language, at 360 px in eleven languages, and at 390 px in six. The canvas reserved a constant 52 px for it, so 49 px of canvas, and the whole attribution line, sat under a 101 px bar. The bar now measures its own height and everything that keeps clear of it reads that measurement: the canvas padding, the More and Help sheets, the Timeline sheet, the zoom buttons and the update notice.
- **In a narrow desktop window** (under about 950 px, or 1000 px in German), the playback strip wraps to a second or third row while the collapsed timeline kept a constant height of 40 px, so the wrapped controls lay 25 to 54 px below the bottom of the window, where they could not be reached. The collapsed timeline is now as tall as its strip.
- Nothing is removed from the bar to make it fit, and nothing about running or saving changes.

**No migration.** A v0.15.0 file opens unchanged. The informational `meta.tool` string is now `loop-studio/0.15.1`.

## v0.15.0 — 2026-10-03

The release where the app starts saying what changed. Until now an update arrived silently: the screen looked different and nothing said why. A returning visitor now gets a one-line notice, and the Help menu keeps a What's new page. This is also the version that the Timeline series selector and the refreshed light theme belong to: both reached the site after v0.14.0 while it still said `0.14.0`.

**No migration.** A v0.14.0 file opens unchanged. A saved file can now carry `"timelineSeries": "all"`, written when you choose `Show all` on the Timeline; v0.14.0 ignores that value and draws every series, which is what it means. The informational `meta.tool` string is now `loop-studio/0.15.0`.

### Added

- **An update notice.** On the first launch after an update, a browser that has used Loop Studio before sees one line naming the new version, with a button that opens the notes and a button that closes it. It does not take focus, does not time out, and never touches the document, the run or the selection. A first visit sees nothing. If the update bar, the filter panel, a tour or a note about something you just did is on screen, the notice waits for it.
- **What's new, in the Help menu.** Every release note, newest first, readable at any time and offline. A `New` marker stays on the item until you have opened the newest entry; closing the notice does not clear it. The notes ship inside the app in all eighteen languages, and nothing is fetched.
- **A series selector on the Timeline.** The `Series` button chooses which series the chart draws. `Show all` keeps showing every series, including ones added later; a hand-picked set stays exactly what you picked. The legend is one row in every state.

### Changed

- **The Help menu is grouped, and its items say what they do.** `Take a tour` is `Restart the tour`. `Contextual help` is `Turn contextual tips back on`, because that screen never was a help document: it only re-arms the short one-time notes. Its dialog is `Manage contextual tips`, with `Show next time it applies` and `Will show`. The order is the tour and the tips, then What's new, then feedback and About, on desktop and in the mobile Help sheet alike.
- **A document with no saved series choice draws at most eight series**, the first eight in document order, instead of every Pool and Register line. Fifty-five lines in one chart told nobody anything. The choice is saved with the document once you make one.
- **The light theme.** One cool palette for the page, the panels and the overlays. Containers, dialogs and popovers have a 12 px radius and standard controls 8 px. Keyboard focus on a bordered control is the boundary in the focus colour plus a halo. The dark theme keeps its own palette.

### Fixed

- **The data-import dialogs' text fields** were unstyled browser controls, white with black text in the dark theme too. They are shell controls now.
- **On a phone, a dialog opened from a sheet is drawn on top.** About, the contextual-tips dialog and the export-author dialog used to sit in the sheet's layer, under the run bar and the "Open a file" card; on a fresh profile that card covered the contextual dialog's title and close button. Every dialog is now drawn in one layer above both, the card sits below an open sheet instead of over its first row, and focus stays inside a dialog opened from a sheet.
- **Under forced colours** every removed outline is back as a real system-colour outline, and the canvas and plot grids name a system colour instead of showing the light palette through a high-contrast theme.

### Notes

From this release on, a change that a person can see ships with its version and its release note in the same change. A merge to `main` is the production deploy, so there is no later release to carry them. `npm run check:change-declaration` holds that line in CI: a change to anything that is built or shipped adds a `.changes/<slug>.json` saying whether it is user-facing, and a user-facing one must raise the version and name a release note that exists in all eighteen languages. The rule and the stored state behind the notice are in [`docs/release-notes.md`](docs/release-notes.md).

Browser storage is now reached through one module, guarded at source and at run time. Nothing a person sees changed by that; it is groundwork for the shared-device work.

The notice's accessibility is checked structurally: the accessibility tree, the tab order and the number of times the live region changes. That is not a screen-reader test, and what a real screen reader says has not been confirmed on any platform. The release-note lines in the sixteen languages other than Korean and English are translations of this project's own text; no locale in this release has had a professional translation review, and none is claimed.

### Included pull requests

<details>
<summary>Merged since v0.14.0</summary>

- Features: [#294](https://github.com/MerciHanrim/loop-studio/pull/294), [#295](https://github.com/MerciHanrim/loop-studio/pull/295), and the pull request that carries this entry
- Fixes: [#293](https://github.com/MerciHanrim/loop-studio/pull/293)
- Internal: [#299](https://github.com/MerciHanrim/loop-studio/pull/299), [#304](https://github.com/MerciHanrim/loop-studio/pull/304)

</details>

## v0.14.0 — 2026-09-30

A localization release, and the first one that had to change how the app is laid out. Loop Studio went from eleven languages to eighteen, and the eighteenth is Arabic — the first right-to-left locale, which meant the UI had to mirror while the model graph kept its own left-to-right coordinate space.

**No project-file change.** The project schema and the saved fields are unchanged and no migration is needed, so a v0.13.0 file opens in v0.14.0 without conversion. The only difference in a newly saved file is the informational `meta.tool` version string, now `loop-studio/0.14.0`.

### Added

- **Seven new languages**, bringing the UI to eighteen: Arabic, Dutch, Italian, Russian, Thai, Turkish and Vietnamese — alongside Chinese (Simplified and Traditional), English, French, German, Japanese, Korean, Portuguese (Brazil and Portugal) and Spanish (Latin America and Spain). The full list, with codes, is in the [README](README.md#languages).
- **Right-to-left layout.** Choosing Arabic mirrors the app chrome — toolbar, menus, panels, dialogs and the mobile sheet — while the diagram itself keeps its left-to-right coordinate space, so a model does not change shape when you change language. Numbers, identifiers and Latin technical terms inside an Arabic sentence keep their own direction and are never reversed or broken apart.
- **A group frame's title, colour and size can be edited from the frame itself** — the title chip opens a properties popover instead of sending you elsewhere.

### Changed

- **Every CSV this app downloads is now written by one writer.** The record separator is CRLF and fields follow RFC 4180, so a label containing a comma, a quote or a newline survives the round trip; the file is UTF-8 with a byte-order mark so Excel on Windows opens it in the right encoding. *This changes the bytes of downloaded CSV files.* Before this, five of the six writers joined rows with a bare newline and replaced a comma, quote or newline inside your own label with a space — silently destroying it. A label is your text, and an export must not edit it.
- **A frame title written in one language no longer sticks.** A document whose frame titles were created in Simplified Chinese kept them in every language afterwards while its node labels switched correctly; once a document entered one of the six hyphenated locales it could not leave. Frame titles now follow the UI language like everything else.
- **The Thai quotation of the Google Sheets download menu** now matches what that menu actually says.

### Notes

The per-locale decisions — the glossary each language fixed, what was deliberately left in English, the plural and number-format measurements, and the open questions each catalog carries — are recorded in [`docs/localization.md`](docs/localization.md). No locale in this release has had a professional translation review, and none is claimed.

Arabic also brought the right-to-left work recorded in §L9 of the same document: the app chrome mirrors while the diagram keeps its own coordinate space, and a user value placed inside a translated sentence is isolated so it cannot be reordered.

Added automated DOM and Chrome accessibility-tree regression coverage for status text and descriptions in English and Arabic.

A build-time locale checker that could be silently disabled by re-indenting the registry now fails closed, and the Thai locale's six carried-over review items were measured and triaged.

### Included pull requests

<details>
<summary>18 merged pull requests</summary>

- Features: [#274](https://github.com/MerciHanrim/loop-studio/pull/274), [#275](https://github.com/MerciHanrim/loop-studio/pull/275), [#276](https://github.com/MerciHanrim/loop-studio/pull/276), [#279](https://github.com/MerciHanrim/loop-studio/pull/279), [#280](https://github.com/MerciHanrim/loop-studio/pull/280), [#282](https://github.com/MerciHanrim/loop-studio/pull/282), [#283](https://github.com/MerciHanrim/loop-studio/pull/283), [#284](https://github.com/MerciHanrim/loop-studio/pull/284), [#286](https://github.com/MerciHanrim/loop-studio/pull/286), [#288](https://github.com/MerciHanrim/loop-studio/pull/288), [#289](https://github.com/MerciHanrim/loop-studio/pull/289)
- Fixes: [#277](https://github.com/MerciHanrim/loop-studio/pull/277), [#278](https://github.com/MerciHanrim/loop-studio/pull/278), [#285](https://github.com/MerciHanrim/loop-studio/pull/285), [#287](https://github.com/MerciHanrim/loop-studio/pull/287)
- Tests: [#291](https://github.com/MerciHanrim/loop-studio/pull/291)
- Docs: [#273](https://github.com/MerciHanrim/loop-studio/pull/273), [#281](https://github.com/MerciHanrim/loop-studio/pull/281)

</details>

## v0.13.0 — 2026-09-23

A localization release. Loop Studio went from three languages to eleven, and the regional pairs are real locales rather than one catalog with a flag on it — European and Brazilian Portuguese, Spain and Latin American Spanish, and Simplified and Traditional Chinese each get their own catalog, their own plural rules and their own number formatting.

**No save-format change, no migration and no breaking change.** Files written by v0.12.0 open unchanged, and files written by v0.13.0 open in v0.12.0; the only difference in a new file is the informational `meta.tool` version string.

### Added

- **Eight new languages**, bringing the UI to eleven: Chinese (Simplified), Chinese (Traditional), French, German, Spanish (Latin America), Spanish (Spain), Portuguese (Brazil) and Portuguese (Portugal) — alongside the existing English, Korean and Japanese. The full list, with codes, is in the [README](README.md#languages).
- **Your browser's language is honoured, down to the region.** A first visit follows `navigator.languages`, and a regional request gets the regional catalog: `pt-PT` reaches European Portuguese while `pt` and `pt-BR` reach Brazilian, `es-ES` reaches Spain while `es` and `es-MX` reach Latin America, and `zh-TW` / `zh-HK` reach Traditional while `zh-CN` reaches Simplified. A tag with no catalog of its own falls back to the closest one that has it, and only then to English. The choice is remembered per device, and switching never touches your diagram.
- **Bundled Templates and modules speak the UI language too.** Node labels and frame titles in the five bundled Templates, and the labels an inserted module brings with it, are translated per locale — a translated menu that inserts English node names is a half-translated product. Labels you have edited yourself are never overwritten.

### Changed

- **The language picker is sorted and searchable.** Languages are listed by English name rather than in the order they happened to ship, so a regional pair sits next to its sibling, and the search box matches a language's own name, its name in the current UI language, its English name or its code.
- **Long translations fit.** Descriptive copy, menu blurbs and inline hints were measured in the boxes that actually render them, per language, and the wrapping rules are scoped by locale instead of applied globally.
- **Chinese text renders with Chinese fonts.** Em dashes and other punctuation shared with Latin scripts were falling back to a Latin face mid-sentence; the font stack now narrows by character range so a Chinese sentence stays in one typeface.
- **Accessibility and terminology corrections found while translating.** Parser errors say *character position* rather than *column* — the two were the same word in several languages and meant different things; a disabled row in the mobile sheet is distinguishable without relying on colour alone; and every non-English catalog now says, inside the link, that the feedback form is in English.
- Localization test reliability.

### Notes

The per-locale decisions — the glossary each language fixed, what was deliberately left in English, the plural and number-format measurements, and the open questions each catalog carries pending a native-speaker review — are recorded in [`docs/localization.md`](docs/localization.md). No locale in this release has had a professional translation review.

### Included pull requests

<details>
<summary>19 merged pull requests</summary>

- Features: [#255](https://github.com/MerciHanrim/loop-studio/pull/255), [#256](https://github.com/MerciHanrim/loop-studio/pull/256), [#259](https://github.com/MerciHanrim/loop-studio/pull/259), [#262](https://github.com/MerciHanrim/loop-studio/pull/262), [#266](https://github.com/MerciHanrim/loop-studio/pull/266), [#268](https://github.com/MerciHanrim/loop-studio/pull/268), [#270](https://github.com/MerciHanrim/loop-studio/pull/270), [#271](https://github.com/MerciHanrim/loop-studio/pull/271)
- Fixes: [#254](https://github.com/MerciHanrim/loop-studio/pull/254), [#257](https://github.com/MerciHanrim/loop-studio/pull/257), [#258](https://github.com/MerciHanrim/loop-studio/pull/258), [#260](https://github.com/MerciHanrim/loop-studio/pull/260), [#261](https://github.com/MerciHanrim/loop-studio/pull/261), [#267](https://github.com/MerciHanrim/loop-studio/pull/267), [#269](https://github.com/MerciHanrim/loop-studio/pull/269)
- Tests: [#263](https://github.com/MerciHanrim/loop-studio/pull/263), [#264](https://github.com/MerciHanrim/loop-studio/pull/264), [#265](https://github.com/MerciHanrim/loop-studio/pull/265)
- Chores: [#272](https://github.com/MerciHanrim/loop-studio/pull/272)

</details>

## v0.12.0 — 2026-09-21

Group frames stop being decoration: one carries its contents when you drag it, and the whole frame can be driven from the keyboard. The spreadsheet import wizard explains itself in place. And the largest theme of the release is a sustained accessibility pass — forced colours, control boundaries, descriptive text and focus handling — decided on measured pixels rather than by eye.

**No save-format change, no migration and no breaking change.** Files written by v0.11.0 open unchanged, and files written by v0.12.0 open in v0.11.0; the only difference in a new file is the informational `meta.tool` version string.

### Added

- **A frame drag carries its contents** ([`docs/large-graph-readability.md`](docs/large-graph-readability.md) §LGR6.5) — moving a group frame moves the nodes inside it. Membership is derived at the moment the drag starts, so nothing new is written to the file; holding `Alt` moves the frame alone. The whole gesture is a single undo entry, and a locked canvas or the mobile view keeps frames view-and-select only.
- **A group frame can be used from the keyboard** ([`docs/large-graph-readability.md`](docs/large-graph-readability.md) §LGR6.6) — a frame can be focused, moved, resized and deleted without a pointer, `Delete` and `Backspace` have exactly one owner, and each action is announced. Added as a capability, and the reason it was built is accessibility: a frame was previously reachable only by mouse.
- **The spreadsheet import wizard explains itself** ([`docs/data-import.md`](docs/data-import.md) §DI17) — a collapsible quick start with a one-click worked example, role help on every column select, a per-table count line, inline validation errors that point at the offending cell, and a review breakdown computed from the same plan summary the commit uses.
- **Arrow-key navigation in the descriptive menus** — Templates, Insert module and File answer Arrow / Home / End with wrapping, separators and disabled rows are skipped, and `Escape` returns focus to the trigger.

### Changed

- **Clicking a node no longer rebuilds every orthogonal route** — the route map is now keyed on the layout it was built from (node bounds and visibility, the orthogonal edges' endpoints, handles and waypoints) instead of on array identity, so a selection change, which hands the canvas a new node array, reuses the current generation. Moving, resizing, hiding a node or changing an edge's routing input still rebuilds, and a rebuild is byte-identical to a fresh load. On the two largest bundled templates a click used to spend 18–27 ms (CPU ×1) or 90–130 ms (CPU ×4) rerouting.
- **Tooltips and descriptive menus are readable** — the node tooltips and menu blurbs go from 11 px to 12.5 px, Korean descriptions no longer break in the middle of a word, the Templates popover widens to 300 px so no description is cut by its two-line clamp, and the menu blurb takes a colour that clears 4.5:1. A palette tooltip now closes on `Escape` and survives the pointer travelling onto it to be read.
- **The probabilistic gate is described correctly** in English, Korean and Japanese — it picks at most one branch per step; it does not split the incoming resource by probability.

### Fixed

- **An arrow-key node move is one undo entry** — it used to undo the *previous* edit instead.
- **A Register expression no longer reorders what you type** — the caret and focus restore after an `@` reference pick, an operator-keypad press or an arm-and-click canvas insert was deferred to the next animation frame, which on a busy main thread arrived up to seconds later and pushed aside anything typed in the gap; two of the possible interleavings also left the stored expression disagreeing with the visible one.
- **The import wizard no longer takes focus back** — "Use this example" scrolled to and focused the new card a frame after the click, which could pull focus off the role select you had tabbed to, off the summary a failed check had just announced, or out of the data box mid-sentence, sending the rest of what you typed into the table name.
- **Forced colours** — active edges keep a Highlight dash-dot / long-dash tell at low zoom; inactive and route-invalid edges take the system `GrayText`, with a forced-colours-only 1.5 px inactive stroke; pressed rail toggles keep their keyboard focus ring and the activity edge tell drops its halo.
- **Control boundaries** — `.btn`, the PlayBar's `.pb-btn` and the Timeline's CSV button draw a ≥ 3:1 boundary from the shared control tokens, on the desktop and inside a mobile sheet.
- **A mobile sheet's secondary labels** keep 4.5:1 when a row is hovered or keyboard-focused, in the More, Templates and Export sheets; disabled rows retain their existing treatment.

### Internal

- The region-select marquee is kept inside the pane, removing the `Esc`-during-a-box flake.
- The run-distinction block runs under real reduced motion, with its one baseline re-taken.
- The unreachable `--state-warning` border on a hovered ghost button is gone — a no-render cleanup.
- Two e2e files that waited for a weaker state than the one they asserted now wait for the exact asserted state.

### Included pull requests

<details>
<summary>18 merged pull requests</summary>

- Features: [#240](https://github.com/MerciHanrim/loop-studio/pull/240), [#243](https://github.com/MerciHanrim/loop-studio/pull/243), [#247](https://github.com/MerciHanrim/loop-studio/pull/247)
- Fixes: [#239](https://github.com/MerciHanrim/loop-studio/pull/239), [#241](https://github.com/MerciHanrim/loop-studio/pull/241), [#242](https://github.com/MerciHanrim/loop-studio/pull/242), [#244](https://github.com/MerciHanrim/loop-studio/pull/244), [#245](https://github.com/MerciHanrim/loop-studio/pull/245), [#248](https://github.com/MerciHanrim/loop-studio/pull/248), [#249](https://github.com/MerciHanrim/loop-studio/pull/249), [#250](https://github.com/MerciHanrim/loop-studio/pull/250), [#251](https://github.com/MerciHanrim/loop-studio/pull/251), [#252](https://github.com/MerciHanrim/loop-studio/pull/252)
- Performance: [#238](https://github.com/MerciHanrim/loop-studio/pull/238)
- Tests: [#236](https://github.com/MerciHanrim/loop-studio/pull/236), [#237](https://github.com/MerciHanrim/loop-studio/pull/237)
- Chores: [#246](https://github.com/MerciHanrim/loop-studio/pull/246), [#253](https://github.com/MerciHanrim/loop-studio/pull/253)

</details>

## v0.11.0 — 2026-09-19

Minor release: region select on the canvas, a much faster orthogonal router, and a rebuilt visual-test bed. No file-format or data-meaning change; documents, revision files and share links from v0.10.x open unchanged.

Selecting several nodes becomes a visible, named feature; the orthogonal router gets much faster without changing a route; and the test bed that guards the canvas is rebuilt — reviewed visual baselines, a per-capture tolerance policy, and a type-checked `e2e/`.

### Added

- **Region select** ([`docs/large-graph-readability.md`](docs/large-graph-readability.md) §LGR12) — a one-shot *select a region* tool on the desktop Controls rail: arm it, drag on empty canvas to rubber-band a selection, and the tool disarms itself. Shift-drag and Ctrl/Cmd-click keep working and the tool's label names them, so the keyboard gesture is no longer the only way to discover multi-selection. Arming it turns the Frame tool and Pan mode off (and either of those cancels it); `Esc` cancels the tool without touching the selection, a click with no drag clears both, and a cancelled pointer never leaves the tool armed. A persistent **"N nodes selected"** readout accompanies it — in the right column above the Inspector on desktop, and inside the read-only Inspector sheet on mobile when two or more nodes are selected — never on the canvas, where it could cover a node.

### Changed

- **The orthogonal connector routes the same paths, much faster and with far less memory** — the §ER3 router keeps its ruler grid, its free-point and neighbour rules, its cost function, its tie-break order and its expansion budget; only the bookkeeping changed (lattice-indexed typed arrays instead of string-keyed maps, per-ruler obstacle coverage instead of rescanning every obstacle for every probe, and a binary heap instead of a linear scan of the open list). A full route rebuild drops from 380 ms to 24 ms on the gacha template and from 724 ms to 39 ms on the MMO one; on a 144-edge stress graph peak heap falls from 150 MB to 28 MB and garbage-collection time from 1.4 s to 0.1 s over one drag. Routes are byte-identical: a golden fixture and a differential test against a frozen copy of the previous implementation cover every bundled example, a boundary corpus, the stress graph and 3,000 seeded layouts, so `ROUTER_VERSION` is unchanged. The search lattice is then built per obstacle instead of per cell — filling the grid had been 27–42 % of a route build while the search visited under 5 % of it — verified route for route at every pointer position of two full drag gestures with zero mismatches.
- **Smoother node drags** — the canvas no longer hands React Flow a fresh options object on every render, so a pointer move re-renders only the edges attached to the moving node instead of every edge on the canvas; the drag-phase frame p95 falls by 10–11 % on the bundled MMO and gacha templates.

### Fixed

- **A selected node is never dimmed by Focus mode** — with several nodes selected, the ones outside the anchor node's neighbourhood were faded to 26 % while still selected (7 of 10 in a marquee selection on the MMO template read as three). A node the user has selected now always stays legible; the focus calculation itself is unchanged.
- **Register / Parameter values are never clipped** — the rounded-rim inset that came with the node shells was a cyclic percentage: it was carved out of the value column *after* the node had been sized, so a value such as `370370.34` rendered as `370370.3…` on any node wider than about 129 px. The rim is now a margin on the two corner lines only and the value line keeps its full column; every node in the bundled examples keeps a byte-identical size.

### Internal

- **Visual baselines reviewed and refreshed** — an audit found 40 of the 46 Playwright pixel baselines silently out of date: the single 2 % tolerance had absorbed eight releases of drift, including a Pool value changing outright. Every image was reviewed one by one and 41 regenerated, with new DOM assertions pinning the states the shots assume.
- **Per-capture-kind snapshot tolerance** ([`docs/visual-snapshot-policy.md`](docs/visual-snapshot-policy.md)) — the real cross-machine variance was measured on three independent Windows runners and a local machine (runner ↔ runner: identical; local ↔ runner: text rasterisation only), then the tolerance was set per capture kind, from 0.5 % for a desktop full page down to 0.02 % for a desktop canvas clip, with a guard that keeps every baseline under exactly one policy and every shot on the shared helper. Against the old baselines the policy fails 40 of the 41 real drifts.
- **`e2e/` is type-checked by `tsc -b`** — a dedicated TypeScript project now covers the Playwright specs, helpers and configs; the 51 errors it surfaced were fixed by cause, and four `test.use({ reducedMotion | forcedColors })` blocks that Playwright had silently ignored now apply their emulation through `contextOptions` (a fifth was dropped pending a baseline decision).
- **Characterisation tests** — the playback cascade is observed from before `play()` with emit order judged per transition, and what an `@id` Parameter reference may resolve to is pinned.

### Included pull requests

<details>
<summary>13 merged pull requests</summary>

- Features: [#229](https://github.com/MerciHanrim/loop-studio/pull/229)
- Fixes: [#228](https://github.com/MerciHanrim/loop-studio/pull/228), [#230](https://github.com/MerciHanrim/loop-studio/pull/230), [#231](https://github.com/MerciHanrim/loop-studio/pull/231)
- Performance: [#224](https://github.com/MerciHanrim/loop-studio/pull/224), [#225](https://github.com/MerciHanrim/loop-studio/pull/225), [#227](https://github.com/MerciHanrim/loop-studio/pull/227)
- Tests: [#222](https://github.com/MerciHanrim/loop-studio/pull/222), [#226](https://github.com/MerciHanrim/loop-studio/pull/226), [#232](https://github.com/MerciHanrim/loop-studio/pull/232), [#233](https://github.com/MerciHanrim/loop-studio/pull/233), [#234](https://github.com/MerciHanrim/loop-studio/pull/234)
- Chores: [#235](https://github.com/MerciHanrim/loop-studio/pull/235)

</details>

## v0.10.2 — 2026-09-17

Patch release: the runtime defects found by the post-v0.10.0 codebase audit. No file-format or data-meaning change; documents, revision files and share links from v0.10.0 / v0.10.1 open unchanged.


### Fixed

- **Autosave failures are no longer silent, and a last-moment edit is no longer lost** — when the browser refuses the autosave record (its storage quota is exhausted — reproduced with two 20,000-row data-import tables on Chromium — or storage is blocked) the app now shows a persistent notice with an *Export Graph JSON* button instead of silently keeping nothing from that moment on; the notice clears by itself once a save succeeds again. The pending autosave is also written immediately when the page is hidden or unloaded, so an edit made in the last 400 ms before a reload / close (reproduced at 150 ms) is kept.
- **Share links and saved frames / data-import records** — opening a `#g1=` share link kept the *previous* document's group frames and data-import table records (they leaked into the shared graph and its next Export / revision digest) and dropped the frames the link itself carried. A link now replaces both, exactly like a file Import does.
- **Negative or non-finite Pool values no longer break the run** — typing a value below 0 (or `1e400`) into a Pool's Starting amount / Capacity used to reach the store, where the engine's refusal threw inside a store subscriber: a console error, a Reset that kept failing, Monte-Carlo staleness and the project's unsaved flag silently skipped, and the bad value autosaved. The Inspector now keeps an invalid entry as a local draft (with a hint) and commits only a valid number; a bad value that arrives from a hand-edited file is shown as a run-strip notice with Play / Step disabled instead of an error.
- **Untranslated messages and stale menu paths** — the Project-revision / proposal export refusals, the share-link replace prompt, the import structural / model-layer warnings, the graph-file read errors and the Monte-Carlo "Cancelled" note are now in the active language (EN / KO / JA); the canvas node's accessible name uses the localized kind and state words; messages and the example READMEs that still said `Export ▾ → …` now say `File ▾ → …` (the v0.10.0 toolbar), two of them in the inline help. The i18n surface check also scans stores / ui helpers for English `alert` / `confirm` literals.

### Internal

- `strict` is now written explicitly in both tsconfigs instead of being inherited from the TypeScript 6 default, and `useT()` returns a locale-stable function so effects that list `t` as a dependency no longer re-run on every render.

### Notes

- The notes as published at the time: [CHANGELOG.md § v0.10.2](https://github.com/MerciHanrim/loop-studio/blob/v0.10.2/CHANGELOG.md#v0102--2026-09-17).

### Included pull requests

<details>
<summary>5 merged pull requests</summary>

- Fixes: [#217](https://github.com/MerciHanrim/loop-studio/pull/217), [#218](https://github.com/MerciHanrim/loop-studio/pull/218), [#219](https://github.com/MerciHanrim/loop-studio/pull/219)
- Chores: [#220](https://github.com/MerciHanrim/loop-studio/pull/220), [#221](https://github.com/MerciHanrim/loop-studio/pull/221)

</details>

## v0.10.1 — 2026-09-16

Patch release: Project revision / proposal files of a `@parameter` document.

**Recovers the Project revision / proposal files v0.10.0 exported for `@parameter` (loop-model/2) documents, and preserves the document's model version.** Files written by v0.10.0 with the wrong (v1) envelope are read back as v2 when their content digest proves it — the project header is adopted and the graph runs with its `@parameter` references intact. “Open as a document” keeps the proposal's own model version; Apply keeps the open document's version and refuses a v1 ↔ v2 cross-version proposal. New exports carry the correct envelope. Genuine v1 files are unaffected.


### Fixed

- **Project revision / proposal files of a `@parameter` (loop-model/2) document** — v0.10.0 wrote every revision and proposal with the v1 envelope `"schema": "loop-studio/graph"` while computing `project.contentDigest` under the v2 projection, so such a file failed its own integrity check on import (the project header was dropped with a misleading "edited outside Loop Studio?" warning) and its graph loaded as v1 — every `@…` flow silently ran as the literal `1`. Both bundled v2 Templates (Coffee roastery, 3-zone gacha) were affected. Now: the writer emits the document's real envelope (`loop-studio/graph/2`) and projects a proposal's first-creation `base` at the same version; the reader recovers an already-exported v0.10.0 file **only** when its `project.contentDigest` verifies under the v2 projection (digest is the proof — nothing else ever promotes a file; a file that matches neither projection is dropped exactly as before, and genuine v1 files are untouched). Apply keeps the open document's model version and refuses a v1 ↔ v2 cross-version proposal before anything changes (`version-mismatch`, whole and per-hunk); "Open as a document" preserves the proposal's own version. A recovered legacy proposal's v1-projected `base` is read verbatim, so it classifies as `unknown` (confirmation kept) rather than being promoted to `exact`. Fixtures: `examples/revision-legacy-v0.10.0/`.

### Notes

- A patch on top of v0.10.0; the `v0.10.0` tag itself is untouched. Legacy fixtures: `examples/revision-legacy-v0.10.0/`.

### Included pull requests

<details>
<summary>3 merged pull requests</summary>

- Fixes: [#215](https://github.com/MerciHanrim/loop-studio/pull/215)
- Documentation: [#214](https://github.com/MerciHanrim/loop-studio/pull/214)
- Chores: [#216](https://github.com/MerciHanrim/loop-studio/pull/216)

</details>

## v0.10.0 — 2026-09-16

Data import, a fifth Template, tunable activator thresholds, conditional post-pull state updates, and a reorganized desktop toolbar.

### Added

- **Spreadsheet data import** ([`docs/data-import.md`](docs/data-import.md)) — paste or upload a CSV/TSV snapshot across multiple linked tables (joined by shared key columns, no formulas). Numeric cells materialize as ordinary, editable Parameter nodes; import does not auto-wire them into the graph's flows, Registers, or activators, while source provenance is retained for refresh. No live connection, no OAuth, and Loop Studio never writes back to the source file.
- **Data refresh, three-way diff & change-proposal export** — re-paste the same binding's updated data and **Refresh** walks the full row lifecycle (added / missing / value-changed / key-changed) against a real base / local / incoming three-way diff; a genuine conflict prompts *apply incoming* or *keep mine*, and a foreign-key re-point is always surfaced, never auto-applied. A **change-proposal CSV** export lets a designer paste tuned values back into their own spreadsheet by hand.
- **3-zone gacha banner comparison Template** — a fifth bundled Template comparing **General/Free** (base rates), **Premium Standard** (a tunable hard-pity ceiling), and **Premium Pickup** (hard-pity plus a pickup guarantee) side by side, 200 pulls per zone under identical run settings, with real hit-rate / pickup-rate results and a Monte Carlo outcome distribution.
- **`@parameter` activator references** ([`docs/parameter-activator.md`](docs/parameter-activator.md)) — an activator's comparison threshold can reference a Parameter node (optionally ± one integer offset) instead of only a hardcoded literal, with a live resolved-value preview in the Inspector.
- **Conditional post-pull state updates** ([`docs/conditional-state-update.md`](docs/conditional-state-update.md), [`docs/label-timing-authoring.md`](docs/label-timing-authoring.md)) — a `label` modifier can now apply in a new **Phase 2.5**, immediately after that step's pull, conditioned on whether the specific Gate / Converter / Drain / End it's attached to actually fired — letting a counter update or reset within the very same step a hard-pity-style condition resolves, something a `phase0` label (evaluated before the pull) could not express. The Inspector offers this as two named presets — **Always** (today's behaviour) or **When the source fires** — that cannot construct an invalid `timing`/`when` combination.
- **Desktop two-tier toolbar** — project/app commands (Templates, Insert module, **File**, **Data**, Share, **Settings**, Help) collapse to one fixed row; the node palette keeps its own row underneath. New/Import/ Export are unified under **File ▾**; Theme/Language move under **Settings ▾**.

### Changed

- **Gacha Template canvas readability** — a Parameter reference used in a resource flow or an activator threshold now shows its resolved current number instead of the raw internal id (with a translated fallback for a dangling/invalid reference); connector routing and label placement were retuned to remove overlaps in the busiest zones.
- **Data import wizard UX** — **Next** now stays disabled until every table draft has both a name and pasted data, so a downstream validation error can no longer surface before that basic precondition is met; the fixable-now root causes are flagged inline on the same screen instead of a separate error step; the table-name field, upload/delimiter controls, and layout were cleaned up. Help's position among the toolbar's inline actions was also pinned last at the time — since superseded by this release's own two-tier toolbar reorganization, above.
- **Playback default speed** — a fresh document's default step speed is now medium-fast (600 ms) instead of the slowest stop.
- **Bundled module labels** — inserting a bundled Building block into a KO/JA document localizes its labels on that fresh insert; a later EN/KO/JA switch now keeps that instance's still-unedited official labels in sync too, in both the menu-insert and canvas-drag-insert paths, without touching any label the user has since renamed ([`docs/bundled-module-label-localization.md`](docs/bundled-module-label-localization.md)).
- **In-app feedback** — the Help menu's `Send feedback` link now opens Tally instead of Typeform.

### Fixed

- **Pull-all Converter conservation** — an all-or-nothing Converter that couldn't reach full flow because an upstream Gate or router only offered a partial amount used to silently destroy that resource instead of holding back; the engine now probes the full pull graph first and disables a short Converter before committing the step.
- **Japanese font fallback** — corrected a CJK font-fallback issue affecting Han-unification rendering in the Japanese UI.
- **Canvas edit-lock persistence** — the edit lock no longer resets on a page reload or a PWA update.
- **Confirm-dialog double-click guard** — a rapid double-click on a `ConfirmDialog`'s Confirm button (Export, New, module promote, …) could run the confirmation action twice; it now fires at most once per open.
- **Locale-switch stall** — a duplicate, redundant per-node re-measurement alongside React Flow's own automatic one turned a multi-node document's locale switch into a multi-second stall (worst case 6–7s); removing the redundant call cut that to about 1s without any loss of measurement correctness.
- **Toolbar menu outside-dismiss** — an open Tier-1 menu (Templates, Insert module, File, Data, Settings, Help, the `⋯` overflow) no longer closed on a canvas node click, a canvas pan, or a scroll outside it — a regression from the two-tier toolbar reorganization above.
- **Palette tooltip visibility** — the hover/keyboard-focus tooltip on any of the 8 node-creation chips was invisible at every desktop width, silently clipped by the toolbar palette's own horizontal-scroll container — another regression from the same reorganization.

### Compatibility

- **`@parameter` activators** (`loop-state/4`, [`SEMANTICS-S4.md`](docs/specs/SEMANTICS-S4.md)) need no new revision format and no migration. An **unmodified** existing document's projection and digest are unchanged. Committing a `@parameter` reference in an activator engages the existing `loop-model/2` v1→v2 `modelVersion` latch (never on load, only on that edit) — the same one-way promotion a resource-edge flow already triggers. Actually editing an activator's `expr` or a Parameter's `value` is real content change and moves the digest exactly as it already does today, with or without this feature.
- **Conditional post-pull labels** (`loop-state/3`, `loop-revision/6`) — an existing label edge (which has never had a `timing`/`when`) opens and reads as **Always**, byte-identical to today. A document that actually uses the new **When the source fires** timing *does* move its revision content digest and workspace digest — that's real engine behaviour, not cosmetic, so a revision or workspace comparison correctly reports it as a genuine change rather than noise.

### Included pull requests

<details>
<summary>38 merged pull requests</summary>

- Features: [#181](https://github.com/MerciHanrim/loop-studio/pull/181), [#183](https://github.com/MerciHanrim/loop-studio/pull/183), [#188](https://github.com/MerciHanrim/loop-studio/pull/188), [#189](https://github.com/MerciHanrim/loop-studio/pull/189), [#195](https://github.com/MerciHanrim/loop-studio/pull/195), [#197](https://github.com/MerciHanrim/loop-studio/pull/197), [#202](https://github.com/MerciHanrim/loop-studio/pull/202), [#203](https://github.com/MerciHanrim/loop-studio/pull/203), [#209](https://github.com/MerciHanrim/loop-studio/pull/209)
- Fixes: [#179](https://github.com/MerciHanrim/loop-studio/pull/179), [#185](https://github.com/MerciHanrim/loop-studio/pull/185), [#186](https://github.com/MerciHanrim/loop-studio/pull/186), [#190](https://github.com/MerciHanrim/loop-studio/pull/190), [#192](https://github.com/MerciHanrim/loop-studio/pull/192), [#193](https://github.com/MerciHanrim/loop-studio/pull/193), [#198](https://github.com/MerciHanrim/loop-studio/pull/198), [#199](https://github.com/MerciHanrim/loop-studio/pull/199), [#206](https://github.com/MerciHanrim/loop-studio/pull/206), [#210](https://github.com/MerciHanrim/loop-studio/pull/210), [#211](https://github.com/MerciHanrim/loop-studio/pull/211), [#212](https://github.com/MerciHanrim/loop-studio/pull/212)
- Documentation: [#176](https://github.com/MerciHanrim/loop-studio/pull/176), [#178](https://github.com/MerciHanrim/loop-studio/pull/178), [#180](https://github.com/MerciHanrim/loop-studio/pull/180), [#182](https://github.com/MerciHanrim/loop-studio/pull/182), [#187](https://github.com/MerciHanrim/loop-studio/pull/187), [#191](https://github.com/MerciHanrim/loop-studio/pull/191), [#194](https://github.com/MerciHanrim/loop-studio/pull/194), [#196](https://github.com/MerciHanrim/loop-studio/pull/196), [#201](https://github.com/MerciHanrim/loop-studio/pull/201), [#208](https://github.com/MerciHanrim/loop-studio/pull/208), [#213](https://github.com/MerciHanrim/loop-studio/pull/213)
- Tests: [#184](https://github.com/MerciHanrim/loop-studio/pull/184)
- Chores: [#177](https://github.com/MerciHanrim/loop-studio/pull/177)
- Other: [#200](https://github.com/MerciHanrim/loop-studio/pull/200), [#204](https://github.com/MerciHanrim/loop-studio/pull/204), [#205](https://github.com/MerciHanrim/loop-studio/pull/205), [#207](https://github.com/MerciHanrim/loop-studio/pull/207)

</details>

## v0.9.0 — 2026-09-10

Expression authoring, ordered playback & in-app feedback. Four backward-compatible additions on top of v0.8.0 — no engine, schema, wire-contract, or digest change, and no new `loop-*/N` id.

### Added

- **Register expression authoring & readability** ([`docs/register-expression-authoring.md`](docs/register-expression-authoring.md)) — editing a Register formula after unlock no longer means reading and typing raw `@pool_mttqb36u_2` ids. An **`@` autocomplete** lists only Pool / Parameter / Register nodes, with self and dependent Registers disabled and a reason given; a **two-line read-back** spells the stored expression out by name (`Wallet + Savings`) and by value (`Wallet 3 + Savings 34 = 37`); a **`＋ Insert reference`** button arms a one-shot mode that inserts an `@id` at the caret when you click that node on the canvas; an **`＋ − × ÷ ( )` operator keypad** inserts expression-safe syntax and wraps a selection in parentheses, preserving the draft-until-valid undo contract. Content-aware Register / Parameter shells ([`docs/node-shell-content-in-vessel.md`](docs/node-shell-content-in-vessel.md)) keep the title, value and `= expression` line inside the drawn vessel across widths and locales. `@id` stays the sole stored form and the `loop-revision/2` digest is unchanged. EN / KO / JA.
- **Ordered playback cascade + steady-state** ([`docs/simulation-playback-ordering.md`](docs/simulation-playback-ordering.md)) — within a step, transfers now depart and arrive in **dependency order** (a staggered `τ` by longest-predecessor depth over the graph's SCC condensation) instead of one simultaneous pulse, with distinct **emit / converge / absorb** cues by role, and a “flows continue” **steady-state** chip once a run settles. Display layer only — no engine / RNG / GraphDoc change.
- **In-app feedback** — a **`Send feedback`** entry in the Help menu (desktop `?` and mobile More → Help) opens the feedback form in a new tab.
- **日本語 as a third shipped locale + multilingual layout** — the `ja` catalog and its template labels load as their own chunk on demand; two-line node titles and height-parametric node shells ([`docs/mmo-multilingual-layout.md`](docs/mmo-multilingual-layout.md)) let EN / KO / JA labels fit the same graph without overlap.
- **Large-graph readability follow-ups** — a collapsible minimap and a Timeline series picker: a Template's first-run chart shows a curated set of series, the rest one `+N more` click away. UI-only.

### Compatibility

- Presentation / render layer throughout — a document that does not use a new capability computes and hashes exactly as before.

### Notes

- The notes as published at the time: [README.md § Releases](https://github.com/MerciHanrim/loop-studio/blob/v0.9.0/README.md#releases).

### Included pull requests

<details>
<summary>36 merged pull requests</summary>

- Features: [#151](https://github.com/MerciHanrim/loop-studio/pull/151), [#153](https://github.com/MerciHanrim/loop-studio/pull/153), [#154](https://github.com/MerciHanrim/loop-studio/pull/154), [#155](https://github.com/MerciHanrim/loop-studio/pull/155), [#162](https://github.com/MerciHanrim/loop-studio/pull/162), [#163](https://github.com/MerciHanrim/loop-studio/pull/163), [#164](https://github.com/MerciHanrim/loop-studio/pull/164), [#170](https://github.com/MerciHanrim/loop-studio/pull/170), [#171](https://github.com/MerciHanrim/loop-studio/pull/171), [#174](https://github.com/MerciHanrim/loop-studio/pull/174)
- Fixes: [#140](https://github.com/MerciHanrim/loop-studio/pull/140), [#142](https://github.com/MerciHanrim/loop-studio/pull/142), [#165](https://github.com/MerciHanrim/loop-studio/pull/165), [#167](https://github.com/MerciHanrim/loop-studio/pull/167), [#168](https://github.com/MerciHanrim/loop-studio/pull/168)
- Documentation: [#143](https://github.com/MerciHanrim/loop-studio/pull/143), [#144](https://github.com/MerciHanrim/loop-studio/pull/144), [#160](https://github.com/MerciHanrim/loop-studio/pull/160), [#166](https://github.com/MerciHanrim/loop-studio/pull/166), [#172](https://github.com/MerciHanrim/loop-studio/pull/172), [#175](https://github.com/MerciHanrim/loop-studio/pull/175)
- Tests: [#169](https://github.com/MerciHanrim/loop-studio/pull/169)
- Chores: [#145](https://github.com/MerciHanrim/loop-studio/pull/145)
- Other: [#141](https://github.com/MerciHanrim/loop-studio/pull/141), [#146](https://github.com/MerciHanrim/loop-studio/pull/146), [#147](https://github.com/MerciHanrim/loop-studio/pull/147), [#148](https://github.com/MerciHanrim/loop-studio/pull/148), [#149](https://github.com/MerciHanrim/loop-studio/pull/149), [#150](https://github.com/MerciHanrim/loop-studio/pull/150), [#152](https://github.com/MerciHanrim/loop-studio/pull/152), [#156](https://github.com/MerciHanrim/loop-studio/pull/156), [#157](https://github.com/MerciHanrim/loop-studio/pull/157), [#158](https://github.com/MerciHanrim/loop-studio/pull/158), [#159](https://github.com/MerciHanrim/loop-studio/pull/159), [#161](https://github.com/MerciHanrim/loop-studio/pull/161), [#173](https://github.com/MerciHanrim/loop-studio/pull/173)

</details>

## v0.8.0 — 2026-09-05

Onboarding, part 2 & the Productization track. Localization, the guided first-run tour, the Early MMO example, and contextual inline help complete Onboarding, part 2; large-graph readability, a small module / template-composition system, dense-graph pan usability, and a first `loop-model/2` Template complete this cycle's slice of the Productization track.

### Added

- **Onboarding, part 2** — an N-language-extensible **localization** base shipping EN + KO, full-app translation with CI drift guards, a read-only six-step **guided first-run tour**, the **“Early MMO progression (levels 1–15)”** example as a third Template, and **contextual inline help**: four one-shot situational hints, each re-armable from a `Contextual help` entry on both Help surfaces.
- **Large-graph readability** ([`docs/large-graph-readability.md`](docs/large-graph-readability.md)) — a hit-test fix + selection-driven 1-hop focus view, ephemeral filters, the `effective` / `evaluated` run distinction, manual **and** auto-suggested group frames with a five-preset accent colour, and **saved frames** (`loop-revision/5`, [`SEMANTICS-R5.md`](https://github.com/MerciHanrim/loop-studio/blob/main/docs/specs/SEMANTICS-R5.md), Frozen) — a frame's `id`/`label`/`rect`/`color` becomes real document content that round-trips reload, Export / Import, Share, Workspace and revisions.
- **Small module / template-composition system** ([`docs/module-system.md`](docs/module-system.md)) — an **Insert module ▾** menu and **Extract selection as module…** (desktop only): every id re-issued, the whole candidate validated before anything changes, one atomic undo. A module is a plain Graph JSON — no new file kind. Alongside it, desktop **Inputs** and **Summary** panels read through to the canvas.
- **The Coffee roastery operations flow Template** — the first bundled `loop-model/2` graph ([`SEMANTICS-M2.md`](https://github.com/MerciHanrim/loop-studio/blob/main/docs/specs/SEMANTICS-M2.md), Frozen): a resource edge's `flow` may be a single Parameter reference the engine resolves once per step, so its five surfaced Parameters drive a real stock trajectory.
- **Dense-graph pan usability** ([`docs/dense-graph-pan.md`](docs/dense-graph-pan.md)) — a pan-capture overlay and a self-computed two-finger pinch zoom make a packed graph pannable and zoomable on both desktop and mobile, real-phone verified.

### Compatibility

- Two backward-compatible wire-contract extensions ship — `loop-model/2`, a real model-semantics addition, and `loop-revision/5`, a revision storage / comparison addition. Neither changes what an existing graph computes, and neither moves a document's digest unless it actually uses the new capability.

### Notes

- **Known limitations in this release:** module **Insert** / **Extract** are desktop only, with no mobile flow yet; a Graph or Workspace file re-saved by an older build does not preserve fields it doesn't recognise (no forward-compatible unknown-field passthrough).
- **Scenario Compare**, an advanced Monte-Carlo worker-count setting, manual waypoint editing, and the module system's later assembly-screen work were deliberately left for later.
- Earlier release history, back to v0.2.0 and before, is in the [CHANGELOG](https://github.com/MerciHanrim/loop-studio/blob/main/CHANGELOG.md).
- The notes as published at the time: [README.md § Releases](https://github.com/MerciHanrim/loop-studio/blob/v0.8.0/README.md#releases).

### Included pull requests

<details>
<summary>73 merged pull requests</summary>

- Features: [#69](https://github.com/MerciHanrim/loop-studio/pull/69), [#70](https://github.com/MerciHanrim/loop-studio/pull/70), [#72](https://github.com/MerciHanrim/loop-studio/pull/72), [#74](https://github.com/MerciHanrim/loop-studio/pull/74), [#75](https://github.com/MerciHanrim/loop-studio/pull/75), [#76](https://github.com/MerciHanrim/loop-studio/pull/76), [#77](https://github.com/MerciHanrim/loop-studio/pull/77), [#79](https://github.com/MerciHanrim/loop-studio/pull/79), [#83](https://github.com/MerciHanrim/loop-studio/pull/83), [#86](https://github.com/MerciHanrim/loop-studio/pull/86), [#87](https://github.com/MerciHanrim/loop-studio/pull/87), [#89](https://github.com/MerciHanrim/loop-studio/pull/89), [#95](https://github.com/MerciHanrim/loop-studio/pull/95), [#100](https://github.com/MerciHanrim/loop-studio/pull/100), [#103](https://github.com/MerciHanrim/loop-studio/pull/103), [#105](https://github.com/MerciHanrim/loop-studio/pull/105), [#106](https://github.com/MerciHanrim/loop-studio/pull/106), [#111](https://github.com/MerciHanrim/loop-studio/pull/111), [#113](https://github.com/MerciHanrim/loop-studio/pull/113), [#118](https://github.com/MerciHanrim/loop-studio/pull/118), [#120](https://github.com/MerciHanrim/loop-studio/pull/120), [#122](https://github.com/MerciHanrim/loop-studio/pull/122), [#125](https://github.com/MerciHanrim/loop-studio/pull/125), [#126](https://github.com/MerciHanrim/loop-studio/pull/126), [#128](https://github.com/MerciHanrim/loop-studio/pull/128), [#132](https://github.com/MerciHanrim/loop-studio/pull/132), [#134](https://github.com/MerciHanrim/loop-studio/pull/134)
- Fixes: [#71](https://github.com/MerciHanrim/loop-studio/pull/71), [#73](https://github.com/MerciHanrim/loop-studio/pull/73), [#85](https://github.com/MerciHanrim/loop-studio/pull/85), [#88](https://github.com/MerciHanrim/loop-studio/pull/88), [#91](https://github.com/MerciHanrim/loop-studio/pull/91), [#96](https://github.com/MerciHanrim/loop-studio/pull/96), [#97](https://github.com/MerciHanrim/loop-studio/pull/97), [#98](https://github.com/MerciHanrim/loop-studio/pull/98), [#108](https://github.com/MerciHanrim/loop-studio/pull/108), [#112](https://github.com/MerciHanrim/loop-studio/pull/112), [#127](https://github.com/MerciHanrim/loop-studio/pull/127), [#129](https://github.com/MerciHanrim/loop-studio/pull/129), [#136](https://github.com/MerciHanrim/loop-studio/pull/136), [#137](https://github.com/MerciHanrim/loop-studio/pull/137)
- Documentation: [#68](https://github.com/MerciHanrim/loop-studio/pull/68), [#80](https://github.com/MerciHanrim/loop-studio/pull/80), [#81](https://github.com/MerciHanrim/loop-studio/pull/81), [#82](https://github.com/MerciHanrim/loop-studio/pull/82), [#84](https://github.com/MerciHanrim/loop-studio/pull/84), [#92](https://github.com/MerciHanrim/loop-studio/pull/92), [#93](https://github.com/MerciHanrim/loop-studio/pull/93), [#94](https://github.com/MerciHanrim/loop-studio/pull/94), [#99](https://github.com/MerciHanrim/loop-studio/pull/99), [#101](https://github.com/MerciHanrim/loop-studio/pull/101), [#102](https://github.com/MerciHanrim/loop-studio/pull/102), [#104](https://github.com/MerciHanrim/loop-studio/pull/104), [#109](https://github.com/MerciHanrim/loop-studio/pull/109), [#110](https://github.com/MerciHanrim/loop-studio/pull/110), [#114](https://github.com/MerciHanrim/loop-studio/pull/114), [#115](https://github.com/MerciHanrim/loop-studio/pull/115), [#116](https://github.com/MerciHanrim/loop-studio/pull/116), [#117](https://github.com/MerciHanrim/loop-studio/pull/117), [#119](https://github.com/MerciHanrim/loop-studio/pull/119), [#121](https://github.com/MerciHanrim/loop-studio/pull/121), [#123](https://github.com/MerciHanrim/loop-studio/pull/123), [#124](https://github.com/MerciHanrim/loop-studio/pull/124), [#130](https://github.com/MerciHanrim/loop-studio/pull/130), [#131](https://github.com/MerciHanrim/loop-studio/pull/131), [#133](https://github.com/MerciHanrim/loop-studio/pull/133), [#138](https://github.com/MerciHanrim/loop-studio/pull/138)
- Tests: [#90](https://github.com/MerciHanrim/loop-studio/pull/90)
- Chores: [#67](https://github.com/MerciHanrim/loop-studio/pull/67), [#78](https://github.com/MerciHanrim/loop-studio/pull/78), [#107](https://github.com/MerciHanrim/loop-studio/pull/107), [#135](https://github.com/MerciHanrim/loop-studio/pull/135)
- Other: [#139](https://github.com/MerciHanrim/loop-studio/pull/139)

</details>

## v0.7.0 — orthogonal routing & simulation playback

Two render-layer additions on top of the same engine — the deterministic
simulation result and every serialized byte are unchanged.

- **Automatic orthogonal edge routing** ([`docs/edge-routing.md`](docs/edge-routing.md))
  — `route: "orthogonal"` swaps an edge's Bézier curve for right-angle
  segments from a deterministic obstacle-avoiding router. `route` /
  `waypoints` are `loop-revision/3` **cosmetic** wire fields — a graph using
  no routing has an unchanged content digest. Manual waypoint editing was
  deliberately deferred.
- **Simulation Playback / Event Choreography** ([`docs/simulation-playback.md`](docs/simulation-playback.md))
  — pressing Play makes the model move: a resource visibly departs, travels
  the exact rendered edge path, arrives, and only then does the value update,
  on a shared per-step time axis. State events choreograph too (`trigger` /
  `activator` / `label`). Handles `prefers-reduced-motion`, an L0 elision,
  background-tab freeze-and-recover, a mobile layout, an a11y live region,
  and a bounded on-screen token count. **Display layer only** — no new engine
  oracle.

## v0.6.0 — model language & canvas visual refresh

A small deterministic modelling layer on top of the engine, and one visual
grammar for the canvas. Edge geometry and Scenario Compare were deliberately
not in this release.

- **Parameter & Register nodes** — a `parameter` is a tuned numeric input; a
  `register` holds a `loop-expr/1` expression whose value `R(t)` is
  recomputed from the committed snapshot each step and stored nowhere. `/0`,
  a self/mutual cycle, an unknown reference, or a depends-on-invalid cascade
  each surface an error code and never halt the run.
- **Advisory `resourceType`** — a free-text tag on pools and resource edges
  with a built-in palette, icon, legend, and Inspector mismatch note. Purely
  advisory.
- **`loop-revision/2`** — the revision projection/diff/Apply extended for the
  model layer; a graph with no model layer is byte- and digest-identical to
  `loop-revision/1`.
- **Canvas Visual Refresh** ([`docs/visual-language.md`](docs/visual-language.md))
  — every node and edge on one "Vessel" grammar: edge class/direction/cues,
  three zoom detail levels that elide only supplementary text, a renderer-owned
  direction marker, `prefers-reduced-motion` and `forced-colors` support.
  Edge paths stayed on React Flow's Bézier route — orthogonal routing shipped
  in v0.7.0.

## v0.5.0 — project revisions & proposals

File-based **asynchronous collaboration** ([`SEMANTICS-R.md`](docs/specs/SEMANTICS-R.md))
— no accounts, no server, no real-time sync. A project moves between people
only as JSON files. See [`examples/revision/README.md`](examples/revision/README.md)
for a worked walkthrough of the create → propose → review → apply flow.

- **Project revision files** and **proposals** — `Export ▾` writes a graph
  doc carrying a stable `projectId` and revision lineage; a proposal carries a
  complete snapshot so diff and apply run entirely offline.
- **Non-destructive Review** — an id-keyed three-way diff (`base`/`theirs`/`yours`),
  `exact`/`divergent`/`unknown` classification; desktop panel === mobile sheet.
- **Whole-proposal Apply** and **selective per-hunk Apply** — per-field
  *take theirs* / *keep mine*, node-removal dependencies resolved by removal
  or retarget, invalid selections refused before anything changes.
- **Atomic** — either path yields one new local revision, one undo entry, and
  a sim reset to step 0; a single Undo restores everything.

## v0.4.0 — ship: workspace, links, offline, mobile view/run

- **Workspace Export / Import** — an optional `workspace` key carrying the
  run config, the last Monte-Carlo distribution, the timeline view, the
  canvas viewport, and a verified simulation snapshot. 8 MiB cap,
  all-or-nothing.
- **Shareable URL** — a `Share` button copies a `#g1=<payload>` link
  (zlib-wrapped DEFLATE + base64url, 8 KiB cap, graph only).
- **Installable offline PWA** ([`docs/pwa.md`](docs/pwa.md)) — precaches the
  whole app shell; updates surface a dismissible bar, applied only on click.
- **Mobile view/run layout** ([`docs/mobile.md`](docs/mobile.md)) — below a
  720px breakpoint: full-bleed canvas, finger pan/pinch-zoom, a fixed bottom
  bar, a Timeline sheet, a read-only Inspector sheet. Structural editing is
  locked; the desktop layout is unchanged above the breakpoint.

## v0.3.0 — executable state connections

State edges (`trigger` with an integer `delay`, AND-combined `activator`
level gates, `label` Pool modifiers) now run as a Phase 0 at the top of every
step — frozen as `loop-state/1`/`loop-state/2`
([`SEMANTICS-S.md`](docs/specs/SEMANTICS-S.md)). The canvas shows a travelling pulse on a
trigger's delivery step, a steady tint for an open activator, and a `delta`
flash for a label. Covered end-to-end by `examples/state-verification.json`.

## v0.2.0 and earlier

v0.2.0 shipped Engine B (seeded RNG, probabilistic gates) and the Monte-Carlo
engine + UI. Before that: the diagram editor (add / connect / edit nodes,
JSON import/export, autosave), the deterministic engine (step / play / reset,
single-run timeline), Cloudflare Pages deployment with GitHub Actions CI, and
the first onboarding pass (starter templates, verification fixtures, the
*Risky Factory* example).
