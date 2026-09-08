# Template label overlay (non-frozen design doc)

**Status: implemented. rev 4.** rev 1 fixed the
mechanism; rev 2 pinned four review points; rev 3 made the
canonical-immutability boundary unambiguous; **rev 4** adds **§TLO11** — a
narrow, deliberate exception to "a language switch never re-translates an open
document": the OFFICIAL bundled-template labels (and only those, decided by an
exact string match) follow a UI-language change, in the live graph and the
undo/redo history.

rev 3's canonical-immutability boundary: `loadGraph` gets a **full
structural deep clone of the whole `{ nodes, edges }` payload** (every node /
`position` / `data`, every edge / `data` / `route` / `waypoints`) plus a fresh
`recommendedRunConfig`, so no overlay, React Flow runtime state (`selected` /
`dragging` / `measured`), or user edit can reach `TEMPLATES[i]` (§TLO3 / INV-7 /
TLO-D10), backed by a re-open-isolation test **and** a no-shared-references unit
test (§TLO8). rev 2's other three points stand: first-impl scope (§TLO2.1),
the completeness-conditional CI rule (§TLO7), the `label`-only MMO migration
(§TLO2.2).
A **non-frozen** design doc — no `loop-*/N` id, no `Frozen` marker — like
[`docs/localization.md`](localization.md) and
[`docs/large-graph-readability.md`](large-graph-readability.md).

**Docs-only in this PR** (shared with [`docs/example-coffee-roastery.md`](example-coffee-roastery.md)).
The mechanism is built in its **own implementation PR**, which merges **before**
the coffee-roastery Template PR.

A bundled Template should open in the **user's language** without the project
keeping a full second JSON per locale. This is a **fresh-open label overlay**:
one English-canonical Template graph + a per-locale `nodeId → label` dictionary,
applied **once**, at the moment the Template is opened from the menu. After that
the graph is the user's document.

It **extends [`docs/localization.md`](localization.md) §L3.4** in two narrow
ways — a *bundled Template*'s node `label`s are locale-seeded at open (§TLO3),
and on a later UI-language change the *official* bundled-template labels in the
open document follow the new language (§TLO11) — and leaves the rest of §L3.4
intact: a running locale switch still never rewrites a *user's own* label, an
`examples/*.json` graph's arbitrary labels, a Share/Workspace graph, or
`defaultData()`.

### What this is / is not

**A shared system for every bundled Example / Template / Building block** —
keyed on `(templateId, nodeId, locale)`, **not** coffee-specific. Every current
and future menu entry can use it with no per-entry code.

**A general user benefits with zero setup:**

- open a bundled Template in Korean → Korean labels; in English → English
  labels; the same for the MMO Example, `equilibrium` / `deadlock`, and future
  Building blocks;
- after it opens, the user edits any label freely — it is their document;
- Save / Share / Export keep the labels currently shown.

**v1 does NOT let a user localize *their own* graph.** No per-graph translation
dictionary, no authoring per-locale labels, no translating a user document on a
language switch, no translation-file export/import, no auto / AI translation.
The overlay dictionaries are **trusted, maker-managed, in-repo data**. A
user-facing translation-authoring feature — with its own cost (marking which
label is the user's source, storing per-locale user labels, a GraphDoc or
translation-file contract, an Inspector translate-edit UI, Share/Export
language handling, missing-translation fallback, edit-conflict rules) — is a
**separate future product feature**, only if real demand appears.

---

## TLO0. Why

- Template 3 (MMO) shipped a hand-made `examples/mmo-progression.ko.json` — a
  full duplicate graph, kept in sync **by hand** ([`docs/mmo-ko-derived-example`
  maintenance rule](example-mmo-progression.md)). That does not scale to a 4th,
  5th … Template.
- The coffee-roastery Template ([`docs/example-coffee-roastery.md`](example-coffee-roastery.md))
  is the first **external comprehension check**; it must open in Korean for a
  Korean reader **and** in English for an English reader, from **one** graph.
- "User data is not translated" (§L3.4) still holds. This changes only **what a
  bundled Template seeds at open time**, per locale, for **`label` only**.

---

## TLO1. Scope

**In**

