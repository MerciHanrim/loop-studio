# Guided first-run tour (non-frozen design doc — DRAFT)

**Status: IMPLEMENTED (`feat/guided-tour`). rev 3.** rev 1 fixed the
structure (desktop/mobile split, read-only principle, six-step scope, a11y +
invariance); rev 2 pinned the four **lifecycle boundaries** (§GT6.1 display
timing, §GT6.3 `localStorage` failure, §GT6.4 exit-state table, §GT7 Help menu +
mobile target); **rev 3** adds a second working Help entry — **`About Loop
Studio`** (§GT7, §GT9) — since the tool has no in-app place to show the creator /
copyright today. The tour's six steps and lifecycle contract are unchanged.

This doc fixes the **behaviour contract** for the guided first-run tour before
any implementation. It is a **non-frozen** design doc — no `loop-*/N` id, no
`Frozen` marker — and merges as *settled design, implementation pending*, like
[`docs/localization.md`](localization.md), [`docs/mobile.md`](mobile.md), and
[`docs/edge-routing.md`](edge-routing.md).

The tour is the first slice of **Onboarding, part 2 → guided first-run tour**
(README roadmap), built on the finished localization base. The slice also lands
the **Help (`?`) menu** it needs as a home, with `Take a tour` **and** `About
Loop Studio`. **Contextual inline help** is a *separate later slice* and is out
of scope here (§GT12).

A **UI-chrome-only** layer: a read-only overlay that points at parts of the
interface. It changes nothing the engine computes, nothing that is serialized,
and no wire contract. Its only persistent trace is one `localStorage` string
(§GT6). §GT10 is the decision record; §GT9 the acceptance / E2E set; §GT11 the
slices.

## GT0. Why

A `#g1=` Share link or the bare app drops a first-time visitor into a dense
editor — palette, canvas, Inspector, play bar, timeline, four menus — with no
orientation. The mobile visitor lands in a view/run layout whose capabilities
are not obvious (no editing; where is Share?). A short, skippable, read-only
tour names the six regions of the UI and what each is for, once, and then gets
out of the way. It is **not** an interactive tutorial — it never asks the user
to perform a step (§GT4).

## GT1. Scope

**In**

- a **desktop tour** — six steps over the real editor regions (§GT2);
- a **mobile tour** — six steps rewritten for view/run, *not* a shrink of the
  desktop tour (§GT3);
- a **Welcome card** on the true first run, with `Start tour` / `Skip` (§GT6);
- a small **Help (`?`) menu** in the toolbar (desktop) and in the More sheet
  (mobile), with two working entries — **`Take a tour`** (tour re-entry) and
  **`About Loop Studio`** (§GT7); `Contextual help` is not present;
- an **About dialog** — creator + version/build + copyright + the
  non-affiliation line, EN + KO (§GT7);
- one `localStorage` key that suppresses the Welcome card after the first
  interaction (§GT6);
- EN + KO copy from the localization catalog (§GT8);
- the read-only / no-mutation / overlay / a11y / reduced-motion / forced-colors
  behaviour boundary (§GT4);
- an E2E acceptance set (§GT9).

**Out (this slice)**

- **Monte Carlo** and **revision / proposal review** — excluded from the first
  tour; they are advanced flows for **contextual inline help** (a later slice).
- Any step the user must *do*. The tour only points and describes.
- Multi-page docs, video, product tour analytics/telemetry.
- Deep-linking to a specific step from a URL.
- Re-surfacing the Welcome card on a schedule / after N visits.
- A "tour" of anything that is not a persistent region of the chrome (e.g. a
  transient dialog).

## GT2. The desktop tour — six steps

Each step highlights one region and shows a short overlay popover (name +
one–two sentences). Order is fixed; steps are numbered **`N / 6`**.

| # | Step | Anchor (region) | What the copy says |
|---|---|---|---|
| 1 | **Pieces** | the top **palette** (Pool · Source · Drain · Gate · Converter · End · Parameter · Register) | the building blocks; click or drag one onto the canvas to add it |
| 2 | **Canvas** | the **canvas** area | place pieces, connect them handle-to-handle, pan and zoom |
| 3 | **Inspector** | the **Inspector** panel | edit the settings of whatever piece or connection is selected |
| 4 | **Playback** | the **play bar** (Reset · Step · Play/Pause · Speed · Seed) | run the model one step at a time or continuously; Seed makes a random run repeatable |
| 5 | **Timeline** | the **timeline** strip | watch pool values and run results over time |
| 6 | **Files and sharing** | the toolbar **actions** cluster (Templates · Import · Share · Export) | start from a template, open a file, copy a Share link, or export the graph / workspace |

