# Shareable URL

```
Spec ID: loop-share/1
Status:  Frozen
```

**Frozen** (2026-08-29). This document is the fixed target for the
implementation. A behavioural change after this is a new spec id in a new
document (`loop-share/2`), exactly as with `loop-state/1 → loop-state/2` and
`loop-workspace/1`; this file only takes typo / clarifying-prose fixes.

Defines *what a share link is*, *what it carries*, *how it is produced*, and
*how it is opened*.

Independent of, and layered on top of, the graph / engine / Monte-Carlo /
workspace specs. It never changes how a diagram *runs* or what a file *is* — it
adds a second **transport** for the same graph document a `Graph JSON` export
already writes. `SEMANTICS.md`, `SEMANTICS-B1.md`, `SEMANTICS-B2.md`,
`SEMANTICS-S.md`, `SEMANTICS-S2.md`, `SEMANTICS-W.md` are unaffected.

---

## U0. Scope

**Added**

- A **share link** — `https://<host>/#<prefix><payload>` whose URL **fragment**
  carries an encoded `loop-studio/graph` document.
- A standalone **`Share`** action that builds the link for the current diagram
  and copies it to the clipboard.
- **On load**, if the fragment carries a recognised share payload, the app
  decodes and *fully validates* it, then — after a replace confirmation unless
  this is the pristine first-boot sample (§U5.6) — loads that graph through the
  same `loadDoc` path as `Import`, and removes the payload from the address bar.

**Out of scope for v1**

- Encoding a **Workspace** (`loop-workspace/1`) in a URL — a Monte-Carlo result
  and a sim snapshot are orders of magnitude too large for a link. A share link
  carries the **`GraphDoc` only** (§U2). The Workspace *file* stays the way to
  move a run.
- Any server: link shortening, storage, upload, redirect. There is no backend.
- Private / authenticated / expiring links.
- Carrying view / canvas framing (deferred to `loop-share/2`).
- Offline install (**PWA**) — separate, non-frozen track; see [`docs/pwa.md`](docs/pwa.md).

**Unchanged**

- The graph is produced by the **same `serialize()` path** as a `Graph JSON`
  export and read by the **same `deserialize()`** validation. Graph schema
  stays `loop-studio/graph` `version: 1`.
- `localStorage` still persists the working graph. A share link is a transport,
  not a store.

---

## U1. Link shape

```
https://cozy-loop-studio.pages.dev/#g1=<base64url( zlibDeflate( utf8( graphJson ) ) )>
```

### U1.1 Fragment, not query

The payload is in `location.hash`. **Never** `?...`. Two reasons: (a) a fragment
is **not transmitted** to the origin server or any CDN / proxy / access log —
the diagram stays between the people who have the link (see §U4 for what a
fragment *is* still exposed to); (b) the project security rules forbid personal
or document data in a query string. A `?`-based share link is a defect.

### U1.2 Key prefix

`g1=` — `g` = graph, `1` = payload format 1. The loader uses it to tell a share
payload from an in-app / router hash or a plain `#anchor`, and it lets a later
`g2=` / `w1=` coexist. An unknown prefix is ignored and the app boots normally
(§U6).

### U1.3 Compression — zlib-wrapped DEFLATE

The compressed layer is **zlib-wrapped DEFLATE (RFC 1950)** — a 2-byte zlib
header and a trailing Adler-32 checksum around an RFC 1951 DEFLATE stream —
**not** raw DEFLATE (RFC 1951). Implementations:

- **`CompressionStream('deflate')` / `DecompressionStream('deflate')`** when the
  context exposes them (these emit / accept the zlib wrapper by definition;
  `'deflate-raw'` must **not** be used).
- A **bundled pure-JS zlib inflate *and* deflate** for the portable `file://`
  build and any browser without Compression Streams — the same self-contained
  fallback principle already accepted for SHA-256 in `loop-workspace/1` §W12.
  The fallback covers **both directions**: a portable build must be able to
  *produce* a link and to *open* one.

