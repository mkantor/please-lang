import either, { type Either } from '@matt.kantor/either'
import type { ElaborationError } from '../../../errors.js'
import {
  attachSpanIfAbsent,
  elaborateOperands,
  isAssignable,
  readCheckExpression,
  stringifyResolvedTypeForEndUser,
  stringifySemanticGraphForEndUser,
  type Expression,
  type ExpressionContext,
  type SemanticGraph,
} from '../../../semantics.js'
import {
  inferType,
  inferTypeOfTypeAnnotation,
} from '../../../semantics/type-system.js'
import { isSingletonType } from '../../../semantics/type-system/type-substitution.js'

const check = ({
  value,
  type,
  context,
}: {
  readonly value: SemanticGraph
  readonly type: SemanticGraph
  readonly context: ExpressionContext
}): Either<ElaborationError, SemanticGraph> => {
  const subContextForValue = {
    ...context,
    location: [...context.location, '1', 'value'],
  }
  const subContextForType = {
    ...context,
    location: [...context.location, '1', 'type'],
  }
  return either.flatMap(
    either.mapLeft(
      inferType(value, subContextForValue),
      attachSpanIfAbsent(subContextForValue),
    ),
    valueAsType =>
      either.flatMap(
        either.mapLeft(
          inferTypeOfTypeAnnotation(type, subContextForType),
          attachSpanIfAbsent(subContextForType),
        ),
        targetType =>
          isAssignable({ source: valueAsType, target: targetType }) ?
            either.makeRight(value)
            // The value is what failed the check, so blame it specifically.
          : either.makeLeft(
              attachSpanIfAbsent(subContextForValue)({
                kind: 'typeMismatch',
                message: `the value \`${stringifySemanticGraphForEndUser(
                  value,
                )}\` ${isSingletonType(valueAsType) ? '' : `(inferred to have type \`${stringifyResolvedTypeForEndUser(valueAsType)}\`) `}is not assignable to the type \`${stringifyResolvedTypeForEndUser(targetType)}\``,
              }),
            ),
      ),
  )
}

export const checkKeywordHandler = (
  expression: Expression,
  context: ExpressionContext,
): Either<ElaborationError, SemanticGraph> =>
  either.flatMap(
    elaborateOperands(expression, context),
    ({ expression, context }) =>
      either.flatMap(
        readCheckExpression(expression),
        ({ 1: { value, type } }) => check({ value, type, context }),
      ),
  )
