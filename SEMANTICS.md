# Execution semantics

How Loop Studio runs a diagram. The goal is compatibility with Machinations'
observable behaviour; where this document and Machinations disagree, that's a bug
to fix here. Anything not yet covered is listed under **Not yet modelled**.

## Time

- Discrete steps. Step 0 is the initial state (pools hold their starting amount,
  nothing has flowed). Pressing **step** or **play** advances to step 1, 2, ...
- Within a step, all firing is resolved against a **snapshot** of pool values
  taken at the start of the step, then the net changes are applied at once. Two
  nodes pulling from the same pool in the same step both see the pre-step amount.

## What fires each step

A node fires this step if its activation is:

| Activation | Fires |
|---|---|
| `automatic` | every step |
| `onStart` | only at step 1 (the first advance from step 0) |
| `passive` | only when a trigger fires it (triggers: not yet modelled → passive nodes are idle in v0) |
| `interactive` | only when clicked during play (not yet modelled in v0) |

## Resource flow within a step

Resolved in two phases so that instantaneous routers (gates, converters) pass
resources along in the same step they receive them.

**Phase A — pools, sources, drains**

- **Source**: for each outgoing resource connection, evaluate its flow
  expression and push that many resources toward the target.
- **Drain**: for each incoming resource connection, evaluate the flow and pull
  from the source pool. `pull any` takes what's available up to the amount;
  `pull all` takes the full amount or nothing.
- **Pool** (when it fires): pulls along each incoming resource connection from
  pool sources, same `pull any` / `pull all` rule.

**Phase B — gates and converters** (on whatever arrived at them in Phase A)

- **Gate**: holds nothing; immediately distributes what it received.
  - `deterministic`: split in proportion to the numeric flow labels on the
    outgoing connections (equal split if unlabelled).
  - `probabilistic`: each received resource goes to one output, chosen at random
    weighted by the outgoing labels (`%` or number).
- **Converter**: consumes what it received; for each outgoing connection, produces
  `received x label` resources.

## Flow expressions

| Form | Meaning |
|---|---|
| `2` | fixed amount |
| `all` | everything available in the source pool |
| `25%` | that fraction of the source pool |
| `1-3` | uniform random integer in the range, inclusive |
| `2D6` | roll 2 six-sided dice and sum (`D6` = `1D6`) |
| empty | treated as `1` |

## Bounds

- A pool never goes below 0 or above its capacity (blank capacity = unbounded).
- Excess that cannot fit is lost (no back-pressure in v0).

## Randomness

Each run uses a seed. Step `n` draws from a deterministic sub-stream derived from
`seed` and `n`, so a run is fully reproducible and Monte Carlo just varies the
seed. **Reset** replays the same seed; change the seed for a different run.

## Ending

If the diagram has an **End** node, the run stops on the first step in which any
resource reaches it.

## Not yet modelled (v0)

- State connections: label modifiers, node modifiers, triggers, activators
- `passive` / `interactive` activation (needs triggers / play-time clicks)
- `push all` / `push any` distinction on sources and pools (v0 pushes what it has)
- Delay / queue nodes, registers with formulas, traders
- Multiple resource colours / typed resources
- Back-pressure when a target pool is full
