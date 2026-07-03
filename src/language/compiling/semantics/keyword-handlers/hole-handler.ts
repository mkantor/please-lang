import either, { type Either } from '@matt.kantor/either'
import type { ElaborationError } from '../../../errors.js'
import type {
  Expression,
  ExpressionContext,
  KeywordHandler,
  SemanticGraph,
} from '../../../semantics.js'

export const holeKeywordHandler: KeywordHandler = (
  expression: Expression,
  _context: ExpressionContext,
): Either<ElaborationError, SemanticGraph> =>
  // This is currently only used in types and doesn't need transformation here.
  either.makeRight(expression)
