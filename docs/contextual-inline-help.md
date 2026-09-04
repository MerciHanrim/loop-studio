# Contextual inline help (non-frozen design doc — DRAFT)

**Status: DESIGN — first pass, Draft PR.** `CIH` prefix. A non-frozen design
doc like [`guided-tour.md`](guided-tour.md), [`dense-graph-pan.md`](dense-graph-pan.md),
[`module-system.md`](module-system.md) — no `loop-*/N` id, no `Frozen` marker,
merges as *settled design, implementation pending*. **It changes no `src/`
file yet.** Implementation is a **separate PR needing separate approval**.

This is the item [`guided-tour.md`](guided-tour.md) §GT11 named and deferred:
*"Later slice — contextual inline help. Separate design + PR; adds
`Contextual help` to the Help menu."* It is also the last item on the
Onboarding, part 2 roadmap line.

---

## CIH0. Why

The guided tour (`docs/guided-tour.md`, shipped) orients a first-time visitor
**once, linearly, on the very first run**: it names the six regions of the
editor and what each is for, then gets out of the way forever (§GT1, §GT6).
By design it is *not* interactive and never asks the user to do anything
(§GT4) — and it deliberately skips **Monte Carlo** and **revision / proposal
review**, calling them "modal, advanced, and situational — a better fit for
contextual inline help than a linear first-run tour" (§GT10).

That leaves a real gap: things a user only needs explained **when they
actually happen**, not on day one before they're relevant —

- a genuinely **empty canvas** the first time it's reached (no first-run tour
  step covers "you have nothing yet, here's where to start" — GT2 step 1 says
  "click or drag a piece," said once, before any canvas exists to demonstrate
  it on);
- **Monte Carlo**, opened for the first time, with no explanation of what a
  "run" there means versus the deterministic playback bar;
- a **Review** overlay (proposal / revision comparison), opened for the first
  time, with no explanation of what a hunk or a conflict is;
- a graph that has **grown dense** enough that Focus / Filter / frames — all
  shipped, all discoverable only by noticing small Controls icons — would
  actually help, and nothing currently says so.

This doc is about **closing that gap for what already ships** — it adds no
new capability, only discovery and light explanation of capability that
exists today. It is deliberately **not** a documentation site, a video, or an
interactive tutorial (those stay separate tracks — §CIH1).

---

## CIH1. Scope

### In

- **CIH2** — one shared mechanism for a lightweight, non-modal, dismissible
  situational hint, replacing the two ad hoc versions of this that already
  exist in `Canvas.tsx` (`lgr-focus-hint`, `lgr-suggest-note`) with one
  reusable piece.
- **CIH3** — the hint inventory: which situations get a hint in v1, and which
  are named and deferred with a reason.
