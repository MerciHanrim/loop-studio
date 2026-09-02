# Example — "Coffee roastery operations" (non-frozen design doc — DRAFT)

**Status: settled design — implementation pending. rev 3.** rev 1 fixed the
model, size budget, and boundary; rev 2 added the **comprehension check** (§CR11)
and the **Korean-display / English-id** language rule (§CR12); **rev 3** changes
the delivery: an unprompted signal from an outside reader (§CR0) makes this the
**first external validation** of Loop Studio as a *real-business* tool, so the
coffee model ships **registered as the 4th Templates entry from the start** —
the reviewer picks it from the menu, no file / Import / Share step (§CR2, §CR13).
This is a **non-frozen** design doc — no `loop-*/N` id, no `Frozen` marker — and
merges as *settled design, implementation pending*, like
[`docs/large-graph-readability.md`](large-graph-readability.md) and
[`docs/example-mmo-progression.md`](example-mmo-progression.md).

**Docs-only (this PR).** The graph JSON **and** its Templates-menu registration
land in **one separate implementation PR** after this design is approved (§CR13).
That impl PR touches **only** what a menu entry needs — the JSON, its fixture
test, `src/model/templates.ts`, `src/components/templateKeys.ts`, and **two**
name/blurb keys in `en.ts` + `ko.ts` — and **nothing else**: no engine, no
schema, no wire / `loop-revision/N`, no other `src/`.

This is the **first external product-direction validation**
([`docs/product-direction.md`](product-direction.md) §PD2 / §PD6), **not** a
re-run of the *Early MMO progression* exercise (which proved the expressive
ceiling of a large model). It asks:

> Can someone with **no game framing and no Loop Studio vocabulary** grasp a
> realistic business flow in **1–2 minutes** and, by changing **a few values**,
> read the results in a way they can predict?

---

## CR0. Why

The Productization track's premise is that blank-canvas authoring is
impractical, so the default path is *adjust a verified template* (§PD2). Before
building the Slice-2 filter UI, it is worth one concrete Template in a real,
non-game domain to test that premise against a person.

**The trigger.** An outside reader (`mjcafe`), shown Loop Studio with a *game*
framing, said the game vocabulary meant nothing to them — but, from the screen
alone, guessed it might be for **real production processes / work flow**,
**budgeting**, **organisation / HR management**, or **asset & logistics flow**.
That is a strong signal that Loop Studio reads as a **real-business tool** to a
non-gamer, and also that the current positioning + samples do not *say* so. A
coffee-roastery Template answers that with a screen, not a paragraph: green
beans arrive, some are sold on, some are roasted and sold through cafe / online
/ retail, and stock and profit move as you experiment.

A coffee roastery is a good fit: a short left-to-right flow (buy green beans →
roast → sell), intuitive levers (how much to roast, how many desserts to prep),
and familiar failure modes (run out of roasted stock, throw away unsold cake).

---

## CR1. Scope

**In**

- the **contract** for one Graph JSON registered as the 4th Templates entry:
  the model shape (§CR3), the size budget (§CR5), the five user-facing
  Parameters (§CR6), the recommended Timeline (§CR7), the Summary read-outs
  (§CR8), the validation scenarios (§CR9), and the completion criteria (§CR10);
- the **comprehension check** (§CR11), the **language decision** (§CR12), the
  **product role and boundary** (§CR2), and the **build order** (§CR13);
- **the 4th Templates entry** — name / blurb / role / default state (§CR2) — and
  the **minimal** registration code the impl PR adds (`templates.ts`,
  `templateKeys.ts`, two `en.ts` + `ko.ts` keys).

**Out**

- **Asking the reviewer to edit or "fix" the graph.** The first check is
  read → adjust values → interpret results *only* (§CR11). Structural-editing
  viability is a later question.
- **The Example / Template system itself.** This is a single JSON file + a menu
  entry, not the packaging / surfaced-inputs work of §PD8-B.
- **Any engine / schema / wire / `loop-revision/N` change, and any `src/`
  change beyond the registration files above.**
- **The modelling complexity in §CR4** — deliberately excluded.
- **A formal English canonical + label overlay** — deferred (§CR12); the first
  build is Korean-first because no overlay mechanism exists yet.
- **LGR Slice 2+** — on hold until MJ's comprehension check (§CR11) is done.

