import either, { type Either } from '@matt.kantor/either'
import type { ElaborationError } from '../../../errors.js'
import {
  elaborateOperands,
  isAssignable,
  isFunctionNode,
  makeRuntimeExpression,
  readRuntimeExpression,
  replaceAllTypeParametersWithTheirConstraints,
  types,
  type Expression,
  type ExpressionContext,
  type SemanticGraph,
} from '../../../semantics.js'

export const runtimeKeywordHandler = (
  expression: Expression,
  context: ExpressionContext,
): Either<ElaborationError, SemanticGraph> =>
  either.flatMap(elaborateOperands(expression, context), ({ expression }) =>
    either.flatMap(
      readRuntimeExpression(expression),
      ({
        1: { function: runtimeFunction },
      }): Either<ElaborationError, SemanticGraph> => {
        if (isFunctionNode(runtimeFunction)) {
          const runtimeFunctionSignature = runtimeFunction.signature
          return (
              !isAssignable({
                source: types.runtimeContext,
                target: replaceAllTypeParametersWithTheirConstraints(
                  runtimeFunctionSignature.parameter,
                ),
              })
            ) ?
              either.makeLeft({
                kind: 'typeMismatch',
                message:
                  '@runtime function must accept a runtime context argument',
              })
            : either.makeRight(makeRuntimeExpression(runtimeFunction))
        } else {
          return either.makeLeft({
            kind: 'invalidExpression',
            message: '@runtime function was not a function',
          })
        }
      },
    ),
  )
