# Pickup gacha

The **Pickup gacha** Template (File ▸ Templates) is the [Standard
gacha](gacha-standard.md)'s banner with a pickup guarantee: after an SSR that
is not the pickup, the next SSR is the pickup. It is a model to learn from and
change — it opens unlocked, fitted whole.

- Canonical file: [`examples/gacha-pickup.json`](../examples/gacha-pickup.json),
  written by [`scripts/gen-gacha-pickup-example.ts`](../scripts/gen-gacha-pickup-example.ts)
  (`GEN_GACHA_PICKUP=1 npx vitest run scripts/gen-gacha-pickup-example.test.ts`).
- In the app, **Help ▸ Example notes ▸ Pickup gacha** says how the guarantee
  turns on, that it applies to the next SSR (not the next pull) and holds
  through SR and R, and what happens when it meets the ceiling.
- It reads the shared graph builder of the
  [3-zone comparison](gacha-banner-zones.md) (`src/engine/gachaBannerZonesGraph.ts`,
  its Premium Pickup zone) and changes its structure (below). The run is
  checked by `src/engine/gacha-pickup.test.ts` (the shipped file as
  generated) and `e2e/gacha-pickup.spec.ts` (the Template as opened from the
  menu). The comparison stays as it is, locked.

## What happens in a run

| Node | Korean | What it does |
|---|---|---|
| Roll, Forced SSR, SSR result | 뽑기 판정, 확정 SSR, SSR 결과 | the Standard gacha's: the roll by weight (10 · 90 · 900 of 1,000) while Pity < ceiling − 1, the forced SSR at it; every SSR, natural or forced, goes through the SSR result (Pity = 0, +1 Pulls made, +1 SSR count) |
| Pickup owed | 픽업 보장 상태 | the guarantee's state, a Pool: 0 or 1 |
| Pickup split | 픽업 판정 | a probabilistic Gate, enabled while Pickup owed < 1: the pickup SSR or the off-pickup SSR by weight (Pickup / Off-pickup weight, 50 : 50) |
| Owed pickup | 픽업 확정 | a deterministic Gate, enabled while Pickup owed ≥ 1: straight to the pickup SSR |
| Pickup SSR, Off-pickup SSR | 픽업 SSR, 픽업 외 SSR | the two SSR results, each with its count; the off-pickup SSR sets Pickup owed = 1, the pickup SSR sets it = 0 |
| SR / R result → count | SR · R 결과 → 횟수 | +1 Pity, +1 Pulls made; Pickup owed untouched |
| SSR hit rate, Pickup rate | SSR 적중률, 픽업 적중률 | Registers, SSR count ÷ Target pulls and Pickup SSR count ÷ Target pulls |
| Completion signal → Pulls complete | 완료 신호 → 뽑기 완료 | the end, as in the General gacha (target 200 → step 202) |

The guarantee applies to the **next SSR**, not the next pull: SR and R pulls
in between leave Pickup owed as it is. When the ceiling is reached with
Pickup owed = 1, the forced SSR is the pickup (the counter resets, the
guarantee is used, one ceiling hit).

The two blocks are framed: "Pity ceiling" / "천장" (the counter, the forced
SSR, its ceiling hits) and "Pickup guarantee" / "픽업 보장" (the split, the
pickup confirmation, both SSR results, the owed state).

## The structure, and how it was checked

The 3-zone Pickup zone has four exclusive paths fed by the tickets — (counter
below / at the ceiling − 1) × (pickup owed 0 / 1) — with eight conditions and
the bookkeeping repeated in two SSR results (43 lines). The example uses the
Standard gacha's flow into one SSR result and decides the pickup after it:
the SSR result is a deterministic Gate with two branches, the pickup
confirmation (owed ≥ 1) and the pickup split (owed < 1); exactly one is
enabled, and a deterministic Gate re-splits over its enabled branches (engine
`step.ts`, §S4), so the SSR goes the one way (32 lines). Adopted by Lumi on
2026-10-20.

What is recorded (`src/engine/gacha-pickup.test.ts`):

- **The transition table** — from a state (counter, pickup owed) to each
  outcome, its chance, and the counter, owed state, ceiling hits, pulls made
  and SSR count after — derived from the graph, is the 3-zone zone's row for
  row, for every counter 0 … ceiling − 1 × owed 0 / 1 at seven input sets
  (the defaults; ceiling 4, 2, 1; no natural SSR; pickup weight 0;
  off-pickup weight 0). The derivation reads the conditions and the weights
  and runs no engine, so every counter is covered there.
- **The engine** from representative and boundary states — counter 0, 1,
  ceiling − 2 and ceiling − 1 × owed 0 / 1, at the same seven input sets,
  600 seeds each — lands only on rows of the table, at their chances (within
  4σ; every row of 5 % or more observed). The counters in between are not
  sampled: every condition compares the counter with ceiling − 1 only
  (`< @hard_pity - 1` for the roll, `>= @hard_pity - 1` for the forced SSR)
  and every change to it is `= 0` or `+ 1`, so a counter from 0 to
  ceiling − 2 opens the same path with the same chances, and only the counter
  after differs (+1); the table check above confirms it per counter.
- **The example's own runs** (the shipped file, its own draws), 4 input sets ×
  seeds 1–10: SSR + SR + R = pulls made and pickup + off-pickup = SSR at
  every step, tickets + pulls made = target (one ticket per pull), a ceiling
  hit exactly at counter = ceiling − 1, the counter reset by every SSR, the
  guarantee on after an off-pickup SSR, kept over SR / R, used by the next
  SSR (always the pickup), the ceiling and the guarantee together, the end at
  target + 2.
- **Reproduction**: the same inputs and seed give the same run, twice and from
  a fresh copy of the file.
- **Not claimed**: the same draws as the 3-zone Pickup zone for the same seed —
  the example's one roll draws where the zone's two did, and its connection
  ids are its own (a probabilistic Gate orders its branches by connection id).

## Layout

The comparison rounds' s1c (2026-10-20): the Standard gacha's layout (v5b) —
the main column, the roll's three branches as one fan, the pity block on the
results row, the counter's returns on their own lanes along a corridor under
everything — with the SR and R columns 96 to the right (room for the SSR count
beside the SSR result) and the guarantee block under the SSR result. Opened
from the menu it shows no route-point warning, in Korean or English
(`e2e/gacha-pickup.spec.ts`); the two frames' titles cover no value or name.
The off-pickup SSR's two outputs leave its left and right sides (its count
down a lane outside the frame's left edge), so its name sits below it, inside
the guarantee frame in Korean; the English name ("Off-pickup SSR") reaches
4 px past the frame's left edge — a known visual exception (2026-10-21): the
name is neither clipped nor covered, only past the frame's line, and the
existing name wrap (by width) does not split a name this short.

The owed state takes both of its setters at its top: the off-pickup SSR's
"= 1" down a lane at x 492, the pickup SSR's "= 0" under the pickup SSR's
symbol (2026-10-21; into the owed state's right side, beside the owed →
owed-pickup condition, its running "=0 / Δ−1" met the owed state's symbol in
English). The condition leaves the owed state's right side, passes under the
pickup SSR's name and goes up a lane just right of the frame.
