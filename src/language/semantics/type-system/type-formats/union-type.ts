import type { Atom } from '../../../parsing.js'
import type { Type } from './type.js'

export type UnionType = {
  readonly kind: 'union'
  readonly members: ReadonlySet<
    Atom | Exclude<Type, UnionType> // unions are always flat
  >
}

type SpecificUnionType<Member extends Atom | Exclude<Type, UnionType>> = Omit<
  UnionType,
  'members'
> & {
  readonly members: ReadonlySet<Member>
}

export const makeUnionType = <Member extends Atom | Exclude<Type, UnionType>>(
  members: Iterable<Member>,
): SpecificUnionType<Member> => ({
  kind: 'union',
  members: new Set(members),
})

/**
 * Combine `types` into a single type: the sole element when there is exactly
 * one, otherwise a flattened union.
 */
export const unionOfTypes = (types: readonly Type[]): Type =>
  types.length === 1 && types[0] !== undefined ?
    types[0]
  : makeUnionType(
      types.flatMap(type =>
        type.kind === 'union' ? [...type.members] : [type],
      ),
    )
