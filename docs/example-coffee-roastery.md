# Example — "Coffee roastery — operational-flow simulation" (non-frozen design doc — DRAFT)

**Status: settled design — implementation pending. rev 6.** rev 1–3 fixed the
model, the comprehension check, and shipping as the 4th Templates entry; rev 4
moved the Korean labels to a **shared fresh-open label overlay**
([`docs/template-label-overlay.md`](template-label-overlay.md)); rev 5 aligned
the build order with that doc's review. **rev 6** resolves a contract conflict
found at the start of impl PR (2): the model as written in rev 1–5 assumed the
five surfaced Parameters *drive the operational simulation*, but the **frozen**
`loop-model/1` + `loop-expr/1` engine does not permit that (a `parameter` node
changes no simulated number; resource-edge `flow` takes no `@ref`; `loop-expr/1`
has no `max` / `min`). **§CR16 is new**: it states the constraint and lays out
**two candidate directions for the reviewers to choose between** — it does not
pick one. **§CR2.0 (new)** repositions the Template as an *operational-flow
simulation example* — not an operations / ERP system — after an external
reader's two pre-comments (recorded anonymised in
[`docs/product-direction.md`](product-direction.md) §PD11). **§CR3.5 / §CR6 /
§CR8 / §CR9** carry "blocked pending §CR16" notes; **§CR10 / §CR11.1 / §CR11.2**
lower the external-check success bar to *"is the simplified flow legible"*, not
*"usable in the field"*; **§CR13** marks steps 1–2 done and gates impl PR (2) on
a §CR16 decision; **CR-D12** is added. The size budget (§CR5), the domain scope
(§CR3–§CR4), and the language mechanism (§CR12) are unchanged. This is a **non-frozen** design doc — no
`loop-*/N` id, no `Frozen` marker — and merges as *settled design, implementation
pending*, like [`docs/large-graph-readability.md`](large-graph-readability.md)
and [`docs/example-mmo-progression.md`](example-mmo-progression.md).

