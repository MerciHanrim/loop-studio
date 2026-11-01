import { useRef, useState, type InputHTMLAttributes } from 'react'
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
 * `restoreOnBlank` (#422, Lumi 2026-11-01 — Seed, Runs, Steps, Base seed): a
 * blank is being edited, not a value. Enter or leaving the field while it is
 * blank shows the value from before the edit again — committed back if a
 * number typed on the way (backspacing `500` through `50` and `5`) already
 * changed it. Enter also ends the edit when the field holds a number.
 *
 * Renders the `<input>` only; the caller wraps it in its own field and shows
 * any hint it wants from `invalid`.
 */
export function DraftNumberInput({
  value,
  allowEmpty,
  valid,
  restoreOnBlank,
  onCommit,
  onInvalidChange,
  ...rest
}: {
  value: number | null
  allowEmpty: boolean
  /** a further rule on a finite parse (e.g. `n >= 0`); absent ⇒ any finite number */
  valid?: (n: number) => boolean
  /** a blank confirmed by Enter or blur brings back the value from before the edit */
  restoreOnBlank?: boolean
  onCommit: (n: number | null) => void
  /** told whenever the draft turns invalid / valid again, for a hint beside the field */
  onInvalidChange?: (invalid: boolean) => void
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur' | 'type'>) {
  const [draft, setDraft] = useState<string | null>(null)
  // the stored value when this edit began (focus, or the last Enter)
  const editStart = useRef<number | null>(value)
  const shown = draft ?? (value == null ? '' : String(value))
  const isInvalid = (text: string) => {
    const r = readDraft(text, valid)
    // a blank that will be restored is an edit in progress, not an error
    return r.kind === 'blank' ? !allowEmpty && !restoreOnBlank : r.kind === 'invalid'
  }
  const draftInvalid = draft !== null && isInvalid(draft)
  /** end the edit: a blank goes back to the value from before it */
  const confirm = () => {
    if (restoreOnBlank && draft === '' && !allowEmpty) {
      const back = editStart.current
      if (back != null && back !== value) onCommit(back)
    } else editStart.current = value
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
      onFocus={(e) => {
        editStart.current = value
        rest.onFocus?.(e)
      }}
      onKeyDown={(e) => {
        rest.onKeyDown?.(e)
        if (restoreOnBlank && e.key === 'Enter' && !e.defaultPrevented) confirm()
      }}
      onChange={(e) => {
        const text = e.target.value
        setDraft(text)
        const invalid = isInvalid(text)
        onInvalidChange?.(invalid)
        if (invalid) return
        const r = readDraft(text, valid)
        if (r.kind === 'value') onCommit(r.n)
        else if (allowEmpty) onCommit(null)
      }}
      onBlur={confirm}
    />
  )
}
