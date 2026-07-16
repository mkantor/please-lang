import type { Either } from '@matt.kantor/either'
import type { FunctionNodeCallError } from '../../function-node.js'
import type { SemanticGraph } from '../../semantic-graph.js'
import type { Type } from './type.js'

/**
 * A stuck application of a host-implemented standard library function. Standard
 * library functions whose return type is concrete (e.g. `:atom.type ~>
 * :atom.type ~> :atom.type` for `atom.append`) are lifted so their return
 * becomes one of these, letting the type system compute the result type from
 * argument types even when argument values are unelaborated.
 *
 * It reduces once every argument type's inhabitants can be exhaustively
 * enumerated (the type is finitely-sized). Until then it stays stuck, behaving
 * like `upperBound` for assignability purposes.
 */
export type IntrinsicApplicationType = {
  readonly kind: 'intrinsicApplication'
  readonly parameterTypes: readonly Type[]
  readonly reduce: (
    // `argumentValues` is expected to be aligned with `parameterTypes`.
    argumentValues: readonly SemanticGraph[],
  ) => Either<FunctionNodeCallError, Type>
  /**
   * Returns the upper bound of this (stuck) application given its current
   * parameter types. It's recomputed whenever the parameter types change (e.g.
   * as type arguments are supplied), letting the bound narrow as arguments
   * become known.
   */
  readonly computeUpperBound: (parameterTypes: readonly Type[]) => Type
}

export const makeIntrinsicApplicationType = (
  parameterTypes: readonly Type[],
  reduce: (
    argumentValues: readonly SemanticGraph[],
  ) => Either<FunctionNodeCallError, Type>,
  computeUpperBound: (parameterTypes: readonly Type[]) => Type,
): IntrinsicApplicationType => ({
  kind: 'intrinsicApplication',
  parameterTypes,
  reduce,
  computeUpperBound,
})
