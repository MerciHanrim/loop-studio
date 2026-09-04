# Product Direction (non-frozen direction doc — DRAFT)

**Status: settled direction — no implementation.** This doc fixes *what Loop
Studio is for* and *who it is for* before the next two design passes
(large-graph readability, small module / template system) begin, so that they
do not pull in different directions. It is **complete on merge** — the five
decisions in §PD9 are the deliverable; after that it is revised only if one of
those decisions changes, not tracked as ongoing work. It changes **no app code**, adds **no
`loop-*/N` id**, and touches nothing the engine computes or serializes. It is
revised freely, like [`docs/visual-language.md`](visual-language.md),
[`docs/localization.md`](localization.md), and [`docs/edge-routing.md`](edge-routing.md).

| | |
|---|---|
| **From** | Lumi |
| **For** | Hanrim · Cozy Shelter |
| **Date** | 2026-09-02 |
| **Trigger** | strategic review after the *Early MMO progression* example ([`docs/example-mmo-progression.md`](example-mmo-progression.md)) |
| **State** | engine + editor + playback + Monte-Carlo + revision + localization all shipped; general-user authoring unproven |
| **Decides** | primary usage mode · content roles · large-graph stance · exposed editing surface · positioning |
| **Does not decide** | any UI, any layout algorithm, the block insert / merge mechanism, any wire change, the order of the two follow-on design passes |

§PD9 is the decision record. §PD10 is the scope boundary. §PD8 is the one
sequencing question left open on purpose. **§PD11** (added 2026-09-02) records
an external reader's take that arrived during the coffee-Template design:
*fix the concrete use purpose before the target industry* — with **§PD11.1**
(added 2026-09-03) recording the coffee comprehension check's partial pass.
**§PD12** (added 2026-09-03) records a game-design / PD reviewer's read of the
Early MMO example and four spec-first candidates derived from it — none adopted.

---

## PD0. Why

The *Early MMO progression* example (97 nodes / 144 edges) shipped and verified.
It proved the expressive power of the model **and its authoring cost**. Building
that economy from a blank canvas requires the user to, in one sitting: decide
which quantities are Pools vs Registers; decompose combat / reward / death into
branches; write dozens of nodes and connection expressions; hand-place nodes to
avoid edge crossings; construct accounting invariants and end conditions; choose
the Timeline and Monte-Carlo tracked series; then run and re-arrange to find
mistakes. That is "learn a simulation language and diagram design first", not
"use a tool".

Where the value actually is today:

| Task | Realistic assessment |
|---|---|
| Small economy-flow design + verification | **practical** |
| Modifying an existing template into a variant | **somewhat practical** |
| Authoring a large model on a blank canvas | **impractical for a general user** |

Hanrim, shown the MMO example and told *"change the parts you need"*: **"I don't
think I could use it."** Not only the node count — it is hard to know *what* to
change for *what* effect, one concept is spread across many nodes and
expressions, breakage is unpredictable, unlocking the canvas risks wrecking the
layout, and dozens of internal calculations and accounting checks are shown raw.
**Understanding the example costs about as much as building a new one.**

So the next phase is **hiding complexity and shrinking the unit of work**, not
adding capability. This doc pins the direction that phase serves.

---

## PD1. Scope

**In**

- the answer to five product-direction questions (§PD2–§PD6);
- a short list of things this direction *implies* but defers to a later doc or a
  batch pass (§PD7);
- the one open sequencing question (§PD8);
- a decision record and a scope boundary.

**Out**

- Any change to `src/`, any component, any style, any catalog string.
- Any layout / grouping / collapse algorithm — that is the *large-graph
  readability* design pass.
- Any Template-picker UI, connection-helper, or staged-build-flow spec — that is
  the *small module / template system* design pass.
- Any wire-contract change. No `loop-*/N`. The Example / Template / Building
  block distinction is **editorial and packaging**, not a new file kind — every
  one of them is a plain Graph JSON (§PD3).
- **Any block-assembly mechanism.** Deciding that *Building block* is a product
  role (§PD3) does **not** authorise the insert / merge implementation:
  id-collision handling, placement, selection / undo integration,
  connection-boundary rules between block and host, and any save metadata a
  block file carries are all the *small module / template system* pass. This
  doc changes nothing in GraphDoc.
