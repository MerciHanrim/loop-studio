/** Save a text blob to a file via a transient object URL.
 *
 *  The anchor is put in the document before the click and taken out after:
 *  not every browser dispatches a click on a detached anchor, and one of the
 *  five call sites this replaced was already doing it that way. */
export function downloadText(text: string, name: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** U+FEFF. Written from its code point: a BOM is invisible in a source listing,
 *  and the whole point of this module is that its presence is deliberate. */
const BOM = String.fromCharCode(0xfeff)

/** The media type every CSV this product writes is served with. */
export const CSV_MIME = 'text/csv;charset=utf-8'

/**
 * Save a CSV to a file — the ONE boundary where the UTF-8 BOM is added.
 *
 * WHY A BOM, AND WHY ONLY HERE
 *
 * Excel on Windows opens a downloaded `.csv` by guessing its encoding, and
 * with no BOM it guesses the system ANSI code page. MEASURED on a real export
 * (`loop-studio-run.csv`, 4,148 bytes, valid UTF-8, first bytes `73 74 65 70`
 * = `step,`): every Korean header rendered as mojibake — `레벨` came out as
 * `ë ë²¨`. The bytes were never wrong; the reader was.
 *
 * `charset=utf-8` in the Blob's media type does NOT fix this. A downloaded
 * file carries no media type, so Excel never sees it — two of the call sites
 * this replaced already set it and were mojibake all the same. Only a BOM
 * travels with the bytes.
 *
 * The BOM belongs to the DOWNLOAD, not to the CSV. The pure serializers
 * (`toSeriesCsv`, `toFinalCsv`, `toFinalSummaryCsv`, the change-proposal
 * builder) keep emitting a bare document, so their tests, their round trip
 * through this product's own importer, and any non-browser consumer are
 * unaffected. Adding it here, exactly once, is what makes "every CSV this
 * product downloads is BOM-prefixed UTF-8" a single checkable fact.
 */
export function downloadCsv(csv: string, name: string): void {
  downloadText(withCsvBom(csv), name, CSV_MIME)
}

/**
 * The CSV payload a download carries: the document with exactly ONE BOM.
 *
 * Split out from `downloadCsv` so the "exactly one" half can be falsified
 * without a browser — `downloadCsv` needs a `document` and the unit runner has
 * no DOM. Idempotent on purpose: a second BOM is not a harmless no-op, it is a
 * stray U+FEFF sitting inside the first cell, which is the same class of
 * defect as having none at all.
 */
export function withCsvBom(csv: string): string {
  return csv.startsWith(BOM) ? csv : BOM + csv
}