- a **generic** mechanism reusable by **every** bundled entry — the current
  four (`equilibrium`, `deadlock`, `mmo-progression`, `coffee-roastery`) and
  any future Template / Building block — driven by `(templateId, nodeId)`, with
  **no** per-entry code;
- the overlay **data shape** (§TLO2);
- the **apply rule** — current-locale labels, bundled-Template fresh-open only
  (§TLO3);
- the **do-not-re-apply** rule — Import / Share / Workspace / autosave-restore /
  a running locale switch (§TLO4);
- **persistence + export** behaviour (§TLO5);
- the **invariants** (§TLO6), the **CI drift check** (§TLO7), the **tests**
  (§TLO8).

**Out**

- **Any GraphDoc / engine / serialized-format / `loop-revision/N` change.**
- Translating anything but node `data.label` — **not** node `id`, expressions,
  `resourceType`, `unit`, edge `data`, `position`, handles, or
  `recommendedRunConfig`.
- A full per-locale JSON graph. The `.ko.json` full-copy approach is **retired**.
  Template 3 (MMO) **adopts the overlay** in the same impl PR (§TLO2.2); the
  `examples/mmo-progression.ko.json` file was kept unwired only as the harvest
  source and has since been **removed** (2026-09-07) — once the layout is shared
  it holds no unique information and would only be a bad precedent.
- **Any user-facing translation-authoring feature** — attaching a translation
  dictionary to a *user's own* graph, per-locale user labels, translating a
  user document on a language switch, translation-file export/import, auto / AI
  translation. Separate future product feature, only on real demand.
- Re-translating an already-open document — ever.
- The Template **menu name / blurb** — those stay in the app i18n catalog
  (`src/components/templateKeys.ts` + `en.ts` / `ko.ts`), unchanged (§TLO-D5).

---

## TLO2. The data

- One dictionary per **(Template, locale)**: a per-locale module
  `src/i18n/templateLabels/<locale>.ts` holding
  `{ [templateId]: { [nodeId]: string } }` (`satisfies` a type keyed off the
  `TEMPLATES` ids). Exact file layout is an impl-PR detail; it lives in `src/`,
  not `examples/`.
- **English is the canonical.** `TEMPLATES[i].graph` nodes already carry English
  `label`s. There is **no `en` dictionary** (or it is empty) — English is the
  *fallback*, not an overlay.
- A locale with no dictionary, or a dictionary missing a node id, contributes
  **nothing** for those nodes → the English canonical label.
- **Registering a new locale = add one `templateLabels/<locale>.ts`** — no
  change to `TEMPLATES`, the graphs, or existing dictionaries (mirrors
  localization.md's "new locale = one file" rule; any `if (locale === 'ko')`
  two-way branch is a bug).

### TLO2.1 First-implementation Template scope

Impl PR (1) ships a **`ko` dictionary for `mmo-progression`** (harvested,
below). Impl PR (2) adds a **`ko` dictionary for `coffee-roastery`**.
Templates 1 & 2 (`equilibrium`, `deadlock`) were on the EN-fallback
allow-list (§TLO7) in PR (1) — the optional follow-up. **Done 2026-09:**
both were reframed as a production line, extracted to
`examples/equilibrium.json` / `examples/deadlock.json`, given a `ko`
dictionary, and removed from `EN_FALLBACK_TEMPLATES` (now empty). The
frozen SEMANTICS §14 Variant A / Variant B structure and engine numbers
are unchanged — only labels and the menu name/blurb carry the framing;
`src/model/templates.trajectory.test.ts` pins the §14 trajectory of the
extracted JSON.

### TLO2.2 Migrating Template 3 (MMO)

The MMO Example is finished; it is **not** rebuilt or edited. Impl PR (1) does
one mechanical step: **harvest the Korean node `label`s from the existing
`examples/mmo-progression.ko.json` into `templateLabels/ko.ts` for the
`mmo-progression` id**, matched **by node `id`**.

- **`label` only.** Nothing else is taken from `mmo-progression.ko.json` —
  **not** its translated `resourceType` (`화폐` / `보급품` / `전투력` …), not
  edge data, not anything. The overlay is `label`-scoped (§TLO-D4); the MMO
  Template keeps its canonical English/advisory `resourceType` in every locale.
