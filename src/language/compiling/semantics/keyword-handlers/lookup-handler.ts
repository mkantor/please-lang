import either, { type Either } from '@matt.kantor/either'
import option from '@matt.kantor/option'
import type { ElaborationError } from '../../../errors.js'
import type { Atom } from '../../../parsing.js'
import {
  elaborateOperands,
  isExpression,
  isObjectNode,
  lookup,
  matchSemanticGraph,
  readApplyExpression,
  readFunctionExpression,
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
                    left: _ =>
                      (
                        holdsResidualApplicationOfOwnFunction(new Set())(
                          foundValue,
                        )
                      ) ?
                        expression
                      : foundValue,
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

/**
 * Whether a value holds an unevaluated call to one of its own functions, like
 * `:f(1)` in `{ f: n => :m, x: :f(1) }`. `ownKeysInScope` are the value's keys
 * visible at `node`.
 */
const holdsResidualApplicationOfOwnFunction =
  (ownKeysInScope: ReadonlySet<Atom>) =>
  (node: SemanticGraph): boolean =>
    matchSemanticGraph(node, {
      atom: _ => false,
      function: _ => false,
      typeSymbol: _ => false,
      object: object =>
        isExpression(object) ?
          either.match(readFunctionExpression(object), {
            right: _ => false,
            left: _ =>
              either.match(readApplyExpression(object), {
                right: _ => mentionsOwnFunction(ownKeysInScope)(object),
                left: _ =>
                  operandsOf(object).some(
                    holdsResidualApplicationOfOwnFunction(ownKeysInScope),
                  ),
              }),
          })
        : Object.values(object).some(
            holdsResidualApplicationOfOwnFunction(
              ownKeysInScope.union(new Set(Object.keys(object))),
            ),
          ),
    })

const mentionsOwnFunction =
  (keysBoundWithinValue: ReadonlySet<Atom>) =>
  (node: SemanticGraph): boolean =>
    matchSemanticGraph(node, {
      atom: _ => false,
      function: functionNode =>
        either.match(functionNode.serialize(), {
          right: mentionsOwnFunction(keysBoundWithinValue),
          left: _ => true,
        }),
      typeSymbol: _ => false,
      object: object =>
        either.match(readLookupExpression(object), {
          right: ({ 1: { key } }) => keysBoundWithinValue.has(key),
          left: _ =>
            isExpression(object) ?
              either.match(readFunctionExpression(object), {
                right: _ => true,
                left: _ =>
                  operandsOf(object).some(
                    mentionsOwnFunction(keysBoundWithinValue),
                  ),
              })
            : Object.values(object).some(
                mentionsOwnFunction(keysBoundWithinValue),
              ),
        }),
    })

const operandsOf = (expression: Expression): readonly SemanticGraph[] => {
  const operands = expression[1]
  return typeof operands === 'object' ? Object.values(operands) : []
}
