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
sequencing question left open on purpose.

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

- **Short term (the readability design pass):** presentation-only affordances
  over the existing single graph —
  - a **focus view** — select a node / region, everything else dims;
  - **connection de-emphasis / filtering** — fade or hide edge classes not
    currently of interest;
  - **group frames** — a visual boundary + label around a set of nodes, purely
    cosmetic, no semantic nesting.
- **Long term (revisit later, not now):** collapsible **composite nodes** /
  sub-graphs that actually fold a region into one node. This *would* touch the
  wire contract and needs its own frozen amendment when — and if — it is taken
  up.
- **This doc does not authorise** any format-changing feature. The readability
  pass is expected to stay render-only, like the Canvas Visual Refresh and
  orthogonal routing did.

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

- **A. Large-graph readability** — focus view, connection de-emphasis, group
  frames (§PD4 short-term). Render-only. Makes the *existing* Examples legible.
- **B. Small module / template system** — Example / Template / Building block
  packaging, surfaced inputs + result Summary (§PD3, §PD5), **block insert /
  merge + any block save metadata** (§PD3), a connection helper, a staged build
  flow, the localization overlay (§PD7). Larger; shapes how new models get made.

Pick one as the next design doc once this direction is agreed.

---

## PD9. Decision record

| # | Question | Decision |
|---|---|---|
| Q1 | Build from scratch vs adjust | **Adjust template / assemble blocks = default path. Blank canvas kept as an unchanged advanced path.** (§PD2) |
| Q2 | Example / Template / Building block | **Three editorial roles over the same Graph JSON. Example opens edit-locked; Template surfaces 3–5 values; Building block is ~8–15 nodes. Templates menu must not tell users to edit an Example.** (§PD3) |
| Q3 | One canvas vs split | **One canvas, one file. Readability affordances (focus view, connection de-emphasis, group frames) first, render-only. Collapsible composite nodes are a later, format-touching question — not authorised here.** (§PD4) |
| Q4 | Surface key variables | **Yes. Surfaced inputs + result Summary presented separately from the raw graph. Raw nodes / expressions stay reachable via advanced editing. Expressions get a plain-language description + `계산식 보기`.** (§PD5) |
| Q5 | Expert modeller vs experiment tool | **Experiment tool: "load a verified system, adjust it, compare the run." `preview` badge stays. No "model anything" claims.** (§PD6) |
| — | Building-block assembly | **Role decided (§PD3). The insert / merge mechanism — id-collision rules, placement, selection / undo, connection boundary — and any block save metadata are deferred to the module-system pass. No GraphDoc change here.** (§PD1, §PD3) |
| — | Format change | **None. No `loop-*/N`. No `src/` change. Editorial + packaging only.** (§PD1) |
| — | Next pass order | **Left open on purpose — A (readability) or B (module system).** (§PD8) |

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
- **carries no `loop-*/N` id** and freezes nothing;
- **is superseded in part** by each follow-on design doc as it lands — those
  docs own the details; this one owns only the direction they must not
  contradict.
