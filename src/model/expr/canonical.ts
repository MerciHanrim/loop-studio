// loop-expr/1 (SEMANTICS-X.md §X8) — canonical re-serialisation of the AST.
//
// Structurally-equal expressions produce byte-identical text (X-INV-4), so the
// loop-revision/2 digest is a function of the AST, not the typed source.
// `canonicalise` is idempotent (X-INV-5). It does NOT fold constants, reorder
// operands, or reassociate.

import type { ExprNode } from './ast'

export const SAFE_ID = /^[A-Za-z_][A-Za-z0-9_]*$/

/** §X3.1 canonical reference spelling: bare `@id` for a SAFE_ID, else `@{…}`. */
export function canonicalRef(id: string): string {
  if (SAFE_ID.test(id)) return `@${id}`
  return `@{${id.replace(/\\/g, '\\\\').replace(/\}/g, '\\}')}}`
}

/** §X8 number literal: the shortest round-tripping decimal — `String(Number)`
 *  after `-0 → 0` (SEMANTICS-R.md §R4.1). */
export function canonicalNumber(value: number): string {
  return Object.is(value, -0) ? '0' : String(value)
}

// precedence: add < mul < unary < primary
const PREC = { add: 1, mul: 2, unary: 3, primary: 4 } as const

type Out = { text: string; prec: number }
type Frame = { node: ExprNode; entered: boolean }

/**
 * Iterative post-order pretty-print. Each node's `{ text, prec }` is built from
 * its children's, so an AST of any depth serialises without recursion.
 * Parentheses are kept **iff** removing them would change the parse: a child of
 * strictly lower precedence, or a same-precedence child on the RIGHT of a
 * left-assoc binary (`@a - (@b - @c)` kept, `@a - @b - @c` not), or a
 * lower-precedence operand under a unary minus (`-(@a + @b)`).
 */
export function canonicalPrint(ast: ExprNode): string {
  const work: Frame[] = [{ node: ast, entered: false }]
  const outs: Out[] = []

  while (work.length > 0) {
    const frame = work[work.length - 1]
    const node = frame.node

    if (node.type === 'number') {
      work.pop()
      outs.push({ text: canonicalNumber(node.value), prec: PREC.primary })
      continue
    }
    if (node.type === 'ref') {
      work.pop()
      outs.push({ text: canonicalRef(node.id), prec: PREC.primary })
      continue
    }

    if (!frame.entered) {
      frame.entered = true
      if (node.type === 'unary') {
        work.push({ node: node.operand, entered: false })
      } else {
        work.push({ node: node.right, entered: false })
        work.push({ node: node.left, entered: false })
      }
      continue
    }

    work.pop()
    if (node.type === 'unary') {
      const operand = outs.pop()!
      const text = operand.prec < PREC.unary ? `-(${operand.text})` : `-${operand.text}`
      outs.push({ text, prec: PREC.unary })
    } else {
      const right = outs.pop()!
      const left = outs.pop()!
      const parentPrec = node.op === '+' || node.op === '-' ? PREC.add : PREC.mul
      const wrap = (child: Out, sideRight: boolean): string => {
        const needParens = child.prec < parentPrec || (child.prec === parentPrec && sideRight)
        return needParens ? `(${child.text})` : child.text
      }
      outs.push({ text: `${wrap(left, false)} ${node.op} ${wrap(right, true)}`, prec: parentPrec })
    }
  }

  return outs[0].text
}
