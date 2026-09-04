# Contextual inline help (non-frozen design doc — DRAFT)

**Status: DESIGN — direction approved, review round 2 locked four boundaries
(§CIH2.2, §CIH2.3, §CIH3, §CIH4).** `CIH` prefix. A non-frozen design doc like
[`guided-tour.md`](guided-tour.md), [`dense-graph-pan.md`](dense-graph-pan.md),
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
  again," and a **Show again next time** path so nothing is silently lost
  forever.
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

- **`hintStore`** (new, zustand) — `seen: Record<HintId, boolean>` hydrated
  from **one** `localStorage` key, `markSeen(id)`, `rearm(id)`. Try/catch
  guarded exactly like `tourStore`'s key (§GT6.3): a read/write failure is
  non-fatal and never locks a hint permanently off or on. Named `seen`, not
  `dismissed` — see §CIH2.1a for why that isn't just a naming choice.
- **`<HintNote id condition={condition}>`** (new, shared component) —
  computes `eligible = condition && !seen[id] && !closedThisInstance` (the
  last term is a local, unpersisted `useState`, reset on remount). Renders
  nothing when `!eligible`; otherwise the hint body plus one explicit **✕**
  that sets `closedThisInstance = true`. Two render shapes, chosen per hint: a
  canvas `<Panel position="top-center">` (reuses the existing
  `lgr-*-hint`/`-note` CSS shape) for canvas-situational hints, or a plain
  inline block for a hint embedded inside an existing dialog / overlay (Monte
  Carlo, Review).
- **The trigger condition stays at the call site**, not in a central
  registry — `nodes.length === 0`, `mcStore.status`, `reviewStore.open`, and
  so on are already live selectors exactly where each hint renders. A big
  central "if X then show hint Y" table would drift from real app state the
  first time either changes; a local condition next to the render, like the
  two hints already in `Canvas.tsx`, does not.

#### CIH2.1a `seen` is recorded on render, not on the ✕ click (review round 2)

The first cut of this doc tied persistence to the ✕ — reasonable-looking, but
wrong in practice: Monte Carlo and Review are dialogs the user opens and
closes routinely. If only an explicit ✕ click ever persisted anything, a user
who reads the hint once and simply closes the dialog (the overwhelmingly
normal thing to do) would see the *exact same* hint again the next ten times
they open Monte Carlo. That is nagging, not a one-time nudge.

**Fixed rule: `markSeen(id)` fires the instant `eligible` is first true for
that id — at render, in a mount effect — not gated behind any user action.**
The ✕ only ever controls whether *this one currently-mounted instance* stays
visible (`closedThisInstance`); by the time a user could even see the ✕, the
persisted `seen[id]` write has already happened. Closing the dialog without
touching the hint, clicking ✕, or the underlying condition simply going false
(e.g. Focus gets toggled on) — all three end up in the same place: the hint
was shown once, is now recorded as `seen`, and will not render again.

**`seen` is per-`hintId`, not one global flag** — already true of the data
shape (`Record<HintId, boolean>`), stated here as an explicit guarantee: a
*new* hint added in a future slice starts at `seen[newId] === undefined`
(falsy) for **every** existing user, including one who has every current
hint marked seen. Nothing about shipping hint #5 later silently suppresses it
for people who have already seen #1–#4.

### CIH2.2 Persisted vs. session-only — decided per hint, not globally

The codebase already has both tiers, for a reason:

