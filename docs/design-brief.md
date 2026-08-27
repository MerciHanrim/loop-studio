# Loop Studio — Design Brief

**Making the diagram run.**

Loop Studio lets someone model a game's economy as a diagram and then press play to
watch it work. The editor exists in rough form. What needs design is the running
part — the moment the diagram comes alive.

| | |
|---|---|
| **From** | Hanrim · Cozy Shelter |
| **Date** | 2026-08-27 |
| **State** | editor shell built · playback undesigned |
| **Stack** | React + React Flow, client-only |
| **For** | Lumi |

---

## Context — what Loop Studio is

**Machinations** is an established notation for modelling game systems: resources
flow between *pools*, are made by *sources*, removed by *drains*, routed by *gates*,
and traded by *converters*. You draw the graph, hit play, and the tool simulates it
— numbers move, feedback loops cycle, and a chart plots the outcome over time. It is
a commercial web app used by economy designers at game studios.

**Loop Studio** is an independent, browser-only take on the same idea. Nothing is
uploaded; a diagram is a plain JSON file the user owns. It started as one tool in
the Cozy Shelter tools suite and is now being pulled out to stand on its own —
which is why its visual identity is open rather than inherited.

The node canvas, the property inspector, and file load/save are working. The
simulation engine and everything you'd watch while it runs are what this brief is
about.

---

## The brief — the experience to design

A person wires up a small system, presses **play**, and the diagram starts running
one step at a time. They should be able to *see the logic happen*.

Concretely, on each step of the run:

- sources spawn new resources;
- resources travel visibly along the connections — this is the signature image of
  the whole product;
- pools' counts tick up and down as resources arrive and leave;
- gates split or randomise the flow; converters trade it;
- the nodes that acted this step register that they acted;
- a timeline chart at the bottom extends by one point, drawing every pool's value
  as the run goes.

The user controls the pace with a speed slider, can single-step to inspect a
moment, and can reset to replay from the start. Over a few hundred steps the shape
of the system — runaway growth, a stable loop, a slow bleed — should become legible
from the motion and the chart together.

---

## Fixed — the shell it lives in

Five regions. The toolbar, canvas, and inspector are in place. The **timeline
chart** is a new region to design. Where the **playback controls** sit is an open
call.

```
┌─────────────────────────────────────────────────────────────┐
│  Toolbar   node palette · new · import · export             │
├───────────────────────────────────────────┬─────────────────┤
│                                           │                 │
│  Canvas                                   │  Inspector      │
│  diagram + running simulation             │  selected node  │
│                                           │  or connection  │
│            ( playback controls —          │                 │
│              placement open )             │                 │
├───────────────────────────────────────────┤                 │
│  Timeline chart   ← NEW                    │                 │
│  every pool's value over steps            │                 │
└───────────────────────────────────────────┴─────────────────┘
```

Regions, not proportions. The chart height and control placement are yours to
decide.

---

## Fixed — the technology