If a step's anchor is not currently in the DOM / viewport (e.g. the Inspector is
empty, or the timeline is collapsed), see §GT4 "missing target".

## GT3. The mobile tour — six steps

The phone layout **cannot edit** ([`docs/mobile.md`](mobile.md)), so the mobile
tour is a **different script**, not the desktop tour with smaller popovers.

| # | Step | Anchor | What the copy says |
|---|---|---|---|
| 1 | **Open a graph** | the top bar / Import control | open a shared graph — from a `#g1=` link or by importing a file |
| 2 | **Move around** | the canvas | drag to pan, pinch to zoom; `fit` re-centres the diagram |
| 3 | **Inspect** | a node (or the read-only Inspector sheet) | tap a node or connection to read its configuration (editing is desktop-only) |
| 4 | **Run it** | the bottom run bar (Step · Play) | step through the model or play it |
| 5 | **Timeline** | the Timeline sheet handle | open the timeline sheet to see values over time |
| 6 | **More** | the **More** (`⋯`) **button** — *the tour points at the closed button; it does not open the sheet* | Share, Export, and the language switch live in this menu |

No mobile step opens a menu or sheet. Step 6 highlights the closed `⋯` button;
because the tour scrim swallows background input (§GT4), the More sheet, the file
menu, and the language menu cannot open while the tour is running.

## GT4. Behaviour boundary

The tour is an **overlay that reads the UI**; it never drives it.

**No state mutation.** Starting, advancing (`Next`), going back (`Back`), and
ending the tour (`Escape`, the explicit close control, `Skip`, or `Done` on step
6) leave **all** of the following byte-for-byte unchanged:

- the GraphDoc (nodes / edges / project) and the `loop-revision/*` digest;
- the undo / redo stacks and `simulationRev`;
- the current **selection**, the React Flow **viewport** (pan / zoom), and the
  minimap;
- `SimState` — `values`, `stepIndex`, `status` (a running / paused / ended run
  keeps running / paused / ended);
- the Monte-Carlo config and last result;
- the theme, the active locale, and every other UI setting **except** the one
  tour key in §GT6.

The tour store holds only `{ active, step, platform }` in memory.

**Layout-neutral overlay.** The popover and the highlight are an
`position: fixed` / `absolute` overlay layer (a scrim + a spotlight cut-out + a
popover). They **do not reflow** the Toolbar, Canvas, Inspector, or Timeline —
no element is resized, inserted into flow, or scrolled by the tour. (Same
constraint the language menu and the palette tip already meet.)

**Scrim swallows background input; backdrop click is inert.** While the tour (or
the Welcome card) is open, the scrim intercepts pointer events, so a click that
would land on the Toolbar, a menu trigger, the Canvas, or the language switch
does **nothing** — no menu opens, no node is selected, nothing behind the tour
reacts. A click on the scrim itself is **ignored** — it is *not* a dismiss path
(exit is only `Escape`, the close control, `Skip`, or `Done`; see the table in
§GT6.4). Highlighting a region does not make it interactive.

**Z-order.** The tour layer sits **above** the Canvas, Toolbar, Timeline, and
the palette tip, but **below** `ConfirmDialog` and any true blocking modal —
`ConfirmDialog` must always be able to appear on top of, and take focus from,
the tour. In practice the tour never coexists with `ConfirmDialog` (§GT6.1), but
the stacking order is fixed so a programmatic confirm can never be trapped
behind the tour.

**Missing target.** If a step's anchor element is absent or off-screen, the
tour shows the step's copy in a **safe centred card** (no spotlight, no arrow)
and stays on that step. It never auto-skips, never advances past the end, and
never crashes. `Next` / `Back` still work.

