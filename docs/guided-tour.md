# Guided first-run tour (non-frozen design doc — DRAFT)

**Status: design pending review — no code.** This doc fixes the **behaviour
contract** for the guided first-run tour before any implementation. It is a
**non-frozen** design doc — no `loop-*/N` id, no `Frozen` marker — and merges as
*settled design, implementation pending*, like [`docs/localization.md`](localization.md),
[`docs/mobile.md`](mobile.md), and [`docs/edge-routing.md`](edge-routing.md).

The tour is the first slice of **Onboarding, part 2 → guided first-run tour**
(README roadmap), built on the finished localization base. **Contextual inline
help** is a *separate later slice* and is out of scope here (§GT12).

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
- a **re-entry point** — a small Help (`?`) menu in the toolbar (desktop) and a
  row in the More sheet (mobile); this slice ships only its **`Take a tour`**
  item (§GT7);
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
| 6 | **More** | the **More** (`⋯`) menu | Share, Export, and the language switch live here |

## GT4. Behaviour boundary

The tour is an **overlay that reads the UI**; it never drives it.

**No state mutation.** Starting, advancing (`Next`), going back (`Back`), and
ending the tour (`Escape`, an explicit close, or finishing step 6) leave **all**
of the following byte-for-byte unchanged:

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

**Missing target.** If a step's anchor element is absent or off-screen, the
tour shows the step's copy in a **safe centred card** (no spotlight, no arrow)
and stays on that step. It never auto-skips, never advances past the end, and
never crashes. `Next` / `Back` still work.

**Locale change mid-tour.** Switching EN↔KO while the tour is open re-renders
the **current step** immediately in the new locale (copy, `N / 6` label,
button labels). The step index does not change.

**Accessibility.**

- `Escape` ends the tour.
- `Back` / `Next` buttons; `Next` on step 6 is `Done` and ends the tour.
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

## GT5. Step anchoring

Steps target **stable regions**, addressed by a dedicated `data-tour` attribute
(e.g. `data-tour="palette"`), never by a brittle CSS path. The attribute is the
only code touch a region needs; adding / reordering steps is catalog + tour-config
only. A step whose `data-tour` node is missing is handled per §GT4
"missing target".

## GT6. First run & persistence

**Language.** The tour does **no language detection of its own.** The Welcome
card and every tour step render in whatever locale the app has already resolved
and activated at load, per [`docs/localization.md`](localization.md) §L5.2:

1. a previously **stored** user choice (`loop-studio/ui-locale/1`) wins;
2. else, on a true first visit, the **browser** preference — `ko` / `ko-KR` /
   any `ko-*` ⇒ **Korean**;
3. else (English, Japanese, German, French, …) ⇒ **English**;
4. a corrupt / unsupported stored value ⇒ browser check, then English fallback.

So on a first visit: `ko*` browser → **Korean Welcome + Korean tour**; any other
browser → **English Welcome + English tour**. An explicit user choice always
outranks the browser language — a Korean-browser user who once picked English
gets the English tour, and vice versa. Mid-tour language changes are handled in
§GT4 (current step and progress kept, copy swapped immediately).

**Key** (UI-only, namespaced like `loop-studio/ui-locale/1`):

```
localStorage["loop-studio/guided-tour/1"]  =  "completed" | "dismissed"
```

- **absent** → first run. On load, after the app is interactive, show a small
  **Welcome card** (not the full tour): a one-line greeting and two buttons —
  **`Start tour`** and **`Skip`**.
  - `Start tour` → open the tour at step 1.
  - `Skip` → close the card, write `"dismissed"`.
  - finishing the tour (step 6 `Done`, or `Escape` partway) → write
    `"completed"`.
  - Either stored value **suppresses the Welcome card on every later visit.**
    The tour itself stays available forever from the Help menu (§GT7).
- **the current step is memory-only.** A reload mid-tour does **not** force-resume
  from step 3 — a reload with the key still absent shows the Welcome card again
  only if the user never interacted; once `Start tour` or `Skip` is pressed the
  key is written and the card does not return. (i.e. pressing `Start tour` writes
  nothing until the tour ends; if the user reloads *during* the tour, they get
  the Welcome card once more — acceptable, and simpler than persisting progress.
  Alternative in §GT10.)
- a corrupt / unrecognised stored value is treated as **"suppress the card"**
  (fail safe — never nag), and is left in place, never rewritten.
- **`completed` / `dismissed` are UI-only.** The key never enters the GraphDoc,
  the Workspace / Share payload, the `loop-revision/*` digest, undo, or
  `simulationRev`. It is never read by the engine.

## GT7. Re-entry — the Help menu