- Re-labelling, re-locking, or restructuring the existing templates now (§PD7).

---

## PD2. Q1 — Does the user build from scratch, or adjust existing material?

**Decision: the default path is _adjust a verified template_ or _assemble small
building blocks_. The blank canvas stays, as an advanced path, unchanged.**

- Three entry paths, ranked by how the product presents them:
  1. **Adjust a template** — open a verified model, change a few surfaced
     values, run, compare. *Primary.*
  2. **Assemble building blocks** — drop in a small pre-wired piece (one combat
     loop, one level-up, one drop→sell), connect it to what is there. *Primary
     as an intended path; the insert / merge mechanism is not specified here —
     see §PD3 and §PD8-B.*
  3. **Blank canvas** — every node kind, every expression, free placement.
     *Advanced; unchanged; never removed.*
- The blank canvas is not deprecated and gets no warning gate. It simply stops
  being the implied starting point in first-run copy, the Templates menu, and
  onboarding.
- This is a **presentation and defaults** decision. No editor capability is
  removed to make it true.

---

## PD3. Q2 — How are Example / Template / Building block distinguished?

**Decision: three editorial roles over the same Graph JSON format, each with its
own default open-state and its own messaging in the Templates menu.**

| Role | What it is | Opens as | Templates-menu message |
|---|---|---|---|
| **Example** | A finished, complex model to **run and observe**. *Early MMO progression* is one. | **Edit-locked** (canvas locked, read-only Inspector, selection + run still work — the current `canvasLocked` / `recommendedRunConfig` behaviour). | "Open and run. A worked model to study — not a starting point to edit." |
| **Template** | A **starting point** where the user changes only **3–5 clearly surfaced values** and runs. | Editable, but the surfaced values are the obvious first thing (see §PD5). | "Change a few values, run, compare." |
| **Building block** | A **small system piece** — ~8–15 nodes: one combat + win/lose; XP + one level-up; item drop + sell; food consume + rebuy. | Editable; small enough to read whole. | "A small pre-wired piece to drop into a bigger model." |

- **No new file kind, no schema flag is required for the distinction.** It is
  carried by the Templates registry entry (`templateKeys.ts` id-map + EN/KO name
  and blurb, as today) plus the existing `canvasLocked` field for Examples.
  Whether a lightweight `role` tag is worth adding is a question for the
  *module system* design pass, not this doc.
- **What "Building block" decides — and what it does not.** *Decided here:* it
  is a product role, ~8–15 nodes, editable, listed in the Templates menu.
  *Not decided here:* how a block is **inserted into an existing graph** —
  id-collision resolution, placement, selection / undo, the connection boundary
  between block and host — and any **save metadata** a block file carries. Those
  are the *small module / template system* design pass (§PD8-B). Until that pass
  ships, a Building block is just a small Graph JSON opened like any other
  template; "assemble" names the intent, not an approved feature, and this doc
  authorises no GraphDoc change to support one.
- The Templates menu must **not** message an Example as "modify this to reuse".
  That is the single messaging bug this table exists to prevent.
- *Early MMO progression* stays an **Example**, stays edit-locked, is **not**
  "fixed" or demoted. It did its job: it verified the ceiling.

---

## PD4. Q3 — One canvas for a large model, or split via groups / sub-graphs?

**Decision: keep one canvas and one file. Improve readability _on top of_ that
first. Do not commit to any serialization-format change in this doc.**

- **Short term (the readability design pass):** affordances layered over the
  existing single graph. Two are clear render / UI-only candidates:
  - a **focus view** — select a node / region, everything else dims;
  - **connection de-emphasis / filtering** — fade or hide edge classes not
    currently of interest; a transient, non-persisted view state.
  A third is **not** settled here:
  - **group frames** — a labelled boundary around a set of nodes. Whether a
    frame is *auto-inferred* or *session-transient* (no persistence, UI-only)
    or *user-authored and saved* (its position, size, and membership have to be
    serialized somewhere) is a **readability-design-pass decision**. A saved
    frame would likely need its own **cosmetic wire contract** — the pattern
    `route` / `waypoints` set in `loop-revision/3` (projected + diffed, never
    engine-affecting). This doc authorises **neither** that storage mechanism
    **nor** an assumption that group frames come for free.
