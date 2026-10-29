import { useState, type InputHTMLAttributes } from 'react'

/**
 * A number input whose stored value must be a finite number (optionally with a
 * further `valid` rule). The text being typed lives in a local draft and only
 * a VALID parse is committed, so a half-typed `-`, `1e400` or an empty field
 * never reaches the store: `Number('-')` is 0 and `Number('1e400')` is
 * `Infinity`, which `readParameterData` rejects — committing them per
 * keystroke snapped a Parameter's value to 0 as soon as a minus was typed, and
 * flipped the node into the Inspector's "unreadable" fallback on an overflow
 * (issue #393 A). The draft is dropped on blur, snapping the field back to
 * whatever is stored. `allowEmpty` commits `null` for a blank field.
 *
 * Renders the `<input>` only; the caller wraps it in its own field and shows
 * any hint it wants from `invalid`.
 */
export function DraftNumberInput({
  value,
  allowEmpty,
  valid,
  onCommit,
  onInvalidChange,
  ...rest
}: {
  value: number | null
  allowEmpty: boolean
  /** a further rule on a finite parse (e.g. `n >= 0`); absent ⇒ any finite number */
  valid?: (n: number) => boolean
  onCommit: (n: number | null) => void
  /** told whenever the draft turns invalid / valid again, for a hint beside the field */
  onInvalidChange?: (invalid: boolean) => void
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur' | 'type'>) {
  const [draft, setDraft] = useState<string | null>(null)
  const ok = (n: number) => Number.isFinite(n) && (valid ? valid(n) : true)
  const shown = draft ?? (value == null ? '' : String(value))
  const draftInvalid = draft !== null && !(draft === '' ? allowEmpty : ok(Number(draft)))
  return (
    <input
      dir="ltr"
      {...rest}
      type="number"
      value={shown}
      aria-invalid={draftInvalid || rest['aria-invalid'] || undefined}
      onChange={(e) => {
        const text = e.target.value
        setDraft(text)
        const invalid = !(text === '' ? allowEmpty : ok(Number(text)))
        onInvalidChange?.(invalid)
        if (invalid) return
        onCommit(text === '' ? null : Number(text))
      }}
      onBlur={() => {
        setDraft(null)
        onInvalidChange?.(false)
      }}
    />
  )
}
