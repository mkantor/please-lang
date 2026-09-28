import either, { type Either } from '@matt.kantor/either'
import option, { type Option } from '@matt.kantor/option'
import type { ElaborationError } from '../../../errors.js'
import {
  applyKeyPathToType,
  attachSpanIfAbsent,
  containsAnyUnelaboratedNodes,
  elaborateOperands,
  inferType,
  isExpression,
  isObjectNode,
  lookup,
  makeIndexExpression,
  readIndexExpression,
  readLookupExpression,
  stringifyResolvedTypeForEndUser,
  type Expression,
  type ExpressionContext,
  type IndexExpression,
  type SemanticGraph,
} from '../../../semantics.js'
import { applyTypeKeyPathToSemanticGraph } from '../../../semantics/semantic-graph.js'
import {
  stringifyTypeKeyPathForEndUser,
  typeKeyPathFromObjectNode,
  type TypeKeyPath,
} from '../../../semantics/type-system.js'

const checkKeyPathExistsInType = (
  object: SemanticGraph,
  keyPath: TypeKeyPath,
  context: ExpressionContext,
): Either<ElaborationError, undefined> =>
  either.flatMap(
    inferType(object, {
      ...context,
      location: [...context.location, '1', 'object'],
    }),
    objectType => {
      // `-1` if the entire `keyPath` is resolvable.
      const firstUnresolvableComponentIndex = keyPath.findIndex(
        (_component, endIndex) =>
          option.isNone(
            applyKeyPathToType(objectType, keyPath.slice(0, endIndex + 1)),
          ),
      )
      return firstUnresolvableComponentIndex === -1 ?
          either.makeRight(undefined)
        : either.makeLeft(
            attachSpanIfAbsent({
              ...context,
              location: [
                ...context.location,
                '1',
                'query',
                String(firstUnresolvableComponentIndex),
              ],
            })({
              kind: 'typeMismatch',
              message: `property \`${stringifyTypeKeyPathForEndUser(
                keyPath.slice(0, firstUnresolvableComponentIndex + 1),
              )}\` does not exist on type \`${stringifyResolvedTypeForEndUser(objectType)}\``,
            }),
          )
    },
  )

export const indexKeywordHandler = (
  unelaboratedExpression: Expression,
  context: ExpressionContext,
): Either<ElaborationError, SemanticGraph> =>
  either.flatMap(
    elaborateOperands(unelaboratedExpression, context),
    ({ expression, context }) =>
      either.flatMap(readIndexExpression(expression), indexExpression => {
        const {
          1: { object: objectOperand, query },
        } = indexExpression
        const object = dereferenced(objectOperand, {
          ...context,
          location: [...context.location, '1', 'object'],
        })
        return either.flatMap(
          typeKeyPathFromObjectNode(query, {
            ...context,
            location: [...context.location, '1', 'query'],
          }),
          typeKeyPath => {
            return either.flatMap(
              checkKeyPathExistsInType(objectOperand, typeKeyPath, context),
              _ =>
                (
                  !isReadableAlong(
                    object,
                    typeKeyPath,
                    unelaboratedExpression,
                  ) || containsAnyUnelaboratedNodes(query)
                ) ?
                  either.makeRight(
                    residualIndexExpression(
                      unelaboratedExpression,
                      indexExpression,
                    ),
                  )
                : option.match(
                    applyTypeKeyPathToSemanticGraph(object, typeKeyPath),
                    {
                      none: _ =>
                        // This error is less specific than the one from
                        // `checkKeyPathExistsInType`, but since that's used for
                        // static analysis this isn't expected to ever surface.
                        either.makeLeft(
                          attachSpanIfAbsent({
                            ...context,
                            location: [...context.location, '1', 'query'],
                          })({
                            kind: 'typeMismatch',
                            message: `property \`${stringifyTypeKeyPathForEndUser(
                              typeKeyPath,
                            )}\` not found`,
                          }),
                        ),
                      some: either.makeRight,
                    },
                  ),
            )
          },
        )
      }),
  )

/**
 * The value `object` refers to, if it's a `@lookup` which stayed a reference
 * (see `lookupKeywordHandler`).
 */
const dereferenced = (
  object: SemanticGraph,
  context: ExpressionContext,
): SemanticGraph =>
  either.match(readLookupExpression(object), {
    left: _ => object,
    right: ({ 1: { key } }) =>
      either.match(lookup({ key, context }), {
        left: _ => object,
        right: foundBinding =>
          option.match(foundBinding, {
            none: _ => object,
            some: ({ foundValue }) => foundValue,
          }),
      }),
  })

const isElaboratedAlong = (
  object: SemanticGraph,
  keyPath: TypeKeyPath,
): boolean => {
  const [firstKey, ...remainingKeyPath] = keyPath
  const next =
    (
      typeof firstKey === 'string' &&
      isObjectNode(object) &&
      !isExpression(object)
    ) ?
      object[firstKey]
    : undefined
  return next === undefined ?
      !containsAnyUnelaboratedNodes(object)
    : isElaboratedAlong(next, remainingKeyPath)
}

/**
 * Only `keyPath` matters for an object from a `@lookup`. Any other object is
 * discarded once read, which would lose the effects of its unelaborated parts.
 */
const isReadableAlong = (
  object: SemanticGraph,
  keyPath: TypeKeyPath,
  unelaboratedExpression: Expression,
): boolean =>
  isElaboratedAlong(object, keyPath) &&
  option.match(objectLookupOf(unelaboratedExpression), {
    none: _ => isElaboratedButForReferences(object),
    some: _ => true,
  })

const isElaboratedButForReferences = (node: SemanticGraph): boolean =>
  isReference(node) ||
  (isObjectNode(node) && !isExpression(node) ?
    Object.values(node).every(isElaboratedButForReferences)
  : !containsAnyUnelaboratedNodes(node))

const isReference = (node: SemanticGraph): boolean =>
  either.match(readLookupExpression(node), {
    left: _ =>
      either.match(readIndexExpression(node), {
        left: _ => false,
        right: ({ 1: { object, query } }) =>
          isReference(object) && !containsAnyUnelaboratedNodes(query),
      }),
    right: _ => true,
  })

/**
 * The residual of `:a.b` keeps `:a` as its object. The value `:a` refers to
 * may contain `:a.b` itself.
 */
const residualIndexExpression = (
  unelaboratedExpression: Expression,
  elaboratedIndexExpression: IndexExpression,
): IndexExpression =>
  option.match(objectLookupOf(unelaboratedExpression), {
    none: _ => elaboratedIndexExpression,
    some: object =>
      makeIndexExpression({
        object,
        query: elaboratedIndexExpression[1].query,
      }),
  })

/**
 * The object of an `@index` as it was in the source, if it was a `@lookup`.
 */
const objectLookupOf = (
  unelaboratedExpression: Expression,
): Option<Expression> =>
  either.match(readIndexExpression(unelaboratedExpression), {
    left: _ => option.none,
    right: ({ 1: { object } }) =>
      isExpression(object) && object['0'] === '@lookup' ?
        option.makeSome(object)
      : option.none,
  })
