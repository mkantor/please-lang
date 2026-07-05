import either, { type Either } from '@matt.kantor/either'
import type { ElaborationError } from '../../errors.js'
import { isKeywordExpressionWithArgument } from '../expression.js'
import {
  isObjectNode,
  makeObjectNode,
  type ObjectNode,
} from '../object-node.js'
import type { SemanticGraph } from '../semantic-graph.js'
import { readArgumentsFromExpression } from './expression-utilities.js'

export type IndexExpression = ObjectNode & {
  readonly 0: '@index'
  readonly 1: {
    readonly object: SemanticGraph
    readonly query: ObjectNode
  }
}

export const readIndexExpression = (
  node: SemanticGraph,
): Either<ElaborationError, IndexExpression> =>
  isKeywordExpressionWithArgument('@index', node) ?
    either.flatMap(
      readArgumentsFromExpression(node, ['object', 'query']),
      ([object, query]) =>
        !isObjectNode(query) ?
          either.makeLeft({
            kind: 'invalidExpression',
            message: 'query must be an object',
          })
        : either.makeRight(makeIndexExpression({ object, query })),
    )
  : either.makeLeft({
      kind: 'invalidExpression',
      message: 'not an `@index` expression',
    })

export const makeIndexExpression = ({
  query,
  object,
}: {
  readonly query: ObjectNode
  readonly object: SemanticGraph
}): IndexExpression =>
  makeObjectNode({
    0: '@index',
    1: makeObjectNode({
      object,
      query,
    }),
  })