**rev 6 is docs-only** — this doc + the one README roadmap line. Implementation
stays **two** PRs, in order:
**(1)** the shared label overlay — **merged** (PR #100, `b938aed`); **(2)** this
Template — `examples/coffee-roastery.json` (English canonical labels), a Korean
label dictionary, a fixture test, `src/model/templates.ts`,
`src/components/templateKeys.ts`, **two** name/blurb keys in `en.ts` + `ko.ts`.
**Nothing else** in `src/`: no engine, schema, wire / `loop-revision/N`.

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
and familiar failure modes (run out of roasted stock, throw away unsold cake).

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
  assumptions and watching how green / roasted stock, sales, stockouts, waste,
  and profit relate.

**Positioning (adopted for the product, not just this example — §PD11):**
Loop Studio is not an ERP that manages live business data; it composes
**connected operating flows visually and compares outcomes as you change a few
conditions** — an operating-flow simulation. The coffee entry is a *simplified
one-day operating model*, not a roastery management system.

The Template name, blurb, and README line say **"operational-flow simulation"**
(KO: **운영 흐름 시뮬레이션**), never "operations management" (KO: **운영 관리**);
and the Template surface (an on-canvas note or the `examples/README.md` entry,
§CR13) states plainly, KO verbatim: **운영 흐름 시뮬레이션 예제이며 ERP·실시간
모니터링 시스템이 아님** (an operational-flow simulation example — not an ERP or
real-time monitoring system).

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
  | `templates.coffeeRoastery.name` | KO: **커피 로스터리 운영 흐름 시뮬레이션** · EN: **Coffee roastery — operational-flow simulation** |
  | `templates.coffeeRoastery.blurb` | KO: **가정 기반 모델 — 생두·원두 재고, 판매·품절·폐기·이익의 관계를 흐름으로 살펴봄 (실시간 재고/POS/ERP 아님)** · EN: an assumption-based model of how green / roasted stock, sales, stockouts, waste and profit relate — not a real-time inventory / POS / ERP tool |
  | graph node labels | **English canonical**, localized on fresh-open by the overlay (§CR12) — KO in a KO UI, EN in an EN UI |
  | role | a small Template for changing a few operating assumptions and reading the result |
  | default state | editable (no `canvasLocked`) |
  | adjustable | the five operational levers (§CR6) — **delivery mechanism blocked pending §CR16** |
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

- a daily **dessert prep** quantity;
- **in-store + takeaway** dessert sales;
- **leftover dessert is discarded** at end of day (a drain).

### CR3.5 Results

- **revenue per channel**;
- **total cost**;
- **operating profit**;
- **stockouts / missed sales**;
- **waste quantity** (roast loss is expected; dessert waste is the signal).

> **rev 6 — blocked pending §CR16.** rev 1–5 assumed these results move when the
> user changes one of the five operational levers (§CR6). Whether that is
> achievable, and by what mechanism (a real flow-simulation effect vs. a
> Register-only read-out; a clamped shortfall vs. signed headroom, since
> `loop-expr/1` has no `max` / `min`), depends on which direction §CR16 settles.
> Do **not** implement a version where only a Register's displayed number
> changes while the stock trajectory does not.

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

The five surfaced values are **operational levers** — real physical quantities
that a roastery adjusts — laid out clearly in **one row along the top**:

1. **Daily customers** — cafe footfall.
2. **Daily roast amount** — kg of green beans put to roast per day.
3. **Online bean orders** — bags ordered online per day.
4. **Green wholesale orders** — kg of green beans ordered by other businesses
   per day.
5. **Daily dessert prep** — dessert units prepared per day.

Prices, unit costs, and the roast yield are **stable fixed values** in v1 (in
node data or a couple of clearly-labelled constants) — **not** surfaced as
hard-to-read expressions.

> **rev 6 — this list is the approved intent; its delivery is blocked pending
> §CR16.** These five are **operational levers**, not display-calculation
> constants. Changing one must move the stock / sales / stockout / waste / profit
> flow — that experience *is* the point of the Template (§CR0). The frozen engine
> does not let a `parameter` node do that today (§CR16). rev 6 does **not**
> resolve this by redefining the five as prices / unit costs / yield — that would
> quietly swap the approved model for a different one. The two candidate
> directions and their cost are in §CR16; the five stay as written above until
> one is chosen.

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

> **rev 6 — blocked pending §CR16.** "missed sales" and "dessert waste" as
> `loop-expr/1` Registers cannot be `max(0, …)` (no `max`/`min`, §CR16.1 #3);
> pending the §CR16 direction they are either a signed headroom read-out or a
> real drain in the flow simulation. Do not ship a version that displays a
> clamped number the expression cannot actually produce.

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

> **rev 6 — blocked pending §CR16.** Every scenario here is "change a §CR6
> operational lever → a stock / sales / stockout / waste / profit result moves."
> That requires a lever to reach the simulation, which the frozen engine does not
> allow for a `parameter` node (§CR16). These scenarios stay as the acceptance
> target; how they are met is the §CR16 decision. A build where the numbers only
> *look* like they moved (Register text changes, trajectory does not) does **not**
> satisfy this section.

---

## CR10. Completion criteria

> **rev 6 — the success bar is lowered.** The headline criterion is **not**
> "usable in the field right now" (§CR2.0 — the reader's own warning against a
> partial-but-real-looking tool). It is: **can a domain reader understand the
> simplified flow and how the variables relate.** "I can't tell what this means"
> is still a failure; "this is a toy, not my real system" is **expected and fine**
> as long as the flow and the lever→result relationships read clearly.

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
- it **loads from `Templates ▾ → 커피 로스터리 운영 흐름 시뮬레이션`** and applies
  its `recommendedRunConfig`; **no engine / schema / wire change** in impl PR (2)
  itself, only the registration files (§CR2, §CR15) — a §CR16 direction-1
  general engine feature, if chosen, is its own separate prior PR.

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
운영 흐름 시뮬레이션`"*. **No feature explanation, no Import / Share / file
steps.** Then ask:

1. What business flow does this screen represent?
2. Point to where green beans **enter** and where they **leave**.
3. Predict what happens if the **roast amount is too low**.
4. What does **raising green wholesale** do to cafe / bean sales?
5. Change **daily customers** *or* **daily roast amount** yourself and read the
   result.
6. Name any node, term, or result you **could not** understand.

The four questions are framed as **"is the model believable and legible"**, not
**"is it usable in real work today"** (rev 6, after §CR2.0):

- does the **overall flow** broadly match how a roastery really works, or is it
  badly wrong somewhere?
- is a **key step missing**?
- are the **five operational levers** meaningful for an operating decision?
- are the **result changes easy to understand**?

### CR11.2 Pass bar

- explains the whole flow, roughly, in **1–2 minutes**;
- understands the **wholesale-vs-own-roasting competition** for green stock;
- understands roasted beans **split into cafe / retail / online**;
- **finds the five adjustable values** with no guidance;
- after changing a value, can **say why** the result moved;
- uses it **without** knowing Loop Studio's internal node vocabulary;
- reads it as a **simplified operating model** — not expecting live stock,
  lots / varieties, vendors, WIP, or accounting output (§CR2.0). Saying "this
  is not my real system" is **not** a failure; failing to follow the flow or
  the lever→result link is.

Not on the bar (rev 6): that the reviewer would **use it in real work**, or
that it covers a full roastery operation.

### CR11.3 Realism sub-check (the reviewer has domain experience)

- a **core flow that is missing** from an operations point of view;
- a part that is **over-simplified**;
- an **inventory metric that should be read before revenue**;
- whether the **green wholesale ↔ roasting allocation** is realistic;
- whether the **dessert-waste model** is believable.

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

1. ~~design PR — docs-only: this doc + `docs/template-label-overlay.md` + one
   README line.~~ **Done** (PR #99, `d131948`).
2. ~~implementation PR (1) — the shared label overlay + the Template-3 KO-label
   migration + EN-fallback allow-list for Templates 1 & 2.~~ **Done**
   (PR #100, `b938aed`; `main` CI green).
3. **design PR — rev 6 (docs-only, THIS PR):** §CR2.0 repositioning +
   §CR16 (engine constraint + the two candidate directions + their cost). No
   `src/` or `examples/` change. Review → **pick a §CR16 direction** → settle.
4. **implementation PR (2) — this Template**, only **after** step 3 settles a
   §CR16 direction:
   - `examples/coffee-roastery.json` (English canonical labels, English ids);
   - the `mmo-progression`-style KO dictionary entries for its nodes (§CR12.1);
   - a fixture / deterministic-run test (like `mmo-progression.test.ts`) + an
     `examples/README.md` entry that **states the §CR2.0 boundary** (an
     assumption-based model, not a real-time inventory / POS / ERP tool);
   - `src/model/templates.ts` — a 4th `TEMPLATES[]` item with
     `recommendedRunConfig` (§CR7 series);
   - `src/components/templateKeys.ts` — a 4th `TEMPLATE_KEY` entry;
   - `src/i18n/locales/en.ts` + `ko.ts` — the two menu keys (§CR12), using the
     **"operational-flow simulation"** wording (§CR2.0), not "operations
     management".
   Plus **whatever the chosen §CR16 direction requires** (direction 1 adds a
   general engine feature in its own prior PR; direction 2 adds nothing beyond
   the list above). **No Coffee-specific engine hardcoding either way.**
5. **Hanrim pre-check** — locally or in the PR-(2) preview, in both EN and KO:
   the entry loads, reads L→R, the five values are obvious, the §CR9 scenarios
   behave (really — the trajectory moves, §CR6 / §CR9 rev-6 notes), and EN/KO
   differ only in labels.
6. **merge + Production deploy.**
7. **external comprehension check** (§CR11) — send the URL + "open `Templates ▾
   → 커피 로스터리 운영 흐름 시뮬레이션`", nothing else, run the §CR11.1 protocol
   with the **rev-6 framing** (believable + legible, not "usable in real work
   today").
8. **after the check** — if it exposes model problems, fix in a follow-up PR.
   **LGR Slice 2** starts once step 7 is done. **Not recorded as a success
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
| **CR-D9** | `src/` / wire / engine impact | impl PR (2) touches **only** `examples/coffee-roastery.json`, its test, `templates.ts`, `templateKeys.ts`, the KO dictionary entries, 2 menu keys × en+ko; **no** engine / schema / wire / `loop-revision/N` (§CR15). **rev 6:** if §CR16 direction 1 is chosen, the *general* engine feature is a **separate prior PR** with its own spec; impl PR (2) itself still touches only this list. |
| **CR-D10** | who verifies comprehension? | an **external, domain-informed reviewer** (identity not recorded) — read → adjust → interpret only; not asked to edit the graph (§CR11). |
| **CR-D11** | language | **one English-canonical `examples/coffee-roastery.json`**; Korean (and later locales') node **labels** via the shared fresh-open overlay ([`docs/template-label-overlay.md`](template-label-overlay.md)), built first. `label` only — ids / expr / `resourceType` / positions stay English. No `.ko.json` for this Template. Menu name/blurb per-locale via the app catalog (§CR12). |
| **CR-D12** | *(rev 6)* the five levers can't reach the frozen engine — what now? | **Pause impl PR (2); do this rev-6 doc PR first.** The five stay **operational levers** (visitors · roast kg · online orders · wholesale kg · dessert prep), **not** redefined as price / cost / yield constants. §CR16 documents the boundary and compares **direction 1** (a minimal *general* `parameter → simulation input` feature) vs **direction 2** (a smaller engine-unchanged model that is still factually right and first-user-legible). **Rejected:** Coffee-specific hardcoding; a "simulation" where only Register text moves; direction-B flat-Register spreadsheet; direction-C edit-the-edge-in-the-Inspector. Code starts only after a §CR16 direction is reviewed and approved. |

---

## CR15. Scope boundary

- This doc **is** the model + size + surfaced-value + result contract, the
  comprehension-check protocol (§CR11), how this Template *uses* the label
  overlay (§CR12), and the 4th Templates entry's fields (§CR2). The overlay
  **mechanism** is [`docs/template-label-overlay.md`](template-label-overlay.md),
  not this doc. Neither is a spec for the module / template system (§PD8-B).
- **Impl PR (1)** = the shared overlay (`docs/template-label-overlay.md` §TLO)
  + the Template-3 KO-label migration.
- **Impl PR (2)** adds **only**: `examples/coffee-roastery.json`, its fixture
  test, an `examples/README.md` entry, this Template's KO dictionary entries, a
  `TEMPLATES[]` item in `src/model/templates.ts`, a `TEMPLATE_KEY` entry in
  `src/components/templateKeys.ts`, and two menu keys in `en.ts` + `ko.ts`.
  **No other `src/` change; no engine / schema / wire / `loop-revision/N`.**
- Templates **1 / 2 / 3** keep their graphs, behaviour, and digests unchanged
  (the overlay only affects a *non-EN fresh-open*, §TLO6).
- **LGR Slice 2** does not start until the external comprehension check (§CR11)
  is
  complete.
- If the check fails, the file stays an `examples/` reference and is **not**
  promoted — no menu entry, no further scope.
- **rev 6:** impl PR (2) does not start until §CR16 settles a direction.

---

## CR16. Engine constraint & model architecture *(rev 6)*

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

### CR16.3 The two directions to cost out (this rev-6 PR asks the reviewers to pick)

**Direction 1 — a minimal, *general* "Parameter drives a simulation input"
feature.** A small, spec'd, engine-level capability that lets a `parameter`
`value` be referenced where a rate is read today — e.g. `@param_id` accepted in a
resource-edge `flow` (and/or a Source push rate), evaluated once per step like a
constant. General (any graph benefits), not Coffee-specific. Its own spec id +
doc + PR, reviewed on its own merits, **before** impl PR (2). Cost to scope:
grammar + `parseFlow` extension, engine wiring in the pull/push phases,
`loop-revision` field projection + digest, editor affordance, `normalizeGraph`
handling of a dangling `@ref`, tests, and a decision on whether random / `all` /
`percent` compose with it. Benefit: the coffee model (and future Templates) works
as designed; the five stay real levers.

**Direction 2 — a smaller Coffee model that needs no engine change, is still
factually right, and a first-time reader can understand.** Accept that a
`parameter` node can't drive the run, and re-design the Template around what the
frozen engine *does* allow. Candidate mechanisms, to be weighed in the rev-6
review (not pre-decided here):

- the operating levers as the literal push rates of a small top row of **Source**
  nodes, read/edited on the **node** in the Inspector — **only if** the Inspector
  actually surfaces a Source's rate on the node (needs checking; if it is
  edge-only, the §CR10 "five values immediately identifiable" bar is at risk and
  this mechanism is out);
- fewer than five levers, if that is what stays honest and legible;
- a narrower "what you adjust" (e.g. the built-in day is fixed and the reader
  compares two or three preset day shapes) rather than free-value tuning.

Registers stay read-outs only. Cost to scope: mostly model re-design + layout +
tuning + one Inspector check; smallest code footprint. Risk: any version that
keeps "edit a value the reader must first hunt for" (an edge label, a buried
field) fails the external-comprehension goal — the same reason direction C was
rejected in §CR16.2.

**Out of scope for both:** green-bean-variety CRUD, real-time stock entry,
POS / sensor / order integration, statistics dashboards — all correctly raised
by the external reader (§CR2.0) and all belonging to a different product, not
this example.

### CR16.4 After a direction is chosen

Fold the decision back into §CR3.5 / §CR6 / §CR8 / §CR9 (remove the
"blocked pending §CR16" notes, state the real mechanism), set CR-D12 to the
chosen direction, and only then start impl PR (2) per §CR13 step 4.
