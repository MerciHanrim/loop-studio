# Shareable URL

```
Spec ID: loop-share/1
Status:  Draft
```

**Draft.** First pass for review. Open forks are marked **(DECIDE)** in §U3–U7
and collected in §U9. Once the decisions are settled this file flips to
`Status: Frozen` and, from then on, a behavioural change is a new spec id in a
new document (`loop-share/2`), exactly as with `loop-state/1 → loop-state/2` and
`loop-workspace/1`; a frozen file takes only typo / clarifying-prose fixes.

Defines *what a share link is*, *what it carries*, *how it is produced*, and
*how it is opened*.

Independent of, and layered on top of, the graph / engine / Monte-Carlo /
workspace specs. It never changes how a diagram *runs* or what a file *is* — it
adds a second **transport** for the graph document that a `Graph JSON` export
already writes. `SEMANTICS.md`, `SEMANTICS-B1.md`, `SEMANTICS-B2.md`,
`SEMANTICS-S.md`, `SEMANTICS-S2.md`, `SEMANTICS-W.md` are unaffected.

---

## U0. Scope

**Added**

- A **share link** — `https://<host>/#<prefix><payload>` whose URL **fragment**
  carries an encoded `loop-studio/graph` document.
- A **"Share link"** action that builds the link for the current diagram and
  copies it to the clipboard.
- **On load**, if the fragment carries a recognised share payload, the app
  decodes it, loads that graph defensively (the same path as `Import`), then
  **removes the payload from the address bar**.

**Out of scope for v1**

- Encoding a **Workspace** (`loop-workspace/1`) in a URL — a Monte-Carlo result
  and a sim snapshot are orders of magnitude too large for a link. A share link
  carries the **graph only** (see §U2). The Workspace *file* stays the way to
  move a run.
- Any server: link shortening, storage, upload, redirect. There is no backend.
- Private / authenticated / expiring links.
- Offline install (**PWA**) — separate track; see §U10.

**Unchanged**

- The graph half is produced by the **same `serialize()` path** as a `Graph
  JSON` export and read by the **same `deserialize()`** validation. Graph schema
  stays `loop-studio/graph` `version: 1`.
- `localStorage` still persists the working graph. A share link is a transport,
  not a store.

---

## U1. Link shape

```
https://cozy-loop-studio.pages.dev/#g1=<base64url( deflate?( utf8( graphJson ) ) )>
```

| part | rule |
|---|---|
| **fragment, not query** | the payload is in `location.hash`. Never `?...`. Two reasons: (a) a fragment is **not transmitted** to the origin server or any CDN / proxy / access log — the diagram stays between the people who have the link; (b) the project security rules forbid personal or document data in a query string. A `?`-based share link is a defect. |
| **key prefix** `g1=` | `g` = graph, `1` = payload format 1. Lets the loader tell a share payload from an in-app / router hash or a plain `#anchor`, and lets a later `g2=` / `w1=` coexist. An unknown prefix is ignored and the app boots normally. |
| **encode pipeline** | canonical graph JSON (the exact `serialize()` string) → UTF-8 bytes → **(DECIDE D2)** raw DEFLATE (RFC 1951) *or* no compression → **base64url** (`A–Za–z0–9-_`, no `=` padding, no `+` `/`). base64url so the link is copy-paste-safe with no percent-encoding. |
| **decode pipeline** | reverse: base64url-decode → inflate (if D2 = compression) → `JSON.parse` → `deserialize()`. Any failure at any stage ⇒ discard the payload, boot the normal graph, one console warning (§U5). |

**(DECIDE D2) — compression.** Raw graph JSON is bulky; a ~30-node diagram is
roughly 4–8 KB raw, ~2–4 KB base64url. DEFLATE typically cuts that ~2–3×, so it
is the difference between "most real diagrams fit a link" and "only small ones
do". Cost: a **bundled pure-JS DEFLATE/INFLATE** is needed so the portable
`file://` build and browsers without `CompressionStream` can still encode /
decode — the same self-contained-fallback principle already accepted for
SHA-256 in `loop-workspace/1` §W12. Recommendation: **adopt compression**;
`CompressionStream('deflate-raw')` / `DecompressionStream` when present, the
bundled fallback otherwise. The simpler alternative (base64url of raw JSON, no
dependency, smaller shareable ceiling, compression deferred to `loop-share/2`)
is viable if the fallback burden is judged not worth it.

**(DECIDE D7) — checksum.** A damaged fragment currently surfaces as an inflate
/ parse / validate failure (all handled → boot normal graph + warning). A
4-byte CRC-32 prefix would let the loader say "this was a share link and it is
damaged" rather than "unrecognised fragment". Recommendation: **no checksum for
v1** — the decode failure path already exists and a link is not an authenticity
claim.

