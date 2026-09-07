import option, { type Option } from '@matt.kantor/option'
import type { Atom } from '../../parsing.js'
import * as types from './prelude-types.js'
import { isPendingType, typesAreEquivalent } from './subtyping.js'
import {
  makeTypeParameter,
  type TypeParameter,
} from './type-formats/type-parameter-type.js'
import type { Type } from './type-formats/type.js'
import {
  getTypesForTypeParameters,
  supplyTypeArguments,
} from './type-substitution.js'

/**
 * "Canonical spellings" of types are their preferred user-facing rendering,
 * e.g. `true | false` renders as `:Boolean`.
 */
export type CanonicalSpelling = {
  readonly name: Atom
  readonly typeArguments: readonly Type[]
}

export const canonicalSpellingOf = (type: Type): Option<CanonicalSpelling> =>
  containsPendingType(type) ?
    option.none
  : canonicalTypeSpellings.reduce<Option<CanonicalSpelling>>(
      (spellingSoFar, spelling) =>
        option.match(spellingSoFar, {
          none: _ => {
            // Check if `type` matches this `spelling`.
            const parameters = spelling.parameterNames.map(name =>
              makeTypeParameter(name, { assignableTo: types.something }),
            )
            const pattern = spelling.type(...parameters)
            const bindings = getTypesForTypeParameters({
              parameterType: pattern,
              argumentType: type,
            })
            return option.flatMap(
              option.sequence(
                parameters.map(parameter => typeBoundTo(parameter, bindings)),
              ),
              typeArguments =>
                (
                  typesAreEquivalent(
                    supplyTypeArguments(pattern, bindings),
                    type,
                  )
                ) ?
                  option.makeSome({ name: spelling.name, typeArguments })
                : option.none,
            )
          },
          some: _ => spellingSoFar,
        }),
      option.none,
    )

const containsPendingType = (type: Type): boolean =>
  isPendingType(type) ||
  (type.kind === 'union' && type.members.values().some(isPendingType))

type CanonicalTypeSpelling = {
  readonly name: Atom
  readonly parameterNames: readonly Atom[]
  // This is a thunk to avoid an initialization cycle with the prelude types.
  readonly type: (...typeArguments: readonly Type[]) => Type
}

const canonicalTypeSpellings: readonly CanonicalTypeSpelling[] = [
  { name: 'Boolean', parameterNames: [], type: () => types.boolean },
  {
    name: 'Option',
    parameterNames: ['value'],
    type: value => types.option(value),
  },
]

const typeBoundTo = (
  parameter: TypeParameter,
  bindings: ReadonlyMap<TypeParameter, Type>,
): Option<Type> => {
  const boundType = bindings.get(parameter)
  return boundType === undefined ? option.none : option.makeSome(boundType)
}
