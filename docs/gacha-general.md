# General gacha

The **General gacha** Template (File ▸ Templates) is one banner with no pity:
a fixed number of tickets, each rolled once into SSR, SR or R by weight. It is
a model to learn from and change — it opens unlocked, fitted whole.

- Canonical file: [`examples/gacha-general.json`](../examples/gacha-general.json),
  written by [`scripts/gen-gacha-general-example.ts`](../scripts/gen-gacha-general-example.ts)
  (`GEN_GACHA_GENERAL=1 npx vitest run scripts/gen-gacha-general-example.test.ts`).
- In the app, **Help ▸ Example notes ▸ General gacha** says the same three
  points in short: how the roll uses its weights, what the hit rate is counted
  against, and when the run stops.
- It reuses the shared graph builder of the
  [3-zone comparison](gacha-banner-zones.md) (`src/engine/gachaBannerZonesGraph.ts`,
  its General / Free zone), and the standalone example's run is checked by
  its own tests: `src/engine/gacha-general.test.ts` (the run) and
  `e2e/gacha-general.spec.ts` (the Template as opened from the menu). The
  comparison stays as it is, locked, for comparing banners.

## What happens in a run

| Node | Korean | What it does |
|---|---|---|
| Target pulls (whole number) | 목표 뽑기 횟수(정수) | a Parameter, 200: how many tickets are funded, and when the run ends |
| Fund tickets → Tickets | 티켓 지급 → 티켓 | at the start the Source puts the target's worth of tickets into the Pool |
| Roll | 뽑기 판정 | a probabilistic Gate: each ticket that arrives goes down **one** branch, chosen by weight |
| SSR / SR / R weight | SSR · SR · R 가중치 | Parameters, 6 · 51 · 943: a branch's chance is its weight ÷ the sum of the weights, 1,000 — 0.6 %, 5.1 %, 94.3 % (the Roll's panel lists them) |
| SSR / SR / R result → count | 결과 → 횟수 | each result adds one to its count, and **+1** to Pulls made |
| Pulls made | 뽑기 횟수 | the number of tickets rolled so far; at every step it equals SSR + SR + R count |
| SSR hit rate · of target pulls | SSR 적중률 · 목표 횟수 기준 | a Register, `SSR count ÷ Target pulls` |
| Completion signal → Pulls complete | 완료 신호 → 뽑기 완료 | how the run stops (below) |

One ticket is rolled per step. With the target at 200, the pulls made reach
200 at step 201, and the run ends at step 202 — the recommended run length.

## The hit rate's denominator

The SSR hit rate is computed with the target pulls as its denominator. It
differs from the ratio over the pulls actually made during a run, and equals
the observed hit rate once the target is reached.

목표 뽑기 횟수를 분모로 계산합니다. 실행 도중의 실제 뽑기 횟수 기준 비율과는
다르며, 목표 횟수에 도달하면 관측 적중률과 같아집니다.

The Register's panel shows the calculation with its current values
(SSR count *n* / Target pulls 200 = *r* %), so the basis can be read there
too.

## How the run stops

The completion signal is a Pool holding 1, fed and drained by nothing else.
The end, Pulls complete, takes everything from it, but only while its
condition holds: Pulls made ≥ Target pulls. The end does not fire in the step
in which the pulls made reach the target: it fires in the NEXT step, takes
that 1, and the run stops. With the target at 200, the pulls made reach 200 at
step 201 and the end fires at step 202; at 50, at steps 51 and 52; at 7, at
steps 8 and 9 — always exactly the target pulled (checked by
`src/engine/gacha-general.test.ts`). The menu's summary says only "the run
stops there".

## Layout

The layout is the compact comparison layout adopted on 2026-10-20 (share notes
93 / 94 are its origin): the main column, the three-way split, a column per
result with its count under it, the +1 lines outside the counts, the total and
the end below. It is NOT the same as note 93's: the names of Roll and Pulls
made stay below their symbols (the product puts a name below when lines use
all four sides), so two lines step around those names, and the values on the
lines are placed by the product's rule.