Add a small **Help (`?`)** control to the toolbar actions cluster (desktop) and
an equivalent **row in the More sheet** (mobile). Structure it as a menu so a
later slice can extend it:

- **`Take a tour`** — restarts the tour at step 1. *(this slice)*
- `Contextual help` — *reserved for the later inline-help slice; not built now.*

Selecting `Take a tour` always runs the platform-appropriate tour (desktop
script on desktop, mobile script on mobile), regardless of the stored key.

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
- `tour.help.menuLabel` · `tour.help.takeTour`

No string concatenation of translatable fragments; `{n}` / `{total}` are ICU
arguments. The tour adds **no** exception to any localization invariant
(`docs/localization.md` §L12), and **no locale logic of its own** — it reads the
already-active locale (`docs/localization.md` §L5.2, summarised in §GT6) and
re-renders on change (§GT4).

## GT9. Acceptance / E2E

The implementation slice must ship E2E covering:

1. **First run** — with the key absent, the Welcome card appears **once** after
   load. With the key present (`completed` **or** `dismissed`), it does **not**.
2. **Skip / complete then reload** — after `Skip` or finishing the tour, a
   reload does **not** re-show the Welcome card, and does **not** auto-open the
   tour.
3. **Re-entry** — `Help → Take a tour` opens the tour at step 1 even when the
   key is `completed` / `dismissed`.
4. **Six steps, both platforms** — desktop and mobile (390 px) each walk 1→6 via
   `Next`, `Back` returns, `Done` on step 6 ends; `N / 6` label is correct at
   each step.
5. **Locale — first visit** — with no stored locale and `navigator.language`
   `ko` / `ko-KR`, the Welcome card and the tour render in **Korean**; with a
   non-`ko` browser language, in **English**. A stored user choice overrides the
   browser language in both directions. The tour runs no detection of its own —
   it reflects the app's active locale.
6. **Locale — mid-tour** — switching EN↔KO while the tour is open keeps the
   current step **and** the progress state, and re-renders only the copy +
   `N / 6` label + button labels in the new locale.
7. **Overlay geometry** — on desktop and at 390 px, at every step the popover is
   inside the viewport (no element's right/bottom edge past the viewport, no
   horizontal document scroll), and the Toolbar height / Canvas top / Timeline
   box / node DOM boxes / edge `d` are **unchanged** while the tour is open vs
   closed.
8. **Invariance** — open the tour, walk all six steps, `Back` a few, then end:
   GraphDoc bytes, `loop-revision/*` digest, undo / redo, viewport, **selection**,
   `simulationRev`, and `SimState` (`values` / `stepIndex` / `status`) are all
   identical to before the tour. Repeat with a run **playing** — it is still
   playing, at the same or later step, untouched by the tour.
9. **Payload** — Graph JSON, Workspace JSON, and the `#g1=` Share payload contain
   **no** `tour` / `guided-tour` key; the exported bytes and digest are identical
   with the tour key `completed` vs absent.
10. **a11y** — `Escape` ends; focus is trapped while open and returns to the
    trigger on end; `Back` / `Next` reachable by keyboard.
11. **Missing target** — force a step's `data-tour` node out of the DOM; the tour
    shows the centred fallback card, does not advance or crash, and `Next` /
    `Back` still work.
12. **reduced-motion** — no transition between steps.
13. **forced-colors** — the spotlight outline and popover border are present
    (rendered-style evidence), not hue-only.
14. **Long Korean** — KO copy at 390 px: popover wraps, stays on-screen, no
    horizontal scroll.

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
- **Help menu is extensible** — `Take a tour` now, `Contextual help` reserved for
  the later slice.

## GT11. Slices

- **This PR — the design doc.** `docs/guided-tour.md` only, no code. Merges as
  *settled design, implementation pending*.
- **Next — implementation (its own PR).** The tour store + overlay component,
  the six desktop + six mobile steps, `data-tour` attributes on the regions,
  the Welcome card, the Help (`?`) menu with **`Take a tour` only**, `tour.*`
  catalog entries (EN + KO), and the §GT9 E2E set. No engine / wire / serialized
  change; EN output and every existing snapshot unchanged except the new Help
  control.
- **Later slice — contextual inline help.** Separate design + PR; adds
  `Contextual help` to the Help menu.

## GT12. Scope boundary

The guided tour is **presentation only**. It carries no `loop-*/N` id, defines
no wire field, and is revised freely. Nothing it does is observable in an
export, a digest, an undo entry, or the engine. Contextual inline help,
first-run analytics, interactive tutorials, and per-step deep links are **not**
in this design and are not implied by it.