---

## U2. What the link carries

| carried | source | note |
|---|---|---|
| the whole `GraphDoc` — `nodes`, `edges`, `recommendedRunConfig` | `serialize()` | byte-identical to a `Graph JSON` export |
| **(DECIDE D4)** `view.timeline` + `canvas` `{x,y,zoom}` | `mcStore.view` / React Flow `getViewport()` | tiny (~40 bytes). Lets a link frame the diagram on open. Recommendation: **graph only for v1**; canvas framing is a small nice-to-have that fits `loop-share/2` cleanly. |

**Not carried** (same rationale as `loop-workspace/1` §W2 — a link is a
*document*, not a session): MC `config` beyond `recommendedRunConfig`, MC
`result`, the sim snapshot / `seed`, `distributionPoolId`, `showMean`, undo
history, selection, dialog / focus state, **theme, language**, any user-global
preference.

---

## U3. Size limit — measured, all-or-nothing, no truncation

The fragment is never sent to a server, so CDN request-line caps do not apply.
The real constraints are (a) address-bar and clipboard sanity, and (b) chat /
mail / doc tools that truncate or mangle very long links. So the limit is a
product choice, not a protocol one.

`SHARE_MAX_BYTES` — **(DECIDE D3)** — a hard cap on the **encoded fragment
payload** (after compression + base64url), measured (not estimated) as byte
length. Proposed **8 KiB** (≈ a few hundred nodes with compression). Larger
values (16 / 32 KiB) let more diagrams share but break more often in the wild.

**Processing on "Share link":**

1. Serialize the current graph, run the encode pipeline, measure the fragment
   byte length.
2. **≤ cap** → build the full link, copy it, confirm ("Link copied — *N*
   characters. Anyone with the link can open **and edit** this diagram.").
3. **> cap** → **hard reject**, no truncation (same principle as
   `loop-workspace/1` §W6): "This diagram is too large for a share link (*N* KB;
   limit *8* KB). Use **Export ▾ → Graph JSON** and share the file." Zero links
   produced.

There is nothing to progressively drop (a link has no MC result), so the flow
is encode-once / compare / all-or-nothing — no double-measure.

---

## U4. Sensitive information

- **The fragment never leaves the browser.** By construction it lives in
  `location.hash`; it is not in any request to Cloudflare, to analytics, or to
  any third party. This is the entire reason for fragment-not-query (§U1).
- **A share link embeds the whole diagram**, including every node / edge
  **`label`** and any text the user typed into a field. The Share action must
  say so, plainly, once, **before** it copies: *"The link contains this entire
  diagram, including all labels. Anyone you send it to can open and edit it."*
  No silent share.
- **The app adds nothing of its own** — no user id, no email, no timestamp, no
  device or build info. The payload is exactly the `serialize()` output.
- The app **never auto-generates and never auto-opens** a share link; both
  directions are explicit user actions.
- **On open, the payload is stripped from the address bar immediately**
  (`history.replaceState`, §U5.5) so it does not sit in screenshots, screen
  shares, or the browser history longer than the moment of navigation, and a
  reload does not silently re-import.
- The payload is never placed in a query string, a `POST` body, or anything
  that reaches a server.

---

## U5. Opening a link — load safety

1. **On boot, read `location.hash`.** If it does not start with a known share
   prefix (`g1=`) → normal boot (the `localStorage` graph, or the sample). A
   plain `#anchor` or a future router hash is left untouched.
2. **Recognised prefix** → base64url-decode → inflate (if D2) → `JSON.parse` →
   `deserialize()` (the existing defensive validation). **Any failure at any
   stage ⇒ discard the payload, boot the normal graph, one console warning**
   ("a share link was present but could not be read"). A bad link never blocks
   the app.
3. **Success** → load through `graphStore.loadDoc` — the **one** `simulationRev`
   bump — so the sim resets to step 0 and Monte-Carlo goes idle, exactly as a
   `Graph JSON` import; then `applyRecommended(recommendedRunConfig)` and
   `fitView()` (or restore `canvas` if D4 carries it).
4. **Always paused / idle. Nothing auto-runs**, no timer starts — the same
   invariant as Graph Import and `loop-workspace/1` §W2.1.
5. **Strip the fragment** —
   `history.replaceState(null, '', location.pathname + location.search)` — so
   the address bar is clean and a reload starts from the now-loaded (and
   `localStorage`-persisted) graph, not from a re-decode.