- The `mmo-progression.ko.json` file was retained unwired only as the harvest
  source and has since been **removed** (2026-09-07). Its former
  hand-parity maintenance rule no longer applies to anything; the CI drift
  check (§TLO7) covers label parity for the *Template* against the one canonical
  `examples/mmo-progression.json`.

Result:

- **EN fresh-open** → the finished English MMO, byte-identical to today
  (§TLO6-INV-1);
- **KO fresh-open** → the same MMO graph — node/edge set, `position`s,
  `canvasLocked`, `recommendedRunConfig`, `resourceType`, Timeline,
  deterministic run result all unchanged — with the harvested Korean `label`s
  applied;
- already-saved user MMO documents → untouched.

---

## TLO3. The apply rule

- The **only** trigger is opening a bundled Template from the Templates menu:
  `src/components/Templates.tsx` / `src/components/mobile/MobileMoreMenu.tsx`
  `doLoadTemplate` → `loadGraph(tpl.graph)`.
- At that moment, hand `loadGraph` a **full structural deep clone of the entire
  graph payload** `{ nodes, edges }` — **not** just the node array. Every
  mutable object and array is fresh, sharing **no** reference back into
  `TEMPLATES[i]`:
  - each **node**, and its **`position`** and **`data`** objects;
  - each **edge**, and its **`data`** — including nested values such as
    `route` / `waypoints`;
  - and, on the sibling call, a fresh copy of **`tpl.recommendedRunConfig`**
    (its `timelineSeries` / `tracked` arrays not shared) before
    `applyRecommended`.
  - The clone is `JSON.parse(JSON.stringify(x))` — the payload is pure JSON
    (numbers, strings, booleans, arrays, nested objects; no `Date` / `Map` /
    `Set` / cycles), this matches the existing house idiom (`cloneEl` in
    `src/model/revision.ts`), and it keeps the browser floor where it already
    is — the feature introduces **no** `structuredClone` (Safari 15.4+)
    dependency.
- On the cloned copy only, for each node,
  `data.label = dict[activeLocale]?.[tpl.id]?.[node.id] ?? node.data.label`.
  The **current `activeLocale`** dictionary only. Nothing else on any
  node/edge is changed.
- Why the whole payload, not just labels: the overlay never edits an edge, but
  React Flow and the store later write **runtime state** (`selected`,
  `dragging`, `measured`, …) onto the objects they are given. If the open
  document shared the canonical's node/edge objects, that runtime state — and a
  future locale's labels — would pollute `TEMPLATES[i]`, and the *next*
  fresh-open (any locale, EN included) would start dirty. The deep clone makes
  every open start from the pristine English canonical.
- `recommendedRunConfig` is applied exactly as today, from its fresh copy.
- If `activeLocale` is `en` (or has no dictionary), the copy's labels equal the
  canonical → the load is **byte-identical to today** (§TLO6-INV-1).
- If `activeLocale` is `en` (or has no dictionary), the copy's labels equal the
  canonical → the load is **byte-identical to today** (§TLO6-INV-1).

---

## TLO4. Not re-applied — except the §TLO11 official-label re-seed

Once the document is open it is a **user document**. `openTemplate` (the menu
overlay) runs **zero** further times:

- **Import** (a `.json`), **Share** (`#g1=`) load, **Workspace** import,
  **autosave** (`localStorage`) restore: **no** `openTemplate` pass — those
  files already carry their own labels.
- Revision / proposal apply operates on the already-open document; no overlay.
- **Changing the app language** afterwards does **not** re-run `openTemplate`.
  It does, per **§TLO11**, re-seed the *official* bundled-template labels — a
  node whose `id` is a known bundled-template id **and** whose current `label`
  is exactly one of that id's shipped-locale strings. A **user-edited** label
  (anything that is not one of those official strings) is never touched. This is
  the single, deliberate crack in "a switch never re-translates an open
  document"; every other label — a user rename, an `examples/*.json` label, a
  shared graph — stays as written.

---

## TLO5. Persistence & export

- After fresh-open, the applied labels **are** the document. Export (Graph
  JSON), Share, Workspace, and autosave save them **verbatim**.
