# Loop Studio — timeline series and header contract

Status: **canonical**, 2026-10-01. Implemented on `feat/timeline-series-contract`;
sections 3.1 and 3.2 landed first (state model + every persistence path + the
hydration split), then the view-level default, the one-row header, the selector,
the panel state and the summary toggle (sections 4 to 8).

Source is cited by **symbol and file**, never by line number: a review round disagreed
with every line number quoted here, which is reason enough not to quote them.

Shell rules (tokens, radii, focus ring) live in `Cozy_Shelter_Design_Tokens_v1.1.0.md`
and are not restated here. Nothing in this file belongs in the shared token spec.

Measurements were taken against `examples/mmo-progression.json` (97 nodes, 55 series) on
the local dev server at 1440x900 and 800x600, in a runtime prototype that changed no
repository file. The measurement record, including the attempts that failed, is kept
with the design-refresh artefacts outside the repository.

## 1. Why this exists

The legend renders inside `.timeline__head`, which sits **inside** the fixed 200px
`.timeline__panel`. With 55 series it wraps to about five rows and takes 193px of that
200px, leaving the plot **5px**. The chart was not empty — it had no room. Capping the
legend to one row returns the plot to **170px**.

Capping the legend alone is not enough: at 8 chips the chart still drew all **55** lines.
Legend length and rendered-series count are independent and each needs its own rule.

## 2. Where the field lives, and which documents this changes

`timelineSeries` is part of **`recommendedRunConfig`**, not a field of its own. Existing
properties that this contract preserves:

- A **pure display preference**: invisible to the content digest, the revision diff,
  undo and `simulationRev` (`src/model/serialize.ts`, `src/model/revision.test.ts`).
- Its declared type is **`string[]`** — sorted, de-duped; a non-array value is ignored on
  load. `setTimelineSeries` (`simStore.ts`) sorts and de-dupes before storing.
- It round-trips through **document, template, Workspace, Share and revision load**, and
  **every graph Export writes the current value back**. The autosave record persists it
  too — the only `recommendedRunConfig` slice that does.

**Which documents this changes.** The bundled examples already ship curated sets —
`mmo-progression` five, coffee-roastery four — so opening one has always produced a short
legend. The 55-chip / 5px case is where the field is **absent**: user-authored graphs.
That is the population this contract is for, and it is the common one.

## 3. The stored field: `auto` / `all` / `string[]`

`auto` is an **internal model name**. The default is represented on disk by the field
being **absent**; `'auto'` is never written.

| On disk | Internal | Meaning |
| --- | --- | --- |
| field absent | `auto` | stable document order, at most `DEFAULT_SERIES_CAP` (8) |
| `'all'` | `all` | every series, **including series added later** |
| `string[]` | `explicit` | exactly the ids the user chose |

Resolution, verified as a pure function over nine cases:

- absent or `'auto'` -> first 8 ids in stable document order
- `'all'` -> every current id; a series added afterwards **is** included
- `string[]` -> the stored ids filtered to those that still exist
- an id that no longer exists is **dropped on read**, silently
- if filtering leaves nothing, fall back to `auto` rather than draw an empty chart
- an empty array is treated the same as "nothing left"

**Order.** Storage order is **sorted** — that is existing behaviour, asserted by the
fixture tests. Display order in the legend is **document order**. These are different and
both must stay; do not "fix" one to match the other.

### 3.1 Required change — `'all'` must become storable

This is the single largest implementation risk. Today `'all'` is the *default* value, the
type admits only `string[]`, and a non-array is ignored on load. Adding a third state is
therefore not a one-line change; it must land across every path at once:

- the `RecommendedRunConfig.timelineSeries` **type** (`string[]` -> `'all' | string[]`)
- **file serialization** and the load-time validator that currently ignores non-arrays
- the **autosave** record
- **Export**
- **Share**
- **Workspace**
- **revision load**

If the type and the load validator are not changed together, `모두 표시` will appear to
work in-session and silently fall back to the 8-series default on the next open, because
the stored `'all'` is discarded as an unknown shape. Every one of these round-trips is an
acceptance item in section 10.

