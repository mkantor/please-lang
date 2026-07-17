import either, { type Either } from '@matt.kantor/either'
import type { ElaborationError } from '../../../errors.js'
import type {
  Expression,
  ExpressionContext,
  KeywordHandler,
  SemanticGraph,
} from '../../../semantics.js'
import {
  readExcessClauses,
  readObjectTypeExpression,
} from '../../../semantics/expressions/object-type-expression.js'

export const objectTypeKeywordHandler: KeywordHandler = (
  expression: Expression,
  _context: ExpressionContext,
): Either<ElaborationError, SemanticGraph> =>
  // This is only used in types and doesn't need transformation here, but it's
  // validated so that malformed `@object`s fail during elaboration rather than
  // surfacing later as surprising types.
  either.map(
    either.flatMap(readObjectTypeExpression(expression), readExcessClauses),
    _ => expression,
  )
