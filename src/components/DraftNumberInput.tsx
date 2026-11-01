import { useState, type InputHTMLAttributes } from 'react'
import { readDraft } from '../ui/draftNumber'

/**
 * A number input whose stored value must be a finite number (optionally with a
 * further `valid` rule). The text being typed lives in a local draft and only
 * a VALID parse is committed, so a half-typed `-`, `1e400` or an empty field
 * never reaches the store. A number input reports a lone `-` and an overflow
 * such as `1e400` as `''` (`Number('-')` itself is `NaN`; it is the empty
 * string that `Number` turns into 0), so committing `Number(text)` per
 * keystroke snapped a Parameter's value to 0 as soon as a minus was typed and
 * lost the sign (issue #393 A). The draft is dropped on blur, snapping the
 * field back to whatever is stored. `allowEmpty` commits `null` for a blank
 * field.
 *
 * `commitOnConfirm` (#422, Lumi 2026-11-01 — Seed, Runs, Steps, Base seed):
 * typing changes the draft only; a valid number is committed when the edit is
 * confirmed, by Enter or by leaving the field. Clearing `500` one character at
 * a time therefore never sets `50` or `5` on the way (for Seed each of those
 * would reset the run), and a blank confirmed, like anything not a valid
 * number, commits nothing: the value and the run stay as they were before the
 * edit, and the field shows that value again.
 *
 * Renders the `<input>` only; the caller wraps it in its own field and shows
 * any hint it wants from `invalid`.
 */
export function DraftNumberInput({
  value,
  allowEmpty,
  valid,
  commitOnConfirm,
  onCommit,
  onInvalidChange,
  ...rest
}: {
  value: number | null
  allowEmpty: boolean
  /** a further rule on a finite parse (e.g. `n >= 0`); absent ⇒ any finite number */
  valid?: (n: number) => boolean
  /** commit on Enter or blur only, never while typing; a blank commits nothing */
  commitOnConfirm?: boolean
  onCommit: (n: number | null) => void
  /** told whenever the draft turns invalid / valid again, for a hint beside the field */
  onInvalidChange?: (invalid: boolean) => void
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur' | 'type'>) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? (value == null ? '' : String(value))
  const isInvalid = (text: string) => {
    const r = readDraft(text, valid)
    // a blank that commits nothing is an edit in progress, not an error
    return r.kind === 'blank' ? !allowEmpty && !commitOnConfirm : r.kind === 'invalid'
  }
  const draftInvalid = draft !== null && isInvalid(draft)
  /** end the edit: under `commitOnConfirm` a valid number is set now */
  const confirm = () => {
    if (commitOnConfirm && draft !== null) {
      const r = readDraft(draft, valid)
      if (r.kind === 'value' && r.n !== value) onCommit(r.n)
    }
    setDraft(null)
    onInvalidChange?.(false)
  }
  return (
    <input
      dir="ltr"
      {...rest}
      type="number"
      value={shown}
      aria-invalid={draftInvalid || rest['aria-invalid'] || undefined}
      onKeyDown={(e) => {
        rest.onKeyDown?.(e)
        if (commitOnConfirm && e.key === 'Enter' && !e.defaultPrevented) confirm()
      }}
      onChange={(e) => {
        const text = e.target.value
        setDraft(text)
        const invalid = isInvalid(text)
        onInvalidChange?.(invalid)
        if (invalid || commitOnConfirm) return
        onCommit(text === '' ? null : Number(text))
      }}
      onBlur={confirm}
    />
  )
}
