# Errata to `loop-share/1`

[`SEMANTICS-U.md`](SEMANTICS-U.md) is frozen and is not rewritten. This file
records where its text and the shipped behaviour differ, so that a document
built on it ([`SEMANTICS-P.md`](SEMANTICS-P.md)) can say what a link really
carries. Nothing here changes behaviour.

## E1. §U2 — what a link carries

**The text says** a link carries the whole `GraphDoc` — `nodes`, `edges`,
`recommendedRunConfig` — and "nothing else" (§U2, and row U2 of the invariants
table).

**The shipped behaviour** is that a link carries what `Graph JSON` export
writes, and that file has grown since the freeze. Besides the nodes, the edges
and the recommended run configuration, a link carries:

- the **saved frames** of the document (their ids, titles, rectangles and
  colours), since saved frames became part of the graph document;
- the **imported spreadsheet records** (`dataImports`): the source tables a
  data import kept in the document, including their cell values.

Opening a link replaces both in the receiving document: a link without frames or
tables clears the current ones, a link with them restores exactly them.

The sentence that still holds is the principle of §U2: a link is a _document_,
not a session. It does not carry Monte Carlo results, a simulation snapshot, a
seed, the canvas viewport, undo history, selection, the theme, the language or
any other preference.

**Why it matters.** The disclosure shown before a link is created names labels,
imported spreadsheet values and saved frames for this reason, and a protected
link (`loop-share-protected/1`) seals all of it.

## E2. §U7 — dialogs on load

§U7 says there is no dialog on load except the replace confirmation. That
remains true of a `g1` link. A `p1` link is not a `loop-share/1` link: its
password prompt and its notices belong to `loop-share-protected/1`.