- Re-importing such a file does **not** re-overlay — it round-trips exactly.
- So: open the coffee Template in Korean → Export → the file carries Korean
  labels, and re-importing it anywhere shows Korean regardless of that viewer's
  locale. Correct — it is now a specific document, not "the Template".

---

## TLO6. Invariants (TLO-INV)

1. **EN fresh-open is unchanged.** For `activeLocale = en` (or any locale with
   no dictionary), a Template opened from the menu produces a byte-identical
   GraphDoc, `loop-revision/*` digest, undo entry, and `recommendedRunConfig`
   application to before this feature (a committed golden).
2. **Locale changes only `label`.** For any locale, a fresh-opened Template's
   node set, edge set, handles, `position`s, expressions, `resourceType`,
   `unit`, edge `data`, and `recommendedRunConfig` are **identical** across
   locales — only `data.label` strings differ.
3. **Engine indifference.** A **deterministic-seed run** of a fresh-opened
   Template yields the **same** engine result and the same Timeline /
   Monte-Carlo output in every locale (the engine never reads `label`).
4. **Bounded live re-translation (§TLO11).** After a Template is open, changing
   `activeLocale` re-seeds **only** the OFFICIAL bundled-template node labels —
   a known bundled-template node `id` whose current `label` is exactly one of
   that id's shipped-locale strings. A user rename, a `Foo 2` de-dup suffix, a
   user-made node, and every non-template label are unchanged. Label-only: no
   `simulationRev` / `loadRev` / `pristineSample` change, no undo entry; the
   undo/redo snapshots are re-seeded the same way so an undo cannot resurrect
   the previous language.
5. **Overlay is menu-only.** Import / Share / Workspace / autosave-restore never
   invoke it.
6. **Templates 1 / 2 / 3 unchanged.** Their graphs, behaviour, and digests are
   identical; a dictionary for them (if added) affects only a *future* non-EN
   fresh-open, never an EN one.
7. **Canonical immutable across opens.** No open ever mutates `TEMPLATES[i]` —
   not its `graph`, its `nodes` / `edges` / `position` / `data` (incl. edge
   `data`, `route`, `waypoints`), nor its `recommendedRunConfig` arrays. After
   a `ko` fresh-open — even after the user selects / drags / edits nodes and
   edges in that document — a subsequent `en` fresh-open of the same Template
   yields the **pristine English canonical** (all English labels, no runtime
   state, no Korean leakage), and a later `ko` fresh-open still yields the
   correct Korean (§TLO3).

---

## TLO7. CI drift check

A `checks`-stage script (`check:template-labels`, or folded into `check:i18n`).
The rule is **completeness-conditional**:

- **A (Template, locale) with no dictionary at all → OK.** The Template opens
  fully in English in that locale (full fallback). Templates 1 & 2 are here for
  now (§TLO2.1).
- **A (Template, locale) that *has* a dictionary → it must be complete:**
  - **missing** — every user-facing canonical node id of that Template has an
    entry, **or** is on an explicit *EN-fallback-intended* allow-list for that
    (Template, locale); otherwise **fail**;
  - **stale** — every dictionary key maps to a **current** canonical node id;
    a key for a node id that no longer exists (renamed / removed in the
    canonical) **fails**;
  - **duplicate** — the same node id keyed twice within one (Template, locale)
    dictionary **fails** (also caught by TS, asserted here too).
- **Annotation-only nodes** with no user-facing label are exempt **by rule**,
  listed explicitly, not skipped silently.

**§L4.5 lazy dicts — the `known` seed drift check.** The per-locale
dictionaries are lazy chunks (`templateLabels/dicts.ts` `DICT_LOADERS`), so the
"is this string official in *some* locale" classification the §TLO11 relabel
needs synchronously is frozen into `src/i18n/templateLabels/known.generated.ts`
by `scripts/gen-known-labels.mjs` (`npm run gen:known-labels`; the file is
GENERATED — never hand-edited). `check:template-labels` re-derives it in memory
(`gen-known-labels.mjs --check`) and **fails on any drift** — so registering a
new locale, or editing a template graph / a `<locale>.ts` dict, forces a regen.
The *target* string for the language being switched to still comes from that
language's (lazily-loaded) dictionary; only the classification data is frozen.