6. **(DECIDE D5) — precedence vs. the working graph.** A share link takes
   precedence over the `localStorage` working graph *for that load* (the user
   clicked the link to see *that* diagram). Because `loadDoc` persists, the
   shared graph then **replaces** the working graph. There is no cross-load
   undo. Options:
   - **(recommended)** confirm first *unless the current graph is the pristine
     sample* — "Open the shared diagram? Your current diagram will be replaced.
     Export it first if you want to keep it." — Cancel keeps the local graph and
     still strips the fragment;
   - replace silently and rely on the user being able to re-open their own graph
     from a prior export.

---

## U6. Compatibility

| reader | link | result |
|---|---|---|
| build **without** share support | share link | fragment ignored; app boots normally (`localStorage` / sample) |
| build **with** `loop-share/1` | plain URL, no fragment | normal boot |
| build with `loop-share/1` | fragment, **unknown** prefix (`g2=`, `w1=`, a router hash, `#anchor`) | ignored; normal boot. For a `gN=` it does not know, a one-line console note ("this link was made with a newer version of Loop Studio"). |
| any build | `g1=` fragment that fails to decode / validate | normal boot + console warning |

- The **graph wire format is unchanged** (`loop-studio/graph` `version: 1`). A
  link is only a transport for the same bytes a `Graph JSON` export writes: a
  link made by this build decodes to a file any build can open, and a `Graph
  JSON` file's contents can be pasted into a link by hand.
- **Interaction with `loop-workspace/1`:** none. A link never carries a
  `workspace` key. Sharing a workspace over a URL, if ever wanted, is a new
  `w1=` prefix under a new spec id — not this document.
- **Portable `file://` build:** a share link targets an `https://` host, so
  *opening* one needs the hosted app. But the **encoder** (the Share action)
  must still work in the portable build — base64url and, if D2, the bundled
  DEFLATE fallback, mirroring the SHA-256 fallback in `loop-workspace/1` §W12.
  Round-trip is tested as *encode on `file://`* → *decode on `https://`*.

---

## U7. UI

