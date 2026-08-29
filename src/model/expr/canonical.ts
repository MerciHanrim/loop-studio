// loop-expr/1 (SEMANTICS-X.md §X8) — canonical re-serialisation of the AST.
//
// Structurally-equal expressions produce byte-identical text (X-INV-4), so the
// loop-revision/2 digest is a function of the AST, not the typed source.
// `canonicalise` is idempotent (X-INV-5). It does NOT fold constants, reorder
// operands, or reassociate.

import type { BinaryNode, ExprNode } from './ast'

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

function precOf(node: ExprNode): number {
  switch (node.type) {
    case 'number':
    case 'ref':
      return PREC.primary
    case 'unary':
      return PREC.unary
    case 'binary':
      return node.op === '+' || node.op === '-' ? PREC.add : PREC.mul
  }
}

function binChildText(child: ExprNode, parent: BinaryNode, side: 'left' | 'right'): string {
  const parentPrec = precOf(parent)
  const childPrec = precOf(child)
  let needParens = childPrec < parentPrec
  // left-assoc: a same-precedence child on the RIGHT must be parenthesised
  // (`@a - (@b - @c)` kept, `@a - @b - @c` not).
  if (!needParens && childPrec === parentPrec && side === 'right') needParens = true
  const inner = print(child)
  return needParens ? `(${inner})` : inner
}

function print(node: ExprNode): string {
  switch (node.type) {
    case 'number':
      return canonicalNumber(node.value)
    case 'ref':
      return canonicalRef(node.id)
    case 'unary': {
      // parenthesise a lower-precedence operand: `-(@a + @b)`, `-(@a * @b)`;
      // `--@a` and `-@a` need none.
      const operand = node.operand
      const inner = print(operand)
      return precOf(operand) < PREC.unary ? `-(${inner})` : `-${inner}`
    }
    case 'binary':
      return `${binChildText(node.left, node, 'left')} ${node.op} ${binChildText(node.right, node, 'right')}`
  }
}

export function canonicalPrint(ast: ExprNode): string {
  return print(ast)
}