---

## CR2. Product role & boundary

- **File:** `examples/coffee-roastery.ko.json` — a real Graph JSON, **wired as
  the 4th Templates entry** (`templates.ts` imports it), alongside
  `risky-factory.json` / `mmo-progression.json` in `examples/`. **Korean
  display names, stable English node ids** (§CR12); the `.ko` suffix records
  that it is the Korean-first **validation build**, not a finished bilingual
  canonical.
- **Role: a Template** ([`docs/product-direction.md`](product-direction.md)
  §PD3) — the user changes the five surfaced values (§CR6) and re-runs. *Not*
  an Example (Early MMO is the locked Example); *not* a Building block.
- **Opens editable** — **no `canvasLocked`** (unlike the MMO Example). The
  reviewer is meant to change values.
- The three shipped entries are **untouched** and keep their distinct jobs:
  1. `equilibrium` — "Flowing equilibrium": the engine's basic steady flow.
  2. `deadlock` — "Bottleneck deadlock": a stall / back-pressure failure.
  3. `mmo-progression` — "Early MMO progression": large-model expressiveness,
     locked, run-and-observe.
- **The 4th entry**:

  | field | value |
  |---|---|
  | id | `coffee-roastery` |
  | `templates.coffeeRoastery.name` | KO: **커피 로스터리 운영** · EN: **Coffee roastery operations** |
  | `templates.coffeeRoastery.blurb` | KO: **생두 조달부터 로스팅, 카페·원두·디저트 판매와 재고·이익까지** · EN: a one-line equivalent |
  | graph node labels | **Korean only** (no overlay yet — §CR12) |
  | role | a small Template for adjusting a real business flow |
  | default state | editable (no `canvasLocked`) |
  | adjustable | the five top-row Parameters (§CR6) |
  | `recommendedRunConfig` | `timelineSeries` = the ≤ 8 series in §CR7; a modest `steps` / `baseSeed` |

  It is an **experimental Template** at the `preview` stage — its language
  limitation is recorded in §CR12 and revisited when the overlay structure is
  designed.

---

## CR3. The core model

**Time unit: one day.** The main flow reads **strictly left → right, one
direction**:

```
green intake → green stock → allocation → roasting → roasted stock → sales → revenue / cost / profit
```

Only the essential branches:

### CR3.1 Green-bean stock

- a daily **green intake** feeds a **green-bean stock** pool;
- **allocation** splits the stock: part is **sold as green beans to other
  businesses** (wholesale), the rest goes to **own roasting**.

### CR3.2 Roasting

- **roast input** draws from the green stock;
- a **roast weight loss** removes the moisture / chaff fraction (a drain);
- the remainder becomes **roasted-bean stock** (a pool).

### CR3.3 Roasted-bean sales (three channels)

- **cafe drinks** — beans consumed to make and sell drinks in the cafe;
- **retail bagged beans** — bags sold in-store;
- **online bagged beans** — bags sold online.

### CR3.4 Dessert

- a daily **dessert prep** quantity;
- **in-store + takeaway** dessert sales;
- **leftover dessert is discarded** at end of day (a drain).

### CR3.5 Results

- **revenue per channel**;
- **total cost**;
- **operating profit**;
- **stockouts / missed sales**;
- **waste quantity** (roast loss is expected; dessert waste is the signal).

### CR3.6 Multiple green-bean types — prose only

A real roastery buys several origins / varietals. **v1 aggregates them into one
representative green-bean stock.** Per-varietal comparison is noted here as a
*possible future extension only* — it is not in the v1 graph and must not be
added to hit a node count.

---

## CR4. Deliberately excluded

Explaining these keeps the impl PR from drifting back toward MMO scale:

- per-origin / per-varietal replication of the whole flow;
- blend ratios;
- seat turnover;
- staff / rota;
- delivery-platform commissions;
- tax / rent / depreciation;
- roast profiles;
- customer loyalty;
- seasonality;
- multiple stores;
- elaborate accounting invariants;
- any dependency on group frames or other not-yet-built features.

If the node budget (§CR5) has room to spare, **cut a result item — do not add a
feature.**

---

## CR5. Size budget

- **≤ 20–25 nodes total**, Summary Registers included.
- Readable **left → right on one screen**; the whole structure is
  distinguishable **without zooming**, and every node is readable + clickable
  **when zoomed** (this is the graph the LGR Slice-1 work is meant to serve).