---

## TLO8. Tests

- **Per-locale fresh-open** (`en`, `ko`, a dev pseudo-locale): identical
  structure / edges / handles / positions / expressions / `resourceType` /
  `recommendedRunConfig`; only `label`s differ; `ko` labels equal the `ko`
  dictionary; an id missing from the dictionary shows the EN canonical label.
- **Deterministic run**: same engine result + Timeline series in `en` and `ko`.
- **No live re-translation**: open a Template, switch locale, assert every node
  `label` unchanged.
- **Overlay is menu-only**: under a non-EN locale, Import a graph / load a
  `#g1=` share / import a Workspace / restore from autosave → labels are exactly
  the file's, no overlay applied.
- **Round-trip**: fresh-open in `ko` → Export → re-Import under `en` → labels
  still Korean, structure identical.
- **EN parity golden**: an `en` fresh-open of every Template is byte-identical
  to the committed pre-feature baseline.
- **§TLO11 official-label locale switch:**
  - open a Template in `ko`, switch `ko → ja → en` → the official node labels
    follow each switch; a fresh EN open afterwards is still the canonical;
  - rename one node to a string of the user's own, then switch → that node keeps
    the user string, every other official node follows;
  - a user-made node and a `Foo 2` de-dup name never switch;
  - an **Imported** unmodified template graph (EN labels, no menu open) also
    switches on a later language change — the rule is provenance-agnostic, no
    session flag;
  - a non-template node id whose label happens to equal an official string
    (e.g. `sample-pool` = `"Gold"`) is **not** switched;
  - `simulationRev` / `loadRev` / `pristineSample` unchanged; a deterministic
    run is identical before and after the switch;
  - the undo/redo history is re-seeded — an undo after a switch restores the
    node in the **active** language, not the previous one;
  - Timeline legend / Summary / CSV header (they read `node.data.label` live)
    reflect the switched labels with no extra wiring;
  - boot: a stored `ja` preference against a `ko`-labelled autosaved template
    graph settles on `ja` immediately after boot;
  - re-selecting the active locale, or a same-locale boot, writes nothing (no
    extra `persist`).
- **Shared-id drift contract** (`check:template-labels`): a node id shared by
  two bundled templates must resolve to the **same** official label in every
  locale, or it can never be switched — CI fails on divergence.
- **Re-open isolation** (§TLO6-INV-7): fresh-open Template X in `ko`, **mutate
  the open document** — change a node `label` and `position`, select and drag a
  node, select an edge, change an edge's `data` — then fresh-open X again in
  `en` → the second document is the **pristine English canonical** (all English
  labels, no `selected` / `dragging` / `measured`, no moved positions, no edge
  edits); a third fresh-open in `ko` still yields the correct Korean.
- **No shared references** (unit): after a fresh-open, assert the document's
  `nodes` / `edges` arrays, each `node` / `node.data` / `node.position` /
  `edge` / `edge.data`, and the applied `recommendedRunConfig` (incl.
  `timelineSeries`) are **not `===`** to the corresponding `TEMPLATES[i]`
  object / array.
- **MMO KO fresh-open** (§TLO2.2): node/edge set / `position`s / `canvasLocked`
  / `recommendedRunConfig` / **`resourceType`** / deterministic run result
  identical to an EN fresh-open; every node `label` equals the value harvested
  from `mmo-progression.ko.json`; `resourceType` is **not** taken from that
  file.

---

## TLO9. Decisions (TLO-D)

