# Example — "Coffee roastery operations flow" (non-frozen design doc — DRAFT)

**Status: settled design — implementation landing. rev 8.** rev 1–3 fixed the
model, the comprehension check, and shipping as the 4th Templates entry; rev 4
moved the Korean labels to a **shared fresh-open label overlay**
([`docs/template-label-overlay.md`](template-label-overlay.md)); rev 5 aligned
the build order; **rev 6** found the frozen-engine contract conflict (a
`parameter` node changed no simulated number) and decided **Direction 1** — a
minimal, general `parameter → simulation input` capability in its own prior PR —
plus the §CR2.0 repositioning as a *simplified operating-flow simulation
example* (recorded anonymised in
[`docs/product-direction.md`](product-direction.md) §PD11); **rev 7** folded
`loop-model/2` in and locked the five `@param` references.

**rev 8 — the roasting node is a deterministic `Gate`, not a `Converter`.**
Building impl PR (2) surfaced that a **`Converter`** cannot carry
"daily roast amount (kg)": under frozen Engine A a Converter's output is
`producedₖ = f·outRateₖ` with a single `f ∈ [0, 1]` and ≤ 1 activation/step
([`SEMANTICS.md`](../SEMANTICS.md) I2), so a Converter whose **input** edge is
`@daily_roast_kg` produces at most its constant `outRate` — the lever stops
mattering the moment green beans are not the binding constraint, and moves the
output *backwards* when they are (raising the lever lowers `f`). A **deterministic
Gate** expresses the quantity exactly and is *the* correct model, not a
work-around: the **one** input edge `green_stock → roasting` carries
`@daily_roast_kg` (still exactly one `@param` reference, §CR6.1), the Gate pulls
`T = min(@daily_roast_kg, green available)`, and two fixed weights split T into
82 % roasted-bean stock and 18 % roasting weight loss — mass-conserving
(`0.82·T + 0.18·T = T`). **When green stock is short, T falls, so the roasted
output and the weight-loss path fall together.** rev 8 updates §CR6.1, §CR9.1
and §CR3.5 (the roasted-supply-margin proxy now reads the live roasted-stock
level) and adds **CR-D14**. No other lever changes; no engine / schema / wire
change.

**rev 7 — the §CR16 feature has shipped, so the "blocked" notes come out.**
`loop-model/2` ([`SEMANTICS-M2.md`](../SEMANTICS-M2.md), Frozen; PR #103, merge
`c194629`) lets a **v2 document**'s `resource`-edge `flow` be a single
`@parameter-id` reference the engine resolves once per step. **rev 7:**

- **§CR2.1a (new)** — this Template is the **first bundled `loop-model/2` /
  schema `loop-studio/graph/2` entry**.
- **§CR6** — the five levers are **locked to concrete `@param` references**
  (which node, which edge — §CR6.1); each `flow` is a **single bare
  `@parameter-id`** and nothing else.
- **§CR3.5 / §CR8 / §CR9** — the "blocked / pending PR (1.5)" notes are removed;
  §CR9 now names, per scenario, **which Parameter changes and which result
  moves** (§CR9.1). The two `supply − demand` read-outs are renamed to
  **roasted supply margin** / **dessert prep margin** — signed *proxies* with an
  explicit `+` / `−` meaning, **never** called "missed sales" or "waste"
  (they are operating cues, not measured losses or accounting figures — §CR3.5).
- **§CR13** — steps 1–2 (this doc PR) and the §CR16 feature PR are done; the
  next step is the Coffee Template impl PR.
- **CR-D12 / §CR16** are marked **resolved**.

The size budget (§CR5), the domain scope (§CR3–§CR4), the language mechanism
(§CR12), the §CR2.0 positioning, the limitation marker, and the §CR10 / §CR11
success bar are unchanged. Still **no Coffee-specific engine logic and no new
expression grammar** — the Template only *consumes* `loop-model/2`. This is a
**non-frozen** design doc — no `loop-*/N` id, no `Frozen` marker — and merges as
*settled design, implementation pending*, like
[`docs/large-graph-readability.md`](large-graph-readability.md) and
[`docs/example-mmo-progression.md`](example-mmo-progression.md).

