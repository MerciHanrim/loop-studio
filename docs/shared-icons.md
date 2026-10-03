# Shared icons (issue #298)

Every functional icon in the chrome is drawn by the app, as inline SVG from one component, `src/ui/icons.tsx`. This page says why, what the rules are, how an icon follows the reader's direction, what the check guards, and how the replacement was shown to move nothing.

## Why

Until v0.15.3 the icons were typed as Unicode characters. Measured on `main 3f07c11` (2026-10-01), in Chromium on Windows: the shipped font (IBM Plex Sans) drew three of the symbols the UI used, `©`, `×` and `−`; every other one was drawn by whatever font the operating system chose, four different fonts on one Windows PC. Seven of them (`▶` `⏸` `⏭` `☀` `↗` `↖` `✳`) are emoji-capable characters that iOS draws in colour, and two (`🔒` `🔓`) are colour emoji everywhere. The same button therefore differed in weight, size, baseline and sometimes colour from one platform to the next, and a screen reader read the symbol as part of the button's name (`▶ Play`).

## The rules

- **A functional icon is an `<Icon>`** (or an `<ArrowIcon>`, below): one 16 x 16 drawing, 1.6 px strokes with round caps, the grammar the canvas control buttons already used. It is `aria-hidden`; the accessible name belongs to the control and is words.
- **It follows `currentColor`**, so it takes the control's text colour in every theme and under forced colours, where the text colour is the system's.
- **Its size is `1em` by default**, the height of the text it replaced; a control that was measured to need another box gets it in CSS (`.icon--…` and the per-control rules in `src/index.css`), never in the component.
- **A translated string carries no functional glyph.** `Play`, `Light`, `File` and the rest are words; the icon sits beside them in the component. The 17 catalog keys that carried a glyph lost it in all 18 locales, and the in-sentence `↔` of the Inspector's type-mismatch note became words in each language (`inspector.resourceType.pair`).
- **Meaning-bearing characters stay text:** `©` (copyright), `＋ － ＝` beside the palette marks and on the expression keypad, the formula and menu-path characters `→ ← × − ≥ ≤ ≈ ± ÷ ≠ °`, and `⏎ ⇥ ␡` as the written names of control characters. Anything a person typed is theirs.

## Direction

Four icons have a sense defined by the reading flow and therefore follow the reader (docs/localization.md §L9.3): the external-link mark, the submenu disclosure, undo and redo. They are rendered only by `<ArrowIcon unit="…">`, which reads the locale's direction from the same hook the arrow layer uses and picks one of two drawings. The RTL drawing is **derived** from the LTR one at module load by `src/ui/mirrorPath.ts`, as path data with every x reflected and every arc sweep reversed, never by a transform: a transform flips the box, cannot be read back, and the arrow contract forbids it. The icon carries `data-arrow` and `data-dir`, which is what the runtime test reads.

Everything else has one drawing for every reader: a menu opens downward for everyone, and the transport (Play, Pause, Replay, Step, Reset) sits with the physical time axis. `scripts/check-arrow-direction.mjs` (clause 1b) holds the two sets apart: an `ArrowIcon` for a keeping unit, or a plain `Icon` for a mirroring one, is red, and the table in `icons.tsx` must name exactly the mirroring units.

## The check

`npm run check:functional-glyphs` (`scripts/check-functional-glyphs.mjs`, in the `checks` CI job) reads every component under `src/components` and `src/ui` through the TypeScript AST and every catalog under `src/i18n/locales`, and fails when one of the 32 replaced characters appears in rendered JSX text, in a string inside a JSX expression, in an `aria-label` / `title` / `placeholder`, or in a translated value. Comments are not read, so a comment that names a glyph (this file's sources have many) is not a hit. The allow-list is the list of meaning-bearing characters above; it is written in the check so the next reader knows those were decided, not missed. Out of scope: user content, the engine and model fixtures, examples, tests and SVG path data.

## Measured: nothing moved

A layout fingerprint of every control that carried a glyph was taken before and after the replacement, on the same dev server, desktop (1280 px) and mobile (390 px), English and Arabic: the toolbar and palette buttons, the play bar and the run bar, the canvas controls, the revision chip, the Settings rows, the Theme submenu, the Help menu, the About dialog's close button, the More sheet, and a trigger edge label. 162 boxes compared, rounded to 0.5 px.

The first pass moved 64 of them by 1 to 2 px: a character drawn by an OS font had given its control a line box a pixel taller than the text font's, and an icon of `1em` did not. The per-control rules in `src/index.css` give each icon the advance width and the line box its character had, measured; after them all 162 boxes are identical to the half pixel, on both viewports and for both readers, the trigger edge label included. Three controls the fingerprint did not reach were measured against a clone of themselves carrying the old text in the same stylesheet, and are the size they were: the Distribution panel's Export button, the Insert reference button and the mobile Help sheet's feedback row.

The visual baselines that changed (ten, all on the desktop project) were diffed pixel by pixel against the committed ones: nine differ only inside the boxes of a drawn icon (the undo, redo and overflow buttons, the canvas lock and focus buttons, the trigger mark on a connection, the Export caret); one, the matrix at the lowest zoom, also differs by 222 anti-aliased pixels on the outline of a parameter node whose geometry and computed paint are identical in both trees, which was confirmed by capturing the same state from the previous commit on the same machine. The forced-colours baseline's edge-tell lines differed between that old-tree capture and the committed file as well, so those lines are a machine difference, not this change.

## Not done here

- No physical iOS device was measured; the expectation that iOS no longer draws emoji follows from the icons being SVG, not from a measurement on a device.
- The mixed heights the OS fonts had introduced (a 28 px menu button beside a 27 px one, a 31 px checked row beside 29 px rows) are reproduced on purpose, because the issue asked that nothing move; evening them out is a separate decision.
