import either, { type Either } from '@matt.kantor/either'
import type { ElaborationError } from '../../errors.js'
import { isExpression, isKeywordExpressionWithArgument } from '../expression.js'
import {
  isObjectNode,
  makeObjectNode,
  type ObjectNode,
} from '../object-node.js'
import type { SemanticGraph } from '../semantic-graph.js'
import { readArgumentsFromExpression } from './expression-utilities.js'

export type ObjectTypeExpression = ObjectNode & {
  readonly 0: '@object'
  readonly 1: ObjectNode & {
    readonly properties: ObjectNode
    /**
     * Clauses bounding the values of properties not listed in `properties`, as
     * an enumerated object containing key/value pairs. For example:
     * ```plz
     * @object {
     *   properties: …
     *   excess: {
     *     { :atom.type, :integer.type }
     *     { :natural_number.type, :boolean.type }
     *   }
     * }
     * ```
     * When multiple clauses have overlapping keys, the last clause targeting
     * the given key takes effect. The example above means "natural-number-keyed
     * excess properties must have boolean values, while every other excess
     * property must have an integer value".
     */
    readonly excess: ObjectNode
  }
}

type ExcessClause = readonly [keys: SemanticGraph, values: SemanticGraph]

export const readObjectTypeExpression = (
  node: SemanticGraph,
): Either<ElaborationError, ObjectTypeExpression> =>
  isKeywordExpressionWithArgument('@object', node) ?
    either.flatMap(
      readArgumentsFromExpression(node, ['properties', 'excess']),
      ([properties, excess]): Either<ElaborationError, ObjectTypeExpression> =>
        either.flatMap(
          readPlainObjectOperand(properties, 'properties'),
          validProperties =>
            either.map(readPlainObjectOperand(excess, 'excess'), validExcess =>
              makeObjectTypeExpression(validProperties, validExcess),
            ),
        ),
    )
  : either.makeLeft({
      kind: 'invalidExpression',
      message: 'not an `@object` expression',
    })

const readPlainObjectOperand = (
  operand: SemanticGraph,
  operandName: string,
): Either<ElaborationError, ObjectNode> =>
  !isObjectNode(operand) ?
    either.makeLeft({
      kind: 'invalidExpression',
      message: `\`@object\` ${operandName} must be an object`,
    })
    // A keyword expression is itself an `ObjectNode`, so without this check
    // its `0`/`1` properties would silently be read as ordinary entries.
  : isExpression(operand) ?
    either.makeLeft({
      kind: 'invalidExpression',
      message: `\`@object\` ${operandName} must be an object, not a keyword expression`,
    })
  : either.makeRight(operand)

/**
 * Interpret an `@object` expression's `excess` operand as an ordered list of
 * clauses, validating its structure.
 */
export const readExcessClauses = (
  expression: ObjectTypeExpression,
): Either<ElaborationError, readonly ExcessClause[]> => {
  // Ordinal keys enumerate in ascending numeric order, giving clause order.
  const clauseEntries = Object.entries(expression[1].excess)
  if (clauseEntries.length === 0) {
    // A plain object should be used when there are no excess clauses.
    return either.makeLeft({
      kind: 'invalidExpression',
      message: '`@object` must have at least one excess clause',
    })
  } else {
    return either.sequence(
      clauseEntries.map(([key, clause], index) =>
        readExcessClause(key, clause, index),
      ),
    )
  }
}

const readExcessClause = (
  key: string,
  clause: SemanticGraph,
  index: number,
): Either<ElaborationError, ExcessClause> => {
  if (key !== String(index)) {
    return either.makeLeft({
      kind: 'invalidExpression',
      message:
        '`@object` excess clauses must be listed with ordinal keys (`0`, `1`, …)',
    })
  } else if (!isObjectNode(clause) || isExpression(clause)) {
    return either.makeLeft({
      kind: 'invalidExpression',
      message: '`@object` excess clauses must be pairs of key & value types',
    })
  } else if (
    Object.keys(clause).some(property => property !== '0' && property !== '1')
  ) {
    return either.makeLeft({
      kind: 'invalidExpression',
      message:
        '`@object` excess clauses may only have property keys `0` and `1`',
    })
  } else {
    const keys = clause['0']
    const values = clause['1']
    return (
      values === undefined ?
        either.makeLeft({
          kind: 'invalidExpression',
          message:
            '`@object` excess clauses must have a `1` property (the values type)',
        })
      : keys === undefined ?
        either.makeLeft({
          kind: 'invalidExpression',
          message:
            '`@object` excess clauses must have a `0` property (the keys type)',
        })
      : either.makeRight([keys, values])
    )
  }
}

export const makeObjectTypeExpression = (
  properties: ObjectNode,
  excess: ObjectNode,
): ObjectTypeExpression =>
  makeObjectNode({
    0: '@object',
    1: makeObjectNode({ properties, excess }),
  })