| id | question | decision |
|---|---|---|
| **TLO-D1** | per-locale full JSON, or an overlay? | **Overlay** — one EN canonical graph + `nodeId → label` dicts. The `.ko.json` full-copy approach is retired for new Templates. |
| **TLO-D2** | when applied? | **Only** on a bundled-Template fresh-open from the menu, current locale only (§TLO3). |
| **TLO-D3** | after open? | A **user document** — `openTemplate` is never re-run. A UI-language change re-seeds the OFFICIAL bundled-template labels only (exact string match, no per-document flag — §TLO11); every user label / non-template label is left as written. |
| **TLO-D4** | translation scope | node `data.label` **only** (§TLO1). |
| **TLO-D5** | menu name / blurb | **unchanged** — app i18n catalog, separate from this overlay. |
| **TLO-D6** | missing / stale entries | EN fallback at runtime; **CI fails** on an un-allowlisted missing id or a stale key (§TLO7). |
| **TLO-D7** | GraphDoc / engine / format | **no change** — overlay acts on the in-memory copy handed to `loadGraph` (§TLO6). |
| **TLO-D8** | MMO (Template 3) | **adopts the overlay in the same impl PR** — its KO **`label`s** are harvested from `mmo-progression.ko.json` into `templateLabels/ko.ts`; **`resourceType` is not harvested**; the canonical MMO graph / layout / lock / `recommendedRunConfig` / `resourceType` are untouched; the `.ko.json` file was **removed after the harvest** (2026-09-07, §TLO2.2). |
| **TLO-D9** | which Templates get a KO dict in the first implementation? | **MMO + coffee.** Templates 1 & 2 (`equilibrium`, `deadlock`) went on the **EN-fallback allow-list** as an optional follow-up — **done 2026-09**: production-line reframe + extracted to `examples/*.json` + `ko` dict added; `EN_FALLBACK_TEMPLATES` is now empty (§TLO2.1). |
| **TLO-D10** | canonical mutation | **None.** `loadGraph` gets a **full structural deep clone of the whole `{ nodes, edges }` payload** — every node / `position` / `data`, every edge / `data` / `route` / `waypoints` — plus a fresh `recommendedRunConfig` (arrays not shared). No overlay, RF runtime state, or user edit can reach `TEMPLATES[i]`. Asserted by a re-open-isolation test **and** a no-shared-references unit test (§TLO3 / INV-7 / §TLO8). |

---

## TLO11. Official-template-label locale switch

**Rule.** When `activeLocale` changes, walk the open graph. A node's `label` is
replaced with the target locale's official label **iff**:

1. `node.id` is a **known bundled-template node id** (any of the four bundled
   templates), **and**
2. `node.data.label` is **exactly** (`===`, no trim / case-fold — these are
   canonical strings) **one of that id's official labels in some shipped
   locale**, the English canonical included.

The target label is that id's official label for the target locale (the English
canonical when the target locale has no dictionary entry for it). No match →
the node is left untouched. The precise preservation contract is **"preserve a
label that is not one of the official strings"** — so a user rename that happens
to land exactly on another locale's official label *is*, by this rule, switched;
that is an accepted, rare consequence of having no per-document provenance flag.

**No per-document state.** The mechanism keys only on `(node id, current label)`.
The "is this label official in *some* locale" set comes from the build-time
`known.generated.ts` seed (§TLO7, docs/localization.md §L4.5) — complete even
though the `templateLabels/<locale>.ts` dictionaries are now lazy chunks — so an
Imported / Shared unmodified template graph carrying a **never-visited** locale's
official labels still switches. Only the *target* string is read from the (by
then resident — the switch loads it first) dictionary. There is no "this doc
came from a menu open" flag.

A **registered locale whose dictionary somehow is not resident** at relabel time
is an invariant violation (`store.ts` loads it before flipping `activeLocale`):
`relabelNodesForLocale` then leaves every node untouched and logs — it never
rewrites to English, which would be a visible half-switch (UI in the new
language, nodes still English).

**What it does not touch.** `position`, edges, handles, expressions, `unit`,
`resourceType`, values, run state, selection, Timeline-series ids, frame
geometry / colour / selection, `recommendedRunConfig`. Node-`label`-only (frame
*titles* are §TLO12, same subscription). No undo entry, no `simulationRev` /
`loadRev` / `fitRev` / `pristineSample` change. The undo/redo snapshots (`past` /
`future`) are re-seeded the same way, so an undo across a switch cannot bring the
previous language back. A single `persist()` fires only when a label actually
changed; re-selecting the active locale and a same-locale boot write nothing.

**Where.** `src/i18n/templateLabels/relabel.ts` (the pure index + mapper) and a
`useI18n.subscribe` reaction at the bottom of `src/store/graphStore.ts`. The
reaction also covers the **boot** pass — `initI18n`'s `setState` runs it once
with the resolved locale (the graphStore module is evaluated before `initI18n`).