Different compressor implementations (native vs. fallback, different levels) may
emit **different bytes** for the same graph. That is valid as long as every
conformant decoder can inflate every conformant encoder's output. **There is no
requirement that the same graph yields the same URL string**, and callers must
not assume link stability across builds or sessions. Interop is mandatory:
a link made under `https://` must open under `file://` and vice-versa (§U12.10).

### U1.4 base64url — exact alphabet, strict decode

The inflate input / deflate output bytes are carried as **base64url**:

- encode: standard base64, then `+` → `-`, `/` → `_`, and **all `=` padding
  removed**.
- decode: **strict**. Only `A–Z a–z 0–9 - _` are accepted. Any other character
  — including `+`, `/`, whitespace, or an `=` padding character — makes the
  payload **invalid**: it is rejected before inflate, the existing graph is left
  untouched, and the load fails per §U5.2.

### U1.5 Decode pipeline

`#g1=` payload → strict base64url-decode (§U1.4) → zlib-inflate (§U1.3), **with
the inflated size bounded by `SHARE_MAX_DECODED_BYTES` — §U3.2**) → `JSON.parse`
→ `deserialize()` (the existing defensive validation). **Every stage must
succeed** before the app touches its current state (§U5.2, §U5.5).

---

## U2. What the link carries

| carried | source | note |
|---|---|---|
| the whole `GraphDoc` — `nodes`, `edges`, `recommendedRunConfig` | `serialize()` | byte-identical to a `Graph JSON` export |

**Nothing else.** Not MC `config` beyond `recommendedRunConfig`, not the MC
`result`, not the sim snapshot / `seed`, not `distributionPoolId` / `showMean`,
not `view.timeline`, not the canvas viewport, not undo history, selection,
dialog / focus state, **theme, language**, or any user-global preference. Same
rationale as `loop-workspace/1` §W2 — a link is a *document*, not a session.
View / canvas framing is a `loop-share/2` question.

---

## U3. Size limits — measured, all-or-nothing, no truncation

### U3.1 Outbound cap — `SHARE_MAX_BYTES`

The fragment is never sent to a server, so CDN request-line caps do not apply.
The real constraints are address-bar / clipboard sanity and chat / mail / doc
tools that truncate or mangle long links. So the cap is a product choice.

`SHARE_MAX_BYTES = 8 * 1024` (**8 KiB**) — a hard cap on the **encoded fragment
payload**, i.e. the **ASCII byte length of the base64url string that follows
`#g1=`**. Not the whole-URL length; not the pre-compression JSON size.
base64url is ASCII, so byte length equals character count.

**Processing on `Share`:**

1. `serialize()` the current graph, run the encode pipeline, measure the length
   of the base64url payload.
2. **≤ `SHARE_MAX_BYTES`** → build the full link, copy it, confirm ("Link copied
   — *N* characters. Anyone with the link can open **and edit** this diagram.").
3. **> `SHARE_MAX_BYTES`** → **hard reject**, no truncation (same principle as
   `loop-workspace/1` §W6): "This diagram is too large for a share link (*N* KB;
   limit 8 KB). Use **Export ▾ → Graph JSON** and share the file." Zero links
   produced, nothing copied.

There is nothing to progressively drop (a link has no MC result), so the flow is
encode-once / compare / all-or-nothing — no double-measure.

### U3.2 Inbound cap — `SHARE_MAX_DECODED_BYTES` (decompression-bomb guard)

A small base64url payload can inflate to an enormous JSON string. The decoder
**must bound the inflate output**:

`SHARE_MAX_DECODED_BYTES = 1024 * 1024` (**1 MiB**) — the maximum permitted
length of the inflated UTF-8 bytes.

Enforcement is **incremental**: inflation stops and the payload is rejected as
soon as the running output length would exceed the cap — the full output is
**never** materialised first. On breach the loader **aborts before `JSON.parse`**
and reports the link as damaged / unsupported (§U5.2); the current graph is not
touched.

1 MiB is far above any graph that also fits `SHARE_MAX_BYTES` after compression,
so a legitimate link is never near this bound.

---

## U4. Sensitive information