The canvas is [React Flow](https://reactflow.dev). That fixes a few things any
design has to live with:

- **Nodes are HTML/SVG cards** on a pan-and-zoom surface, roughly 110–190 px wide,
  each with connection handles on its sides. Anything expressible in DOM, SVG, and
  CSS is fair game; anything that needs a custom rendering engine is not.
- **Connections are bézier curves** drawn as SVG paths. A resource travelling a
  connection is a shape animated along that path.
- **Animation runs every step, for many edges at once**, inside a step duration the
  user sets between roughly 120 ms and 1.2 s. It has to be cheap — CSS/SVG
  transforms, not heavy per-frame JavaScript — and it has to read clearly even at
  the fast end.
- **Light and dark** are both in scope from the start.

---

## Fixed — the vocabulary

Six node types and two connection types. Each needs to be recognisable on sight — a
diagram is read as a set of shapes before any label is read — and each needs room
for a live value or label plus a running/selected state on top.

| Element | Role in a run | What it has to carry visually |
|---|---|---|
| **Pool** | Holds resources between steps. The one node with memory. | A count that *is* the node's face; a sense of filling and draining; an optional capacity ceiling. |
| **Source** | Creates resources from nothing each step it fires. | Reads as an origin / faucet. Outputs only. |
| **Drain** | Consumes resources, removing them from the system. | Reads as a sink / outflow — the mirror of Source. Inputs only. |
| **Gate** | Routes what arrives, instantly, in the same step. Splits by ratio or by chance. | Reads as a junction / valve. Must not look like it stores anything. Shows which mode it's in. |
| **Converter** | Consumes N of one thing, produces M of another. | Reads as a machine / exchange, with an in-side and an out-side. |
| **End** | Stops the run the moment a resource reaches it. | Terminal and rare. Reads as a finish line. |
| **Resource link** | Carries resources. Tokens travel along it. | Solid, directional — the road. Carries a flow label: `2`, `all`, `2D6`, `25%`. |
| **State link** | One node's value modifies another. Nothing physically moves. | Dashed, secondary. Must never be mistaken for a resource path. Carries a modifier: `+1`, `≥5`, a trigger mark. |

---

## Decisions we need from you

In rough priority order. Every one of these is currently a placeholder in the
build.

### 1. A resource travelling a connection — *the signature image*

What does a resource look like moving down a wire each step? One mark per unit, or
one mark carrying a number? Its size, speed, easing, trail; what it does when it
lands in a pool.

- **Why it matters:** this is the image that says "the logic is alive." Get this
  and the product has a soul.
- **Constraint:** animated along an SVG bézier path, dozens at once, inside a
  120 ms–1.2 s step, legible at the fast end.

### 2. The node visual language — *recognisable at a glance*

How do the six types read as distinct shapes — including zoomed out, where a whole
system is in view and labels are unreadable? Machinations leans hard on silhouette.

- **Constraint:** a DOM/SVG card ~110–190 px wide, light and dark, with selected
  and running states layered on top.

### 3. Which nodes fired this step — *causality, tick by tick*

After each step some nodes acted and some sat idle. How is that shown without
turning the canvas into a light show? It lasts exactly one step and sits on top of
selection state.

### 4. A pool's number changing — *the payoff*

When a count ticks up or down, how much emphasis? Colour by direction? It should
feel consequential on a single step yet not exhausting across a 400-step run.

- **Note:** a gain/loss colour is semantic and separate from the product's accent
  hue.

### 5. The timeline chart — *results over time*

A new bottom panel plotting every pool's value against step number as the run
progresses. Its whole visual style, in both themes; one line per pool, each
matching its pool on the canvas; how it copes with long runs (scroll, a moving
window, compression).

- **Constraint:** hand-built SVG, roughly 140–180 px tall, full canvas width,
  redrawn every step.

### 6. The playback controls — *reached for constantly*

Reset · step · play/pause · speed · a step counter · the run's seed. Where do they
live — floating on the canvas, a strip above the chart, folded into the toolbar?
How do *playing*, *paused*, and *ended* read?

### 7. The overall identity — *sets everything else*

Loop Studio is leaving the Cozy Shelter suite to be its own product. How close to
Cozy Shelter's warm, quiet tone; how much its own thing? Machinations is the
functional reference, but its UI is dated and tool-heavy — there's daylight there.

- **Downstream:** a landing page and an onboarding flow come later and will inherit
  whatever you set here.

---

## Context — the current rough state (don't anchor on this)

There's a working editor with a placeholder skin: a warm-minimal palette picked
only to get pixels on screen. It is **not a proposal**. Listed here so you know
what's provisional (all of it) and can react against it if that's useful.

| Token | Hex |
|---|---|
| paper | `#faf7f1` |
| ink | `#37322c` |
| accent | `#7c9070` |
| pool | `#5b8aa6` |
| source | `#6a9f6a` |
| drain | `#c07f6c` |
| gate | `#b58b57` |
| converter | `#8f7db0` |
| end | `#7a7268` |

Nodes are currently plain rounded cards with a coloured left edge and a big number;
connections are thin bézier curves with a small pill label; there is no motion, no
chart, no controls yet. **A live build will follow** so you can design over the real
thing in motion.

---

## Reference — worth looking at

**Machinations.io** — the notation standard and the closest functional analogue.
Study how it keeps the six node types distinct, how it animates resource flow, and
where it puts the run controls. Its weak spot — and our opening — is a dense, dated,
utilitarian interface.

**The Cozy Shelter tools** — the sibling suite Loop Studio is spinning out of: Card
Studio, Image Studio, Lotus Studio, and others. The current house tone is warm,
calm, and single-purpose. Useful as the baseline we're deciding how far to move
from.

---

## Deliverable — what would help most, coming back

- **One or two mockups of a diagram mid-run** — the money shot: tokens on the
  wires, a couple of nodes lit, the chart drawn partway.
- **Node specs for all six types** — default, selected, and just-fired states,
  light and dark.
- **Motion notes** — token travel (duration, easing, what a unit looks like), the
  fired-node treatment, the number-change treatment. Description or a short clip
  both fine.
- **A colour token set** for light and dark: surfaces, ink, hairline, accent,
  semantic gain/loss, and the six node hues.
- **A timeline chart spec.**
- **A read on identity** — direction, and whether "Loop Studio" is the right name.

Static mockups are enough; motion can be written down. Whatever's fastest to react
to.
