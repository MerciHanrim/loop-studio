# Execution semantics — State connections, revision 2

```
Spec ID: loop-state/2
Status:  Frozen
```

**Frozen** (2026-08-28). Supersedes [`SEMANTICS-S.md`](./SEMANTICS-S.md)
(`loop-state/1`) for the **`label` event reporting shape only**. Everything else
in `loop-state/1` — `trigger` (pulse + `delay`), `activator` (AND level gate),
the Phase-0 model, the `label` *value* semantics, every invariant, and the
`triggerQueue` lifecycle — is **inherited verbatim**. `loop-state/1` stays on
disk unchanged as the historical baseline; this document states only the delta.

Why a new spec id rather than an edit to `loop-state/1`: the change alters the
observable `report.stateEvents` schema (`applied` → `clampAdjustment`), the S-C
expected vectors, and the way I1′ is written. That is a behavioural change to a
frozen report contract, so it takes a new frozen document even though `label`
had not yet shipped when the revision was made.

---

## What is unchanged (inherited from `loop-state/1`)

- **`trigger`** — one-step pulse, integer `delay ≥ 0`, `deliveryStep = t + delay
  + 1`; fires a `passive` / `interactive` target on delivery iff `enabled`;
  `automatic` / `onStart` target ⇒ `stateEvent {applied:false}`; simultaneous
  pulses OR-combine to ≤ 1 execution, every edge reported.
- **`activator`** — continuous AND-combined level gate; source must be a Pool;
  empty set ⇒ `enabled = true`; frozen §S6 comparison grammar.
- **`label` value semantics** — source **and** target are Pools; `expr` ∈
  `{+N, -N, =N, +S, -S, =S}` (`N` a finite real ≥ 0, whitespace tolerated, `S`
  = `S[source]`, never debited); several edges into one target apply in
  ascending `edge.id` to the running `working[target]` (seeded from `S[target]`);
  intermediate out-of-range values are allowed; **one clamp per target** at the
  end of Phase 0 — `[0, capacity]`, or floor-`0` only when the Pool is uncapped.
  Invalid / non-Pool / removed ⇒ inert + exactly one diagnostic per edge per
  step. `label` never touches `report.events`, never schedules a trigger, never
  sets `ended`.
- All invariants **I1′, I2–I10-S** as written in `loop-state/1` §S10, with the
  I1′ *wording* refined in §S2-9 below (the quantity is identical).

---

## S2-5. `label` — clamp reporting (replaces the last two bullets of §S5)

The per-target end-of-Phase-0 clamp is a `label` sink. It is reported **once per
target** as `clampAdjustment` (§S2-9), **never folded into any edge's `delta`**.
An edge's `delta` always equals what that edge requested — its sign can never be
inverted by a downstream clamp.

Non-conserving by design: the source Pool is never debited. The net change on the
target is an external source/sink term in I1′ and appears in
`report.stateEvents` only, never in `report.events`.

---

## S2-9. `report.stateEvents` — the `label` entry (replaces the §S9 `label` rows)

```ts
stateEvents: {
  edgeId: string
  from: string
  to: string
  mode: 'trigger' | 'activator' | 'label'
  effect:
    | { kind: 'trigger';  delivered: true; applied: boolean }   // unchanged
    | { kind: 'activator'; satisfied: boolean }                 // unchanged
    | { kind: 'label';     delta: number; clampAdjustment: number }
}[]
```

- Emitted in **ascending `edgeId`** (unchanged).
- **`label`** — one entry per step per **valid** label edge (Pool→Pool, parsed
  `expr`).
  - **`delta`** = that edge's **own raw requested change**: `+N` / `−N`, or
    `N − running` for `=N` / `=S` (where `running` is `working[target]` just
    before this edge). The clamp is never folded in.
  - **`clampAdjustment`** = the target's single end-of-Phase-0 clamp correction,
    `clamped − unclamped`, reported **once**, on the **last** label event into
    that target (`0` on the others, and `0` when the final value needed no
    clamp). It rides on an event only as a carrier — it is a *target-level*
    quantity, not an attribute of that edge's request.
  - **Net external change on a target** =
    `Σ (delta over its label edges) + clampAdjustment = final − start`.
