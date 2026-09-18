import type { Either } from '@matt.kantor/either'
import either from '@matt.kantor/either'
import type { ElaborationError } from '../../errors.js'
import { isObjectNode, withProperty, type ObjectNode } from '../object-node.js'
import type { SemanticGraph } from '../semantic-graph.js'

export type TodoExpression = ObjectNode & {
  readonly 0: '@todo'
}

export const readTodoExpression = (
  node: SemanticGraph,
): Either<ElaborationError, TodoExpression> =>
  isObjectNode(node) && node[0] === '@todo' ?
    either.makeRight(withProperty(node, '0', '@todo'))
  : either.makeLeft({
      kind: 'invalidExpression',
      message: 'not a `@todo` expression',
    })
