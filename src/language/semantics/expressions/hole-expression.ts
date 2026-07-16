import either, { type Either } from '@matt.kantor/either'
import type { ElaborationError } from '../../errors.js'
import type { Atom } from '../../parsing.js'
import { isKeywordExpressionWithArgument } from '../expression.js'
import { isFunctionNode } from '../function-node.js'
import {
  isObjectNode,
  makeObjectNode,
  type ObjectNode,
} from '../object-node.js'
import type { SemanticGraph } from '../semantic-graph.js'
import {
  isTypeParameter,
  makeTypeParameter,
  typeFromSemanticGraph,
  types,
  type TypeParameter,
} from '../type-system.js'
import {
  ignoredKey,
  readArgumentsFromExpression,
} from './expression-utilities.js'

/**
 * The source of truth for a hole's constraint:
 * - `'expression'`: resolve it from the expression itself (`[1].constraint`).
 *   Resolution occurs with a specific `ExpressionContext` (so constraints
 *   containing `@lookup`s are correctly scoped).
 * - `'typeParameter'`: the constraint has already been resolved and is stored
 *   in the hole's type parameter (`typeParameterKey`). It shouldn't be
 *   re-derived from the expression.
 */
export type HoleConstraintSource = 'expression' | 'typeParameter'

export type HoleExpression = ObjectNode & {
  readonly 0: '@hole'
  readonly 1: ObjectNode & {
    readonly name: Atom
    readonly constraint: ObjectNode & {
      readonly assignableTo: SemanticGraph
    }
  }

  // This is stashed on the node so that repeated reads (e.g. successive
  // type-inference passes) return a parameter with stable identity.
  readonly [typeParameterKey]: TypeParameter

  // The source of truth for this hole's constraint. See `HoleConstraintSource`.
  readonly [constraintSourceKey]: HoleConstraintSource
}
const typeParameterKey = Symbol('typeParameter')
const constraintSourceKey = Symbol('constraintSource')

/**
 * Mints a new type parameter for the node if one doesn't already exist.
 */
export const readHoleExpression = (
  node: SemanticGraph,
): Either<ElaborationError, HoleExpression> =>
  isKeywordExpressionWithArgument('@hole', node) ?
    either.flatMap(
      readArgumentsFromExpression(node, ['name', 'constraint']),
      ([name, constraint]) => {
        if (typeof name !== 'string') {
          return either.makeLeft<ElaborationError>({
            kind: 'invalidExpression',
            message: '`@hole` name must be an atom',
          })
        } else if (!isObjectNode(constraint)) {
          return either.makeLeft({
            kind: 'invalidExpression',
            message: '`@hole` constraint must be an object',
          })
        } else if (
          typeParameterKey in node &&
          typeof node[typeParameterKey] !== 'object'
        ) {
          return either.makeLeft({
            kind: 'bug',
            message:
              '`@hole` had an existing type parameter that was not actually a type parameter',
          })
        } else {
          const assignableToNode = constraint['assignableTo']
          if (assignableToNode === undefined) {
            return either.makeLeft({
              kind: 'invalidExpression',
              message:
                '`@hole` constraint must contain an `assignableTo` property',
            })
          } else {
            const existingTypeParameter =
              (
                typeParameterKey in node &&
                isTypeParameter(node[typeParameterKey])
              ) ?
                node[typeParameterKey]
              : undefined
            return either.map(
              // TODO: Try to get an `ExpressionContext` in here so `inferType`
              // can be used instead of `typeFromSemanticGraph`. That'd probably
              // eliminate the need to resolve constraints anywhere else and
              // would allow ditching the constraint source stuff.
              typeFromSemanticGraph(assignableToNode, {
                // Constraints are merely upper bounds.
                objectsAreExact: false,
              }),
              eagerlyResolvedConstraint => {
                const constraintIsResolvable =
                  existingTypeParameter === undefined &&
                  // A constraint referencing a type parameter via `@lookup`
                  // can't be resolved here as we don't have context. Start from
                  // a provisional top bound; type inference resolves the real
                  // constraint (see the `@hole` case in `type-inference.ts`).
                  !containsLookupExpression(assignableToNode)

                const typeParameter =
                  existingTypeParameter ??
                  makeTypeParameter(name, {
                    assignableTo:
                      constraintIsResolvable ?
                        eagerlyResolvedConstraint
                      : types.something,
                  })

                const constraintSource: HoleConstraintSource =
                  (
                    constraintIsResolvable ||
                    (constraintSourceKey in node &&
                      node[constraintSourceKey] === 'typeParameter')
                  ) ?
                    'typeParameter'
                  : 'expression'

                // Side effect: set the type parameter and constraint source on
                // the original node so that reads from elsewhere share the
                // same identity (and constraint source).
                Object.assign(node, {
                  [typeParameterKey]: typeParameter,
                  [constraintSourceKey]: constraintSource,
                })

                return {
                  [typeParameterKey]: typeParameter,
                  [constraintSourceKey]: constraintSource,
                  ...makeObjectNode({
                    0: '@hole',
                    1: makeObjectNode({
                      name,
                      constraint: makeObjectNode({
                        assignableTo: assignableToNode,
                      }),
                    }),
                  }),
                }
              },
            )
          }
        }
      },
    )
  : either.makeLeft({
      kind: 'invalidExpression',
      message: 'not a `@hole` expression',
    })