- The UI's per-edge direction / delta flash reads **`delta`**;
  `clampAdjustment ≠ 0` is a truncation it may surface separately (never as the
  edge's own motion).

I1′ (wording refined; quantity unchanged): per step, over resource movement
only,

```
Σ Pool(after) = Σ Pool(before) + Σ Source push
              + ( Σ label delta + Σ per-target clampAdjustment )   ← the label term
              − Σ Drain/End pull − Σ Converter net loss
```

---

## S2-11. Case S-C — under `loop-state/2` reporting

Same graph as `loop-state/1` §S11 Case S-C:

```
Feeder F (Pool, init 10, isolated — never debited)
F ┄┄ m1: label "-1" ┄┄► Tank T          (edge id m1 < m2 ⇒ evaluated first)
F ┄┄ m2: label "+S"  ┄┄► Tank T
Tank T: Pool, init 0, cap 8
T ──e1:4──► Drain D  (auto)
```

The committed `T` trace is **unchanged** from `loop-state/1` — only the
`stateEvents` shape differs.

| step | S[T] | after m1 (−1) | after m2 (+10) | clamp→[0,8] | Drain pull | T (commit) |
|---:|---:|---:|---:|---:|---:|---:|
| 0 | 0 | – | – | – | – | 0 |
| 1 | 0 | −1 | 9 | **8** | 0 | 8 |
| 2 | 8 | 7 | 17 | **8** | 4 | 4 |
| 3 | 4 | 3 | 13 | **8** | 4 | 4 |
| ≥3 | 4 | 3 | 13 | 8 | 4 | 4 → steady |

`stateEvents` per step, ascending id — `m1` always
`{label, delta:-1, clampAdjustment:0}`; `m2` always `{label, delta:+10,
clampAdjustment:C}` where `C` is the single per-target correction on the last
event:

| step | unclamped after m2 | clamp | `C` (m2.clampAdjustment) | net = Σδ + C | ΔT check |
|---:|---:|---:|---:|---:|---|
| 1 | 9  | 8 | **−1** | (−1 + 10) + (−1) = **8** | 8 − 0 = 8 ✓ |
| 2 | 17 | 8 | **−9** | ( 9) + (−9) = **0** | (4 − 8) = −4 = net − drain(4) ✓ |
| 3 | 13 | 8 | **−5** | ( 9) + (−5) = **4** | (4 − 4) = 0 = net − drain(4) ✓ |

`S[F] = 10` forever. `report.events` never contains `m1` / `m2`.

### Additional acceptance vectors (multi-overflow, direction preservation)

Start `T = 0`; single step; no drain.

| edges (asc id) | cap | commit | events |
|---|---:|---:|---|
| `m1:"+100"`, `m2:"+1"` | 10 | 10 | `m1 {delta:+100, clampAdjustment:0}`, `m2 {delta:+1, clampAdjustment:-91}` |
| `m1:"+10"`, `m2:"-20"` | ∞ (floor 0) | 0 | `m1 {delta:+10, clampAdjustment:0}`, `m2 {delta:-20, clampAdjustment:+10}` |
| `m1:"+20"`, `m2:"-15"` | 8 | 5 | `m1 {delta:+20, clampAdjustment:0}`, `m2 {delta:-15, clampAdjustment:0}` (final in range) |
| `m1:"+3"`, `m2:"+2"` | 10 | 5 | both `clampAdjustment:0` (no clamp) |

In every row each `delta` keeps the sign of its own request; the whole clamp
correction sits in one `clampAdjustment`; and
`Σ delta + Σ clampAdjustment = commit − start`. Reversing the `nodes` / `edges`
arrays does not change any figure (I8-S — evaluation order is `edge.id`, not
array order).

---

## S2-13. Slice status

`loop-state/2` is delivered together with **§S13 slice 4 (`label` modifier)**.
Slices 1–3 shipped under `loop-state/1` and are unaffected. Slice 5 (Inspector +
in-canvas pulse) reads `delta` for the `label` delta flash and may surface
`clampAdjustment` as a separate "clamped" hint.