- **Long term (revisit later, not now):** collapsible **composite nodes** /
  sub-graphs that actually fold a region into one node. This *would* touch the
  wire contract and needs its own frozen amendment when — and if — it is taken
  up.
- **What this doc fixes:** one canvas, one file; the focus view and transient
  filters are the render-only starting point. Anything that *persists* new
  user-authored structure — a saved group frame now, a composite node later —
  is a wire-contract question for the pass that builds it, **not** pre-approved
  as render-only here. The readability pass is *expected* to lean render-only
  (as the Canvas Visual Refresh and orthogonal routing did), but this doc does
  not mandate it for a persisted frame.

---

## PD5. Q4 — Surface only the user-editable key variables separately?

**Decision: yes. Separate _the few values a user is meant to change_ and _the
result summary_ from the raw node / expression graph.**

- A Template (and, later, a composed model) carries a small set of **surfaced
  inputs** — the 3–5 values from §PD3 — presented together, away from the
  canvas, as the first thing the user sees.
- A **result Summary** — the handful of outcome numbers that matter (time to
  goal, final gold, deaths, …) — is presented the same way, separate from the
  internal calculation nodes.
- **Raw nodes and expressions stay reachable** through normal (advanced)
  editing. Nothing is hidden permanently; it is just not the default surface.
- **Expressions** should read as a **plain-language description** with the
  literal formula available behind a *show calculation* (`계산식 보기`) control,
  so a non-author can tell *what a node does* without parsing the grammar.
- **How** any of this is presented — a panel, a side sheet, an overlay — is the
  *module system* design pass. This doc only fixes that the separation exists.

---

## PD6. Q5 — Expert modeller, or experiment tool for general planners / designers?

**Decision: position Loop Studio as _"load a verified system, adjust it, and
compare what the run does"_ — an experiment tool. Not "a tool anyone uses to
build a complex model from scratch".**

- **Honest current state:** a **technically strong prototype**. Proven — graph
  edit / save / share; deterministic sim + probabilistic branching; playback /
  Timeline / Monte-Carlo; desktop / mobile / a11y; EN·KO localization; running a
  full MMO-scale economy; data / save-format / sim-state invariance. **Not
  proven** — a general user modelling their own problem without help.
- The **`preview` badge stays.** It matches this state exactly.
- **Claims to avoid:** "model anything", "build your economy from scratch in
  minutes", "no learning curve".
- **Claim to make:** "Open a worked model. Change a few numbers. Press play.
  See what changes." Blank-canvas modelling is the advanced door, named as such.
- The long-term possibility of **AI drafting a model from natural language** is
  real but downstream — it is only trustworthy once the modules, connection
  rules, and validation structure are stable enough to check its output. Not
  this phase.

---

## PD7. Implied, but handled elsewhere

Recorded here so the follow-on passes inherit them, not so they are done now:

- **Template localization overlay** — a human-authored per-locale
  `nodeId → label` dictionary applied only when a fresh template is opened
  (see the `mmo-progression.ko.json` reasoning). **Decided inside the *module
  system* design pass**, alongside how Templates carry their surfaced inputs —
  not built as a standalone slice first.
- **Contextual inline help** — designed **after** the structure above is fixed.
  Help placed before structure would only *explain* the complexity instead of
  *reducing* it. It stays the last item under Onboarding part 2 in the README
  roadmap.
- **Existing Templates #1 / #2 polish** (`equilibrium`, `deadlock`) — folded
  into whichever pass first touches the Templates menu; not a separate task.
- **Large-graph readability** and the **small module / template system** are
  **separate implementation PRs** with **separate design docs**. This doc does
  not merge them.
- **Manual waypoint editing** and **Scenario Compare** remain out of scope —
  separate future projects, unchanged by this doc.

---

## PD8. Open question — which follow-on pass goes first

Deliberately not answered here. After this doc merges, the first implementation
design pass is **one of**:

- **A. Large-graph readability** — focus view + transient filters (render-only),
  and a decision on the group-frame persistence model (§PD4 short-term). Makes
  the *existing* Examples legible.
- **B. Small module / template system** — Example / Template / Building block
  packaging, surfaced inputs + result Summary (§PD3, §PD5), **block insert /
  merge + any block save metadata** (§PD3), a connection helper, a staged build
  flow, the localization overlay (§PD7). Larger; shapes how new models get made.

