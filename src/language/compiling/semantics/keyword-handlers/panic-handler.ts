import either, { type Either } from '@matt.kantor/either'
import type { ElaborationError } from '../../../errors.js'
import {
  elaborateOperands,
  stringifySemanticGraphForEndUser,
  type Expression,
  type ExpressionContext,
  type SemanticGraph,
} from '../../../semantics.js'

export const panicKeywordHandler = (
  expression: Expression,
  context: ExpressionContext,
): Either<ElaborationError, SemanticGraph> =>
  either.flatMap(
    elaborateOperands(expression, context),
    ({ expression, context }) =>
      context.panicsAreDeferred ?
        either.makeRight(expression)
      : either.makeLeft({
          kind: 'panic',
          message: stringifySemanticGraphForEndUser(expression),
        }),
  )
