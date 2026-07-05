import either, { type Either } from '@matt.kantor/either'
import type { ElaborationError } from '../../errors.js'
import { isKeywordExpressionWithArgument } from '../expression.js'
import { makeObjectNode, type ObjectNode } from '../object-node.js'
import type { SemanticGraph } from '../semantic-graph.js'
import { readArgumentsFromExpression } from './expression-utilities.js'

// TODO: Evolve this into pattern matching/destructuring.
export type IfExpression = ObjectNode & {
  readonly 0: '@if'
  readonly 1: {
    readonly condition: SemanticGraph
    readonly then: SemanticGraph
    readonly else: SemanticGraph
  }
}

export const readIfExpression = (
  node: SemanticGraph,
): Either<ElaborationError, IfExpression> =>
  isKeywordExpressionWithArgument('@if', node) ?
    either.map(
      readArgumentsFromExpression(node, ['condition', 'then', 'else']),
      ([condition, then, otherwise]) =>
        makeIfExpression({ condition, then, else: otherwise }),
    )
  : either.makeLeft({
      kind: 'invalidExpression',
      message: 'not an `@if` expression',
    })

export const makeIfExpression = ({
  condition,
  then,
  else: otherwise,
}: {
  readonly condition: SemanticGraph
  readonly then: SemanticGraph
  readonly else: SemanticGraph
}): IfExpression =>
  makeObjectNode({
    0: '@if',
    1: makeObjectNode({
      condition,
      then,
      else: otherwise,
    }),
  })