- **The fragment never reaches a server.** By construction it lives in
  `location.hash`; it is not in any request to Cloudflare, to analytics, or to
  any third party. This is the entire reason for fragment-not-query (§U1.1).
- **A fragment is still exposed** to the browser's **history**, to profile /
  account **sync** if the user has it on, to the **clipboard**, and — the whole
  point — to **whoever receives the link**. The `Share` UI shows a short line to
  this effect (§U7) alongside the §U4 disclosure below.
- **A share link embeds the entire diagram**, including every node / edge
  **`label`** and any text typed into a field. The `Share` action states this,
  once, **before** it copies: *"The link contains this entire diagram, including
  all labels. Anyone you send it to can open and edit it."* No silent share.
- **The app adds nothing of its own** — no user id, no email, no timestamp, no
  device or build field. The payload is exactly the `serialize()` output
  (§U12.9).
- The app **never auto-generates and never auto-opens** a share link; both
  directions are explicit user actions (with, on open, the §U5.6 confirmation).
- **On open the payload is stripped from the address bar immediately** (§U5.5)
  so it does not linger in screenshots, screen shares, or history beyond the
  moment of navigation, and a reload does not silently re-import.
- The payload is never placed in a query string, a request body, or anything
  that reaches a server.

---

## U5. Opening a link — load safety

### U5.1 Recognition

On boot, read `location.hash`. If it does not start with a known share prefix
(`g1=`) → normal boot (the `localStorage` graph, or the first-boot sample). A
plain `#anchor` or a future router hash is left untouched, and no fragment strip
happens.

### U5.2 Validate fully before touching state

For a recognised prefix, run the full §U1.5 pipeline **to completion**:

1. strict base64url-decode (§U1.4),
2. zlib-inflate bounded by `SHARE_MAX_DECODED_BYTES` (§U3.2),
3. `JSON.parse`,
4. `deserialize()`.

