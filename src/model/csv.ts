// docs/data-import.md - Phase 1B delimited-text (CSV/TSV) parsing.
// No library: no CSV/TSV parser exists anywhere in this app or package.json,
// and this project's philosophy (client-only, offline-first, minimal surface)
// favours a small hand-rolled parser over a new dependency for a bounded,
// well-specified grammar. Pure, synchronous, no locale handling.
//
// This module owns SYNTAX only (quoting well-formedness). It never inspects
// cell CONTENT (a ragged row, an empty numeric cell, an invalid key) -- that
// is dataImportValidate.ts's job, run AFTER header-row selection and
// leading/trailing row trim, since a raw paste's title/footer rows
// legitimately have a different shape and must not fail parsing.

export type CsvParseError = {
  kind: 'unterminated-quote' | 'text-after-quote' | 'quote-in-unquoted-field'
  /** 1-based line number of the offending row. */
  line: number
  /** 1-based character offset within that row. */
  column: number
}
export type CsvParseResult = { ok: true; rows: string[][] } | { ok: false; error: CsvParseError }

/** Drop a leading UTF-8 BOM (U+FEFF), only at offset 0. A BOM'd file is
 *  ordinary, well-formed input -- this is a silent success path, never an
 *  error. Run before anything else touches the text (paste and file-read
 *  paths alike). */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

// --- WRITING ------------------------------------------------------------
//
// The same grammar, the other way round. Every CSV this product DOWNLOADS is
// built here, so the record separator and the quoting rule have exactly one
// owner. Before this (measured 2026-09-26) each of the six writers had its own
// idiom: five joined rows with a bare LF and ran a user label through a
// replace that turned a quote, a comma or a newline into a SPACE, silently
// destroying it, while only the change-proposal writer did RFC 4180. A label
// is the user's text; an export must not edit it.

/** RFC 4180's record separator. CRLF, because these files are opened in Excel
 *  on Windows more than anywhere else, and the change-proposal export already
 *  committed to it as a product decision (docs/data-import.md DI12.3). The BOM
 *  is NOT added here -- that belongs to the download boundary
 *  (`src/ui/download.ts`), so a serializer's output stays a plain document. */
export const CSV_EOL = '\r\n'

/** One field. Quoted only when it has to be, with internal quotes doubled --
 *  never rewritten. `parseDelimitedText` below is the exact inverse, which is
 *  what makes an export then re-import round trip lossless. A TAB is
 *  deliberately left alone: it is ordinary content in a comma-delimited file. */
