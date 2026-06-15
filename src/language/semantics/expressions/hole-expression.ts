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
import { typeFromSemanticGraph } from '../type-system.js'
import type { TypeParameter } from '../type-system/type-formats.js'
import {
  isTypeParameter,
  makeTypeParameter,
} from '../type-system/type-formats.js'
import {
  ignoredKey,
  readArgumentsFromExpression,
} from './expression-utilities.js'

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
}
const typeParameterKey = Symbol('typeParameter')

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
              typeFromSemanticGraph(assignableToNode, {
                // Constraints are merely upper bounds.
                objectsAreExact: false,
              }),
              assignableTo => {
                const typeParameter =
                  existingTypeParameter ??
                  makeTypeParameter(name, { assignableTo })
                // Side effect: stash the type parameter on the original `node`
                // as well, so that reads from elsewhere (annotation inference,
                // `@lookup`s, etc) get the same identity.
                Object.assign(node, { [typeParameterKey]: typeParameter })
                const reconstructedNode = makeObjectNode({
                  0: '@hole',
                  1: makeObjectNode({
                    name,
                    constraint: makeObjectNode({
                      assignableTo: assignableToNode,
                    }),
                  }),
                })
                return Object.assign(reconstructedNode, {
                  [typeParameterKey]: typeParameter,
                })
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

export const makeHoleExpression = (
  name: Atom,
  constraint: HoleExpression[1]['constraint'],
  parameter: TypeParameter,
): HoleExpression =>
  Object.assign(
    makeObjectNode({
      0: '@hole',
      1: makeObjectNode({ name, constraint }),
    }),
    { [typeParameterKey]: parameter },
  )

export const getHoleTypeParameter = (node: HoleExpression): TypeParameter =>
  node[typeParameterKey]

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
