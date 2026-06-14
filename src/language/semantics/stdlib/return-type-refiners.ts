import { isAssignable } from '../type-system/subtyping.js'
import { type Type } from '../type-system/type-formats.js'

/**
 * Builds a `computeRefinedReturnType` function for an operation closed over
 * `closedType`: when every argument type is assignable to `closedType` the
 * result is bounded by `closedType` (e.g. addition is closed over natural
 * numbers), otherwise by `fallback`.
 */
export const closedOver =
  (closedType: Type, fallback: Type) =>
  (argumentTypes: readonly Type[]): Type =>
    (
      argumentTypes.every(argumentType =>
        isAssignable({ source: argumentType, target: closedType }),
      )
    ) ?
      closedType
    : fallback
