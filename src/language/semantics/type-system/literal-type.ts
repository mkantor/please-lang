import either, { type Either } from '@matt.kantor/either'
import type { Bug } from '../../errors.js'
import {
  getHoleTypeParameter,
  readHoleExpression,
} from '../expressions/hole-expression.js'
import { readUnionExpression } from '../expressions/union-expression.js'
import type { SemanticGraph } from '../semantic-graph.js'
import { typesBySymbol } from './prelude-types.js'
import { makeObjectType, unionOfTypes, type Type } from './type-formats.js'

/**
 * Attempt to interpret `node` as a `Type` in a very basic way:
 * - `Atom`s become singleton `UnionType`s.
 * - `TypeSymbol`s are translated back to their corresponding `Type`s.
 * - `FunctionNode`s become `FunctionType`s with a corresponding signature.
 * - `@union`-shaped `ObjectNode`s become `UnionType`s.
 * - `@hole`-shaped `ObjectNode`s become `TypeParameter`s.
 * - Everything else becomes an `ObjectType`.
 *
 * Warning: other than `@union` and `@hole`, there is no specific expression
 * handling here (e.g. `@function`-shaped `ObjectNode`s don't become
 * `FunctionType`s, `@index`-shaped `ObjectNode`s don't `IndexedAccessType`s,
 * etc). Use `inferType` instead when more sophisticated translation is desired.
 */
export const typeFromSemanticGraph = (
  node: SemanticGraph,
  options: { readonly objectsAreExact: boolean },
): Either<Bug, Type> => {
  if (typeof node === 'string') {
    return either.makeRight({
      kind: 'union',
      members: new Set([node]),
    })
  } else if (typeof node === 'symbol') {
    if (node in typesBySymbol) {
      return either.makeRight(typesBySymbol[node])
    } else {
      return either.makeLeft({
        kind: 'bug',
        message: 'semantic graph contained an unknown symbol',
      })
    }
  } else if (typeof node === 'function') {
    return either.makeRight({
      kind: 'function',
      signature: node.signature,
    })
  } else {
    // Is it a `@union`?
    return either.match(readUnionExpression(node), {
      right: unionExpression =>
        either.map(
          either.sequence(
            Object.values(unionExpression[1]).map(member =>
              typeFromSemanticGraph(member, options),
            ),
          ),
          unionOfTypes,
        ),
      left: _ =>
        // Is it a `@hole`?
        either.flatMapLeft(
          either.map(readHoleExpression(node), getHoleTypeParameter),
          _ =>
            // Interpret `node` as an object type.
            either.map(
              either.sequence(
                Object.entries(node).map(([key, value]) =>
                  either.map(
                    typeFromSemanticGraph(value, options),
                    childType => [key, childType],
                  ),
                ),
              ),
              entries =>
                makeObjectType(Object.fromEntries(entries), {
                  exact: options.objectsAreExact,
                }),
            ),
        ),
    })
  }
}
