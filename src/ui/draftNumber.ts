/**
 * What the text of a number field stands for, read at the input boundary
 * (`DraftNumberInput`). A blank is no value; only a FINITE parse that also
 * passes the field's own rule is a value, so `Infinity`, `1e400` (which a
 * number input may hand over as text) or `NaN` never reaches a store.
 */
export type DraftRead = { kind: 'blank' } | { kind: 'invalid' } | { kind: 'value'; n: number }

export function readDraft(text: string, valid?: (n: number) => boolean): DraftRead {
  if (text === '') return { kind: 'blank' }
  const n = Number(text)
  return Number.isFinite(n) && (valid ? valid(n) : true) ? { kind: 'value', n } : { kind: 'invalid' }
}
