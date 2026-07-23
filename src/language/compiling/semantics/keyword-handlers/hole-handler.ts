import either, { type Either } from '@matt.kantor/either'
import type { ElaborationError } from '../../../errors.js'
import {
  elaborateOperands,
  type Expression,
  type ExpressionContext,
  type SemanticGraph,
} from '../../../semantics.js'

export const holeKeywordHandler = (
  expression: Expression,
  context: ExpressionContext,
): Either<ElaborationError, SemanticGraph> =>
  // This is currently only used in types and doesn't need transformation here.
  either.map(
    elaborateOperands(expression, context),
    ({ expression }) => expression,
  )
