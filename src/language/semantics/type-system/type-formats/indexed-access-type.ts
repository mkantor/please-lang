import type { Type } from './type.js'

/**
 * A stuck projection (i.e. `object[key]`), produced when an `@index` or `@if`
 * can't be fully resolved because its key/condition contains a type parameter.
 */
export type IndexedAccessType = {
  readonly kind: 'indexedAccess'
  readonly object: Type
  readonly key: Type
}

export const makeIndexedAccessType = (
  object: Type,
  key: Type,
): IndexedAccessType => ({
  kind: 'indexedAccess',
  object,
  key,
})