**Settled:** A went first and shipped in `v0.8.0-dev`
([`docs/large-graph-readability.md`](large-graph-readability.md)). B is the
current design pass — [`docs/module-system.md`](module-system.md) (`MS`); its
headline finding is that the first cut needs **no** new file format or block
save metadata.

---

## PD9. Decision record

| # | Question | Decision |
|---|---|---|
| Q1 | Build from scratch vs adjust | **Adjust template / assemble blocks = default path. Blank canvas kept as an unchanged advanced path.** (§PD2) |
| Q2 | Example / Template / Building block | **Three editorial roles over the same Graph JSON. Example opens edit-locked; Template surfaces 3–5 values; Building block is ~8–15 nodes. Templates menu must not tell users to edit an Example.** (§PD3) |
| Q3 | One canvas vs split | **One canvas, one file. Focus view + transient edge filters are the render-only start. A user-saved group frame's persistence — and any cosmetic wire contract it needs — is a readability-pass decision, not pre-approved as render-only here. Collapsible composite nodes are a later, format-touching question.** (§PD4) |
| Q4 | Surface key variables | **Yes. Surfaced inputs + result Summary presented separately from the raw graph. Raw nodes / expressions stay reachable via advanced editing. Expressions get a plain-language description + `계산식 보기`.** (§PD5) |
| Q5 | Expert modeller vs experiment tool | **Experiment tool: "load a verified system, adjust it, compare the run." `preview` badge stays. No "model anything" claims.** (§PD6) |
| — | Building-block assembly | **Role decided (§PD3). The insert / merge mechanism — id-collision rules, placement, selection / undo, connection boundary — and any block save metadata are deferred to the module-system pass. No GraphDoc change here.** (§PD1, §PD3) |
| — | Format change | **None. No `loop-*/N`. No `src/` change. Editorial + packaging only.** (§PD1) |
| — | Next pass order | **Left open on purpose — A (readability) or B (module system).** (§PD8) |
| — | Positioning, restated (§PD11) | **Loop Studio is not an ERP / live-data manager. It composes connected operating flows visually and compares outcomes as a few conditions change — an operating-flow simulation. Any domain example (coffee, …) is a simplified model, never billed as that field's management system. Fix the concrete use purpose — who, in what setting, for what decision — before widening to an industry.** (§PD11) |

---

## PD10. Scope boundary

This doc:

- **is not** a feature spec, a UI design, or an implementation plan;
- **does not** change, add, or remove any file under `src/`, any component, any
  style token, or any localization string;
- **does not** change the engine, `R(t)`, expressions, state semantics,
  Monte-Carlo, the revision / proposal format, Share, the Workspace format, or
  any serialized byte;
- **does not** authorise any block insert / merge implementation, or any
  GraphDoc change to support one;
- **does not** pre-approve a persisted group frame as render-only, nor
  authorise any wire contract for one — the readability pass decides whether a
  frame is transient or saved, and what a saved frame costs (§PD4);
- **carries no `loop-*/N` id** and freezes nothing;
- **is superseded in part** by each follow-on design doc as it lands — those
  docs own the details; this one owns only the direction they must not
  contradict.

---

## PD11. External read — fix the use purpose before the target industry *(added 2026-09-02)*

During the coffee-Template design
([`docs/example-coffee-roastery.md`](example-coffee-roastery.md)), an
**external, domain-informed reader** — shown Loop Studio and reading it as a
production / operations tool — warned that a real system in that space is large
(lot / varietal tracking, vendor management, real-time stock, WIP + lead-time,
reorder point / BEP, auto cost-accounting output) and that showing only a few
disconnected stages *"may be valued as an artwork, but not as a practical
tool."* Their recommendation: **decide the concrete field of use and the use
purpose first — who, in what setting, for what decision — before mapping the
work onto an industry.** Recorded here anonymised; the value is the judgement,
not a feature list.

**Two conclusions carried into product work:**

1. **Every domain example is a *limited operating-flow simulation*, framed as a
   simplified model — never billed as that field's management / operations
   system.** Confirms §PD6. *Partial but realistic-looking is worse than
   clearly scoped.* The coffee entry adopts this wording
   (`docs/example-coffee-roastery.md` §CR2.0).
2. **Fix a concrete user + use purpose + decision problem before widening to an
   industry.** "It could be used in many places" is not a direction; one named
   purpose, validated against the current structure, is. This is the bar the
   module-system pass (§PD8-B) and any future domain template must meet.

