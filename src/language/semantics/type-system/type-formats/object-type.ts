import type { Atom } from '../../../parsing.js'
import type { Type } from './type.js'

/**
 * Bounds the values of properties whose keys inhabit `keys`. Excess clauses
 * never assert that any property must be present; they only constrain the
 * values of properties that happen to exist.
 */
export type ExcessClause = {
  /**
   * `Type` indicating the keys of properties constrained by this clause (must
   * be a subtype of `atom`).
   */
  readonly keys: Type
  /**
   * Property values matched by this clause are required to be assignable to
   * this `Type`.
   */
  readonly values: Type
}

export type ObjectType = {
  readonly kind: 'object'
  readonly children: Readonly<Record<Atom, Type>>
  /**
   * Clauses bounding the values of properties not explicitly required by
   * `children`. A bound property's value must inhabit the `values` of the last
   * clause whose `keys` its key inhabits. A property matching no clauses may
   * have any type (an empty `excess` array leaves the object fully open). A
   * clause like `{ keys: atom, values: nothing }` forbids excess properties.
   */
  readonly excess: readonly ExcessClause[]
}

export const makeObjectType = <Children extends Readonly<Record<Atom, Type>>>(
  children: Children,
  excess: readonly ExcessClause[] = [],
): ObjectType & { readonly children: Children } => ({
  kind: 'object',
  children,
  excess,
})
