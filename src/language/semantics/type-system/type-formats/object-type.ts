import type { Atom } from '../../../parsing.js'
import type { Type } from './type.js'

export type ObjectType = {
  readonly kind: 'object'
  readonly children: Readonly<Record<Atom, Type>>
  /**
   * An upper bound on the values of properties *not* explicitly required by
   * `children`. The bottom type (an empty union) means inhabitants have exactly
   * the specified keys; the top type admits arbitrary excess properties;
   * anything in between bounds what excess property values may be.
   */
  readonly excess: Type
}

export const makeObjectType = <Children extends Readonly<Record<Atom, Type>>>(
  children: Children,
  options: { readonly excess: Type },
): ObjectType & { readonly children: Children } => ({
  kind: 'object',
  children,
  excess: options.excess,
})
