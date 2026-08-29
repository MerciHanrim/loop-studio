// loop-expr/1 (SEMANTICS-X.md §X2) — the AST. The canonical text form (§X8) is
// a deterministic re-serialisation of this tree, so the tree — not the source
// text — is the identity that the loop-revision/2 digest sees.

export type NumberNode = { type: 'number'; value: number }
/** `id` is the *decoded* target node id (both `@id` and `@{id}` decode to it). */
export type RefNode = { type: 'ref'; id: string }
export type UnaryNode = { type: 'unary'; op: '-'; operand: ExprNode }
export type BinaryNode = {
  type: 'binary'
  op: '+' | '-' | '*' | '/'
  left: ExprNode
  right: ExprNode
}

export type ExprNode = NumberNode | RefNode | UnaryNode | BinaryNode

export const num = (value: number): NumberNode => ({ type: 'number', value })
export const ref = (id: string): RefNode => ({ type: 'ref', id })
export const neg = (operand: ExprNode): UnaryNode => ({ type: 'unary', op: '-', operand })
export const bin = (
  op: BinaryNode['op'],
  left: ExprNode,
  right: ExprNode,
): BinaryNode => ({ type: 'binary', op, left, right })
