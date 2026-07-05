import either, { type Either } from '@matt.kantor/either'
import option, { type Option } from '@matt.kantor/option'
import type { ElaborationError } from '../../errors.js'
import type { Atom, Molecule } from '../../parsing.js'
import { inlinePlz, sugarFreeInlinePlz, unparse } from '../../unparsing.js'
import type { ExpressionContext } from '../expression-elaboration.js'
import type { Expression } from '../expression.js'
import { isFunctionNode } from '../function-node.js'
import { isSemanticGraph } from '../is-semantic-graph.js'
import { stringifyKeyPathForEndUser } from '../key-path.js'
import {
  lookupPropertyOfObjectNode,
  objectNodeFromMolecule,
  type ObjectNode,
} from '../object-node.js'
import {
  applyKeyPathToSemanticGraph,
  stringifySemanticGraphForEndUser,
  type SemanticGraph,
} from '../semantic-graph.js'

/**
 * This name is used for ignored parameters/properties and can't be directly
 * looked-up.
 */
export const ignoredKey = '_'

export const asSemanticGraph = (
  value: SemanticGraph | Molecule,
): SemanticGraph =>
  isSemanticGraph(value) ? value : objectNodeFromMolecule(value)

export const locateSelf = (context: ExpressionContext) =>
  option.match(applyKeyPathToSemanticGraph(context.program, context.location), {
    none: () =>
      either.makeLeft({
        kind: 'bug',
        message: `failed to locate self at \`${stringifyKeyPathForEndUser(
          context.location,
        )}\` in program`,
      }),
    some: either.makeRight,
  })

export const readArgumentsFromExpression = <
  const Specification extends readonly string[],
>(
  expression: Expression,
  specification: Specification,
): Either<ElaborationError, ParsedExpressionArguments<Specification>> => {
  if (expression[1] === undefined) {
    return either.makeLeft({
      kind: 'invalidExpression',
      message: `missing arguments object`,
    })
  } else if (typeof expression[1] === 'string') {
    return either.makeLeft({
      kind: 'invalidExpression',
      message: `found an atom instead of an arguments object`,
    })
  } else if (typeof expression[1] === 'symbol') {
    return either.makeLeft({
      kind: 'invalidExpression',
      message: `found a symbol instead of an arguments object`,
    })
  } else if (isFunctionNode(expression[1])) {
    return either.makeLeft({
      kind: 'invalidExpression',
      message: `found a function instead of an arguments object`,
    })
  } else {
    const expressionArguments: ObjectNode[string][] = []
    for (const [position, keyword] of specification.entries()) {
      const argument = lookupWithinObjectNode(
        [keyword, String(position)],
        expression[1],
      )
      if (option.isNone(argument)) {
        const requiredKeySummary = `\`${keyword}\` or \`${position}\``
        return either.makeLeft({
          kind: 'invalidExpression',
          message: `missing required property ${requiredKeySummary} within ${expression['0']} expression: \`${stringifySemanticGraphForEndUser(
            expression,
            sugarFreeInlinePlz,
          )}\``,
        })
      } else {
        expressionArguments.push(argument.value)
      }
    }
    return either.makeRight(
      // This is correct since the above loop pushes one argument for each
      // `specification` element.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      expressionArguments as ParsedExpressionArguments<Specification>,
    )
  }
}
type ParsedExpressionArguments<Specification extends readonly string[]> = {
  [Index in keyof Specification]: ObjectNode[string]
}

export const stringifyKeyForEndUser = (key: Atom): string =>
  either.match(unparse(key, inlinePlz), {
    right: stringifiedOutput => stringifiedOutput,
    left: error => `(unserializable key: ${error.message})`,
  })

const lookupWithinObjectNode = (
  keyAliases: readonly [Atom, ...(readonly Atom[])],
  node: ObjectNode,
): Option<SemanticGraph> => {
  for (const key of keyAliases) {
    const result = lookupPropertyOfObjectNode(key, node)
    if (!option.isNone(result)) {
      return result
    }
  }
  return option.none
}