- **No connection passes through a node body**; crossings minimised (hand-place
  on a clean grid).
- **No bottom accounting mesh, no dozens of auxiliary Registers** (the opposite
  of the MMO example).

Indicative breakdown (the impl PR finalises the exact set within the cap):

| group | ~count |
|---|---|
| Parameters (§CR6) | 5 |
| green side — intake, stock, allocation split | 3 |
| green wholesale channel | 1–2 |
| roasting — input, weight-loss, roasted stock | 3 |
| roasted sales — cafe drinks, retail bags, online bags | 3 |
| dessert — prep, sales, waste | 3 |
| Summary Registers (§CR8) | 4–6 |
| **total** | **~22–25** |

---

## CR6. The five values the user changes

Five **Parameter** nodes, laid out clearly in **one row along the top**:

1. **Daily customers** — cafe footfall.
2. **Daily roast amount** — kg of green beans put to roast per day.
3. **Online bean orders** — bags ordered online per day.
4. **Green wholesale orders** — kg of green beans ordered by other businesses
   per day.
5. **Daily dessert prep** — dessert units prepared per day.

Prices, unit costs, and the roast yield are **stable fixed values** in v1 (in
node data or a couple of clearly-labelled constants) — **not** surfaced as
hard-to-read expressions.

---

## CR7. Recommended Timeline

At most **8** recommended series:

- green-bean stock
- roasted-bean stock
- cafe drink sales
- retail bagged-bean sales
- online bagged-bean sales
- green wholesale (kg delivered)
- dessert waste
- operating profit

---

## CR8. Summary

The right-hand result area: **4–6 Registers**, no more.

- total revenue
- total cost
- operating profit
- missed sales
- dessert waste
- *(optional)* ending roasted-bean stock

**Human-readable titles and outcomes take priority over the formulas.**

---

## CR9. Validation scenarios

At minimum, these changes must reproduce **intuitively**:

1. **Roast amount too low** → roasted-bean stockouts and missed sales rise.
2. **Raise green wholesale orders** → wholesale revenue rises, but green beans
   for roasting can run short.
3. **Dessert prep above demand** → dessert waste rises.
4. **Online orders rise** → roasted-bean stock and operating profit move in a
   predictable direction.
5. **At a sensible roast amount** → both stockouts and overstock ease.

---

## CR10. Completion criteria

- **the headline criterion** — a reviewer **with coffee-business experience**,
  given **no** Loop Studio or graph-modelling instruction, can **explain the
  core flow within 1–2 minutes** and **interpret the result change from
  adjusting at least one input value** (§CR11);
- the **five values to change are immediately identifiable** with no prompting;
- for each value, **the direction of the result change is predictable**;
- the reviewer never needs the words *Pool* / *Gate* / *Register* to use it;
- **≤ 25 nodes**;
- the whole structure reads without zoom; zoomed in, every node is stably
  readable and clickable;
- **save / run / `loop-revision/*` digest invariance and existing engine
  semantics are unchanged**;
- a **deterministic-seed run** plus the core stock ↔ revenue relationships are
  **pinned by tests** (a fixture spec, like `mmo-progression.test.ts`);
- it **loads from `Templates ▾ → 커피 로스터리 운영`** and applies its
  `recommendedRunConfig`; **no engine / schema / wire change**, only the
  registration files (§CR2, §CR15).

---

## CR11. Comprehension check

The engine tests verify *the arithmetic is correct*. This check verifies *a
person who knows the real business accepts the model as natural* — the
validation Loop Studio needs more right now.

**Reviewer:** **MJ** (`mjcafe`), a plausible coffee-business person — the name
and the unprompted "real production / operations" read (§CR0) make them a
natural first external reviewer. A person who knows the domain saying "I can't
tell what this means" is a **failure**; reading it briefly and explaining the
flow + an adjustment result is a **strong success signal**. One person is not
the whole population, but this is the sharpest single signal available, and it
is a *real outside* reader, not the team.

### CR11.1 Protocol — hand over the site, then ask only