- **CIH4** — a `Contextual help` entry in the Help (`?`) menu (desktop) and the
  mobile More → Help sub-sheet — the placeholder both already carry (§GT7 /
  `HelpMenu.tsx` / `MobileMoreMenu.tsx`: *"`Contextual help` is not shown
  (later slice)"*).
- **CIH5** — the persistence / dismiss model: per-hint "seen, don't show
  again," and a **Show again** path so nothing is silently lost forever.
- **CIH6** — mobile scope, decided per hint.
- a11y / reduced-motion / forced-colors parity with the tour's existing bar.
- **Presentation only** — no engine, wire, digest, undo, or `simulationRev`
  effect, mirroring §GT12.

### Out (this pass)

- A full documentation site, multi-page help, video or GIF introduction
  material — a separate track (Hanrim named it as its own later step, not
  this one).
- Analytics / telemetry on hint views or dismissals.
- **Interactive tutorials** — a step the user must perform to proceed. Every
  hint here only *points and describes*, same rule as the tour (§GT1).
- Deep-linking to a specific hint from a URL.
- Re-surfacing a dismissed hint on a schedule / after N visits — dismissed
  means dismissed until the user explicitly asks via **Show again** (§CIH4).
- Touching the guided tour itself, or its two Help-menu entries.

---

## CIH2. Mechanism

### CIH2.1 One shared hint, not more bespoke ones

Two ad hoc versions of "a small dismissible canvas note" already exist in
`Canvas.tsx`:

```
{focusMode && !focusSet && (
  <Panel position="top-center" className="lgr-focus-hint">…</Panel>
)}
{autoFramesExist && !suggestNoteDismissed && (
  <Panel position="top-center" className="lgr-suggest-note">…<button onClick={() => setSuggestNoteDismissed(true)}>✕</button></Panel>
)}
```

— one with no dismiss at all (it just tracks its own condition), one with a
`useState` dismiss that resets on reload. Good instincts, no shared plumbing.
CIH unifies the pattern others can build on:

- **`hintStore`** (new, zustand) — `dismissed: Record<HintId, boolean>`
  hydrated from **one** `localStorage` key, `dismiss(id)`, `reset(id)`.
  Try/catch guarded exactly like `tourStore`'s key (§GT6.3): a read/write
  failure is non-fatal and never locks a hint permanently off or on.
- **`<HintNote id impact={condition}>`** (new, shared component) — renders
  nothing if `dismissed[id]` is true *or* `condition` is false; otherwise the
  hint body plus one explicit **✕** that calls `hintStore.dismiss(id)`. Two
  render shapes, chosen per hint: a canvas `<Panel position="top-center">`
  (reuses the existing `lgr-*-hint`/`-note` CSS shape) for canvas-situational
  hints, or a plain inline block for a hint embedded inside an existing
  dialog / overlay (Monte Carlo, Review).
- **The trigger condition stays at the call site**, not in a central
  registry — `nodes.length === 0`, `mcStore.status`, `reviewStore.open`, and
  so on are already live selectors exactly where each hint renders. A big
  central "if X then show hint Y" table would drift from real app state the
  first time either changes; a local condition next to the render, like the
  two hints already in `Canvas.tsx`, does not.

### CIH2.2 Persisted vs. session-only — decided per hint, not globally

The codebase already has both tiers, for a reason:

- **Persisted** (the new `hintStore`, one `localStorage` key) — right for a
  hint tied to **first encounter with a whole feature** (an empty canvas,
  Monte Carlo's first open, Review's first open). The user needs the nudge
  once, ever; re-explaining it every session is noise, exactly why the tour
  itself is a single `completed | dismissed` key (§GT6).
- **Session-only** (in-memory, resets on reload) — right for a hint tied to a
  **recurring state** that isn't really "teach this once," like the existing
  auto-frame suggest note: dismissing frees the current look at the canvas,
  and if the same state recurs after a fresh load, a light reminder again is
  fine, not nagging.

§CIH3 decides the tier for each v1 hint; the reasoning above is the rule for
future ones, so this isn't re-litigated per hint forever.

### CIH2.3 Never interrupts

Same ethos as the tour's "overlay that reads the UI, never drives it" (§GT4),
extended to a mechanism that can fire many times across a session instead of
once:

- **Never a modal.** No OK-to-proceed button, no focus trap, no backdrop, no
  keyboard capture. The canvas and every control underneath stay live.
- **`Escape` does not dismiss a hint** — only its own ✕ does. `Escape` already
  means other things depending on context (cancel a frame draw, close a
  dialog); overloading it onto a passive note is exactly the kind of quiet
  behavior change this doc must not introduce.
- **Never fires while the guided tour is running or the Welcome card is up**
  — gated on `tourStore.phase === 'idle'`. The tour already established that
  nothing stacks on top of it (§GT6.1); a contextual hint appearing mid-tour
  would be new stacking, not a repeat of an existing rule.
- **At most one canvas-anchored hint at a time.** Canvas-anchored hints
  (§CIH3 #1 and #4) render at the same `top-center` position as the existing
  `lgr-focus-hint` / `lgr-suggest-note`; if two conditions are true at once,
  priority is: an in-progress LGR hint (`lgr-focus-hint`, `lgr-suggest-note` —
  unchanged, out of scope here per §CIH2.4) wins over a new CIH hint, and
  among CIH's own canvas hints the **empty-canvas** hint (#1) can never
  coexist with the **large-graph** hint (#4) since their trigger conditions
  (`nodes.length === 0` vs. `nodes.length >= WORTH_IT_FLOOR`) are mutually
  exclusive by construction. Dialog-embedded hints (#2, #3) are in a
  different region and never compete with a canvas hint or each other (their
  dialogs are already mutually exclusive — Monte Carlo and Review cannot both
  be open).

### CIH2.4 Not migrating the two existing ad hoc hints

`lgr-focus-hint` and `lgr-suggest-note` **stay exactly as they are.** Rewriting
working, already-shipped, already-tested UI onto a new shared component the
moment that component is invented is scope creep with no user-facing benefit
— it would touch two more files, two more snapshot baselines, and two more
LGR-owned behaviors for a purely internal tidiness win. If a future pass wants
to fold them in, that is its own small PR, not part of shipping new hints.

---

## CIH3. Hint inventory — v1 decisions

| # | Situation | Trigger | Where it renders | Tier | v1? |
|---|---|---|---|---|---|
| 1 | **Empty canvas** | `nodes.length === 0` on the open editor, tour idle, not mid-Import | canvas `top-center` `<Panel>` | persisted | **Yes** |
| 2 | **Monte Carlo, first open** | the MC dialog opens | inline note in the dialog body | persisted | **Yes** |
| 3 | **Review, first open** | the Review overlay opens (desktop or the mobile Review sheet) | inline note in the overlay | persisted | **Yes** |
| 4 | **Large graph — Focus / Filter discovery** | `nodes.length >= WORTH_IT_FLOOR` (8 — the same threshold `docs/large-graph-readability.md`'s auto-frame suggestion already uses) **and** neither Focus nor Filter has ever been toggled on | canvas `top-center` `<Panel>` (desktop); a one-line note atop the mobile More sheet's Focus/Filter rows | persisted | **Yes** |
| 5 | First-connection recovery (dragged from a node body, not a handle) | no reliable signal exists today — would need a new "failed drag" event, not just a missing one | — | — | **Backlog** — needs its own small investigation before it can even be designed |
| 6 | Run / simulation error explanation | Register / expression errors are already inline-localized at the point of failure (`error.M_REG_*.message`, `error.EXPR_*.message` in the Inspector) | — | — | **Backlog** — re-assess only if real user confusion shows up; today's inline error codes may already be enough |
| 7 | Module-insert discovery | no natural one-shot "first encounter" moment the way MC/Review have an open event — the Insert-module menu is just always present in the toolbar | — | — | **Backlog** — revisit with real usage signal |
| 8 | Frames (as their own hint) | — | — | — | **Folded into #4** — the Focus/Filter hint copy names frames as a related tool instead of adding a fourth canvas hint competing for the same `top-center` slot |

**#1 empty canvas** — copy names the palette and "or start from a Template,"
pointing at the same two entry points the tour's steps 1 and 6 named, now
shown at the moment they matter. Dismiss: the ✕, or automatically the instant
`nodes.length` becomes `> 0` (adding *any* piece counts as "found it" — no
separate "got it" click needed, matching `MobileOpenFileHint`'s
self-clearing precedent).

**#2 Monte Carlo** — one or two sentences: many runs, not one; the bands and
final-distribution view are what to look at; dismiss via ✕ (does not
auto-clear — a user could read it and still not have run yet).

**#3 Review** — one or two sentences: a hunk is one changed piece; accept/keep
per hunk or as a whole; a conflict means both sides touched the same thing.
Wording covers both the desktop `ReviewOverlay` and the mobile Review sheet
(`docs/module-system.md`-adjacent Slice 1C review UI) — one key, two mount
points, same as the tour's copy-reuse pattern elsewhere.

**#4 Focus / Filter** — one or two sentences: "Getting crowded? Focus dims
everything but a 1-hop neighborhood; Filter hides by type; frames group
related pieces." Dismiss via ✕, or automatically the first time the user
actually turns Focus or Filter on (their own real discovery beats the hint
continuing to sit there).

---

## CIH4. The `Contextual help` Help-menu entry

Both Help surfaces already carry the placeholder and the exact same
exclusion comment (`HelpMenu.tsx`, `MobileMoreMenu.tsx`): *"`Contextual help`
is not shown (later slice)."* This is that slice.

- A third row, after `Take a tour` / `About Loop Studio`: **`Contextual help`**.
- Opens a small dialog reusing the existing `.mcdlg` shell (same shell
  `AboutDialog` already reuses; `--z-mc-dialog`, same as `About`) — desktop
  dialog, mobile sheet-shaped like `About` is today.
- Lists the four v1 hints by name with a one-line description each, and a
  **다시 보기 / Show again** button per row that calls `hintStore.reset(id)`
  and closes the dialog. The hint reappears the next time its trigger
  condition is true — immediately, if it already is (e.g. Focus/Filter's
  condition is almost always true on a graph past the threshold).
- `help.contextual.*` i18n namespace, EN + KO, same catalog discipline as
  `tour.*` / `about.*`.

---

## CIH5. Persistence / dismiss model

- **One** new `localStorage` key, `loop-studio/contextual-help/1` — namespaced
  like `loop-studio/guided-tour/1` (§GT6). Value: a JSON object
  `{ [hintId]: true }` for every *persisted-tier* hint the user has dismissed
  or that has auto-cleared. Read/write wrapped in try/catch; a missing,
  corrupt, or unparsable value is treated as `{}` (every hint shows again) —
  never as "everything permanently dismissed." Same non-fatal principle as
  §GT6.3.
- **Session-only tier** hints (none in v1's four — see §CIH2.2 — but the
  mechanism supports them for later use, e.g. if a future hint follows the
  `suggestNoteDismissed` shape) keep their own in-memory `useState`, not
  written to the shared key at all.
- **No GraphDoc / `loop-revision/*` digest / undo / `simulationRev` /
  Monte-Carlo-result / selection / viewport effect from showing, dismissing,
  or resetting any hint** — presentation only, the same contract §GT12 states
  for the tour.

---

## CIH6. Mobile

| Hint | Mobile? | Notes |
|---|---|---|
| #1 Empty canvas | **No** | Mobile is view/run only and always shows a loaded graph, a Template, or `MobileOpenFileHint` ("nothing loaded yet, open a file") — that hint already owns this exact situation on mobile; adding a second one competing for the same moment is redundant, not additive. |
| #2 Monte Carlo | **Yes** | Same dialog, same trigger, mobile-fitted copy if the desktop wording references anything desktop-only (it doesn't currently). |
| #3 Review | **Yes** | The mobile Review sheet is its own mount point for the same content; same key, same one-time trigger. |
| #4 Focus / Filter | **Yes** | Both are real, reachable mobile More-sheet rows (`MobileMoreMenu.tsx` already wires `toggleFocusMode` and the Filter sub-sheet) — not desktop-only despite editing being desktop-only. Rendered as a one-line note above those two rows in the More sheet rather than a canvas `<Panel>` (there is no `top-center` canvas panel slot on the mobile view/run layout). |
| `Contextual help` Help entry | **Yes** | Both Help surfaces get the same third row (§CIH4). |

---

## CIH7. Behaviour boundary

Presentation only, mirroring §GT12 exactly: contextual hints carry no
`loop-*/N` id, define no wire field, are revised freely, and are never
observable in an export, a digest, an undo entry, or the engine. Showing,
dismissing, auto-clearing, or resetting-via-Help leaves every one of the
following byte-for-byte unchanged: the GraphDoc and its digest, undo/redo,
`simulationRev`, `SimState`, the Monte-Carlo config/result, the current
selection, the viewport, the theme, and the active locale.

---

## CIH8. Test boundaries (for the impl PR)

**`hintStore` unit tests** (mirrors `tourStore.test.ts`'s shape):
- default: nothing dismissed.
- `dismiss(id)` persists; a second read (simulating reload) still shows it
  dismissed.
- `reset(id)` clears just that one id, others untouched.
- a corrupt / unparsable stored value is treated as `{}`, not a lock-out.
- a `localStorage` throw on read or write is non-fatal — the in-memory state
  still updates for the session.

**e2e, one spec per v1 hint plus the Help entry:**
- each hint's trigger condition is necessary AND sufficient — it does not
  show before the condition, does show once true, does not show a second
  time after ✕ or auto-clear, does show again after `Contextual help → Show
  again`.
- no hint renders while the guided tour / Welcome card is active (seed both
  states, assert absence).
- the empty-canvas hint clears itself the instant a first node is added,
  without needing its own ✕.
- the Focus/Filter hint clears itself the instant Focus or Filter is
  actually toggled on.
- Escape does not dismiss any hint (asserted directly — a real behavior
  contract, not an oversight to catch later).
- a11y: each hint is `role="note"` or equivalent, not `role="alert"` (it
  never demands attention); forced-colors keeps the ✕ and text visible
  without relying on hue alone; no motion is introduced (hints appear /
  disappear with the same no-transition rule the tour follows) so
  `prefers-reduced-motion` needs no special case.
- mobile: the three mobile-eligible hints render in their mobile mount
  points; the empty-canvas hint never renders on mobile.

**Invariance:** a full `vitest` + e2e pass showing no `loop-revision/*` /
GraphDoc / undo / `simulationRev` / Monte-Carlo-result change from any hint
interaction.

---

## CIH9. Open for review

- **The v1 four-hint set (§CIH3)** — Hanrim's list named empty canvas, first
  connection, run errors, large graph, frames, and module insert as
  candidates; this pass recommends shipping the four with a clear one-shot
  trigger and folding frames into the large-graph hint, backlogging the
  three without one (§CIH3 #5–#7) rather than inventing a weaker trigger for
  them now.
- **The persisted-vs-session split (§CIH2.2)** — all four v1 hints landed on
  "persisted" by the stated rule (first-encounter-with-a-feature); confirm
  that rule, not just its four outputs, is right going forward.
- **Not migrating `lgr-focus-hint` / `lgr-suggest-note` onto the new
  mechanism (§CIH2.4)** — confirm this is deliberately out of scope, not an
  oversight.
- **The empty-canvas hint's exact copy / entry points named** (palette vs.
  Template vs. Import vs. module Building blocks) — a wording decision, not
  a structural one, best settled with real copy in front of it.

---

## CIH10. Order this feeds into

1. **This design pass** — Draft PR, no code.
2. **Review** — lock §CIH3's v1 set, §CIH2.2's tier rule, and §CIH9's open
   items.
3. **Implementation** — a Draft PR: `hintStore` + `<HintNote>` + the four v1
   hints + the `Contextual help` Help-menu entry (desktop + mobile) + i18n +
   the §CIH8 test set. Ready / merge is a separate approval, same as every
   prior slice.
4. **Then** — Onboarding, part 2 is complete; the only work left on the
   current roadmap is the Productization-track follow-ups already named
   elsewhere (module-system §MS10 items) and whatever review round 2 adds
   here.
