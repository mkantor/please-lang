import either, { type Either } from '@matt.kantor/either'
import option from '@matt.kantor/option'
import type { ElaborationError } from '../../../errors.js'
import {
  elaborateOperands,
  isObjectNode,
  lookup,
  readHoleExpression,
  readLookupExpression,
  stringifySemanticGraphForEndUser,
  type Expression,
  type ExpressionContext,
  type SemanticGraph,
} from '../../../semantics.js'

export const lookupKeywordHandler = (
  expression: Expression,
  context: ExpressionContext,
): Either<ElaborationError, SemanticGraph> =>
  either.flatMap(
    elaborateOperands(expression, context),
    ({ expression, context }) =>
      either.flatMap(readLookupExpression(expression), ({ 1: { key } }) => {
        if (isObjectNode(context.program)) {
          return either.flatMap(lookup({ context, key }), successfulLookup =>
            option.match(successfulLookup, {
              none: _ =>
                either.makeLeft({
                  kind: 'invalidExpression',
                  message: `cannot find a value for \`${stringifySemanticGraphForEndUser(expression)}\``,
                }),
              some: ({ foundValue }) =>
                either.makeRight(
                  either.match(readHoleExpression(foundValue), {
                    // `@hole`s are kept as `@lookup`s rather than being inlined as
                    // values, otherwise a looked-up hole would be indistinguishable
                    // from its declaration. It's necessary to know where type
                    // parameters are introduced during instantiation (to handle
                    // rigidity/flexibility).
                    right: _hole => expression,
                    left: _ => foundValue,
                  }),
                ),
            }),
          )
        } else {
          return either.makeLeft({
            kind: 'invalidExpression',
            message: 'the program has no properties',
          })
        }
      }),
  )