Send just the Loop Studio URL and one line: *"open `Templates ▾ → 커피 로스터리
운영`"*. **No feature explanation, no Import / Share / file steps.** Then ask:

1. What business flow does this screen represent?
2. Point to where green beans **enter** and where they **leave**.
3. Predict what happens if the **roast amount is too low**.
4. What does **raising green wholesale** do to cafe / bean sales?
5. Change **daily customers** *or* **daily roast amount** yourself and read the
   result.
6. Name any node, term, or result you **could not** understand.

### CR11.2 Pass bar

- explains the whole flow, roughly, in **1–2 minutes**;
- understands the **wholesale-vs-own-roasting competition** for green stock;
- understands roasted beans **split into cafe / retail / online**;
- **finds the five adjustable values** with no guidance;
- after changing a value, can **say why** the result moved;
- uses it **without** knowing Loop Studio's internal node vocabulary.

### CR11.3 Realism sub-check (MJ has domain experience)

- a **core flow that is missing** from an operations point of view;
- a part that is **over-simplified**;
- an **inventory metric that should be read before revenue**;
- whether the **green wholesale ↔ roasting allocation** is realistic;
- whether the **dessert-waste model** is believable.

### CR11.4 Scope of this first check

**Read → adjust values → interpret results only.** MJ is **not** asked to edit
or "fix" the graph. Whether structural editing is viable is examined **only
after** this check passes.

---

## CR12. Language — the validation build

The check must measure the *model*, not English comprehension. A reviewer who
is good at English might understand the graph *in English too*, which would mask
a structural problem. So the first build is **Korean-display**.

| layer | language |
|---|---|
| **this design doc** | English (repo convention) |
| **on-screen node names** | Korean — the only Korean in the file |
| **node ids** | English, stable — `green_bean_stock`, `roasting`, `cafe_sales`, `online_bean_sales`, … |
| **expressions & internal refs** | English ids only |
| Parameter / Register **titles** shown on canvas & in the Summary | Korean |

- **No bilingual labels on one node** — one language per name; the screen stays
  legible.
- **One file:** `examples/coffee-roastery.ko.json`, wired as the 4th Templates
  entry (§CR2). The `.ko` records that it is the **Korean-first validation
  build**.
- **English-user promotion is deferred.** Loop Studio has **no template label
  overlay** today, so a menu entry carries the labels baked into its JSON. This
  entry ships **Korean-only** on purpose — the point is to check whether the
  *model* reads without English or Loop Studio vocabulary. A proper bilingual
  form — an English canonical + a human-authored KO label overlay, or a
  separate derived file (as with
  [`examples/mmo-progression.ko.json`](../examples/mmo-progression.ko.json)) — is
  decided **with the module / template-system design** (§PD8-B), not here.
- This is acceptable at the `preview` stage: the limitation is recorded, and a
  real external comprehension check is worth more right now than bilingual
  polish. The impl PR's README / `examples/README.md` note says the entry is a
  Korean-first experiment.
- **What "Korean-first" scopes:** the **graph's node / Parameter / Register
  labels** are Korean (baked into the JSON, no overlay). The **menu chrome**
  (the entry's name + blurb) is per-locale like every other Template — the
  impl PR adds exactly **two** keys, `templates.coffeeRoastery.name` and
  `.blurb`, to **`en.ts` and `ko.ts`** (EN: "Coffee roastery operations" / a
  one-line EN blurb; KO: 커피 로스터리 운영 / 생두 조달부터 로스팅, 카페·원두·
  디저트 판매와 재고·이익까지), mirroring `templates.equilibrium.*` etc. No
  other catalog change; `check:i18n` parity holds. An EN-locale user therefore
  sees an English menu entry that opens a Korean-labelled graph — the recorded
  `preview` limitation, fixed when the overlay lands.

### CR12.1 Terminology — natural industry Korean

| English | Korean |
|---|---|
| green beans | 생두 |
| roasted beans / roasted stock | 로스팅 원두 (원두 재고) |
| roast yield | 로스팅 수율 |
| wholesale green beans | 생두 납품 |
| packaged beans | 포장 원두 |
| lost / missed sales | 놓친 판매 (품절 손실) |
| dessert waste | 디저트 폐기 |

The five surfaced Parameters (§CR6), in Korean: **하루 방문 고객 수 · 하루
로스팅량 · 온라인 원두 주문량 · 생두 납품 주문량 · 하루 디저트 준비량**.

---

## CR13. Build order

1. **this design doc** → **docs-only Draft PR** → review → settle.
2. **one implementation PR** — builds the graph **and** registers the menu
   entry in the same PR:
   - `examples/coffee-roastery.ko.json` (Korean labels, English ids);
   - a fixture / deterministic-run test (like `mmo-progression.test.ts`) +
     an `examples/README.md` entry noting it is a Korean-first experiment;
   - `src/model/templates.ts` — a 4th `TEMPLATES[]` item importing the JSON,
     with `recommendedRunConfig` (§CR7 series);
   - `src/components/templateKeys.ts` — a 4th `TEMPLATE_KEY` id → name/blurb
     entry;
   - `src/i18n/locales/en.ts` + `ko.ts` — the two keys (§CR12).
   Nothing else in `src/`; no engine / schema / wire change.
3. **Hanrim pre-check** — locally or in the PR preview, confirm the entry loads,
   reads L→R, the five values are obvious, and the §CR9 scenarios behave.
4. **merge + Production deploy.**
5. **MJ comprehension check** (§CR11) — send the URL + "open `Templates ▾ →
   커피 로스터리 운영`", nothing else, and run the protocol.
6. **after the check** — if it exposes model problems, fix in a follow-up PR;
   the bilingual / overlay structure (§CR12) is settled later with the module /
   template-system design; **LGR Slice 2** starts once step 5 is done.

---

## CR14. Decisions (CR-D)

| id | question | decision |
|---|---|---|
| **CR-D1** | replace an existing template? | **No.** New file + a **4th** entry; 1 / 2 / 3 untouched (§CR2). |
| **CR-D2** | Example or Template? | **Template** — editable, the user adjusts 5 values (§CR2). |
| **CR-D3** | menu-registered when? | **From the start** — registered as the 4th entry in the impl PR, so MJ just picks it from the menu (no Import / Share). Was "Import-only until validated" in rev 2; changed in rev 3 because the comprehension check *is* the point and a menu pick is the fastest route (§CR2, §CR13). |
| **CR-D4** | time unit | **one day.** |
| **CR-D5** | multiple green-bean types in v1? | **No** — one aggregate green stock; per-varietal is a prose-only future extension (§CR3.6). |
| **CR-D6** | node budget | **≤ 20–25 total**, Summary Registers included; short on nodes ⇒ cut a result, never add a feature (§CR5). |
| **CR-D7** | the 5 user values | daily customers · daily roast amount · online bean orders · green wholesale orders · daily dessert prep (§CR6). |
| **CR-D8** | prices / costs / yield | fixed, clearly-labelled constants in v1 — not surfaced as expressions (§CR6). |
| **CR-D9** | `src/` / wire / engine impact | **only** the registration files (`templates.ts`, `templateKeys.ts`, 2 keys × en+ko); **no** engine / schema / wire / `loop-revision/N` (§CR15). |
| **CR-D10** | who verifies comprehension? | **MJ** (`mjcafe`) — read → adjust → interpret only; not asked to edit the graph (§CR11). |
| **CR-D11** | language | graph node labels **Korean only** (no overlay yet); menu name/blurb per-locale (EN + KO keys). One file `examples/coffee-roastery.ko.json` — a Korean-first validation build; EN-user promotion deferred to the overlay design (§CR12). |

---

## CR15. Scope boundary

- This doc **is** the model + size + surfaced-value + result contract, plus the
  comprehension-check protocol (§CR11), the language rule (§CR12), and the 4th
  Templates entry's fields (§CR2). It **is not** a spec for the Example /
  Template system (§PD8-B).
- The impl PR adds **only**: `examples/coffee-roastery.ko.json`, its fixture
  test, an `examples/README.md` entry, a `TEMPLATES[]` item in
  `src/model/templates.ts`, a `TEMPLATE_KEY` entry in
  `src/components/templateKeys.ts`, and two keys in `en.ts` + `ko.ts`. **No
  other `src/` change; no engine / schema / wire / `loop-revision/N`.**
- The final bilingual structure for the entry (English canonical + overlay vs.
  derived file) is decided **later**, with the module / template
  system — not here.
- **LGR Slice 2** does not start until MJ's comprehension check (§CR11) is
  complete.
- If the check fails, the file stays an `examples/` reference and is **not**
  promoted — no menu entry, no further scope.
