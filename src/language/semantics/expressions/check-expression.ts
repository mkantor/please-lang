import either, { type Either } from '@matt.kantor/either'
import type { ElaborationError } from '../../errors.js'
import { isKeywordExpressionWithArgument } from '../expression.js'
import { makeObjectNode, type ObjectNode } from '../object-node.js'
import type { SemanticGraph } from '../semantic-graph.js'
import { readArgumentsFromExpression } from './expression-utilities.js'

export type CheckExpression = ObjectNode & {
  readonly 0: '@check'
  readonly 1: {
    readonly value: SemanticGraph
    readonly type: SemanticGraph
  }
}

export const readCheckExpression = (
  node: SemanticGraph,
): Either<ElaborationError, CheckExpression> =>
  isKeywordExpressionWithArgument('@check', node) ?
    either.map(
      readArgumentsFromExpression(node, ['value', 'type']),
      ([value, type]) => makeCheckExpression({ value, type }),
    )
  : either.makeLeft({
      kind: 'invalidExpression',
      message: 'not a `@check` expression',
    })

export const makeCheckExpression = ({
  value,
  type,
}: {
  value: SemanticGraph
  type: SemanticGraph
}): CheckExpression =>
  makeObjectNode({
    0: '@check',
    1: makeObjectNode({ value, type }),
  })