export function csvField(value: string | number): string {
  const s = String(value)
  if (!/["\r\n,]/.test(s)) return s
  return '"' + s.replace(/"/g, '""') + '"'
}

/** A whole document: every row terminated by `CSV_EOL`, including the last.
 *  No rows means the empty string, never a lone separator. */
export function toCsv(rows: readonly (readonly (string | number)[])[]): string {
  if (rows.length === 0) return ''
  return rows.map((row) => row.map(csvField).join(',')).join(CSV_EOL) + CSV_EOL
}

// --- READING ------------------------------------------------------------

type Pos = { line: number; column: number }

/**
 * The strict quote-aware scanner `parseDelimitedText` runs once the real
 * delimiter is known. A quote is significant ONLY at a field's start
 * position (right after a delimiter, right after a newline, or at BOF) -- a
 * quote character appearing anywhere else is a syntax error, never silently
 * treated as a literal or as re-entering quoted mode. This is what rejects
 * a malformed field like  a b " c d  (unquoted text containing a stray
 * quote).
 *
 * Calls onField(value) after each field is fully read and onRow() after
 * each row's line terminator (or EOF). Stops (returns an error) at the
 * first syntax violation.
 */
function scan(
  text: string,
  delimiter: string,
  onField: (value: string) => void,
  onRow: () => void,
): CsvParseError | null {
  let i = 0
  let line = 1
  let col = 1
  const n = text.length
  const posAt = (): Pos => ({ line, column: col })
  const advance = (count = 1) => {
    for (let k = 0; k < count; k++) {
      if (text[i] === '\n') {
        line++
        col = 1
      } else {
        col++
      }
      i++
    }
  }
  // returns the number of characters consumed by the newline at idx, or 0
  const newlineLenAt = (idx: number): number => {
    if (text[idx] === '\r' && text[idx + 1] === '\n') return 2
    if (text[idx] === '\r' || text[idx] === '\n') return 1
    return 0
  }

  // Outer loop reads whole ROWS; only entered when there is at least one
  // more character, i.e. a field genuinely remains to be read. Each row's
  // inner loop reads FIELDS until the one after the last delimiter is done
  // (a newline or EOF follows it, not another delimiter) -- this explicit
  // "keep reading fields in THIS row" condition is what correctly produces
  // a trailing empty field (and still calls onRow()) when a row ends with a
  // delimiter immediately followed by EOF, e.g. the last row of "a,b,c\n,,"
  // -- a bug an earlier "advance past delimiter, continue the OUTER loop"
  // structure had: it could silently exit before ever flushing that row.
  while (i < n) {
    for (;;) {
      // start of a field
      if (text[i] === '"') {
        // quoted field
        const openPos = posAt()
        advance() // consume opening quote
        let field = ''
        let closed = false
        while (i < n) {
          if (text[i] === '"') {
            if (text[i + 1] === '"') {
              field += '"'
              advance(2)
              continue
            }
            advance() // consume closing quote
            closed = true
            break
          }
          field += text[i]
          advance()
        }
        if (!closed) {
          return { kind: 'unterminated-quote', line: openPos.line, column: openPos.column }
        }
        // after a closing quote: only the delimiter, a newline, or EOF may follow
        if (i < n && text[i] !== delimiter && newlineLenAt(i) === 0) {
          return { kind: 'text-after-quote', line, column: col }
        }
        onField(field)
      } else {
        // unquoted field -- a bare quote anywhere in it is a syntax error
        const start = i
        while (i < n && text[i] !== delimiter && newlineLenAt(i) === 0) {
          if (text[i] === '"') {
            return { kind: 'quote-in-unquoted-field', line, column: col }
          }
          advance()
        }
        onField(text.slice(start, i))
      }

      if (i < n && text[i] === delimiter) {
        advance()
        continue // another field follows in THIS row
      }
      break // row done: a newline or EOF follows the field just read
    }
    onRow()
    const nl = newlineLenAt(i)
    if (nl > 0) advance(nl)
    // loop back to `while (i < n)`: EOF here means no more rows, never a
    // phantom empty one from the newline just consumed.
  }
  return null
}

/**
 * Auto-detect the delimiter from the first LOGICAL row (quote-aware: a
 * comma or tab sitting inside a quoted field must never be counted). Tab
 * wins if it appears outside quotes at all in that row; else comma.
 *
 * Deliberately a SEPARATE, simpler scan from scan() above, not a reuse of
 * it with a placeholder delimiter: at this point the real delimiter isn't
 * known yet, so scan()'s strict "quote only significant at a
 * delimiter-relative field start" rule can't be applied without already
 * knowing the very thing being detected. This is a lenient,
 * delimiter-independent quote-TOGGLE heuristic -- good enough to correctly
 * skip commas/tabs inside a properly quoted field for detection purposes;
 * the real parse below, once the delimiter is known, applies the strict
 * field-start rule and is the one that actually rejects malformed quoting.
 */
export function detectDelimiter(text: string): ',' | '\t' {
  const clean = stripBom(text)
  let inQuotes = false
  let sawTab = false
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]
    if (ch === '"') {
      if (inQuotes && clean[i + 1] === '"') {
        i++ // escaped quote -- stays inside the quoted run
        continue
      }
      inQuotes = !inQuotes
      continue
    }
    if (inQuotes) continue
    if (ch === '\n' || ch === '\r') break // end of the first logical row
    if (ch === '\t') sawTab = true
  }
  return sawTab ? '\t' : ','
}

/**
 * Parse a full CSV/TSV document with the given delimiter.
 *
 * No post-processing "drop a trailing blank row" step is needed: unlike a
 * naive text.split('\n') (which turns a single trailing newline into a
 * spurious extra [''] entry), this state machine treats a newline strictly
 * as a ROW TERMINATOR -- a single trailing newline ("a,b\n") produces
 * exactly one row, never a phantom second one. A row that IS genuinely
 * blank (e.g. two consecutive newlines, "a\n\n") instead produces a real
 * second row (a single empty cell) and is correctly passed through to
 * validateDrafts as real content, not silently dropped.
 */
export function parseDelimitedText(text: string, delimiter: string): CsvParseResult {
  const rows: string[][] = []
  let row: string[] = []
  const err = scan(
    text,
    delimiter,
    (value) => row.push(value),
    () => {
      rows.push(row)
      row = []
    },
  )
  if (err) return { ok: false, error: err }
  return { ok: true, rows }
}