*Noted, not adopted:* the reader also saw a path toward **PERT / CPM**
project-network scheduling. That is a **different core model** (task precedence
+ durations + critical path, not resource / stock flow) — recorded as a
separate, later, spec-first candidate only; not folded into the current model
or any planned pass.

**Not changed by this:** the five §PD9 decisions stand; no `src/` change, no
`loop-*/N`, nothing serialized. §PD11 narrows *how a domain example is
positioned and validated*; it adds no scope.

### PD11.1 Second coffee-domain read — comprehension-check result *(added 2026-09-03)*

The coffee Template's external comprehension check
([`docs/example-coffee-roastery.md`](example-coffee-roastery.md) §CR11.5)
returned a **partial pass**: the simplified flow, the naming (within the
Template's stated scope), and the five levers were understood; a completed
before/after run explaining the direction of each lever's result was not
demonstrated. Two observations carried into product work — **one external
reviewer's domain judgement, not a market finding:**

1. **The stronger potential the reviewer saw is in education / explanation /
   scenario comparison, not a real operations system.** The reviewer expects
   limited real-work pull across small, mid-size, and large operators — each
   for a different reason (too complex for a busy small cafe; a large roaster
   already has its own stock system; a mid-size roastery carries far more item
   types than a few levers hold).
2. **Trying to absorb every multi-item / by-scale / by-vendor reality makes
   scope and complexity spike** and blurs the model's purpose. A domain example
   stays a simplified operating-flow simulation (consistent with §PD6 and
   §PD11).

*Noted, not adopted:* follow-up candidates surfaced — **scenario /
point-in-time diagram comparison**, **clean soft-copy and print export**, and a
**multi-item summary report** — kept as **separate**, later, spec-first
candidates only; no roadmap slot, no implementation approval, not folded into
the coffee Template or any planned pass.

No "field usefulness verified" / "real-roastery suitable" / "passed external
validation" claim is made from this read.

---

## PD12. External review — game-design / PD reviewer *(added 2026-09-03)*

An **external reviewer with game-design and PD experience** was shown Loop
Studio and the Early MMO example
([`docs/example-mmo-progression.md`](example-mmo-progression.md)) over four
rounds of feedback. Recorded here anonymised; the value is the judgement, not a
feature list. This section records **only** that reviewer's input — MJ's coffee
comprehension check is a separate Coffee external-check result and is not folded
in here.

### PD12.1 What the reviewer directly observed

- Performance looks good.
- The current screen's complexity is very high — *"like looking at Opus
  Magnum"*, and at the same time *"like a well-built Blueprint"*.
- Step-by-step **show / hide of detail** seems needed, while the top-level
  Master / Root context stays visible throughout.
- If the per-level stat / balance / formula-input tables a real project keeps in
  **Excel or Google Sheets** could be connected by a **unique key**, the tool's
  general real-world applicability would grow.
- They located, by domain meaning: **base / input**, **level and its attached
  information / state**, **activity / process such as combat or quests**, and
  **results such as level or revenue**.
- In the current structure a **gacha simulator** looks like an attractive
  concrete use case.

### PD12.2 The core reading — a navigation gap

A first-time reader traced the model by *domain* meaning:
**base / input → level and its attached information / state → activity / process
such as combat or quests → results such as level or revenue**. The current
canvas is precise about node *kinds* and wiring but weak on **domain regions** —
a newcomer cannot quickly answer "what is the premise, what do I adjust, where
does the process happen, which output do I read". The **Node-kind filter does
not close this**: engine classes (`source` / `pool` / `gate` / `register`) are a
different axis from the user's domain classes (base / process / result).

### PD12.3 Candidates we derived from this feedback

The items below are **our product interpretation of the feedback**, expressed as
**separate, later, spec-first candidates** — the reviewer did not request or
decide any of them as a feature. None is adopted; none changes the §PD9
decisions or the LGR slice order (Slices 1–3 shipped, 4a in review, 4b its own
design pass, 5 deferred); no `src/` change, no `loop-*/N`, nothing serialized.

**A. Semantic sections / authored landmarks.** A **template author** names
regions (base / input, state / level, activity / process, result) to guide a
first-time reader. Distinct from **Slice-4a transient group frames**, which are
session-only, pure-visual, and dropped on any whole-graph swap — they cannot be
an *authored* landmark. A **saved authored region** may touch GraphDoc /
serialize / digest / undo, so it is its own spec-first pass. Review questions to
carry:

1. Can a first-time user find input / process / result in about ten seconds?
2. Can regions be marked by *domain* meaning rather than engine node kind?
3. Should each region summarise its representative result / I/O at a high level?
4. How are saved regions distinguished from session-only frames?
5. Do these regions, combined with Focus / Filter / Activity / run-errors, still
   never hide a selection, an error, or a run signal?

**B. Hierarchical groups / collapsible subgraphs.** Keep a top-level overview
while expanding / collapsing detail steps, with the Master / Root context always
visible. Undecided and needing its own design: whether a collapsed group is a
filter that hides nodes or a real subgraph; how a collapsed group's boundary
edges connect; how run cues / errors / selection summarise up to the parent.
Related to (A) but not the same feature.

**C. Key-based external data binding.** Map a **unique key + columns** of an
external table to Loop Studio inputs — e.g. a source `character_stats`, key
`class=warrior, level=15`, columns `attack_power` / `armor` / `stamina`,
consumed by a `parameter` or a calc input. Domain-general (product id → price /
stock / lead-time; bean-lot id → qty / cost / yield; task id → duration /
resource / progress), **not** a hard-coded game or domain. A spec-first pass
must separate: a **snapshot** import (CSV / JSON pinned into the doc) versus a
**live** link (Excel / Sheets); the row-finding key with duplicate / missing
handling; number / string / unit / empty / wrong-type values; a source that
changed or was deleted; a Share / Workspace opener without source access;
pinning which data version a run used, for reproducibility; when an
external-data change makes a sim / Monte-Carlo result stale; how Import /
Export / autosave / digest / revision represent source versus snapshot; whether
a review-and-confirm step is needed before external values reach the engine.
Our initial leaning (not decided): a **CSV / JSON snapshot import** is a smaller
first step than a live Google Sheets link.

**D. Gacha-simulator example Template.** Recorded as: a **small independent**
Template (not added to the MMO example); a **generalised** probabilistic
item-draw model with no commercial game's names, data, images, or exact odds;
framed as *observing the outcome distribution of authored probabilities and
rules*, never "predicting a real game's rates". It exercises the core (per-tier
odds branching, resource flow, repeated runs, Parameter tuning, result
Registers, a Monte-Carlo distribution) on a small graph and makes base →
process → result obvious: **base / input** = owned currency, per-draw cost,
per-tier odds; **process** = spend currency → probabilistic draw → per-tier
result; **result** = per-tier counts, total currency spent, whether / after how
many tries a target tier is hit. Our proposed first scope would be
**independent draws only**; prior-state rules (pity / guaranteed pickup /
50:50-then-guaranteed) would be checked against current engine expressiveness
first and **excluded from the first scope if unsupported**. Positioned as a
model for **understanding and verifying** a probability structure and its
resource cost — **not** a monetisation / revenue-optimisation tool. Test
boundaries to carry: probability-sum, invalid input, seed reproducibility, run
count, Monte-Carlo interpretation. Engine-feasibility questions to answer
*before* any spec:

1. How is a single draw represented?
2. Do multi-tier probability branches compose exactly?
3. Is one step equal to one draw?
4. Can "first time the target tier is obtained" be recorded?
5. Can pity-style state (remembering the prior failure count) be expressed?
6. Can Monte-Carlo show the key user-facing results with the current Registers
   and charts alone?

### PD12.4 On the MMO example and "game formula" wording

- The Early MMO example is a **growth / resource / economy-flow** example, **not
  a combat simulator**.
- The absence of attack / defense / health is **not** an error in the current
  scope.
- If a **future** combat example references a published game's formula, it must
  state the **exact version, formula, and scope** it borrows.
- Such a combat example is reviewed as a **separate small example**, never
  appended to the 97-node MMO example.
- This document adopts **no** combat example and **no** formula.

**Not changed by this:** the five §PD9 decisions stand; the LGR slice order is
unchanged; §PD12 records external input plus four independent, later,
spec-first candidates — it adopts nothing and adds no scope. No `src/` change,
no `loop-*/N`, nothing serialized.