### 3.2 Required change — loading must not write

**This is not true today.** The chain is:

```
applyRecommended()                 mcStore.ts    — runs on EVERY document load
  -> setTimelineSeries()           simStore.ts
    -> setAutosaveTimelineSeries() graphStore.ts
      -> the immediate autosave write
```

So opening a document rewrites the autosave record. An earlier draft of this contract
claimed the opposite and called it verified; what had actually been observed was only
that the steady default state held no `timelineSeries` key, which says nothing about the
load path.

**But "opening a project writes nothing" is not an achievable contract, and an earlier
draft of this section still asked for it.** `loadDoc` goes through `commit('')`, and the
store's `persist()` schedules a full autosave 400ms later (`graphStore.ts`)
regardless of anything to do with the timeline. Demanding zero storage writes on load
would fail forever, for reasons that have nothing to do with this feature.

The contract is therefore narrowed to what this feature actually owns:

> Loading or resolving `timelineSeries` must not cause an **additional immediate**
> autosave, and an **absent field must remain absent**. The document load may still use
> the existing debounced graph autosave path.

What must change to satisfy it — the **hydration path separated from the user-action
setter**:

- a hydration entry point that seeds the visible set **without** calling
  `setAutosaveTimelineSeries()`
- `setTimelineSeries` kept for user actions, where writing is correct

How it is verified — not "zero writes", but these two:

1. **`setAutosaveTimelineSeries()` is not called anywhere on the load path.** Spy on it
   across document / template / Workspace / Share / revision load.
2. **After the existing debounced save has run**, `recommendedRunConfig.timelineSeries`
   is in the intended state: still **absent** for an `auto` document, and exactly the
   stored value otherwise.

Note for the second check: today `saveToStorage` omits the field when the value is the
`'all'` sentinel, which is why an untouched document currently shows no key. Once `'all'`
becomes a storable choice (3.1), "absent" and "`'all'`" stop being the same thing, and
this check is what keeps `auto` from silently acquiring a field.

Until the split exists, this clause is a **requirement, not a property**.

## 4. Drawn series

- `auto`: at most **8** lines (`DEFAULT_SERIES_CAP = 8`)
- `all`: every series
- `explicit`: exactly the selection
- at least **one**, *when at least one eligible series exists* — see 6.2
- a document with **no Pool and no Register** draws **zero** lines; that is correct, not
  a failure state

The cap applies to what is rendered — line, segment and bead — not only to the legend.

## 5. Header: always one row

The rule is **one row**, not "eight chips". A fixed count re-compresses the plot at
narrow widths: at 800px, eight chips wrap to three rows and the plot drops to 118px.

- Show as many chips as fit on **one row** at the current width.
- The chip count is therefore **not** the drawn-series count and must never be presented
  as if it were.
- The CSV control and the selector trigger keep their place; chips yield to them.
- The trigger is **always present**, at every width and in every state.

| Width | Chips | Lines | Header rows | Plot |
| ---: | ---: | ---: | ---: | ---: |
| 1440 | 8 | 8 | 1 | 170px |
| 800 | 3 | 8 | 1 | 170px |

Plot height holds at 170px in `auto`, `all`, `explicit` and RTL, at both widths.

## 6. The series selector

Replaces the inline `+N` expansion. It is a **selection** control, not a read-only legend
expansion, and must read as one — its items change project state.

Trigger:

- label `계열 {n}/{total}`, short enough never to wrap (measured 19px tall in every state)
- accessible name `차트 계열 선택, {total}개 중 {n}개 표시`
- `aria-haspopup="dialog"`, `aria-expanded`, `aria-controls`

Popover:

- `role="dialog"`, accessible name bound by **`aria-labelledby`** to the visible title
  `차트 계열 선택` — not `aria-label`
- one **checkbox per series** in document order, checked state reflecting the resolved
  selection — not bare chips
- fixed maximum height with its own scroll; it must never change the chart's height
- `Escape` closes and returns focus to the trigger; outside pointerdown closes; a click
  inside does not
