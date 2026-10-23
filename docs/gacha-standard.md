# Standard gacha

The **Standard gacha** Template (File ▸ Templates) is one banner with a hard
pity ceiling: the [General gacha](gacha-general.md)'s flow, plus a counter of
pulls without an SSR that forces an SSR at the ceiling. It is a model to learn
from and change — it opens unlocked, fitted whole.

- Canonical file: [`examples/gacha-standard.json`](../examples/gacha-standard.json),
  written by [`scripts/gen-gacha-standard-example.ts`](../scripts/gen-gacha-standard-example.ts)
  (`GEN_GACHA_STANDARD=1 npx vitest run scripts/gen-gacha-standard-example.test.ts`).
- In the app, **Help ▸ Example notes ▸ Standard gacha** says in short how the
  counter and the ceiling work, that every SSR is handled by the SSR result,
  and what that changes in the activity cues and the flow record.
- It reads the shared graph builder of the
  [3-zone comparison](gacha-banner-zones.md) (`src/engine/gachaBannerZonesGraph.ts`,
  its Premium Standard zone) and changes its structure in one reviewed way
  (below). The run is checked by its own tests:
  `src/engine/gacha-standard.test.ts` (the run, and the step comparison with
  the zone's structure) and `e2e/gacha-standard.spec.ts` (the Template as
  opened from the menu). The comparison stays as it is, locked.

## What happens in a run

| Node | Korean | What it does |
|---|---|---|
| Target pulls (whole number) | 목표 뽑기 횟수(정수) | a Parameter, 200: how many tickets are funded, and when the run ends |
| Fund tickets → Tickets | 티켓 지급 → 티켓 | at the start the Source puts the target's worth of tickets into the Pool |
| Roll | 뽑기 판정 | a probabilistic Gate: each ticket goes down **one** branch, chosen by weight — while the counter is below the ceiling − 1 |
| SSR / SR / R weight | SSR · SR · R 가중치 | Parameters, 10 · 90 · 900 of 1,000: 1 %, 9 %, 90 % (the Roll's panel lists them) |
| Hard pity ceiling | 천장 횟수 | a Parameter, 80 |
| Pity | 천장 카운트 | a Pool: +1 on an SR or an R result, = 0 on an SSR result |
| Forced SSR | 확정 SSR | a Gate that takes the ticket instead of the Roll once the counter reaches the ceiling − 1; it sends the ticket into the SSR result, and +1 to Ceiling hits |
| Ceiling hits | 천장 도달 횟수 | the forced SSRs, counted apart |
| SSR / SR / R result → count | 결과 → 횟수 | each result adds one to its count, and **+1** to Pulls made |
| Pulls made | 뽑기 횟수 | the tickets rolled so far; at every step it equals SSR + SR + R count |
| SSR hit rate · of target pulls | SSR 적중률 · 목표 횟수 기준 | a Register, `SSR count ÷ Target pulls` (as in the General gacha) |
| Completion signal → Pulls complete | 완료 신호 → 뽑기 완료 | how the run stops: as in the General gacha, the step after the pulls made reach the target (200 → step 202) |

With the ceiling at 80: after 79 pulls in a row without an SSR the counter is
79, the Roll's condition (`Pity < ceiling − 1`) no longer holds and the Forced
SSR's (`Pity ≥ ceiling − 1`) does, so the 80th pull is the forced SSR. A
natural SSR resets the counter as a forced one does.

## The one structural change: every SSR goes through the SSR result

In the 3-zone comparison's Standard zone the forced SSR has three lines of its
own — to the SSR count, +1 to the pulls made, and the counter's reset — beside
the SSR result's same three. Here the forced SSR sends its ticket INTO the SSR
result instead (Lumi, 2026-10-20), so the SSR result is the one place an SSR is
handled, natural or forced; the forced SSR keeps its +1 to the ceiling hits,
so the forced ones are still counted apart. Three lines fewer, and no second
copy of the SSR handling to keep in step.

What is the same, and what is not:

- **Recorded as:** over the inputs and seeds checked, the values at every step
  and the end are the same; the structure changed so that a forced SSR also
  goes through the common SSR result. Not accepted as identical.
- **Two layers of checks** (`src/engine/gacha-standard.test.ts`). The
  id-aligned comparison (next point) says the structural change behaves as
  the zone's structure. Separately, the example AS GENERATED — the shipped
  file, its own ids and draws, nothing renamed — is run for 3 input sets ×
  seeds 1–10: SSR + SR + R = pulls made and tickets + pulls made = target at
  every step, at most one pull a step, a forced pull exactly when the counter
  stood at ceiling − 1 (an SSR, +1 ceiling hits), the counter reset by every
  SSR and +1 otherwise, the end at target + 2; plus the end for targets 200,
  50 and 7 and the default horizon.
- **Id-aligned comparison:** 8 input sets (ceiling 1,
  2, 3, 4, 80; target 1, 5, 6, 9, 13, 20, 30, 200; no natural SSR / many; a
  target on a ceiling boundary) × seeds 1–10, against the zone's structure
  taken from the shared builder: every Pool's value and the end at every step,
  the number of steps, and what fires. Not a proof for every input or seed.
- **What differs, by design:** on a forced pull the SSR result fires too. Its
  activity cue and the flow record therefore show natural and forced SSRs
  together; the ceiling hits are where the two are told apart.
- Nodes are processed upstream → downstream by their connections in a step
  (not by their place on the canvas), so the forced SSR's ticket reaches the
  SSR result in the same step.
- **Seeds:** the example's connection ids are its own (`e_roll_ssr`, …), and a
  probabilistic Gate orders its branches by connection id before it draws.
  For the same seed the example therefore draws a different sequence from the
  3-zone Standard zone (the same chances). The step comparison renames the
  zone's connections to the example's ids, so the draws line up.

## Layout

Adopted by Lumi on 2026-10-20 (v5b of the comparison rounds): the General
gacha's flow on the right; the pity block — the counter, the forced SSR and
its ceiling hits — framed ("Pity ceiling" / "천장") on the results row left of
it, the ceiling's value with the other inputs; the counter's three returning
lines on their own lanes outside the main flow (down from their results, along
a corridor between the pulls made and the end, up the far left into the
counter); the Roll's three branches leave its bottom as one fan, so its name
sits on its free right side. Opened from the menu it shows no route-point
warning (`e2e/gacha-standard.spec.ts`).

Four crossings are left in this layout: R's +1 into the pulls made crosses the
SR and R returns; the tickets → forced SSR line crosses the counter → Roll
condition; the SR return crosses the pulls made → end condition. The whole fit
is the overview (0.80 at 1920 × 1080; 0.57 at 1440 × 900, where it fits but
the values are about 6 px); zooming in and selecting a node with Focus on is
how a path is followed in detail.