- **(DECIDE D8)** A **"Share link"** control in the toolbar, grouped with
  `Import` / `Export ▾`. Options: its own button, or a third item under a
  renamed **"Share ▾"** that also holds Graph / Workspace JSON. Recommendation:
  **a standalone "Share link" button** — Export ▾ keeps its meaning ("write a
  file"), Share is a different verb ("make a link").
- Click → the §U4 disclosure + the §U3 size check → on confirm, build the link,
  `navigator.clipboard.writeText`, toast "Link copied". If the clipboard API is
  unavailable, present the link in a read-only, pre-selected text field.
- **No dialog on _load_** unless D5 resolves to "confirm".

---

## U8. Invariants

| # | invariant |
|---|---|
| **U1** | The payload is always in the URL **fragment** — never a query string, a request body, or anything that reaches a server. |
| **U2** | A share link carries the **graph document only** (optionally a small view / canvas hint); never an MC result, a sim snapshot, a seed, or a user-global preference. |
| **U3** | Opening a link never starts a run and never starts a timer; afterwards the live sim is `idle` at step 0 and Monte-Carlo is `idle` — identical to a `Graph JSON` import. |
| **U4** | A malformed, oversized, or unknown-prefix fragment can never prevent the app from booting. |
| **U5** | Link size is all-or-nothing: the whole graph encodes under `SHARE_MAX_BYTES`, or the Share action is refused with a pointer to `Graph JSON`. The graph is never truncated to fit. |
| **U6** | After a link loads, its payload is removed from the address bar; a reload does not re-import it. |
| **U7** | The share wire format is the same `loop-studio/graph` `version: 1` a `Graph JSON` export writes; a graph round-tripped through a link equals the same graph round-tripped through a file. |
| **U8** | Producing a link and opening a link are both explicit user actions; the app never auto-shares and never auto-imports a link without (per D5) consent. |

---

## U9. Decisions — to resolve before freeze

| # | decision | recommendation |
|---|---|---|
| **D1** | Payload in the URL **fragment**, never a query string. | firm |
| **D2** | Encode = base64url of **DEFLATE**'d `serialize()` output, with a bundled pure-JS inflate/deflate fallback for `file://` / no-`CompressionStream`. | **adopt compression**; simpler raw-base64url is the fallback position |
| **D3** | `SHARE_MAX_BYTES` on the encoded fragment; over ⇒ hard reject, no truncation. | **8 KiB** (vs 16 / 32) |
| **D4** | Link carries **graph only**, or graph + `view.timeline` + `canvas`. | **graph only** for v1; canvas hint → `loop-share/2` |
| **D5** | On load, **confirm before replacing** a non-sample working graph, or replace silently. | **confirm unless the current graph is the pristine sample**; Cancel still strips the fragment |
| **D6** | After a link loads, strip the fragment via `history.replaceState`. | firm |
| **D7** | No integrity checksum (rely on decode / parse / validate failure) vs. a 4-byte CRC-32 prefix for a cleaner "damaged link" message. | **no checksum** for v1 |
| **D8** | Share control: standalone **"Share link"** button vs. fold into a **"Share ▾"** menu with Graph / Workspace JSON. | **standalone button** |
| **D9** | Spec id `loop-share/1`, its own frozen doc; later behavioural change ⇒ `loop-share/2`. | firm |
| **D10** | PWA (§U10): a §U10 appendix here, or a separate `docs/pwa.md` note with no frozen-spec status. | **separate note** — PWA has no wire / semantic surface |

---

## U10. PWA — note (not a frozen spec surface)

The offline-install track (roadmap step 3) has **no wire format and no
observable semantics**: it is a `manifest.webmanifest` plus a service worker
that precaches the **built app shell** (the Vite build's static assets) so an
installed or offline user runs the same static app. It changes nothing in this
document, in the graph / engine specs, or in `loop-workspace/1`.

Points to pin when it is implemented (in the PR, or a plain `docs/pwa.md` — not
as a `loop-*/N` frozen spec):

- **Precache scope** — app shell and build assets only. **Not** cached: the
  `localStorage` graph (already persistent and per-origin), any share-link
  fragment (transient), Google Fonts if used (let the browser HTTP-cache them).
- **Update strategy** — new build detected ⇒ **prompt to reload** rather than
  `skipWaiting()` mid-session, so an open diagram is never swapped under the
  user.
- **Offline scope** — the app runs fully offline (it is client-only); *opening a
  share link* still needs the network the first time to fetch the shell if it is
  not yet cached.
- **Portable build** — the `file://` single-file build neither needs nor
  registers a service worker.

---

## U11. Constants to pin on freeze

| name | value | note |
|---|---|---|
| `SHARE_SCHEMA` prefix | `"g1="` | fragment key; `g` = graph, `1` = payload format |
| `SHARE_MAX_BYTES` | **(DECIDE D3)** — proposed `8 * 1024` (8 KiB) | hard cap on the encoded fragment, measured not estimated |
| graph schema | `loop-studio/graph` `version: 1` | unchanged; the link is only a transport |
| compression | **(DECIDE D2)** — raw DEFLATE (RFC 1951), `deflate-raw` | with a bundled pure-JS fallback |

---

## U12. Acceptance vectors (test basis — filled on implementation)

1. **Fragment, not query** — a produced link has its payload after `#`; there is
   no `?` form; navigating the link issues no network request carrying the
   payload.
2. **Round-trip** — build a graph (mix of node kinds, resource + state edges, a
   `recommendedRunConfig`), Share, open the link in a fresh session ⇒ `nodes` /
   `edges` / `recommendedRunConfig` deep-equal the source; sim `idle` at step 0;
   nothing auto-ran; no timer.
3. **Link ≡ file** — the graph from a link deep-equals the graph from a `Graph
   JSON` export of the same diagram.
4. **Over cap ⇒ hard reject** — a graph whose encoded fragment exceeds
   `SHARE_MAX_BYTES` ⇒ Share produces **zero** links and shows the pointer to
   `Graph JSON`; nothing is copied.
5. **Malformed fragment ⇒ app still boots** — `#g1=` followed by garbage / a
   truncated payload / valid base64url of non-JSON ⇒ the app boots the normal
   graph with a console warning; no exception escapes.
6. **Unknown prefix ⇒ ignored** — `#g2=…`, `#w1=…`, `#/route`, `#section` ⇒
   normal boot, working graph untouched.
7. **Fragment stripped on load** — after a link opens, `location.hash` is empty;
   a reload loads the persisted graph, not a re-decode.
8. **Precedence (D5)** — with a modified working graph, opening a link prompts;
   Cancel keeps the local graph **and** strips the fragment; OK replaces it.
   With the pristine sample, no prompt.
9. **No PII added** — decode a produced link and diff against a `Graph JSON`
   export: identical; no id / email / timestamp / build field is present.
10. **`file://` encode → `https://` decode** — a link produced by the portable
    single-file build (base64url + the DEFLATE fallback if D2) opens correctly
    in the hosted build.
11. **Compression fallback parity (if D2)** — the pure-JS DEFLATE path and
    `CompressionStream` produce fragments that both decode to the identical
    graph (they need not be byte-identical); tested against standard RFC 1951
    vectors.
12. **Old build** — a share link opened by a share-unaware build (simulate by
    disabling the loader) boots normally and ignores the fragment.