- focus moves into the popover on open
- mirrors in RTL and stays inside the viewport at 800px

### 6.1 Actions — the two resets are different things

`기본값으로 재설정` was ambiguous: for a template that ships a curated five, "default"
could mean the template's five or the global automatic eight. They are different, so the
contract names only the one it implements.

| Action | Stores | Result |
| --- | --- | --- |
| `모두 표시` | `'all'` | every series, future ones included |
| checking every box by hand | the explicit array of every **current** id | exactly today's series; a series added later is **not** included |
| **`자동 선택으로 재설정`** | **removes the field** | global automatic selection, first 8 |

**`'all'` is reached only through the named `모두 표시` action** (decided 2026-10-01).
A hand-completed set of checkboxes is an explicit choice of the series that exist
now; it must not widen into "and every series added later", because the user never
said that. The two states differ exactly when a series is added afterwards: `'all'`
draws it, the explicit array does not. The legend chip toggle
(`toggleTimelineSeries`, `simStore.ts`) used to collapse back to `'all'` once every
series was re-selected; it now stores the explicit array for the same reason, and
never produces `'all'`.

So that the future-inclusive meaning is not hidden behind a two-word button, the
popover shows the sentence `현재 및 나중에 추가되는 계열을 모두 표시합니다.` under
`모두 표시` and binds it as that button's accessible description
(`aria-describedby`).

**`자동 선택으로 재설정` is the global automatic selection, not the template's
recommendation.** It is named for what it does.

Restoring a template's recommended set is a **separate, larger feature and is not in this
contract**: the opened recommendation is not preserved anywhere once the user changes the
selection, because `applyRecommended` copies it into the live selection and Export
rewrites `recommendedRunConfig.timelineSeries` from that live value. Offering it would
require retaining the as-opened array as new state. Not started unless asked for.

### 6.2 At least one series — when there is one to have

> When at least one eligible series exists, the selector must keep at least one selected.
> With zero eligible series, draw zero lines and expose a disabled `계열 0/0` trigger.

With eligible series present, unchecking the last remaining one is **refused**: the
checkbox returns to checked, a message is shown, and that series keeps being drawn. An
empty chart is not reachable *through the selector*. The guard lives in the store
(`toggleTimelineSeries` returns `false` and changes nothing), so the legend chip of the
last drawn series is refused the same way — the chip and the checkbox are two views of
one selection and cannot disagree about its floor.

A document with no Pool and no Register has nothing to draw. The minimum-one rule does
not apply to it, and must not be implemented as an invariant that such a document
violates. In that case the trigger reads `계열 0/0`, is **disabled**, and the popover does
not open — there is nothing to choose from.

### 6.3 The inline `+N` chip is replaced, not accompanied

`.timeline__key--more` must be unreachable once the selector ships. In explicit mode
`hiddenCount > 0`, so the old chip would otherwise reappear beside the new trigger — two
controls for overlapping jobs.

## 7. Timeline panel state

The collapse control already exists (`.pstrip__collapse`, 240px -> 40px, canvas 562 ->
762px) and already writes nothing. Only the default and the auto-expand rule are new.

```
untouched + before any run -> collapsed
untouched + first run      -> auto-expand
user has toggled it once   -> automatic transitions stop permanently
```

- Run, pause and reset never override a user choice.
- "First run" means the first time the session has something to show in the panel: a
  live step (`stepIndex > 0` or `status === 'running'`) **or a completed Monte-Carlo
  run** — the distribution view lives in the same panel and a result nobody can see
  is not a result. Automatic transitions only ever expand; the panel never collapses
  itself again.
- Screen state only: not in the project save format, not persisted. (Verified: toggling
  changes no storage key today.)
- Add the missing **`aria-expanded`**. It currently signals state only by swapping its
  `title` between `타임라인 숨기기` and `타임라인 표시`, while the section headers and the
  legend chip both expose `aria-expanded`.

Verified by falsification: with the auto-expand flag reset so only the user-touched guard
could hold the panel shut, a run advanced from step 0 to step 2 and it stayed collapsed.