**Locale change mid-tour.** If the active locale changes while the tour is open
(e.g. a programmatic `setLocale`), the **current step** re-renders immediately in
the new locale — copy, `N / 6` label, button labels — and the step index and
progress are unchanged. This is a **reactivity** guarantee only: because focus is
trapped in the popover (§GT4 a11y), a user cannot reach the background language
menu mid-tour, so this is not a user-reachable flow in this slice — the E2E
(§GT9 case 6) drives the locale change through the store, not a click.

**Accessibility.**

- `Escape` ends the tour (→ `dismissed`, §GT6.4).
- `Back` / `Next` buttons; `Next` on step 6 is `Done` and ends the tour
  (→ `completed`, written **on the `Done` press**, not on merely reaching
  step 6).
- keyboard focus is **trapped** inside the popover while the tour is open; on
  end, focus returns to the control that opened it (the Welcome card's
  `Start tour`, or the Help menu's `Take a tour`).
- the popover is a labelled dialog (`role="dialog"`, `aria-modal`,
  `aria-labelledby` the step title); the `N / 6` position is announced.
- every string (titles, bodies, `Back` / `Next` / `Done` / `Skip`, the `N / 6`
  template) comes from the catalog (§GT8) — nothing hard-coded.

**`prefers-reduced-motion`.** No move / slide / fade transition between steps —
the popover and spotlight jump to the new position. No artificial delay.

**`forced-colors`.** The highlighted target and the popover border stay
distinguishable without relying on hue — a visible outline / system-color
border on both the spotlight and the popover, not just a tint.

**Overflow / long Korean.** On desktop **and** at 390 px, the popover is
clamped to the viewport (`max-width`, wrap) and never causes a horizontal
document scroll. Long Korean copy wraps; it does not push the popover
off-screen.

**Spotlight clamp.** The highlight ring hugs the target + 4 px, but every edge
is clamped to **≥ 2 px inside the viewport** (`SPOT_INSET`) so the whole border
line — and its `forced-colors` outline, drawn outside it — stays visible even
when the target touches a viewport edge (Canvas, Inspector, Playback, Timeline).
The ring shrinks near an edge; it is **never moved off the target**, and no
layout, Canvas viewport, or node box changes.

## GT5. Step anchoring

Steps target **stable regions**, addressed by a dedicated `data-tour` attribute
(e.g. `data-tour="palette"`), never by a brittle CSS path. The attribute is the
only code touch a region needs; adding / reordering steps is catalog + tour-config
only. A step whose `data-tour` node is missing is handled per §GT4
"missing target".

## GT6. First run & persistence

**Key** (UI-only, namespaced like `loop-studio/ui-locale/1`):

```
localStorage["loop-studio/guided-tour/1"]  =  "completed" | "dismissed"
```

Only `"completed"` and `"dismissed"` are honoured. **A recognised value** → the
Welcome card is never auto-shown again; the tour stays available from the Help
menu (§GT7). `completed` vs `dismissed` is retained only for a future decision
(§GT10) — both suppress the card identically. **Anything else** — absent, an
unrecognised string, or a read that throws — is treated as **absent**: the card
is eligible (subject to §GT6.1), and a corrupt value never permanently hides the
tour. The once-per-session cap is the in-memory `offeredThisSession` flag, not
the key.

**`completed` / `dismissed` are UI-only.** The key never enters the GraphDoc, the
Workspace / Share payload, the `loop-revision/*` digest, undo, or `simulationRev`,
and is never read by the engine. On failure to persist it, nothing is written
anywhere else as a substitute (§GT6.3).

### GT6.1 Welcome display timing & UI priority

The auto Welcome card is decided by **exactly one check**, a short beat after
the boot sequence settles. There is **no polling and no deferral** — the visit
is resolved once:

1. **After** locale resolution (§GT6.2) **and** the app's initial restore —
   autosave load, and, for a `#g1=` link, the **graph restore completes first**
   (`ShareLoader` signals "settled" only after `consumeShareLink` resolves). The
   tour never races or interferes with restoring the shared graph. The single
   check runs ~250 ms after that signal so any post-settle surface (`BootNotice`,
   a PWA update prompt) has mounted first.
2. **If, at that moment, any other top-level surface is open** — a
   `ConfirmDialog`, a mobile sheet, the `BootNotice`, or the PWA update bar —
   **this visit is over.** The card is not shown, and it does **not** reappear
   when that surface later closes. The stored key stays absent, so the **next**
   visit that is clean at check time shows the card.
3. **If nothing is up**, the card is shown. Either way the check fires once per
   page session (`offeredThisSession`), so a re-render, route change, or a
   surface opening/closing after the check changes nothing.
4. **Z-order** (§GT4): the tour / Welcome layer is above the Canvas / Toolbar /
   Timeline but **below** `ConfirmDialog` — a confirm can always appear over the
   tour and take focus. (They should not coexist, but the ordering is fixed
   regardless.)

Manual entry via `Help → Take a tour` (§GT7) has **no** timing gate — the user
asked for it — beyond the normal focus handoff.

### GT6.2 Language

The tour does **no language detection of its own.** The Welcome card and every
tour step render in whatever locale the app has already resolved and activated at
load, per [`docs/localization.md`](localization.md) §L5.2:

1. a previously **stored** user choice (`loop-studio/ui-locale/1`) wins;
2. else, on a true first visit, the **browser** preference — `ko` / `ko-KR` /
   any `ko-*` ⇒ **Korean**;
3. else (English, Japanese, German, French, …) ⇒ **English**;
4. a corrupt / unsupported stored value ⇒ browser check, then English fallback.

So on a first visit: `ko*` browser → **Korean Welcome + Korean tour**; any other
browser → **English Welcome + English tour**. An explicit user choice always
outranks the browser language. Mid-tour locale changes are the reactivity
guarantee in §GT4.

### GT6.3 `localStorage` unavailable

Storage reads / writes can throw or silently fail (private mode, blocked site
data, quota). The tour must degrade, never break:

- a read or write failure **does not block app boot** and is caught, not
  propagated;
- if the key **cannot be read**, treat it as absent, but propose the Welcome
  card **at most once per page session** — hold an in-memory "already offered
  this session" flag so a re-render or a route change does not re-show it;
- if the key **cannot be written** on `Skip` / `Done`, the tour still closes
  normally and the in-memory "offered / finished this session" flag suppresses
  any repeat **for the rest of the session**; the card may reappear on a genuine
  new page load (acceptable — no worse than a first visit), and never loops
  within one session;
- **never** write the tour state to the GraphDoc, autosave blob, Workspace,
  Share payload, or any other store as a fallback.

### GT6.4 Exit-state transition table

The current step lives in memory only (`{ active, step, platform }`, §GT4) and
is **not persisted** — a reload mid-tour does not force-resume from the middle
(alternative considered in §GT10). Only these transitions touch the key:

| Transition | Writes |
|---|---|
| Welcome → `Start tour` | *(nothing — key stays absent until the tour ends)* |
| Welcome → `Skip` | `dismissed` |
| Welcome → `Escape` | `dismissed` |
| Tour → `Done` (the step-6 button, pressed) | `completed` |
| Tour → `Escape` / close control (any step) | `dismissed` |
| Replayed tour (from Help) → any exit | *(nothing — keep the existing `completed` / `dismissed`)* |

- **Backdrop click is not an exit** — the scrim is inert (§GT4); it neither
  dismisses nor confirms. Exit is always an explicit control or `Escape`.
- **`completed` is written on the `Done` press**, not on merely reaching step 6.
  A user who lands on step 6 and then presses `Escape` gets `dismissed`.
- A replay launched from the Help menu **never rewrites** the key, whatever its
  current value — Help is not a first-run surface.
- **Only `completed` / `dismissed` count as a decision.** Any other stored
  string — and a read that throws (§GT6.3) — is treated as **absent**: the card
  is still eligible (a corrupt value must never lock a user out of the tour),
  capped to once per session by the in-memory flag. The unrecognised value is
  **left in place** and never rewritten until the user makes a real choice.

## GT7. The Help menu — `Take a tour` + `About Loop Studio`

Add a small **Help (`?`)** control to the toolbar actions cluster (desktop) and
an equivalent **row in the More sheet** (mobile). It has **two working entries**:

```
? Help
 ├─ Take a tour
 └─ About Loop Studio
```

- **`Take a tour`** — restarts the tour at step 1. It always runs the
  platform-appropriate script (desktop on desktop, mobile on mobile) regardless
  of the stored key, and per §GT6.4 never rewrites it.
- **`About Loop Studio`** — opens the About dialog (§GT7.1).
- **`Contextual help` is NOT shown** — not a disabled row, not a placeholder. It
  is added by the later inline-help slice (its own design + PR).

If the Help menu opens as a popover, the tour scrim (§GT4) still blocks the rest
of the UI while a tour launched from it is running.

### GT7.1 The About dialog

The tool currently shows the creator / copyright **only in `README.md`** — a
hosted-only or portable user never sees it. `About Loop Studio` is a small,
static, **read-only** dialog that fixes that.

**Content** (from the localization catalog, §GT8):

```
Loop Studio
v0.8.0-dev · build 2b6d504

Created by Hanrim
GitHub repository

Copyright © 2026 Hanrim.
All rights reserved.

Loop Studio is an independent project and is not affiliated
with or endorsed by Machinations.io.
```

Korean:

```
Loop Studio
v0.8.0-dev · 빌드 2b6d504

제작: Hanrim
GitHub 저장소

Copyright © 2026 Hanrim.
All rights reserved.

Loop Studio는 독립 프로젝트이며 Machinations.io와
제휴하거나 보증받은 프로젝트가 아닙니다.
```

- **`Copyright © 2026 Hanrim. All rights reserved.` is NOT translated** — the
  same ASCII line in every locale (like a wire token). "Loop Studio", the
  version string, and the build SHA are also verbatim.
- **Version + build SHA** are read from the **same source as the toolbar build
  stamp** (`__APP_VERSION__` / `__BUILD_SHA__`) — one source of truth, so they
  can never disagree with the header.
- **`Created by` / `제작:`** and the non-affiliation sentence are localized.
- **The GitHub link** points at the project repository,
  `https://github.com/MerciHanrim/loop-studio` — a fixed href in every locale
  and every build. It **opens in a new tab** (`target="_blank"`,
  `rel="noreferrer noopener"`). Its **visible text is localized** (`GitHub
  repository` / `GitHub 저장소`, key `about.repo`) and its **accessible name**
  identifies the project (`Loop Studio GitHub repository` / `Loop Studio GitHub
  저장소`, key `about.repoAria`). It replaces the earlier Cozy Shelter blog
  link, which is no longer shown here.

**Behaviour**

- Reachable identically from the **desktop Help menu** and the **mobile
  More → Help** entry; identical in the **portable** and **PWA** builds.
- Opening or closing About changes **nothing**: GraphDoc bytes, `loop-revision/*`
  digest, undo / redo, viewport, selection, `simulationRev`, `SimState`, and the
  Monte-Carlo config are all untouched. The About key does **not** exist — there
  is no persisted "seen About" state.
- A standard modal: **`Escape`, a backdrop click, and an explicit close button**
  each dismiss it by the one same path; focus is trapped while open. Opening
  About **closes the Help menu**, so on close focus returns to the **Help (`?`)
  trigger** — not the `About Loop Studio` menu item, which no longer exists.
  (This is the normal dialog contract — *distinct* from the tour's **inert**
  scrim in §GT4.)
- Nothing about the About dialog enters the Graph JSON, Workspace JSON, or `#g1=`
  Share payload.
- No animation requirement; respects `prefers-reduced-motion` and `forced-colors`
  like every other dialog.

## GT8. Localization

All copy is in the localization catalog under a `tour.*` namespace, EN canonical
and KO `satisfies MessageCatalog`, e.g.:

- `tour.welcome.title` · `tour.welcome.body` · `tour.welcome.start` ·
  `tour.welcome.skip`
- `tour.nav.back` · `tour.nav.next` · `tour.nav.done` ·
  `tour.nav.position` = `"{n} / {total}"`
- `tour.desktop.<step>.title` / `.body` for steps `pieces` · `canvas` ·
  `inspector` · `playback` · `timeline` · `files`
- `tour.mobile.<step>.title` / `.body` for the six mobile steps
- `tour.help.menuLabel` · `tour.help.takeTour` · `tour.help.about`
- `about.createdBy` (= `"Created by"` / `"제작:"`), `about.repo` (the GitHub
  link text, `"GitHub repository"` / `"GitHub 저장소"`), `about.repoAria` (its
  accessible name), and `about.notAffiliated` (the Machinations.io sentence).
  The product name, `v{version} · build {sha}` line, the GitHub link **href**
  (`https://github.com/MerciHanrim/loop-studio`), and `Copyright © 2026 Hanrim.
  All rights reserved.` are **not** catalog strings — they are shown verbatim
  in every locale (the version/SHA come from `__APP_VERSION__` /
  `__BUILD_SHA__`).

No string concatenation of translatable fragments; `{n}` / `{total}` are ICU
arguments. The tour adds **no** exception to any localization invariant
(`docs/localization.md` §L12), and **no locale logic of its own** — it reads the
already-active locale (`docs/localization.md` §L5.2, summarised in §GT6) and
re-renders on change (§GT4).

## GT9. Acceptance / E2E

The implementation slice must ship E2E covering:

1. **First run** — with the key absent and nothing else on screen, the Welcome
   card appears **once** after the app settles. With the key present (`completed`
   **or** `dismissed`), it does **not**.
2. **Skip / complete then reload** — after `Skip`, `Escape` on the card, `Done`,
   or `Escape` mid-tour, a reload does **not** re-show the Welcome card and does
   **not** auto-open the tour.
3. **Re-entry** — `Help → Take a tour` opens the tour at step 1 even when the key
   is `completed` / `dismissed`, and **does not rewrite** the key on any exit.
4. **Help menu contents** — the Help control exposes exactly two working items,
   `Take a tour` and `About Loop Studio`; there is **no** `Contextual help` item
   (not present, not disabled) in this slice.
5. **Six steps, both platforms** — desktop and mobile (390 px) each walk 1→6 via
   `Next`, `Back` returns, `Done` on step 6 ends; `N / 6` label correct at each
   step. No mobile step opens a menu / sheet — step 6 highlights the closed `⋯`
   button.
6. **Locale — first visit** — with no stored locale and `navigator.language`
   `ko` / `ko-KR`, the Welcome card and tour render in **Korean**; with a non-`ko`
   browser language, in **English**. A stored user choice overrides the browser
   language in both directions.
7. **Locale — mid-tour reactivity** — a locale change driven **through the store**
   (`setLocale`, not a background click — focus is trapped) keeps the current
   step **and** progress and re-renders only the copy + `N / 6` + button labels.
8. **Display priority** — with the key absent, open a `ConfirmDialog` (or a boot
   notice) before the app settles: the Welcome card does **not** appear over it;
   it appears only after that surface is dismissed. A `#g1=` Share link restores
   its graph fully **before** the card shows.
9. **Backdrop is inert** — clicking the scrim neither dismisses the tour nor
   activates anything behind it; a click over a menu trigger / node / the
   language switch while the tour is open does nothing.
10. **`localStorage` unavailable** — with storage reads/writes forced to throw:
    the app still boots, the Welcome card is offered **at most once** for the
    session (no loop on re-render), closing the tour still works, and **no** tour
    state is written to any other store.
11. **Overlay geometry** — on desktop and at 390 px, at every step the popover is
    inside the viewport (no edge past it, no horizontal document scroll), and the
    Toolbar height / Canvas top / Timeline box / node DOM boxes / edge `d` are
    **unchanged** while the tour is open vs closed.
12. **Invariance** — open the tour, walk all six steps, `Back` a few, then end:
    GraphDoc bytes, `loop-revision/*` digest, undo / redo, viewport, **selection**,
    `simulationRev`, and `SimState` (`values` / `stepIndex` / `status`) are
    identical to before. Repeat with a run **playing** — still playing, at the
    same or a later step, untouched.
13. **Payload** — Graph JSON, Workspace JSON, and the `#g1=` Share payload contain
    **no** `tour` / `guided-tour` key; exported bytes and digest are identical
    with the key `completed` vs absent.
14. **a11y** — `Escape` ends; focus is trapped while open and returns to the
    trigger on end; `Back` / `Next` reachable by keyboard.
15. **Missing target** — force a step's `data-tour` node out of the DOM; the tour
    shows the centred fallback card, does not advance or crash, and `Next` /
    `Back` still work.
16. **reduced-motion** — no transition between steps.
17. **forced-colors** — the spotlight outline and popover border are present
    (rendered-style evidence), not hue-only.
18. **Long Korean** — KO copy at 390 px: popover wraps, stays on-screen, no
    horizontal scroll.
19. **About dialog** — `Help → About Loop Studio` (desktop) and the mobile
    More → Help entry both open it. It shows the same `v{version} · build {sha}`
    as the toolbar build stamp; the `Copyright © 2026 Hanrim. All rights
    reserved.` line is **byte-identical in EN and KO**, while `Created by` /
    `제작:`, the non-affiliation sentence, and the GitHub link's text
    (`GitHub repository` / `GitHub 저장소`) + accessible name switch with the
    locale; the link's href is the fixed
    `https://github.com/MerciHanrim/loop-studio` and it opens in a new tab.
    **Each** of `Escape`, a backdrop click, and the close button dismisses the
    dialog, and after **each** of those three paths focus is on the **Help
    (`?`) trigger** (the Help menu having closed when About opened). Opening then
    closing About leaves GraphDoc / digest / undo / viewport / selection /
    `simulationRev` / `SimState` unchanged, and no `about` key appears in any
    export or Share payload.

## GT10. Decision record

- **Not an interactive tutorial.** Read-only "point and describe" only. An
  interactive walkthrough (type here, click there) is a much larger surface and
  would have to mutate the GraphDoc — rejected for the first tour.
- **Welcome card = `Start tour` / `Skip`, and always re-runnable from Help.**
  The three-button form (`Start tour` / `Not now` / `Don't show again`) was
  considered; `Not now` vs `Don't show again` is a fuzzy distinction and adds a
  third stored state. The two-button form plus a permanent Help entry is
  simpler and loses nothing. *(Lumi, this thread.)*
- **Stored values `completed` | `dismissed`.** Both suppress the card equally;
  the two labels are kept only so a future decision (e.g. ever re-offer after a
  major version) has the information. A single `"seen"` value would also work.
- **No persisted step index.** The current step lives in memory only. A reload
  mid-tour re-shows the Welcome card (if the key is still absent) rather than
  force-resuming from the middle. *Alternative considered:* persist
  `{ status, step }` and offer "resume where you left off" — deferred as extra
  state and UI for little gain on a six-step tour.
- **Monte Carlo & revision review excluded.** They are modal, advanced, and
  situational — a better fit for contextual inline help than a linear first-run
  tour.
- **Mobile tour is its own script.** The phone can't edit; steps 1 / 3 differ in
  meaning, and Share / language live in a different place (More sheet).
- **Anchoring by `data-tour` attribute**, not CSS selectors — one small,
  explicit code touch per region; robust to markup changes.
- **No language detection in the tour.** The tour reads the app's already-active
  locale (`docs/localization.md` §L5.2: stored choice → `ko*` browser → EN →
  corrupt-value fallback). First visit ⇒ `ko*` browser gets a Korean
  Welcome + tour, everything else English; an explicit user choice always wins
  over the browser language. *(Lumi, this thread.)*
- **Help menu — two working items this slice.** `Take a tour` and `About Loop
  Studio`. `Contextual help` is *not shown at all* (not a disabled row) — it
  belongs to the later inline-help slice. *(Lumi, rev 2 + rev 3.)*
- **`About Loop Studio` dialog** (§GT7.1). The tool had no in-app place to show
  the creator / copyright — only `README.md`, which a hosted-only or portable
  user never sees. A small static read-only dialog fixes it, homed in the same
  Help menu. Version + build SHA come from the same `__APP_VERSION__` /
  `__BUILD_SHA__` as the header; `Copyright © 2026 Hanrim. All rights reserved.`
  is not translated; the dialog carries **a link to the project GitHub
  repository** (`https://github.com/MerciHanrim/loop-studio`, opens in a new
  tab; localized text + accessible name) — it replaced the earlier Cozy Shelter
  blog link, which is no longer shown here (`README.md` still keeps its byline);
  opening About closes the Help menu, so `Escape` / backdrop / close each return
  focus to the **Help (`?`) trigger**; opening / closing it mutates nothing and
  leaves no persisted state. *(Lumi, rev 3.)*
- **Welcome timing — after settle, single surface only** (§GT6.1). The card waits
  behind any `ConfirmDialog` / sheet / boot notice / PWA bar and behind graph
  restore for a `#g1=` link; it never stacks or interrupts, and the tour layer
  sits below `ConfirmDialog` in the z-order. A visit that is always busy simply
  skips the card that time (key stays absent). *(Lumi, rev 2.)*
- **`localStorage` failure is non-fatal** (§GT6.3). Read/write errors are caught;
  the card is offered at most once per session via an in-memory flag; nothing is
  ever written elsewhere as a substitute. *(Lumi, rev 2.)*
- **Exit-state table is fixed** (§GT6.4). `Skip` / `Escape` on the card and
  `Escape` / close mid-tour → `dismissed`; only the pressed **`Done`** →
  `completed` (not merely reaching step 6); a Help-launched replay writes
  nothing; the scrim / backdrop is inert and is not a dismiss path. *(Lumi,
  rev 2.)*
- **Mobile step 6 points at the closed `⋯` button** — the tour opens no menu or
  sheet on any platform; the inert scrim also prevents the file / language menu
  from opening by a fall-through click. *(Lumi, rev 2.)*
- **Mid-tour locale test is store-driven, not a click.** Focus is trapped, so the
  background language menu is unreachable during the tour; the E2E asserts only
  the reactivity (external `setLocale` → same step re-renders), not a
  non-existent user path. *(Lumi, rev 2.)*

## GT11. Slices

- **The design doc.** `docs/guided-tour.md` only, no code — merged as *settled
  design, implementation pending* (rev 1–2), then amended by rev 3 to add
  `About Loop Studio` to the Help menu.
- **Implementation — `feat/guided-tour`.** `src/store/tourStore.ts` (phase
  machine + the §GT6.4 table + `TOUR_STORAGE_KEY`; `readTourKey()` returns
  `null` for absent / unrecognised / a throw — `offerWelcome()` only bails on a
  *recognised* value, and the once-per-session cap is the in-memory flag),
  `src/components/GuidedTour.tsx` (`FirstRunTrigger` = **one** `setTimeout`
  check ~250 ms after `appSettled`, no polling; the Welcome card; the step
  popover + spotlight — `position: fixed`, no transitions, `--z-tour: 47` below
  every dialog, sits beside a full-height panel, centred fallback when a target
  is missing; inert scrim), `src/components/tourSteps.ts` (the two six-step
  scripts keyed by `data-tour` / a plain selector), `src/components/HelpMenu.tsx`
  (desktop `?` menu), `src/components/AboutDialog.tsx` (reuses the `.mcdlg`
  shell). `data-tour` on `.toolbar__palette` / `.canvas` / `aside.inspector` /
  `.pstrip` / `.timeline` / `.toolbar__actions` and the mobile `.toolbar--mobile`
  / `.pstrip--mobile` / `.pstrip__tl` / `.mob-more`. Help lands in the desktop
  toolbar and a mobile More → Help sub-sheet (`uiStore` `'help'` overlay).
  `.mcdlg__scrim` z-index → `var(--z-mc-dialog)` so "below every dialog" holds on
  desktop too. `tour.*` + `about.*` catalog (EN + KO); `ShareLoader` calls
  `tourStore.markAppSettled()` after the `#g1=` consume. **No test-only symbol
  ships** — the E2E suppresses the card the real way, by seeding
  `loop-studio/guided-tour/1 = "dismissed"` (`e2e/support/loop.ts` fixture;
  `portable` / `dist` via `installProbe`; `pwa.spec.ts` in `beforeEach`); a
  bundle grep for `__noFirstRunTour` is 0. E2E:
  `e2e/guided-tour.spec.ts` (29 across the 19 §GT9 conditions + the three
  boundary fixes), `src/store/tourStore.test.ts` (13). No engine / wire /
  serialized change; every existing snapshot unchanged.
- **Later slice — contextual inline help.** Separate design + PR; adds
  `Contextual help` to the Help menu.

## GT12. Scope boundary

The guided tour **and the Help menu / About dialog it introduces** are
**presentation only**. They carry no `loop-*/N` id, define no wire field, and are
revised freely. Nothing they do is observable in an export, a digest, an undo
entry, or the engine. Contextual inline help, first-run analytics, interactive
tutorials, and per-step deep links are **not** in this design and are not implied
by it.