**rev 7 is docs-only** — this doc. **No feature code, no README change** (the
roadmap line and the general positioning are checked *last*, §CR13 step 10).
Implementation was **three** PRs: **(1)** the shared label overlay — merged
(PR #100, `b938aed`); **(1.5)** the general `parameter → simulation input`
feature = `loop-model/2` — merged (PR #103, `c194629`); **(2)** this Template —
`examples/coffee-roastery.json` (schema `loop-studio/graph/2`), a Korean label
block, a fixture test, `src/model/templates.ts`, `src/components/templateKeys.ts`,
**two** name/blurb keys in `en.ts` + `ko.ts`. **Nothing else** in `src/` for
impl PR (2): no engine, schema, wire / `loop-revision/N` beyond what
`loop-model/2` landed.

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

**The trigger.** An **external reader**, shown Loop Studio with a *game*
framing, said the game vocabulary meant nothing to them — but, from the screen
alone, guessed it might be for **real production / work flow**, **budgeting**,
**organisation / HR management**, or **asset & logistics flow**. That is a
strong signal that Loop Studio reads as a **real-business tool** to a non-gamer,
and also that the current positioning + samples do not *say* so. A
coffee-roastery Template answers that with a screen, not a paragraph: green
beans arrive, some are sold on, some are roasted and sold through cafe / online
/ retail, and stock and profit move as you experiment.

A coffee roastery is a good fit: a short left-to-right flow (buy green beans →
roast → sell), intuitive levers (how much to roast, how many desserts to prep),
and familiar tensions (running short of roasted stock; over- or under-preparing
dessert).

---

## CR1. Scope

**In**

- the **contract** for one Graph JSON registered as the 4th Templates entry:
  the model shape (§CR3), the size budget (§CR5), the five user-facing
  Parameters (§CR6), the recommended Timeline (§CR7), the Summary read-outs
  (§CR8), the validation scenarios (§CR9), and the completion criteria (§CR10);
- the **comprehension check** (§CR11), how this Template **uses** the shared
  label overlay (§CR12), the **product role and boundary** (§CR2), and the
  **build order** (§CR13);
- **the 4th Templates entry** — name / blurb / role / default state (§CR2) — and
  the **minimal** registration code impl PR (2) adds (`templates.ts`,
  `templateKeys.ts`, the KO dictionary entries, two `en.ts` + `ko.ts` menu keys).

**Out**

- **Asking the reviewer to edit or "fix" the graph.** The first check is
  read → adjust values → interpret results *only* (§CR11). Structural-editing
  viability is a later question.
- **The Example / Template system itself.** This is a single JSON file + a menu
  entry, not the packaging / surfaced-inputs work of §PD8-B.
- **Any engine / schema / wire / `loop-revision/N` change, and any `src/`
  change beyond the registration files above.**
- **The modelling complexity in §CR4** — deliberately excluded.
- **The label-overlay mechanism itself** — designed and built separately
  ([`docs/template-label-overlay.md`](template-label-overlay.md)); this doc only
  *uses* it (§CR12).
- **LGR Slice 2+** — on hold until the external comprehension check (§CR11) is
  done.

---

## CR2. Product role & boundary

### CR2.0 What this is — and is not (rev 6)

An **external, domain-informed reader commented twice before the example was even
sent to them.** The substance (recorded anonymised in
[`docs/product-direction.md`](product-direction.md) §PD11):

- A real roastery operations system would need lot- and varietal-level tracking,
  import / warehousing / cleaning-sorting / delivery, **vendor / trade-partner
  management**, real-time stock, **WIP and lead-time monitoring**, per-stage
  progress, and a financial layer — reorder point, safety stock, BEP, cost /
  cost-estimate / cost-accounting figures, and inventory-asset values that link
  to the financial statements — **auto-produced**, not hand-keyed. Manual
  keyboard-and-monitor entry would make such a tool too cumbersome to adopt.
- Showing only a few disconnected stages of the real distribution chain has
  limited operational usefulness: *"expressing only some particular aspects —
  that may be valued as an artwork, but not as a practical tool."*
- The stronger recommendation: **decide the concrete use purpose first** — *who,
  in what setting, for what decision* — and only then map the current work onto
  that field's vocabulary (production & operations management, process control,
  managerial / cost accounting; the reader also saw a path toward **PERT / CPM**
  project-network scheduling for large events). Keep extensibility open, but fix
  the purpose before the target industry.

That critique is right **about an operations-management / ERP system**, and this
Template is **not** one, and is not a step toward claiming to be one. It is an
**operational-flow simulation example**:

- **not** a system for entering real daily intake / stock;
- **not** lot / varietal / vendor management or product CRUD;
- **not** connected to a POS, inventory sensors, or an order system;
- **not** a WIP / lead-time / reorder-point / BEP / cost-accounting engine;
- **not** a replacement for any part of running a roastery;
- **is** a small, assumption-based model for changing a few operating
  assumptions and watching how green / roasted stock, sales, the roasted
  supply margin, the dessert prep margin and profit relate (§CR3.5 — signed
  proxies, not measured losses).

**Positioning (adopted for the product, not just this example — §PD11):**
Loop Studio is not an ERP that manages live business data; it composes
**connected operating flows visually and compares outcomes as you change a few
conditions** — an operating-flow simulation. The coffee entry is a *simplified
one-day operating model*, not a roastery management system.

**Settled strings (KO verbatim):**

| surface | KO | EN |
|---|---|---|
| menu name | `커피 로스터리 운영 흐름` | `Coffee roastery operations flow` |
| menu blurb | `로스팅·판매·재고의 관계를 단순화해 살펴보는 운영 흐름 시뮬레이션` | an operating-flow simulation for looking at how roasting, sales and stock relate, simplified |
| limitation marker (Template surface / `examples/README.md`, §CR13) | `단순화한 시뮬레이션 예제이며 ERP나 실시간 모니터링 시스템이 아닙니다.` | a simplified simulation example — not an ERP or real-time monitoring system |

Never use "operations management" / "운영 관리" for this entry.

### CR2.1a First bundled `loop-model/2` entry *(rev 7)*

`examples/coffee-roastery.json` is the **first bundled Template that declares
model-semantics version 2**: its top-level `schema` is **`loop-studio/graph/2`**
([`SEMANTICS-M2.md`](../SEMANTICS-M2.md) §M2-1), and its five surfaced levers are
`resource`-edge `flow` **parameter references** (`@<parameter-id>`, §CR6.1)
resolved by the engine once per step.

- **The overlay is unaffected** — the shared fresh-open label overlay
  ([`docs/template-label-overlay.md`](template-label-overlay.md)) still touches
  node `data.label` only; `flow` strings, `@ids`, `schema`, and every
  serialized byte are English / stable across locales.
- **`openTemplate` / `loadGraph` set the model version from the file** — opening
  this Template from the menu loads it as v2 (the store's `modelVersion` comes
  from the file's `schema`, exactly as an Import does; it is **not** the
  "explicit user promotion" path — a bundled v2 Template is v2 as authored).
- **Engine-affecting digest** — a v2 document carries the `loop-model/2`
  discriminator in the `loop-revision` / `loop-workspace` engine digest
  (§M2-8); a v2 graph and a byte-identical v1 graph hash differently.
- **No new engine code** — the Template consumes `loop-model/2`; the impl PR
  touches only `examples/coffee-roastery.json`, its fixture test, the four
  registration files, and `examples/README.md` (§CR15).

### CR2.1 File & wiring

- **File:** `examples/coffee-roastery.json` — a real Graph JSON with **English
  canonical node labels**, **wired as the 4th Templates entry** (`templates.ts`
  imports it), alongside `risky-factory.json` / `mmo-progression.json`. Korean
  (and later locales') node labels are supplied by the shared **fresh-open
  label overlay** ([`docs/template-label-overlay.md`](template-label-overlay.md)),
  not a second JSON (§CR12).
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
  | `templates.coffeeRoastery.name` | KO: **커피 로스터리 운영 흐름** · EN: **Coffee roastery operations flow** |
  | `templates.coffeeRoastery.blurb` | KO: **로스팅·판매·재고의 관계를 단순화해 살펴보는 운영 흐름 시뮬레이션** · EN: an operating-flow simulation for looking at how roasting, sales and stock relate, simplified |
  | limitation marker (on-canvas note / `examples/README.md`) | KO: **단순화한 시뮬레이션 예제이며 ERP나 실시간 모니터링 시스템이 아닙니다.** · EN: a simplified simulation example — not an ERP or real-time monitoring system |
  | graph node labels | **English canonical**, localized on fresh-open by the overlay (§CR12) — KO in a KO UI, EN in an EN UI |
  | role | a small Template for changing a few operating assumptions and reading the result |
  | default state | editable (no `canvasLocked`) |
  | adjustable | the five operational levers (§CR6) — each a `resource`-edge `flow: "@<parameter-id>"` (§CR6.1), delivered by `loop-model/2` |
  | `recommendedRunConfig` | `timelineSeries` = the ≤ 8 series in §CR7; a modest `steps` / `baseSeed` |

  It is an **experimental Template** at the `preview` stage.

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

- a daily **dessert prep** quantity (`@dessert_prep`);
- **in-store + takeaway** dessert sales, bounded by that day's dessert demand;
- **unsold dessert leaves the day's stock at end of day** (a drain) — a
  simplifying assumption, surfaced as the signed *dessert prep margin* proxy
  (§CR3.5), **not** as a "waste" figure.

### CR3.5 Results

Changing any of the five levers (§CR6) is a real `flow`-simulation change — the
`@parameter-id` on that edge resolves to the new `value` and the stock
trajectory and channel sales move accordingly. All results are **Registers**
(`loop-expr/1`), read from the right-hand Summary block (§CR8):

| Register | English label | KO label | value | sign meaning |
|---|---|---|---|---|
| revenue per channel | Cafe / Retail / Online revenue | 카페·리테일·온라인 매출 | `units_sold_pool × unit_price` | — |
| total cost | Total cost | 총비용 | Σ costs | — |
| operating profit | Operating profit | 영업이익 | revenue − cost | `+` profit · `−` loss |
| roasted supply margin | **Roasted supply margin** | **로스팅 원두 수급 여유** | `@roasted_stock − (cafe + online) daily demand × cover-days` *(rev 8 — reads the LIVE roasted-stock level, so a green shortage that starves the roaster genuinely moves it; §CR9.1 #2)* | **`+` the shelf covers the demand buffer (slack)** · **`−` demand exceeds roasting output / stock (running short)** |
| dessert prep margin | **Dessert prep margin** | **디저트 준비 여유** | `@dessert_prep − dessert_demand_per_day` | **`+` prepared more than the day sold (leftover)** · **`−` demand outran prep (sold out)** |

**The last two are signed *proxies*, not measured business figures.**
`loop-model/2` adds **no `max` / `min`** (it is a single-reference feature, not
an expression layer — §M2-6), so they are plain signed `supply − demand`
readings:

- **A `−` roasted supply margin is an *unmet-demand signal*, not a counted
  lost-sale quantity or lost revenue** — the model has fixed demand, one green
  pool, and a one-day step, so the number is an operating-judgement cue, not an
  accounting figure.
- **A `+` dessert prep margin is a *leftover* amount, not a confirmed discard
  weight** — the "discard all leftovers at end of day" rule (§CR3.4) is an
  assumption; real leftovers may sell later or be given away. A `−` value means
  the day sold out.
- **Never labelled `missed sales`, `lost sales`, `waste`, or `폐기`** anywhere —
  in a Register title, a **node label** (impl PR (2) must use the exact
  EN / KO labels in the table above), the menu blurb, the Timeline series
  (§CR7), or a §CR9 scenario (§CR9.1). The limitation marker (§CR2) already says
  this Template is not a real measurement / accounting tool; these labels keep
  that true.

The physical roast weight-loss stays a real `drain` in the flow simulation
(§CR3.2) — expected process loss, not a signal or a Register.

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
| dessert — prep, sales, day-end drain | 3 |
| Summary Registers (§CR8) | 4–6 |
| **total** | **~22–25** |

---

## CR6. The five values the user changes

The five surfaced values are **operational levers** — real physical quantities
that a roastery adjusts — laid out clearly in **one row along the top**:

1. **Daily customers** — cafe footfall.
2. **Daily roast amount** — kg of green beans put to roast per day.
3. **Online bean orders** — bags ordered online per day.
4. **Green wholesale orders** — kg of green beans ordered by other businesses
   per day.
5. **Daily dessert prep** — dessert units prepared per day.

Prices, unit costs, and the roast yield are **stable fixed values** (in node
data or a couple of clearly-labelled constants) — **not** surfaced as
hard-to-read expressions.

### CR6.1 The five references — locked *(rev 7)*

Each lever is **one `parameter` node** in the top row, referenced by **exactly
one `resource`-edge `flow` string that is a single bare `@<parameter-id>`** and
nothing else (no compound, no arithmetic — `loop-model/2` M2-2). The `id`s below
are the canonical English node ids in `examples/coffee-roastery.json`; the impl
PR may only rename them, never change the wiring.

| # | Parameter (`id`) | the **one** edge whose `flow` is `@<id>` | engine role of that edge |
|---|---|---|---|
| 1 | **daily customers** (`daily_customers`) | the **cafe-demand `Source` → cafe-demand pool** edge | `Source` push amount — cafe drink demand per day |
| 2 | **daily roast amount** (`daily_roast_kg`) | the **green-bean stock pool → roasting deterministic `Gate`** input edge | `Gate` pull / demand amount — kg of green beans put to roast per day *(rev 8: `Gate`, was `Converter`)* |
| 3 | **online bean orders** (`online_orders`) | the **roasted-bean stock pool → online-sales drain** edge | `Drain` pull amount — bags leaving roasted stock to online sales per day |
| 4 | **green wholesale orders** (`green_wholesale_kg`) | the **green-bean stock pool → wholesale drain** edge | `Drain` pull amount — kg of green beans leaving green stock to wholesale per day |
| 5 | **daily dessert prep** (`dessert_prep`) | the **dessert-prep `Source` → dessert stock pool** edge | `Source` push amount — dessert units prepared per day |

- **rev 8 — roasting is a deterministic `Gate`.** A `Converter` cannot carry
  lever 2: its output is `f·outRate` with `f ∈ [0, 1]` and ≤ 1 activation/step
  ([`SEMANTICS.md`](../SEMANTICS.md) I2), so `@daily_roast_kg` on a Converter
  input edge stops changing the roasted output once green is not the binding
  constraint (and moves it *backwards* when it is). The deterministic Gate is
  the accurate model of "kg put to roast per day": it still uses **exactly one**
  `@param` reference (its single input edge), pulls
  `T = min(@daily_roast_kg, green available)`, and splits T by two fixed weights
  — 82 % → roasted-bean stock, 18 % → the roasting **weight-loss** drain
  (moisture / chaff — a real process loss, never "waste"). Mass is conserved
  (`0.82·T + 0.18·T = T`).
- **Levers 2 and 4 both draw from the same green-bean stock pool.** Raising
  `green_wholesale_kg` genuinely removes green beans that would otherwise be
  available for roasting (§CR9.1 scenario 2) — the competition is **real in the
  run**, not a Register artefact, and the impl PR must not add a second green
  pool to sidestep it (§CR3.6 / §CR4). The `wholesale` drain's node id sorts
  before `roasting`, so on a short-green day the wholesale contract is filled
  first and the roaster takes what is left.
- **Green short ⇒ input and output fall together.** Because the roasting Gate's
  `T` is `min(@daily_roast_kg, green available)`, a green shortage lowers both
  the green pulled *and* (proportionally) the roasted output and the weight-loss
  path — there is no regime where the roaster keeps producing on green it did
  not actually consume.
- **A dangling / mistyped reference contributes `0` + a diagnostic** (never `1`);
  the impl PR's fixture test asserts every `@id` resolves to a live `parameter`
  (`SEMANTICS-M2.md` §M2-3).
- Prices / unit costs / roast yield stay **literal constants** — they are read
  by the Summary Registers (§CR3.5), not by a `flow`.

---

## CR7. Recommended Timeline

At most **9** recommended series (the impl PR finalises the exact set):

- green-bean stock
- roasted-bean stock
- cafe drink sales
- retail bagged-bean sales
- online bagged-bean sales
- green wholesale (kg delivered)
- roasted supply margin (§CR3.5 — signed proxy)
- dessert prep margin (§CR3.5 — signed proxy)
- operating profit

---

## CR8. Summary

The right-hand result area: **4–6 Registers**, no more.

- total revenue
- total cost
- operating profit
- **roasted supply margin** — signed proxy; `+` slack, `−` demand exceeds
  roasting output / stock (an unmet-demand *signal*, not a lost-sale count) — §CR3.5
- **dessert prep margin** — signed proxy; `+` leftover, `−` sold out — §CR3.5
- *(optional)* ending roasted-bean stock

The last two are `supply − demand` **proxies** with an explicit sign meaning —
**not** "missed sales" / "waste" figures (§CR3.5). `loop-model/2` adds no
`max` / `min`, so they are never clamped at zero; the sign carries the meaning.

**Human-readable titles and outcomes take priority over the formulas.**

---

## CR9. Validation scenarios

At minimum, these changes must reproduce **intuitively** (using the §CR3.5
terms — a `−` **roasted supply margin** is an unmet-demand signal, a `+`
**dessert prep margin** is leftover; neither is a "waste" / "lost sales" count):

1. **Roast amount too low** → roasted supply margin turns negative (demand
   outruns roasting); ending roasted stock falls.
2. **Raise green wholesale orders** → wholesale revenue rises, but green beans
   for roasting run short (roasted supply margin trends negative).
3. **Dessert prep above demand** → dessert prep margin turns more positive
   (bigger leftover); dessert-line cost rises without matching sales.
4. **Online orders rise** → roasted stock draws down faster; online revenue and
   operating profit rise until roasted supply margin turns negative.
5. **At a sensible roast amount** → roasted supply margin sits near zero — both
   the shortage signal and the overstock ease.

### CR9.1 Which Parameter, which result *(rev 7)*

Each scenario is **one `@param` change → a real trajectory move**, verified by
the impl PR's fixture test (a deterministic run before / after the change):

| # | change | Parameter (§CR6.1) | what must move (direction) |
|---|---|---|---|
| 1 | roast amount too low | `daily_roast_kg` ↓ | the roasting `Gate` pulls less green ⇒ roasted-bean stock inflow ↓ ⇒ the live roasted-stock level falls → **roasted supply margin → negative** (unmet-demand signal) |
| 2 | more green wholesale | `green_wholesale_kg` ↑ | green-stock drawdown ↑ → the roasting `Gate` is starved (wholesale is filled first) → roasted-stock level ↓ → **roasted supply margin trends negative**; wholesale revenue ↑ |
| 3 | dessert prep above demand | `dessert_prep` ↑ | dessert made per day ↑ while dessert sales are demand-bounded → **dessert prep margin → more positive** (larger leftover); total cost ↑ |
| 4 | more online orders | `online_orders` ↑ | roasted-stock outflow ↑ → **roasted-stock level ↓**, online revenue ↑, operating profit ↑, **roasted supply margin → negative** |
| 5 | roast amount at a sensible level | `daily_roast_kg` → the shipped default | the roasting `Gate` output ≈ the day's roasted demand ⇒ the roasted-stock level holds near its buffer → **roasted supply margin near zero** — the shortage signal and the overstock both ease |

*(rev 8 — the fixture test runs a real deterministic run before / after each
single `@param` change and asserts these directions on the committed
`examples/coffee-roastery.json`: `src/engine/coffee-roastery.test.ts`
`§CR9.1 — each lever change moves a real trajectory in the stated direction`.)*

A build where the numbers only *look* like they moved (a Register's text
changes but the stock trajectory does not) does **not** satisfy this section
(`loop-model/2` §M2-3 — the `@id` resolves to a real number the engine uses).

---

## CR10. Completion criteria

> **rev 6 — the success bar is re-set, not just lowered.** It is **not** "usable
> in the field right now" (§CR2.0). A "this is not a real system" reaction is
> **normal and does not fail** the check. But **"it's a toy" on its own is not a
> pass** either. A pass still requires **all** of: (a) the **simplified flow is
> recognisably realistic** — a domain reader agrees it broadly matches how a
> roastery works; (b) the reader **finds and operates the five levers** unaided;
> (c) the reader can **explain the result change** each lever produces.
> "I can't tell what this means" remains a failure.

- **the headline criterion** — a reviewer **with coffee-business experience**,
  given **no** Loop Studio or graph-modelling instruction, can **explain the
  core flow within 1–2 minutes** and **interpret the result change from
  adjusting at least one input value** (§CR11), and recognises it as a
  **simplified model**, not mistaking it for an operations system;
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
- it **loads from `Templates ▾ → 커피 로스터리 운영 흐름`** and applies
  its `recommendedRunConfig`; **no engine / schema / wire change** in impl PR (2)
  itself, only the registration files (§CR2, §CR15) — the engine feature
  (`loop-model/2`, §CR16) merged separately as PR #103.

---

## CR11. Comprehension check

The engine tests verify *the arithmetic is correct*. This check verifies *a
person who knows the real business accepts the model as natural* — the
validation Loop Studio needs more right now.

**Reviewer:** an **external, domain-informed reviewer** — someone outside the
team, with likely coffee-business familiarity. Their unprompted "real production
/ operations" read (§CR0) is what made this the first external check. A person
who knows the domain saying "I can't tell what this means" is a **failure**;
reading it briefly and explaining the flow + an adjustment result is a **strong
success signal**. One reviewer is not the whole population, but a real outside
domain reader is the sharpest single signal available. (The doc does not record
the reviewer's identity; results are reported in aggregate.)

### CR11.1 Protocol — hand over the site, then ask only

Send just the Loop Studio URL and one line: *"open `Templates ▾ → 커피 로스터리
운영 흐름`"*. **No feature explanation, no Import / Share / file steps.** Then
ask:

1. What business flow does this screen represent?
2. Point to where green beans **enter** and where they **leave**.
3. Predict what happens if the **roast amount is too low**.
4. What does **raising green wholesale** do to cafe / bean sales?
5. Change **daily customers** *or* **daily roast amount** yourself and read the
   result.
6. Name any node, term, or result you **could not** understand.

The questions are framed as **"is the simplified model realistic and legible"**,
not **"is it usable in real work today"** (rev 6, after §CR2.0). Ask, in
addition to 1–6:

- does the **overall flow** broadly match how a roastery really works, or is it
  badly wrong somewhere?
- is a **key step missing**?
- are the **five operational levers** meaningful for an operating decision?
- are the **result changes easy to understand**?

### CR11.2 Pass bar

A pass needs **all** of:

- explains the whole flow, roughly, in **1–2 minutes**;
- confirms the **simplified flow is recognisably realistic** — broadly matches
  how a roastery works, with no badly-wrong step or missing key stage;
- understands the **wholesale-vs-own-roasting competition** for green stock;
- understands roasted beans **split into cafe / retail / online**;
- **finds and operates the five levers** with no guidance, and agrees they are
  **meaningful for an operating decision**;
- after changing a lever, can **say why** the result moved;
- uses it **without** knowing Loop Studio's internal node vocabulary.

**Neutral (does not affect pass/fail):** "this is not my real system" — expected
for a simplified example.

**Fails:** "I can't tell what this means"; can't follow the flow; can't find or
operate the levers; can't explain a result change; **"it's just a toy" with no
realism / legibility judgement behind it.**

Not on the bar (rev 6): that the reviewer would **use it in real work**, or
that it covers a full roastery operation.

### CR11.3 Realism sub-check (the reviewer has domain experience)

- a **core flow that is missing** from an operations point of view;
- a part that is **over-simplified**;
- an **inventory metric that should be read before revenue**;
- whether the **green wholesale ↔ roasting allocation** is realistic;
- whether the **dessert prep margin** (leftover proxy) is a believable operating cue.

### CR11.4 Scope of this first check

**Read → adjust values → interpret results only.** The reviewer is **not** asked
to edit or "fix" the graph. Whether structural editing is viable is examined
**only after** this check passes.

---

## CR12. Language — via the shared fresh-open overlay

The check must measure the *model*, not English comprehension: a Korean reader
needs a Korean graph. But shipping a **Korean-only** JSON would leave every
English user with an English menu entry that opens a Korean graph — a known
mixed-language defect, not something to ship on purpose in the first external
Template. So:

- **One canonical graph, English labels** — `examples/coffee-roastery.json`.
- **Korean (and future locales') labels come from the shared fresh-open label
  overlay** ([`docs/template-label-overlay.md`](template-label-overlay.md)),
  which is designed **and implemented before** this Template. The overlay
  applies the current locale's `nodeId → label` dictionary **once**, when the
  Template is opened from the menu; after that the graph is a user document and
  is **not** re-translated on a language switch.
- **Translated: node `label` only.** Node ids (`green_bean_stock`, `roasting`,
  `cafe_sales`, …), expressions, `resourceType`, `unit`, edge data, and
  positions are **not** translated (they are English/stable everywhere).
- **Menu name / blurb** are per-locale via the app i18n catalog, like every
  Template — the impl PR adds two keys, `templates.coffeeRoastery.name` /
  `.blurb`, to `en.ts` (EN) and `ko.ts` (KO), mirroring `templates.equilibrium.*`.
- Result: **EN UI → English labels; KO UI → Korean labels**, from the same
  graph, with identical structure / expressions / run results (overlay
  invariants, §TLO6). No `.ko.json` for this Template.
- The Korean dictionary entries use the **industry Korean** below (§CR12.1).

### CR12.1 Terminology — natural industry Korean (the KO dictionary)

Physical-flow terms use natural industry Korean; the two `supply − demand`
**proxy** read-outs (§CR3.5) use a neutral "여유 (margin)" wording with the sign
meaning spelled out — **never** `놓친 판매` / `품절 손실` / `폐기`.

| English | Korean |
|---|---|
| green beans | 생두 |
| roasted beans / roasted stock | 로스팅 원두 (원두 재고) |
| roast yield | 로스팅 수율 |
| wholesale green beans | 생두 납품 |
| packaged beans | 포장 원두 |
| **roasted supply margin** (proxy) | **로스팅 원두 수급 여유** — 양수 = 여유, 음수 = 수요가 로스팅 공급을 초과(미충족 수요 신호) |
| **dessert prep margin** (proxy) | **디저트 준비 여유** — 양수 = 잔량, 음수 = 준비 부족(품절) |

The five surfaced Parameters (§CR6), in Korean: **하루 방문 고객 수 · 하루
로스팅량 · 온라인 원두 주문량 · 생두 납품 주문량 · 하루 디저트 준비량**.

---

## CR13. Build order

1. ~~design PR — docs-only: this doc + `docs/template-label-overlay.md` + one
   README line.~~ **Done** (PR #99, `d131948`).
2. ~~implementation PR (1) — the shared label overlay + the Template-3 KO-label
   migration + EN-fallback allow-list for Templates 1 & 2.~~ **Done**
   (PR #100, `b938aed`; `main` CI green).
3. ~~design PR — rev 6 (docs-only): §CR2.0 repositioning + settled strings +
   §CR16 Direction-1 decision.~~ **Done** (PR #101, `26f4de5`).
4. ~~**PR (1.5)** — the general `parameter → simulation input` feature: a spec
   (`SEMANTICS-M2.md`, Frozen, `loop-model/2`) + engine implementation + tests.
   General, not Coffee-specific; no `loop-expr/1` expansion, no `min` / `max`,
   no Coffee file.~~ **Done** (PR #103, merge `c194629`; `main` CI green).
5. ~~**fold PR (1.5) into this doc** (docs-only, THIS PR): §CR3.5 / §CR6 (new
   §CR6.1) / §CR8 / §CR9 (new §CR9.1) lose the "blocked" notes and lock the five
   `@param` references; §CR2.1a marks Coffee the first `loop-model/2` entry;
   CR-D12 / §CR16 → resolved.~~ **This PR.**
6. **implementation PR (2) — this Template**, only **after** step 5:
   - `examples/coffee-roastery.json` — **`schema: "loop-studio/graph/2"`**,
     English canonical labels + English ids; the five levers wired as the
     §CR6.1 `flow: "@<parameter-id>"` references;
   - the `mmo-progression`-style KO dictionary entries for its nodes (§CR12.1);
   - a fixture / deterministic-run test (like `mmo-progression.test.ts`) + an
     `examples/README.md` entry that carries the **§CR2 limitation marker**
     (`단순화한 시뮬레이션 예제이며 ERP나 실시간 모니터링 시스템이 아닙니다.`);
   - `src/model/templates.ts` — a 4th `TEMPLATES[]` item with
     `recommendedRunConfig` (§CR7 series); `openTemplate` / `loadGraph` set the
     store's `modelVersion` from the file's `schema` (v2 — §CR2.1a);
   - `src/components/templateKeys.ts` — a 4th `TEMPLATE_KEY` entry;
   - `src/i18n/templateLabels/ko.ts` — a `coffee-roastery` KO node-label block;
   - `src/i18n/locales/en.ts` + `ko.ts` — the two menu keys (§CR2 strings —
     **`커피 로스터리 운영 흐름`**, never "운영 관리").
   **No engine / schema / wire change in PR (2)** beyond what `loop-model/2`
   landed; **no Coffee-specific engine hardcoding.**
7. **Hanrim pre-merge hands-on check** — locally or in the PR-(2) preview, in
   both EN and KO: the entry loads, reads L→R, the five values are obvious, the
   §CR9.1 scenarios **really** move the trajectory (a before/after run), and
   EN/KO differ only in labels.
8. **merge + Production check.**
9. **external comprehension check** (§CR11) — send the URL + "open `Templates ▾
   → 커피 로스터리 운영 흐름`", nothing else, run the §CR11.1 protocol with the
   **§CR10 / §CR11.2 framing** (believable + legible; realism of the simplified
   flow, lever discovery + operation, per-lever result explanation all on the
   bar; "not a real system" is fine, "toy" alone is not a pass).
10. **README final check** — the roadmap line + general positioning, once
    the model and the check are done.
11. **after the check** — if it exposes model problems, fix in a follow-up PR.
    **LGR Slice 2** starts once step 9 is done. **Not recorded as a success
    until the external check passes.**

---

## CR14. Decisions (CR-D)

| id | question | decision |
|---|---|---|
| **CR-D1** | replace an existing template? | **No.** New file + a **4th** entry; 1 / 2 / 3 untouched (§CR2). |
| **CR-D2** | Example or Template? | **Template** — editable, the user adjusts 5 values (§CR2). |
| **CR-D3** | menu-registered when? | **From the start** — registered as the 4th entry in impl PR (2), so the reviewer just picks it from the menu (no Import / Share). Was "Import-only until validated" in rev 2; a menu pick is the fastest route for the external check (§CR2, §CR13). |
| **CR-D4** | time unit | **one day.** |
| **CR-D5** | multiple green-bean types in v1? | **No** — one aggregate green stock; per-varietal is a prose-only future extension (§CR3.6). |
| **CR-D6** | node budget | **≤ 20–25 total**, Summary Registers included; short on nodes ⇒ cut a result, never add a feature (§CR5). |
| **CR-D7** | the 5 user values | daily customers · daily roast amount · online bean orders · green wholesale orders · daily dessert prep (§CR6). |
| **CR-D8** | prices / costs / yield | fixed, clearly-labelled constants in v1 — not surfaced as expressions (§CR6). |
| **CR-D9** | `src/` / wire / engine impact | impl PR (2) touches **only** `examples/coffee-roastery.json`, its fixture test, `templates.ts`, `templateKeys.ts`, `templateLabels/ko.ts`, 2 menu keys × en+ko, and `examples/README.md`; **no** engine / schema / wire / `loop-revision/N` (§CR15). The engine change is `loop-model/2` (`SEMANTICS-M2.md`, PR #103, merged `c194629`) — a separate, already-shipped, general feature. |
| **CR-D10** | who verifies comprehension? | an **external, domain-informed reviewer** (identity not recorded) — read → adjust → interpret only; not asked to edit the graph (§CR11). |
| **CR-D11** | language | **one English-canonical `examples/coffee-roastery.json`**; Korean (and later locales') node **labels** via the shared fresh-open overlay ([`docs/template-label-overlay.md`](template-label-overlay.md)), built first. `label` only — ids / expr / `resourceType` / positions stay English. No `.ko.json` for this Template. Menu name/blurb per-locale via the app catalog (§CR12). |
| **CR-D12** | the five levers can't reach the frozen engine — what now? | **RESOLVED (rev 7).** Direction 1 shipped: `loop-model/2` (`SEMANTICS-M2.md`, Frozen; PR #103, merge `c194629`) lets a **v2** `resource`-edge `flow` be a single `@parameter-id`. The five stay **operational levers** — locked to concrete edges in §CR6.1 — never redefined as price / cost / yield. The feature added **no** Coffee-specific code, **no** `loop-expr/1` expansion, **no** `min` / `max`. Direction 2 (redesign around the unchanged engine) was considered and not chosen. |
| **CR-D13** | *(rev 7)* Coffee is the first bundled v2 Template — any risk? | **No.** `openTemplate` / `loadGraph` already accept a model version; a bundled v2 file loads as v2 as authored (not the "explicit user promotion" path). The label overlay is `label`-only, so it is unaffected. The v2 `loop-revision` / `loop-workspace` digest discriminator (§M2-8) means the Coffee graph's identity is distinct from any v1 graph — expected. |
| **CR-D14** | *(rev 8)* lever 2 on a `Converter` input edge can't satisfy §CR9.1 under frozen semantics — what now? | **Model `roasting` as a deterministic `Gate`.** [`SEMANTICS.md`](../SEMANTICS.md) I2 fixes a Converter's output at `f·outRate`, `f ∈ [0, 1]`, ≤ 1 activation/step, so `@daily_roast_kg` on a Converter input edge stops changing the roasted output once green is not the binding constraint. A deterministic Gate carries "kg put to roast per day" exactly — **still one `@param` reference** (the single input edge), `T = min(@daily_roast_kg, green available)`, split 82 : 18 into roasted stock and the weight-loss drain, mass-conserving, and green-short limits input + output together. Not a work-around — it is the accurate model. Rejected: a second `@param` edge on the Converter output (breaks "exactly one edge per lever"); Coffee-specific engine code (§CR16.2); keeping the Converter and accepting a dead lever (fails §CR9.1). §CR3.5's roasted-supply-margin proxy now reads the live `@roasted_stock` level so a green-starvation move (§CR9.1 #2) is visible. |

---

## CR15. Scope boundary

- This doc **is** the model + size + surfaced-value + result contract, the
  comprehension-check protocol (§CR11), how this Template *uses* the label
  overlay (§CR12), and the 4th Templates entry's fields (§CR2). The overlay
  **mechanism** is [`docs/template-label-overlay.md`](template-label-overlay.md),
  not this doc. Neither is a spec for the module / template system (§PD8-B).
- **Impl PR (1)** = the shared overlay (`docs/template-label-overlay.md` §TLO)
  + the Template-3 KO-label migration. **Merged** (#100, `b938aed`).
- **`loop-model/2`** (`SEMANTICS-M2.md`, Frozen; PR #103, merge `c194629`) —
  the general `parameter → simulation input` engine feature. **This is where the
  engine change lives**; it is not Coffee-specific and not part of impl PR (2).
- **Impl PR (2)** adds **only**: `examples/coffee-roastery.json` (schema
  `loop-studio/graph/2`), its fixture test, an `examples/README.md` entry (with
  the §CR2 limitation marker), the `coffee-roastery` block in
  `src/i18n/templateLabels/ko.ts`, a `TEMPLATES[]` item in
  `src/model/templates.ts`, a `TEMPLATE_KEY` entry in
  `src/components/templateKeys.ts`, and two menu keys in `en.ts` + `ko.ts`.
  **No other `src/` change; no engine / schema / wire / `loop-revision/N`
  beyond what `loop-model/2` already landed.**
- Templates **1 / 2 / 3** keep their graphs, behaviour, and digests unchanged
  (the overlay only affects a *non-EN fresh-open*, §TLO6).
- **LGR Slice 2** does not start until the external comprehension check (§CR11)
  is
  complete.
- If the check fails, the file stays an `examples/` reference and is **not**
  promoted — no menu entry, no further scope.
- impl PR (2) starts now that `loop-model/2` is merged and §CR3.5 / §CR6.1 /
  §CR8 / §CR9.1 state the real mechanism (rev 7, this PR).
- **README** (the roadmap line and the general positioning text) is checked
  **last** — after the coffee Template is implemented and the external check has
  run.

---

## CR16. Engine constraint & model architecture *(rev 6 — RESOLVED in rev 7)*

> **Resolved.** The constraint below is the reason `loop-model/2`
> ([`SEMANTICS-M2.md`](../SEMANTICS-M2.md), Frozen; PR #103, merge `c194629`)
> exists. In a **v2 document** a `resource`-edge `flow` may be a single
> `@parameter-id` the engine resolves once per step — so the five §CR6 levers
> reach the run (§CR6.1). This section is kept as the design record; §CR6.1 /
> §CR9.1 / CR-D12 carry the settled outcome.

### CR16.1 What was found

At the start of impl PR (2), the model as specified in rev 1–5 could not be
built on the **frozen** engine. Three facts, from the current source and the
frozen specs:

| # | fact | source |
|---|---|---|
| 1 | The engine **skips `parameter` and `register` nodes entirely** — no ports, no `activation`, they never fire. A Parameter's `value` changes **no** number the simulation computes. | `src/engine/step.ts` (`MODEL = new Set(['parameter','register'])`, excluded from every phase); `SEMANTICS-M.md` §M1.3 — "participates only by being **referenced** from expressions". |
| 2 | A resource edge's **`flow`** string is only `const \| all \| percent \| range \| dice`. There is **no `@id` reference** in a flow. So a Parameter cannot be a flow rate, a Source push rate, a Converter ratio, or a Gate weight. | `src/engine/flow.ts` (`parseFlow`); `SEMANTICS-M.md` §M0 Out — "expressions on Gate / Source / Converter — a later amendment". |
| 3 | `loop-expr/1` (Register expressions) has **`+ - * /`, unary `-`, `@id`, parentheses — and nothing else**. No `max` / `min` / comparison / conditional (deferred to `loop-expr/1.1`). A Register cannot clamp a shortfall at zero. | `SEMANTICS-X.md` §X0 / §X2. |

Consequence: with a `parameter` node, the five §CR6 levers can only change what a
**Register displays** — never green / roasted stock, channel sales, stockouts, or
waste in the run. The §CR9 scenarios, as "change a lever → a flow result moves",
are **not achievable** this way. `SEMANTICS-M.md` / `SEMANTICS-X.md` are
**Frozen**; §CR1 / §CR15 forbid any engine / schema / wire change in this
Template's PRs.

### CR16.2 What is **not** an acceptable resolution

- **Redefining the five levers as price / unit-cost / yield constants** (so a
  Parameter only feeds a revenue Register). This keeps the letter of "5
  Parameters" but drops the approved model: the point of the Template (§CR0) is
  that changing an **operating condition** moves stock / stockout / waste /
  profit. Silently swapping that for price-sensitivity is a different Template.
- **A "simulation" where only Register text changes** while the Timeline
  trajectory is fixed. An example that *looks* like a live operations model but
  whose numbers move only decoratively is the worst outcome — especially given
  the external reader's warning (§CR2.0) that partial-but-realistic-looking is
  worse than clearly-scoped.
- **Coffee-specific engine hardcoding** — a code path that special-cases this
  file.
- **A flat wall of ~15 non-interactive Registers** (a spreadsheet with no
  evolving state) — hard to read, fails "explain the flow in 1–2 min".
- **"Select an edge, edit its `flow` in the Inspector" as the five inputs** —
  a first-time reader (the §CR11 reviewer) will not find them; fails "the five
  values are immediately identifiable".

### CR16.3 Decision — Direction 1: a minimal, general `parameter → simulation input` feature

**Decided (rev 6 review); shipped as `loop-model/2` (rev 7).** A small, spec'd,
**engine-level** capability that lets a `parameter` `value` be referenced where a
**rate** is read — so a Parameter genuinely drives the run. It is **general**
(any graph benefits) and shipped as its own spec-first PR **before** impl PR (2)
([`SEMANTICS-M2.md`](../SEMANTICS-M2.md), PR #103, merge `c194629`). This
Template consumes it; it adds no engine code of its own. The as-shipped shape
below matches the sketch, with one narrowing: **`flow` only** (a Source's rate
*is* its out-edge `flow`), and a **v2-document** gate.

**Shape (for the feature's own spec to pin down — sketch only here):**

- a `parameter` reference (`@param_id`) is accepted where a **resource-edge
  `flow`** is read, and/or as a **Source push rate**; it evaluates **once per
  step, like a constant** (the parameter is fixed for the whole run, §M1.1);
- likely touch points: `src/engine/flow.ts` `parseFlow` (a new `param` kind, or
  a resolve step feeding a numeric value in), the pull / push phases in
  `src/engine/step.ts`, `normalizeGraph` handling of a **dangling / wrong-kind
  `@ref`** (fill to a safe value + a notice, never `invalid` mid-run),
  `loop-revision` field projection + digest for the new reference form, and a
  minimal editor affordance so the field is discoverable;
- the feature's spec decides how / whether it **composes with `all` / `percent`
  / `range` / `dice`** (a plain constant-substitution that does not compose is
  an acceptable v1).

**Explicitly excluded from this feature** (kept out on purpose):

- **Coffee-specific hardcoding** — no code path that special-cases
  `coffee-roastery.json` or any single file;
- **a Register-display-only workaround** — a "simulation" whose trajectory is
  fixed and where only a Register's shown number moves is **not** this feature
  and does not satisfy §CR9;
- **widening the `loop-expr/1` expression language** — no new operators, no
  functions, no general expressions on edges / sources; this is a *reference to
  one parameter's value*, not an expression layer;
- **adding `min` / `max` / clamping** — out of scope here; the §CR8 **roasted
  supply margin** / **dessert prep margin** read-outs are plain signed
  `supply − demand` *proxies* with an explicit sign meaning, per §CR3.5 —
  never labelled "missed sales" or "waste".

**Also out of scope (different product, per §CR2.0 / §PD11):** green-bean-variety
CRUD, real-time stock entry, POS / sensor / order integration, statistics
dashboards.

*(Direction 2 — redesigning the Template around the unchanged engine — was
considered and **not** chosen: the "edit a value the reader must first hunt for"
mechanisms it depended on fail the §CR10 "five values immediately identifiable"
bar, the same reason "select an edge, edit its flow" is rejected in §CR16.2.)*

### CR16.4 Work order — done

1. ~~**PR (1.5) — the `parameter → simulation input` feature.**~~ Shipped as
   **`SEMANTICS-M2.md`** (Frozen, `loop-model/2`) + engine implementation +
   tests + the `loop-revision/4` digest discriminator (§M2-8). PR #103, merge
   `c194629`, `main` CI green.
2. ~~**fold the mechanism into this doc.**~~ **This PR (rev 7)** — §CR3.5 /
   §CR6.1 / §CR8 / §CR9.1 state the real mechanism; §CR2.1a; CR-D12 → resolved.
3. **Then impl PR (2)** per §CR13 — the JSON (schema `loop-studio/graph/2`) +
   registration only, consuming `loop-model/2`.