**A note on an open project.** A language switch that changes labels moves the
serialized bytes, so `projectStore`'s normal dirty tracking may flip an open
project to "unsaved" — this is honest (an Export would now differ) and is not
suppressed.

**Drift contract.** A node id shared by two bundled templates (today
`equilibrium` / `deadlock` share six) must resolve to the **same** official
label in every locale — otherwise the id is marked ambiguous and never
switched. `check:template-labels` fails on any divergence; a unit test asserts
the built index has an empty `ambiguous` set.

---

## TLO12. Group-frame title overlay

A bundled Template MAY ship group **frames** (`docs/large-graph-readability-saved-frames.md`
§SF2 — a labelled rectangle: `{ id, label, rect, color? }`). A frame `label` is
user-visible template copy, so it is localised on exactly the same two occasions
and by exactly the same rule as a node label:

1. **Fresh menu open** (`openTemplate`) — the deep-cloned frames take the active
   locale's title for each `frame.id` that has an entry; a frame with no entry
   keeps its EN canonical title. The canonical `TEMPLATES[i].graph.frames` is
   never mutated.
2. **Language switch** — the same `useI18n.subscribe` reaction re-seeds the
   OFFICIAL frame titles (exact `===` match against that id's official strings in
   some shipped locale), in the LIVE frame set **and** the frame sidecar of every
   `past` / `future` history entry. A user rename or the `""` default is left
   alone; an ambiguous shared id is never switched.

**Data.** Each `templateLabels/<locale>.ts` keeps its flat node map (`ko`) and
adds a flat sibling frame map (`koFrames`: `templateId → frameId → title`).
`dicts.ts` composes the consumer shape `{ nodes, frames }` from the one lazy
`import('./<locale>')` — the atomic catalog+dict load contract (docs/localization.md
§L4.5) is unchanged. `known.generated.ts` gains `KNOWN_OFFICIAL_FRAME_LABELS` /
`AMBIGUOUS_FRAME_IDS` (empty until a template ships frames).

**Three independent change axes.** The subscription judges `liveNodesChanged`,
`liveFramesChanged`, `historyChanged` (nodes OR the frame sidecar of any entry)
separately. A history-only diff still commits the new `past` / `future`; the one
autosave write fires only when something LIVE changed (autosave stores the live
doc). No undo entry, no `simulationRev` / `loadRev` / `fitRev` change, no
`recommendedRunConfig` touch. `frameStore.relabelTitles` rewrites `label` only —
`selectedId` / `toolArmed` / `nextN` / geometry / colour are untouched.

**Load path.** A Template's `frames` (already run through `readSavedFrames`, the
same §R5-1.1 normalisation Import uses — no raw cast) reach `frameStore` via a
new optional 4th arg to `graphStore.loadGraph`. `undefined` ⇒ the frame set is
cleared, byte-identical to the pre-#4A behaviour (a pasted graph never passes it).

**CI.** `check:template-labels` also enforces, per (template, dict-shipping
locale): a frame-less template has no (or an empty) frame dict; a template with
frames has a dict whose id set EQUALS the canonical frame-id set exactly (no
missing / stale / duplicate / empty). A canonical example's `frames` must also be
clean *as authored* (valid id / finite rect with `w,h > 0` / string label /
palette colour / no dup id / ≤ `SF_FRAMES_MAX`). A frame id shared across
templates whose official title diverges in any locale fails CI (the runtime EN
fallback in `relabelFramesForLocale` is defense-in-depth only).

---

## TLO10. Scope boundary

- A **fresh-open seeding** mechanism for **bundled** Templates / Examples /
  Building blocks — a general user opens them in their language, no setup. It
  is **not** a feature for a user to localize **their own** graph (that is a
  separate future product feature, §TLO1 Out), and **not** part of the module /
  template system (§PD8-B) — though that pass may build on it.
- Touches `src/` only: the dictionaries, the `doLoadTemplate` apply step, and
  the CI check. **No** engine, schema, wire, `loop-revision/N`, GraphDoc shape,
  or save-format change.
- Does not alter the base rule that a running locale switch never rewrites an
  existing document (§L3.4) — it only adds *what a Template seeds at open*.
