import { types } from '../type-system.js'
import { option as optionType } from '../type-system/prelude-types.js'
import { isAssignable } from '../type-system/subtyping.js'
import {
  makeObjectType,
  makeUnionType,
  type Type,
} from '../type-system/type-formats.js'

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

/**
 * Builds a `computeRefinedReturnType` function for an `is`-style predicate:
 * when the argument type is assignable to `target` the result is necessarily
 * the literal `true`, otherwise it stays `:boolean.type`.
 */
export const computeIsReturnType =
  (target: Type) =>
  (argumentTypes: readonly Type[]): Type => {
    const [argumentType] = argumentTypes
    if (argumentTypes.length > 1 || argumentType === undefined) {
      throw new Error(
        '`is` function received more than one argument. This is a bug!',
      )
    } else {
      return isAssignable({ source: argumentType, target }) ?
          makeUnionType(['true'])
        : types.boolean
    }
  }

/**
 * Builds a `computeRefinedReturnType` function for a `from`-style downcast:
 * when the argument type is assignable to `elementType` the conversion always
 * succeeds, so the result is narrowed to the `some` branch carrying the
 * argument's own type. Otherwise it stays a full `option(elementType)`.
 */
export const computeFromReturnType =
  (elementType: Type) =>
  (argumentTypes: readonly Type[]): Type => {
    const [argumentType] = argumentTypes
    if (argumentTypes.length > 1 || argumentType === undefined) {
      throw new Error(
        '`from` function received more than one argument. This is a bug!',
      )
    } else {
      return isAssignable({ source: argumentType, target: elementType }) ?
          makeObjectType({ tag: makeUnionType(['some']), value: argumentType })
        : optionType(elementType)
    }
  }