**If any stage fails**, the load is abandoned: the **current graph, sim, and MC
state are left exactly as they were**, one console warning is emitted ("a share
link was present but could not be read"), and the fragment is stripped anyway
(§U5.5) so a reload does not repeat the error. A damaged link **never mutates
the existing graph** — the confirm dialog and `loadDoc` (§U5.6–U5.7) are reached
**only** after all four stages succeed.

### U5.3 No auto-run

A link load never starts a run and never starts a timer. Afterwards the live
sim is `idle` at step 0 and Monte-Carlo is `idle` — identical to a `Graph JSON`
import and to `loop-workspace/1` §W2.1.

### U5.4 Stop any active run first

If a live run or its timer is active when a valid link is being applied, it is
**stopped safely first** (as `reset()` / `loadDoc` already do on a graph
replace), then the graph is swapped. No step executes against a half-swapped
graph.

### U5.5 Strip the fragment — every outcome, path + query preserved

On **success, failure, *and* cancel**, the fragment is removed with
`history.replaceState(history.state, '', location.pathname + location.search)` —
**only the `#…` part is removed; `pathname` and `search` are preserved**, and
the history entry is replaced, not pushed. After a successful load the address
bar therefore shows the bare app URL and a reload restores the now-persisted
graph, not a re-decode.

### U5.6 Replace confirmation — pristine-sample session flag

Whether opening a link prompts before replacing the working graph is decided by
a **session flag that records the boot origin**, **not** by comparing graph
contents:

- The flag is "pristine sample" **only** when this session booted the built-in
  first-run sample with no `localStorage` graph present, **and nothing has
  changed it since**.
- **Any** of: an edit (node/edge add, connect, data change, delete, move-commit),
  an `Import`, applying a `Template`, an `undo` / `redo`, or a prior link /
  workspace restore — **clears the flag permanently for the session**. Manually
  re-creating the sample's shape does **not** restore it.

Behaviour:

- **flag set (pristine sample)** → apply the link with **no prompt**.
- **flag clear** → prompt: *"Open the shared diagram? Your current diagram will
  be replaced. Export it first if you want to keep it."*
  - **Cancel** → keep the current graph unchanged; still strip the fragment
    (§U5.5). No `simulationRev` bump.
  - **OK** → proceed to §U5.7.

### U5.7 Apply

`graphStore.loadDoc({ nodes, edges })` — this is the **one and only**
`simulationRev` bump of the whole load (sim resets to step 0, MC goes idle,
exactly as a `Graph JSON` import) — then `applyRecommended(recommendedRunConfig)`
and `fitView()`. `loadDoc` persists, so the shared graph becomes the working
graph. The restore is deterministic: the same link always yields the same state.

---

## U6. Compatibility

| reader | link | result |
|---|---|---|
| build **without** share support | share link | fragment ignored; app boots normally (`localStorage` / sample); fragment left as-is |
| build **with** `loop-share/1` | plain URL, no fragment | normal boot |
| build with `loop-share/1` | fragment, **unknown** prefix (`g2=`, `w1=`, a router hash, `#anchor`) | ignored; normal boot; working graph untouched. For a `gN=` it does not know, a one-line console note ("this link was made with a newer version of Loop Studio"). |
| build with `loop-share/1` | `g1=` fragment that fails any of base64url / inflate / size / parse / `deserialize` | normal boot + console warning; **current graph untouched**; fragment stripped |
| `https://` build ↔ portable `file://` build | either one's `g1=` link | **must** decode in the other (zlib interop + fallback inflate) |

- The **graph wire format is unchanged** (`loop-studio/graph` `version: 1`). A
  link is only a transport for the same bytes a `Graph JSON` export writes: a
  link made by this build decodes to a file any build can open, and a `Graph
  JSON` file's contents can be pasted into a link by hand.
- **Interaction with `loop-workspace/1`:** none. A link never carries a
  `workspace` key. Sharing a workspace over a URL, if ever wanted, is a new
  `w1=` prefix under a new spec id — not this document.
- **Portable `file://` build:** a share link targets an `https://` host, so
  *opening* one needs the hosted app. The **encoder and decoder both** work in
  the portable build via base64url and the bundled zlib fallback (§U1.3).

---

## U7. UI

- A standalone **`Share`** button in the toolbar, next to `Import` / `Export ▾`.
  `Export ▾` keeps its meaning ("write a file"); `Share` is a different verb
  ("make a link") and stays a single click, not a menu.
- Click → a short combined disclosure: *what the link contains* ("this entire
  diagram, including all labels; anyone with the link can open and edit it") and
  *where a link can travel* ("the diagram data is in the link itself — it is not
  uploaded to a server, but it will be in your browser history and visible to
  anyone you send it to") → then the §U3.1 size check.
  - within cap → build link, `navigator.clipboard.writeText`, toast "Link
    copied". Clipboard API unavailable → show the link in a read-only,
    pre-selected text field.
  - over cap → the §U3.1 hard-reject message; nothing copied.
- **No dialog on _load_** except the §U5.6 replace confirmation (skipped for the
  pristine sample).
- The Monte-Carlo `Export ▾` inside the Distribution panel is unrelated and
  unchanged.

---

## U8. Invariants

| # | invariant |
|---|---|
| **U1** | The payload is always in the URL **fragment** — never a query string, a request body, or anything that reaches a server. |
| **U2** | A share link carries the **`GraphDoc` only** — `nodes`, `edges`, `recommendedRunConfig`. Never an MC result, a sim snapshot, a seed, a view / canvas hint, or a user-global preference. |
| **U3** | Opening a link never starts a run or a timer; afterwards the live sim is `idle` at step 0 and Monte-Carlo is `idle` — identical to a `Graph JSON` import. |
| **U4** | A malformed, oversized (outbound **or** decoded), or unknown-prefix fragment can never prevent the app from booting and never mutates the current graph. Validation (base64url → inflate → size → parse → `deserialize`) fully succeeds *before* any confirm or `loadDoc`. |
| **U5** | Outbound size is all-or-nothing on the base64url payload after `#g1=`: it fits `SHARE_MAX_BYTES` or `Share` is refused with a pointer to `Graph JSON`. The graph is never truncated to fit. Inbound, inflate is bounded incrementally by `SHARE_MAX_DECODED_BYTES` and aborts before parse on breach. |
| **U6** | Every load outcome — success, failure, cancel — strips **only** the fragment via `history.replaceState`, preserving `pathname` + `search`; a reload never re-imports. |
| **U7** | The share wire format is the same `loop-studio/graph` `version: 1` a `Graph JSON` export writes; a graph round-tripped through a link equals the same graph round-tripped through a file. `g1` is **zlib-wrapped DEFLATE**; any conformant decoder inflates any conformant encoder's output; identical bytes / identical URL strings are **not** guaranteed. |
| **U8** | A successful link load bumps `simulationRev` **exactly once** (the `loadDoc` call); cancel and failure bump it zero times. Any active run is stopped safely before the swap. |
| **U9** | Producing a link and opening a link are both explicit user actions; the app never auto-shares, and never applies a link without the §U5.6 confirmation unless the session is the pristine first-boot sample. |

---

## U9. Decisions — resolved

| # | decision |
|---|---|
| **D1** | Payload in the URL **fragment**, never a query string. |
| **D2** | Encode = base64url of **zlib-wrapped DEFLATE (RFC 1950)** of the `serialize()` output. `CompressionStream('deflate')` when available; a bundled pure-JS zlib **inflate + deflate** fallback otherwise (portable `file://` and no-Compression-Streams). `deflate-raw` is not used. Cross-implementation byte differences are allowed; mutual decodability and `https ↔ file://` interop are required; URL-string stability is **not** promised. |
| **D3** | `SHARE_MAX_BYTES = 8 * 1024` — hard cap on the **base64url payload byte length after `#g1=`** (not whole-URL, not pre-compression). Over ⇒ hard reject, no truncation. |
| **D3b** | `SHARE_MAX_DECODED_BYTES = 1024 * 1024` — decompression-bomb guard on the inflated bytes, enforced **incrementally**, aborting **before** `JSON.parse`. |
| **D4** | A link carries the **`GraphDoc` only**. `view` / `canvas` framing is deferred to `loop-share/2`. |
| **D5** | On load, prompt before replacing the working graph **unless** a session flag says this is the pristine first-boot sample. The flag is set only by that boot origin and cleared permanently by any edit / `Import` / `Template` / `undo` / `redo` / prior restore — never by graph-content comparison. **Cancel still strips the fragment.** |
| **D6** | After any load outcome, strip **only** the fragment via `history.replaceState`, preserving `pathname` + `search`. |
| **D7** | **No integrity checksum.** A damaged fragment surfaces through the decode / inflate / size / parse / `deserialize` failure path (zlib's own Adler-32 already catches bit-rot inside the compressed stream). |
| **D8** | A standalone **`Share`** button, not a `Share ▾` menu. |
| **D9** | Spec id `loop-share/1`, its own frozen doc; a later behavioural change ⇒ `loop-share/2`. |
| **D10** | **PWA** is documented in a separate, **non-frozen** [`docs/pwa.md`](docs/pwa.md) — it has no wire format and no observable semantics. |
| **D11** | A successful load causes **exactly one** `simulationRev` bump; any active run is stopped safely first; a corrupt link causes **zero** state change. |

---

## U10. PWA

Moved to [`docs/pwa.md`](docs/pwa.md) (non-frozen). It changes nothing in this
document, the graph / engine specs, or `loop-workspace/1`.

---

## U11. Constants to pin on freeze

| name | value | note |
|---|---|---|
| share prefix | `"g1="` | fragment key; `g` = graph, `1` = payload format |
| `SHARE_MAX_BYTES` | `8 * 1024` (8 KiB) | hard cap on the base64url payload byte length **after `#g1=`** |
| `SHARE_MAX_DECODED_BYTES` | `1024 * 1024` (1 MiB) | incremental cap on inflated bytes; abort before `JSON.parse` |
| compression | **zlib-wrapped DEFLATE (RFC 1950)** | `CompressionStream('deflate')` or the bundled pure-JS zlib fallback (inflate **and** deflate); never `deflate-raw` |
| base64url alphabet | `A–Za–z0–9-_`, no `=` padding | strict decode: any other char (incl. `+` `/` whitespace `=`) ⇒ invalid |
| graph schema | `loop-studio/graph` `version: 1` | unchanged; the link is only a transport |

---

## U12. Acceptance vectors (test basis — filled on implementation)

1. **Fragment, not query** — a produced link has its payload after `#`; there is
   no `?` form; navigating the link issues no network request that carries the
   payload.
2. **Round-trip** — build a graph (mixed node kinds, resource + state edges, a
   `recommendedRunConfig`), `Share`, open the link in a fresh session ⇒ `nodes`
   / `edges` / `recommendedRunConfig` deep-equal the source; sim `idle` at step
   0; nothing auto-ran; no timer.
3. **Link ≡ file** — the graph from a link deep-equals the graph from a `Graph
   JSON` export of the same diagram.
4. **Over outbound cap ⇒ hard reject** — a graph whose base64url payload exceeds
   `SHARE_MAX_BYTES` ⇒ `Share` produces **zero** links and shows the pointer to
   `Graph JSON`; nothing is copied. Cap is measured on the substring after
   `#g1=`, not the whole URL.
5. **Malformed fragment ⇒ app still boots, graph untouched** — `#g1=` followed
   by garbage / a truncated payload / valid base64url of non-JSON / valid JSON
   that fails `deserialize` ⇒ the app boots the *previous* graph unchanged, one
   console warning, fragment stripped; no exception escapes; `simulationRev`
   unchanged.
6. **Strict base64url** — a payload containing `+`, `/`, an `=`, or whitespace
   ⇒ rejected before inflate; treated as §U12.5.
7. **zlib wrapper, not raw** — a payload compressed as **raw** DEFLATE
   (`deflate-raw`) ⇒ rejected at inflate (no zlib header); a correctly
   zlib-wrapped payload decodes.
8. **Compressor interop** — a link made with `CompressionStream('deflate')` and
   a link made with the pure-JS zlib fallback, for the same graph, **both**
   decode to the identical graph (bytes / URL strings need not match). Tested
   against standard RFC 1950/1951 vectors.
9. **Decompression-bomb guard** — a crafted `g1=` payload that inflates past
   `SHARE_MAX_DECODED_BYTES` ⇒ inflation aborts **before** `JSON.parse`, the
   link is reported damaged, the current graph is untouched, output is never
   fully materialised.
10. **`https ↔ file://` interop** — a link produced by the portable single-file
    build opens correctly in the hosted build, and a link produced by the hosted
    build opens in the portable build (decoder fallback path).
11. **Unknown prefix ⇒ ignored** — `#g2=…`, `#w1=…`, `#/route`, `#section` ⇒
    normal boot, working graph untouched, fragment left as-is.
12. **Fragment stripped on every outcome, path + query kept** — start from
    `…/sub/path?x=1#g1=…`; after success, after a decode failure, and after a
    §U5.6 Cancel, `location` is `…/sub/path?x=1` with empty hash; the history
    entry was replaced, not pushed.
13. **Pristine-sample flag** — first boot with the sample and a `g1=` link ⇒ no
    prompt, link applies. Then: edit a node and undo back to the exact sample
    shape, open another link ⇒ **prompt** (flag cleared by the edit, not
    restored by content match). Same after an `Import` or a `Template`.
14. **Replace confirm** — with the flag clear, opening a link prompts; **Cancel**
    keeps the current graph, bumps `simulationRev` zero times, and still strips
    the fragment; **OK** replaces it.
15. **Exactly one bump** — a successful link load bumps `simulationRev` exactly
    once (assert the sim/MC subscribers fired once); an active live run / timer
    is stopped before the swap and no step runs against a half-swapped graph.
16. **No PII added** — decode a produced link and diff against a `Graph JSON`
    export: identical; no id / email / timestamp / build field present.
17. **Old build** — a share link opened by a share-unaware build (simulate by
    disabling the loader) boots normally and ignores the fragment.
