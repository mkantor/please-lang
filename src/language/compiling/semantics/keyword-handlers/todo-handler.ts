import either, { type Either } from '@matt.kantor/either'
import type { ElaborationError } from '../../../errors.js'
import {
  elaborateOperands,
  objectNodeFromOrderedEntries,
  type Expression,
  type ExpressionContext,
  type SemanticGraph,
} from '../../../semantics.js'

export const todoKeywordHandler = (
  expression: Expression,
  context: ExpressionContext,
): Either<ElaborationError, SemanticGraph> =>
  // Operands are elaborated only so that errors within them surface.
  either.map(elaborateOperands(expression, context), _ =>
    // TODO: Consider producing the unit value instead. Make sure to update
    // `inferType` as well.
    objectNodeFromOrderedEntries([]),
  )
