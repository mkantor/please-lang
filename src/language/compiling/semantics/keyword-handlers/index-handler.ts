import either, { type Either } from '@matt.kantor/either'
import option from '@matt.kantor/option'
import type { ElaborationError } from '../../../errors.js'
import {
  applyKeyPathToType,
  attachSpanIfAbsent,
  containsAnyUnelaboratedNodes,
  inferType,
  readIndexExpression,
  stringifyTypeForEndUser,
  type Expression,
  type ExpressionContext,
  type KeywordHandler,
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
              )}\` does not exist on type \`${stringifyTypeForEndUser(objectType)}\``,
            }),
          )
    },
  )

export const indexKeywordHandler: KeywordHandler = (
  expression: Expression,
  context: ExpressionContext,
): Either<ElaborationError, SemanticGraph> =>
  either.flatMap(readIndexExpression(expression), indexExpression => {
    const {
      1: { object, query },
    } = indexExpression
    return either.flatMap(
      typeKeyPathFromObjectNode(
        query,
        { ...context, location: [...context.location, '1', 'query'] },
        inferType,
      ),
      typeKeyPath => {
        return either.flatMap(
          checkKeyPathExistsInType(object, typeKeyPath, context),
          _ =>
            (
              containsAnyUnelaboratedNodes(object) ||
              containsAnyUnelaboratedNodes(query)
            ) ?
              // The object isn't ready, so keep the @index unelaborated.
              either.makeRight(indexExpression)
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
  })
