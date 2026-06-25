import either, { type Either } from '@matt.kantor/either'
import type { ElaborationError } from '../../../errors.js'
import {
  attachSpanIfAbsent,
  isAssignable,
  readCheckExpression,
  stringifySemanticGraphForEndUser,
  stringifyTypeForEndUser,
  type Expression,
  type ExpressionContext,
  type KeywordHandler,
  type SemanticGraph,
} from '../../../semantics.js'
import {
  inferType,
  recursivelyInexact,
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
    attachSpanIfAbsent(
      inferType(value, subContextForValue),
      subContextForValue,
    ),
    valueAsType =>
      either.flatMap(
        attachSpanIfAbsent(
          inferType(type, subContextForType),
          subContextForType,
        ),
        typeAsType => {
          // `@check` targets are upper bounds; they allow width subtyping.
          const targetType = recursivelyInexact(typeAsType)
          return isAssignable({ source: valueAsType, target: targetType }) ?
              either.makeRight(value)
              // The value is what failed the check, so blame it specifically.
            : attachSpanIfAbsent<SemanticGraph>(
                either.makeLeft({
                  kind: 'typeMismatch',
                  message: `the value \`${stringifySemanticGraphForEndUser(
                    value,
                  )}\` ${isSingletonType(valueAsType) ? '' : `(inferred to have type \`${stringifyTypeForEndUser(valueAsType)}\`) `}is not assignable to the type \`${stringifyTypeForEndUser(targetType)}\``,
                }),
                subContextForValue,
              )
        },
      ),
  )
}

export const checkKeywordHandler: KeywordHandler = (
  expression: Expression,
  context: ExpressionContext,
): Either<ElaborationError, SemanticGraph> =>
  either.flatMap(readCheckExpression(expression), ({ 1: { value, type } }) =>
    check({ value, type, context }),
  )