- **Persisted** (the new `hintStore`, one `localStorage` key, `seen[id]`
  recorded on first render per §CIH2.1a) — right for a hint tied to **first
  encounter with a whole feature** (an empty canvas, Monte Carlo's first
  open, Review's first open). The user needs the nudge once, ever;
  re-explaining it every session is noise, exactly why the tour itself is a
  single `completed | dismissed` key (§GT6).
- **Session-only** (in-memory, resets on reload) — right for a hint tied to a
  **recurring state** that isn't really "teach this once," like the existing
  auto-frame suggest note: closing it frees the current look at the canvas,
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

#### CIH2.3a Global priority order (review round 2)

The first cut only ruled on CIH's own two canvas hints colliding with each
other. Hanrim's review pointed out the real conflict surface is wider: a
dialog-embedded CIH hint, the two **existing** LGR notices, and CIH's own
discovery-type canvas hints can all have a *true* trigger condition on the
same screen at once, and something has to say which one actually renders.
Fixed three-tier order, highest first:

1. **The hint for whatever screen is currently open** — Monte Carlo's hint
   (#2) while the MC dialog is open, Review's hint (#3) while Review is open.
   These live in their own dialog/overlay region, so in practice they never
   visually compete with a canvas hint — this tier exists to say explicitly
   that opening MC/Review is never blocked or delayed waiting on a canvas
   hint to clear.
2. **The two existing LGR notices** — `lgr-focus-hint`, `lgr-suggest-note`.
   Unchanged, out of scope here (§CIH2.4), and they keep first claim on the
   canvas `top-center` slot over anything new.
3. **CIH's own discovery-type canvas hints** — empty-canvas (#1) and
   Focus/Filter (#4). Lowest priority: either only renders when **neither**
   tier-2 notice is currently showing. (#1 and #4 can also never coexist with
   *each other* — their trigger conditions, `nodes.length === 0` vs.
   `nodes.length >= WORTH_IT_FLOOR`, are mutually exclusive by construction.)

**Post-tour cooldown.** Tier-3 hints additionally do not render for
`POST_TOUR_COOLDOWN_MS` (placeholder default 2000ms — a UX-tuning constant,
not a structural decision) after `tourStore.phase` transitions from
`welcome`/`running` back to `idle` (a tour finish, a tour dismiss, or a
Welcome-card skip). Without this, a graph that was already past
`WORTH_IT_FLOOR` for the whole tour would show the Focus/Filter hint the
literal instant the tour closes — a second onboarding moment stacked
immediately onto the first, exactly the "pile-up" the tour's own "nothing
stacks on it" rule (§GT6.1) was written to prevent, just reappearing one
layer up. Tier-1 hints (#2, #3) are **not** subject to this cooldown — they
only ever appear because the user just took a deliberate action (opening
that dialog), which is not a pile-up risk the same way a passive canvas note
triggered by pre-existing graph size is.

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
| 4 | **Large graph — Focus / Filter discovery** | `nodes.length >= WORTH_IT_FLOOR` (8 — same threshold as the auto-frame suggestion) **and** neither Focus nor Filter ever toggled on **and** tour idle + past the post-tour cooldown **and** (the user has made at least one canvas interaction this session **or** `LARGE_GRAPH_HINT_DELAY_MS` has elapsed since load) **and** no tier-2 LGR notice is currently showing (§CIH2.3a) | canvas `top-center` `<Panel>` (desktop); a one-line note atop the mobile More sheet's Focus/Filter rows | persisted | **Yes** |
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

**#4's timing gate (review round 2).** `nodes.length >= WORTH_IT_FLOOR` alone
is not enough to render this hint — loading the bundled MMO or Coffee
Template crosses that floor on the very first paint, at the exact moment the
existing `lgr-suggest-note` (auto-frame suggestion) is *also* eligible to
show for the same graph. Two onboarding notices competing for the same
`top-center` slot the instant a Template opens reads as clutter, not help.
Fixed: the hint additionally waits for **both** of —
1. `tourStore.phase === 'idle'` and past `POST_TOUR_COOLDOWN_MS` (§CIH2.3a);
2. **the user has made at least one canvas interaction this session** (a
   pan, a zoom, a selection, a node move — any of it) **or**
   `LARGE_GRAPH_HINT_DELAY_MS` (placeholder default 4000ms) has elapsed
   since load, whichever comes first —

and even once both are true, still yields to a currently-visible tier-2 LGR
notice (§CIH2.3a) rather than stacking beside it. In practice: opening a
large Template shows the auto-frame suggestion (if eligible) or nothing
first; the Focus/Filter hint only appears a beat later, once the user has
had a moment to actually look at the graph and nothing higher-priority is
already occupying the slot.

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
  **다음에 다시 표시 / Show again next time** button per row (renamed in
  review round 2 — see below) that calls `hintStore.rearm(id)` and closes the
  dialog.
- **What the button actually does (review round 2).** `rearm(id)` clears
  `seen[id]` — it does **not** force the hint to render right then. The hint
  becomes eligible again and shows at the **next moment its own trigger
  condition, tier, and cooldown rules (§CIH2.3a) are naturally satisfied** —
  which is sometimes immediately (closing the Help dialog can itself be the
  qualifying "canvas interaction" for #4, if its other gates are already
  clear) but is never forced out of context. This is exactly why the label
  is **"Show again *next time*"**, not a bare "Show again": a bare "Show
  again" reads as an immediate action, and popping a hint up disconnected
  from the Help dialog it was just requested from — mid-dialog-close, with no
  situational grounding — is precisely the kind of interruption §CIH2.3
  rules out everywhere else.
- `help.contextual.*` i18n namespace, EN + KO, same catalog discipline as
  `tour.*` / `about.*`.

---

## CIH5. Persistence / dismiss model

- **One** new `localStorage` key, `loop-studio/contextual-help/1` — namespaced
  like `loop-studio/guided-tour/1` (§GT6). Value: a JSON object
  `{ [hintId]: true }` for every *persisted-tier* hint that has been shown at
  least once (§CIH2.1a — recorded on render, not on explicit dismiss). Keyed
  per `hintId`, so a hint added in a future slice is unaffected by what an
  existing user has already seen (§CIH2.1a). Read/write wrapped in try/catch;
  a missing, corrupt, or unparsable value is treated as `{}` (every hint
  shows again) — never as "everything permanently dismissed." Same non-fatal
  principle as §GT6.3.
- **Session-only tier** hints (none in v1's four — see §CIH2.2 — but the
  mechanism supports them for later use, e.g. if a future hint follows the
  `suggestNoteDismissed` shape) keep their own in-memory `useState`, not
  written to the shared key at all.
- **Two UX-tuning constants, not structural decisions:** `POST_TOUR_COOLDOWN_MS`
  (§CIH2.3a) and `LARGE_GRAPH_HINT_DELAY_MS` (§CIH3 #4). Both live as plain
  constants next to `hintStore`, not persisted, not configurable by the user
  — placeholders to be tuned during implementation, not locked by this doc.
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
- default: nothing seen.
- `markSeen(id)` persists; a second read (simulating reload) still shows it
  seen.
- `rearm(id)` clears just that one id, others untouched.
- a corrupt / unparsable stored value is treated as `{}`, not a lock-out.
- a `localStorage` throw on read or write is non-fatal — the in-memory state
  still updates for the session.
- **a new hintId is unaffected by other ids already marked seen** — the
  concrete regression test for §CIH2.1a's per-hint guarantee: seed
  `{ "empty-canvas": true, "mc-first-open": true }`, assert a never-seen
  third id still reads as not-seen.

**`<HintNote>` unit / component tests:**
- `markSeen(id)` fires the moment `eligible` first becomes true — **not**
  gated on the ✕ being clicked (§CIH2.1a): mount with `condition = true`,
  assert `hintStore.seen[id]` is already true before any click.
- clicking ✕ hides *this instance* immediately without needing `seen[id]` to
  change (it's already true) — assert via `closedThisInstance`, not via a
  second `markSeen` call.

**e2e, one spec per v1 hint plus the Help entry:**
- each hint's trigger condition is necessary AND sufficient — it does not
  show before the condition, does show once true, does not show a second
  time after being shown once (with or without an explicit ✕ click — assert
  both paths), does show again after `Contextual help → Show again next
  time` **once its own trigger/tier/cooldown conditions are next met** (not
  forced the instant the button is pressed — assert the hint is still absent
  immediately after the Help dialog closes if its gating conditions aren't
  met yet, e.g. Focus/Filter's interaction-or-delay gate).
- **priority order (§CIH2.3a):** with an MMO/Coffee-sized graph freshly
  loaded, `lgr-suggest-note` (or `lgr-focus-hint`) showing suppresses the
  Focus/Filter hint even once all its own gates are individually satisfied;
  once the LGR notice clears, the Focus/Filter hint becomes eligible.
- **post-tour cooldown (§CIH2.3a):** finishing/dismissing the tour on an
  already-dense graph does not show the Focus/Filter hint until
  `POST_TOUR_COOLDOWN_MS` has passed.
- **the interaction-or-delay gate (§CIH3 #4):** a single pan/zoom/selection
  satisfies it immediately, without waiting for `LARGE_GRAPH_HINT_DELAY_MS`;
  with zero interaction, the hint still appears once the delay elapses.
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

## CIH9. Decisions

**Locked — review round 1 (the v1 hint set):** the four-hint set (§CIH3)
ships with a clear one-shot trigger each; frames folds into the large-graph
hint; first-connection recovery, run-error explanation, and module-insert
discovery are backlogged (§CIH3 #5–#7) rather than given a weaker invented
trigger now. The persisted-vs-session split (§CIH2.2) confirmed: all four v1
hints are persisted by the first-encounter-with-a-feature rule. Not migrating
`lgr-focus-hint` / `lgr-suggest-note` onto the new mechanism (§CIH2.4)
confirmed deliberate, not an oversight.

**Locked — review round 2 (the four boundaries above):**
1. §CIH3 #4's timing gate — `WORTH_IT_FLOOR` alone is not sufficient; add the
   tour-idle + cooldown + interaction-or-delay + tier-2-notice-clear gates.
2. §CIH2.1a — `seen` is recorded on first render, not on the ✕ click; the
   store field and API are renamed (`dismissed`→`seen`,
   `dismiss`/`reset`→`markSeen`/`rearm`) to make that the obviously-correct
   reading, not an implementation detail someone has to already know.
3. §CIH4 — the Help-menu button is **"Show again next time"**, re-arms
   (clears `seen[id]`) rather than force-rendering; it is still subject to
   every one of a hint's own trigger/tier/cooldown rules.
4. §CIH2.3a — the two-hint canvas-collision rule is widened to a three-tier
   global priority (open-screen hint → existing LGR notices → CIH discovery
   hints) plus a post-tour cooldown.

**Still open:**
- **The empty-canvas hint's exact copy / entry points named** (palette vs.
  Template vs. Import vs. module Building blocks) — a wording decision, not
  a structural one, best settled with real copy in front of it.
- **The two placeholder timing constants** (`POST_TOUR_COOLDOWN_MS`,
  `LARGE_GRAPH_HINT_DELAY_MS`, §CIH5) — UX-tuning values, not locked by this
  doc; the implementation PR can adjust them without a design amendment.

---

## CIH10. Order this feeds into

1. **This design pass** — Draft PR, no code.
2. **Review** — round 1 locked the v1 hint set and the tier rule; round 2
   locked the four boundaries in §CIH9. — **done.**
3. **Implementation** — a Draft PR: `hintStore` + `<HintNote>` + the four v1
   hints (with the §CIH2.3a priority order and §CIH3 #4 timing gate wired in
   from the start, not bolted on after) + the `Contextual help` Help-menu
   entry (desktop + mobile) + i18n + the §CIH8 test set. Ready / merge is a
   separate approval, same as every prior slice.
4. **Then** — Onboarding, part 2 is complete; the only work left on the
   current roadmap is the Productization-track follow-ups already named
   elsewhere (module-system §MS10 items).