## 8. Summary panel calculations

- One shared `계산식` toggle beside the summary heading, always visible.
- Shows and hides **all** expressions at once.
- A real `<button>` with `aria-expanded`. Not hover-only, no per-row repeated link.
- Accepted trade-off: this removes per-row independence, which the current build has.
  Revisit if expressions grow much longer.

Note: the per-row buttons in the current build are already real buttons with
`aria-expanded` and are always visible. The hover-only version existed only in a
discarded CSS prototype. This is a consolidation, not a fix.

## 9. Out of scope

- **Graph re-fit.** An automatic re-fit after a panel resize is a no-op for this
  document: the fit binds on width, the zoom is identical before and after, and the app's
  own re-fit reproduces a byte-identical transform. Keep the current rule.
- **`--tool-*` renaming.** Recorded in `token-map.md`, deliberately separated.
- **Restoring a template's recommended set.** See 6.1.

## 10. Acceptance

Verified **in the implementation** (`e2e/timeline-series.spec.ts` unless named
otherwise; the prototype rows this table replaced are in the measurement record):

| Criterion | Result |
| --- | --- |
| `auto`: at most 8 lines, document order | 12 Pools, no field: `Series 8/12`, 8 lines, 8 beads, the first eight checked |
| `all`: every series, future ones included | `Show all` → `'all'`; a Pool added afterwards is drawn (`5/5` → `6/6`) |
| explicit array: exactly the user's choice | `['p1','reg_a']` → 2 chips, `2/4`; checking `P2` → `['p1','p2','reg_a']`, written at once |
| every box checked by hand ⇒ the explicit array, not `'all'` | 4 of 4 checked → the array; a fifth series added afterwards is **not** drawn (`4/5`) |
| `자동 선택으로 재설정` removes the field | `'auto'` in the store, no `timelineSeries` key in the record |
| header one row in every state | 55 series at 1440 and 800, `auto` and `'all'`: every legend child in one band, nothing clipped, chips ≤ 8 |
| plot height held | ≥ 160px at both widths (200px panel minus a one-row head); the popover changes neither head nor plot |
| trigger never wraps or is pushed out | < 26px tall, inside the legend and the viewport at both widths |
| popover: dialog, focus, Escape, outside click | `role="dialog"` named `Chart series` via `aria-labelledby`; focus inside on open; Escape closes and focuses the trigger; a canvas click closes, a title click does not |
| at least one series, when one is eligible | unchecking the last: box springs back, `At least one series stays selected.`, 1 line; the chip of the last series is refused too |
| zero eligible series | Source → Drain only: 0 lines, `Series 0/0`, trigger disabled, no popover |
| `.timeline__key--more` never coexists | 0 in every state |
| panel state (§7) | starts collapsed with `aria-expanded="false"`; the first step expands it; after a user fold, three steps and a reset leave it folded; a completed Monte-Carlo run expands it; no storage key |
| summary `계산식` toggle (§8) | `e2e/model-panels.spec.ts`: one button beside the heading with `aria-expanded`, both rows' expressions together, no per-row button |
| a selector toggle moves no digest / undo / step | unchanged |
| no additional immediate autosave on load; absent stays absent | `src/store/timelineSeriesPersistence.test.ts` (§3.2): 0 writes from hydration per state; after the debounced save the field is absent for `auto` |
| `'all'` survives file / Export / Share / Workspace / revision load | the same unit file, 7 paths × 3 states; Graph JSON, Workspace and Share also end to end |

Falsified, each red before green: the six store tests for the toggle semantics
(6 red on the previous collapse-to-`'all'` code); the resolver with `'all'` capped
(exactly the "every current id" case red); the one-row header with every drawn chip
rendered (the two 800px header tests red — at 1440px all eight `auto` chips genuinely
fit, so that row cannot tell the sabotage from the product); the panel starting
expanded (the two §7 tests red).

Not covered by an automated check: the RTL mirroring of the popover (measured in the
prototype only) and a screen-reader pass — see `verification-needs-an-owner` in the
project notes. Neither is claimed.
