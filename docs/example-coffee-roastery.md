# Example — "Coffee roastery operations" (non-frozen design doc — DRAFT)

**Status: settled design — implementation pending. rev 1.** This doc fixes the
**scope and shape** of a small, realistic business model *before* any graph is
built. It is a **non-frozen** design doc — no `loop-*/N` id, no `Frozen`
marker — and merges as *settled design, implementation pending*, like
[`docs/large-graph-readability.md`](large-graph-readability.md) and
[`docs/example-mmo-progression.md`](example-mmo-progression.md).

**Docs-only.** No app code, no GraphDoc / engine / schema change, no
`loop-revision/N`, no i18n-catalog change. The graph JSON is built in a
**separate implementation PR** after this design is approved (§CR11).

This is a **product-direction validation prototype**
([`docs/product-direction.md`](product-direction.md) §PD2 / §PD6), **not** a
re-run of the *Early MMO progression* exercise. Early MMO proved the expressive
ceiling of a large model. This one asks the opposite question:

> Can a **general user** grasp a realistic business flow in **1–2 minutes** and,
> by changing **a few values**, watch the results move in a way they can
> predict?

---

## CR0. Why

The Productization track's premise is that blank-canvas authoring is
impractical, so the default path is *adjust a verified template* (§PD2). Before
building the Slice-2 filter UI, it is worth having **one concrete Template
candidate** in a real, non-game domain to test that premise against a person.

A coffee roastery is a good fit: the operation is a short left-to-right flow
(buy green beans → roast → sell), the levers are intuitive (how much to roast,
how many desserts to prep), and the failure modes are familiar (run out of
roasted stock, throw away unsold cake).

---

## CR1. Scope

**In**

- the **contract** for one importable Graph JSON: the model shape (§CR3), the
  size budget (§CR5), the five user-facing Parameters (§CR6), the recommended
  Timeline (§CR7), the Summary read-outs (§CR8), the validation scenarios
  (§CR9), and the completion criteria (§CR10);
- the **product role and boundary** (§CR2) and the **build order** (§CR11).

**Out**

- **Templates-menu registration.** v1 is an **Import-only** file. Whether it
  ever becomes a menu entry is decided *after* a comprehension check (§CR2,
  §CR11).
- **The Example / Template system itself.** This is a single JSON file, not the
  packaging / surfaced-inputs work of §PD8-B.
- **App code, GraphDoc, engine, schema, i18n catalog.** None change.
- **The modelling complexity in §CR4** — deliberately excluded.
- **LGR Slice 2+** — on hold until this prototype's comprehension check is done.

---

## CR2. Product role & boundary

- **File:** `examples/coffee-roastery.json` — a real Graph JSON that opens and
  runs via **Import**, alongside `risky-factory.json`,
  `mmo-progression.json`, etc.
- **NOT registered** in the Templates menu (`templateKeys.ts` untouched). No
  `canvasLocked`; it opens editable.
- **Role: a Template candidate** ([`docs/product-direction.md`](product-direction.md)
  §PD3) — the user changes the five surfaced values (§CR6) and re-runs.
  *Not* an Example (Early MMO is the locked Example); *not* a Building block.
- The three shipped Templates entries are **untouched**:
  1. `equilibrium` — "Flowing equilibrium": the engine's basic steady flow.
  2. `deadlock` — "Bottleneck deadlock": a stall / back-pressure failure.
  3. `mmo-progression` — "Early MMO progression": large-model expressiveness,
     locked, run-and-observe.
  4. *(candidate)* `coffee-roastery` — "Coffee roastery operations": a small
     real-business model to adjust. Added as the **4th** menu entry **only if**
     the comprehension check passes, in its own later PR (§CR11).

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

- a first-time viewer can **explain the main flow in 1–2 minutes**;
- the **five values to change are immediately identifiable**;
- for each value, **the direction of the result change is predictable**;
- **≤ 25 nodes**;
- the whole structure reads without zoom; zoomed in, every node is stably
  readable and clickable;
- **save / run / `loop-revision/*` digest invariance and existing engine
  semantics are unchanged**;
- a **deterministic-seed run** plus the core stock ↔ revenue relationships are
  **pinned by tests** (a fixture spec, like `mmo-progression.test.ts`);
- it **works via Import** with **no Templates registration and no app change**.

---

## CR11. Build order

1. **this design doc** → **docs-only Draft PR** → review → settle.
2. **implementation PR** (separate): `examples/coffee-roastery.json` +
   a fixture / deterministic-run test + an `examples/README.md` entry. No app
   code.
3. **Hanrim comprehension check** — open the file, confirm the flow reads in
   1–2 minutes, the five values are obvious, and the scenarios (§CR9) behave.
4. **only if it proves practical** → a **later PR** registers it as the **4th**
   Templates entry (`templateKeys.ts` id-map + EN/KO name & blurb, same pattern
   as `equilibrium` / `deadlock` / `mmo-progression`), with a
   `recommendedRunConfig` (Timeline series from §CR7). Not before.

---

## CR12. Decisions (CR-D)

| id | question | decision |
|---|---|---|
| **CR-D1** | replace an existing template? | **No.** New, separate file; 1 / 2 / 3 untouched (§CR2). |
| **CR-D2** | Example or Template? | **Template candidate** — the user adjusts 5 values (§CR2). |
| **CR-D3** | menu-registered from the start? | **No** — Import-only until a comprehension check passes (§CR2, §CR11). |
| **CR-D4** | time unit | **one day.** |
| **CR-D5** | multiple green-bean types in v1? | **No** — one aggregate green stock; per-varietal is a prose-only future extension (§CR3.6). |
| **CR-D6** | node budget | **≤ 20–25 total**, Summary Registers included; short on nodes ⇒ cut a result, never add a feature (§CR5). |
| **CR-D7** | the 5 user values | daily customers · daily roast amount · online bean orders · green wholesale orders · daily dessert prep (§CR6). |
| **CR-D8** | prices / costs / yield | fixed, clearly-labelled constants in v1 — not surfaced as expressions (§CR6). |
| **CR-D9** | app / wire / engine impact | **none**; docs-only PR now, JSON-only PR later. |

---

## CR13. Scope boundary

- This doc **is** the model + size + surfaced-value + result contract for one
  importable Graph JSON. It **is not** a spec for the Example / Template system
  (§PD8-B), and it registers nothing in the app.
- The impl PR adds **only** `examples/coffee-roastery.json`, its test, and an
  `examples/README.md` entry — **no `src/` change**.
- **LGR Slice 2** does not start until this prototype's comprehension check is
  complete.
- If the check fails, the file stays an `examples/` reference and is **not**
  promoted — no menu entry, no further scope.
