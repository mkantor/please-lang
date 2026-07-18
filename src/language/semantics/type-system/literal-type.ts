import either, { type Either } from '@matt.kantor/either'
import type { Bug } from '../../errors.js'
import {
  getHoleTypeParameter,
  readHoleExpression,
} from '../expressions/hole-expression.js'
import {
  readExcessClauses,
  readObjectTypeExpression,
} from '../expressions/object-type-expression.js'
import { readUnionExpression } from '../expressions/union-expression.js'
import type { SemanticGraph } from '../semantic-graph.js'
import { atom, nothing, typesBySymbol } from './prelude-types.js'
import { makeObjectType } from './type-formats/object-type.js'
import type { Type } from './type-formats/type.js'
import { unionOfTypes } from './type-formats/union-type.js'

/**
 * Attempt to interpret `node` as a `Type` in a very basic way:
 * - `Atom`s become singleton `UnionType`s.
 * - `TypeSymbol`s are translated back to their corresponding `Type`s.
 * - `FunctionNode`s become `FunctionType`s with a corresponding signature.
 * - `@union`-shaped `ObjectNode`s become `UnionType`s.
 * - `@object`-shaped `ObjectNode`s become `ObjectType`s with their written
 *   excess clauses (in both modes; `objectsAreExact` only applies to plain
 *   object literals).
 * - `@hole`-shaped `ObjectNode`s become `TypeParameter`s.
 * - Everything else becomes an `ObjectType`.
 *
 * Warning: other than `@union`, `@object`, and `@hole`, there is no specific
 * expression handling here (e.g. `@function`-shaped `ObjectNode`s don't become
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
        // Is it an `@object`?
        either.match(
          either.flatMap(readObjectTypeExpression(node), objectTypeExpression =>
            either.map(readExcessClauses(objectTypeExpression), clauses => ({
              objectTypeExpression,
              clauses,
            })),
          ),
          {
            right: ({ objectTypeExpression, clauses }) =>
              either.flatMap(
                either.sequence(
                  Object.entries(objectTypeExpression[1].properties).map(
                    ([key, propertyValue]) =>
                      either.map(
                        typeFromSemanticGraph(propertyValue, options),
                        childType => [key, childType],
                      ),
                  ),
                ),
                children =>
                  either.map(
                    either.sequence(
                      clauses.map(clause =>
                        either.map(
                          either.sequence([
                            typeFromSemanticGraph(clause[0], options),
                            typeFromSemanticGraph(clause[1], options),
                          ]),
                          ([keys, values]) => ({ keys, values }),
                        ),
                      ),
                    ),
                    refinementClauses =>
                      makeObjectType(
                        Object.fromEntries(children),
                        refinementClauses,
                      ),
                  ),
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
                      makeObjectType(
                        Object.fromEntries(entries),
                        options.objectsAreExact ?
                          [{ keys: atom, values: nothing }]
                        : [],
                      ),
                  ),
              ),
          },
        ),
    })
  }
}