export const makeHoleExpressionWithExtantTypeParameter = (
  name: Atom,
  constraint: HoleExpression[1]['constraint'],
  parameter: TypeParameter,
): HoleExpression =>
  Object.assign(
    makeObjectNode({
      0: '@hole',
      1: makeObjectNode({ name, constraint }),
    }),
    {
      [typeParameterKey]: parameter,
      [constraintSourceKey]: 'typeParameter' as const,
    },
  )

export const getHoleTypeParameter = (node: HoleExpression): TypeParameter =>
  node[typeParameterKey]

export const getHoleConstraintSource = (
  node: HoleExpression,
): HoleConstraintSource => node[constraintSourceKey]

/**
 * Walk an annotation, returning a `Map` from hole names to their expressions.
 *
 * Duplicates (after the first occurrence per name) are silently dropped. Use
 * `findDuplicateHoleNames` to detect them.
 */
export const collectHolesByName = (
  annotation: SemanticGraph,
): ReadonlyMap<Atom, HoleExpression> => {
  const collect = (
    accumulator: Map<Atom, HoleExpression>,
    node: SemanticGraph,
  ): Map<Atom, HoleExpression> => {
    const holeExpressionResult = readHoleExpression(node)
    if (
      either.isRight(holeExpressionResult) &&
      typeParameterKey in holeExpressionResult.value
    ) {
      const node = holeExpressionResult.value
      const name = node[1].name
      if (!accumulator.has(name)) {
        // Side effect: remember the hole.
        accumulator.set(name, node)
      }
      return accumulator
    } else if (isFunctionNode(node)) {
      return either.match(node.serialize(), {
        right: serialized => collect(accumulator, serialized),
        left: _ => accumulator,
      })
    } else if (!isObjectNode(node)) {
      return accumulator
    } else {
      return Object.values(node).reduce(collect, accumulator)
    }
  }
  return collect(new Map(), annotation)
}

/**
 * Walk an annotation, returning the identity of every hole's type parameter.
 * Unlike `collectHolesByName` this does not deduplicate by name, so every
 * anonymous hole is included.
 */
export const collectHoleTypeParameterIdentities = (
  annotation: SemanticGraph,
): ReadonlySet<symbol> => {
  const collect = (node: SemanticGraph): readonly symbol[] =>
    either.match(readHoleExpression(node), {
      right: holeExpression => [getHoleTypeParameter(holeExpression).identity],
      left: _ => {
        if (isFunctionNode(node)) {
          return either.match(node.serialize(), {
            right: collect,
            left: _ => [],
          })
        } else if (isObjectNode(node)) {
          return Object.values(node).flatMap(collect)
        } else {
          return []
        }
      },
    })
  return new Set(collect(annotation))
}

/**
 * Walk an annotation, returning the set of hole names that appear more than
 * once. Anonymous holes are skipped.
 */
export const findDuplicateHoleNames = (
  annotation: SemanticGraph,
): ReadonlySet<Atom> => {
  // TODO: Consider less-imperative/more-functional approaches for this.
  const seen = new Set<Atom>()
  const duplicates = new Set<Atom>()
  const visit = (node: SemanticGraph): void => {
    const holeExpressionResult = readHoleExpression(node)
    if (
      either.isRight(holeExpressionResult) &&
      typeParameterKey in holeExpressionResult.value
    ) {
      const node = holeExpressionResult.value
      const name = node[1].name
      // Side effect: add `name` to `seen` or `duplicates`.
      if (
        seen.has(name) &&
        // Allow multiple anonymous holes in an annotation.
        name !== ignoredKey
      ) {
        duplicates.add(name)
      } else {
        seen.add(name)
      }
    } else {
      if (isFunctionNode(node)) {
        const serialized = node.serialize()
        if (either.isRight(serialized)) {
          visit(serialized.value)
        }
      } else if (isObjectNode(node)) {
        for (const value of Object.values(node)) {
          visit(value)
        }
      }
    }
  }
  visit(annotation)
  return duplicates
}

const containsLookupExpression = (node: SemanticGraph): boolean =>
  isKeywordExpressionWithArgument('@lookup', node) ||
  (isFunctionNode(node) ?
    either.match(node.serialize(), {
      right: containsLookupExpression,
      left: _ => false,
    })
  : isObjectNode(node) ? Object.values(node).some(containsLookupExpression)
  : false)
