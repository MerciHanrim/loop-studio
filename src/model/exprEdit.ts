// docs/register-expression-authoring.md §RXA8b — pure text edits for the Register
// expression `<input>`: the operator / parenthesis buttons under the field.
// NOTHING here parses or evaluates — the caller still runs the existing
// draft-until-valid commit gate, so `@id` stays the sole stored form and the
// `loop-revision/2` digest is untouched (RXA-INV-1).

export type OpKind = '+' | '-' | '*' | '/' | 'group'

/**
 * Apply an operator button to `value` with the caret / selection at
 * `[start, end)`. An operator (`+ - * /`) is inserted with one space on each
 * side — skipped only where the neighbour is already whitespace, or (leading
 * space only) at the very start of the field; `group` wraps a non-empty
 * selection in `( … )`, otherwise inserts an empty `()` with the caret between
 * the parentheses. Returns the new text and where to put the caret. No
 * operator or space is added beyond what is described here.
 */
export function insertOperator(
  value: string,
  start: number,
  end: number,
  kind: OpKind,
): { value: string; caret: number } {
  const s = Math.max(0, Math.min(start, value.length))
  const e = Math.max(s, Math.min(end, value.length))
  const before = value.slice(0, s)
  const selected = value.slice(s, e)
  const after = value.slice(e)

  if (kind === 'group') {
    if (selected) {
      return {
        value: `${before}(${selected})${after}`,
        caret: before.length + 1 + selected.length + 1,
      }
    }
    return { value: `${before}()${after}`, caret: before.length + 1 }
  }

  const lead = before === '' || /\s$/.test(before) ? '' : ' '
  const trail = /^\s/.test(after) ? '' : ' '
  const ins = `${lead}${kind}${trail}`
  return { value: before + ins + after, caret: before.length + ins.length }
}
