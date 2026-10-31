import type { Either } from '@matt.kantor/either'
import type { Option } from '@matt.kantor/option'
import type { FunctionNodeCallError } from '../../function-node.js'
import type { NonEmptyKeyPath } from '../../key-path.js'
import type { SemanticGraph } from '../../semantic-graph.js'
import type { Type } from './type.js'

/**
 * A stuck application of a host-implemented standard library function. Standard
 * library functions whose return type is concrete (e.g. `:Atom ~> :Atom ~>
 * :Atom` for `atom.append`) are lifted so their return becomes one of these,
 * letting the type system compute the result type from argument types even when
 * argument values are unelaborated.
 *
 * It reduces once every argument type's inhabitants can be exhaustively
 * enumerated (the type is finitely-sized). Until then it stays stuck, behaving
 * like its upper bound as a source. As a target it only accepts the same
 * application or a source within its lower bound.
 */
export type IntrinsicApplicationType = {
  readonly kind: 'intrinsicApplication'
  readonly parameterTypes: readonly Type[]
  /**
   * `reduce` doubles as the applied function's identity, so a function must
   * reuse one `reduce` for all of its applications.
   */
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
  /**
   * Returns a type assignable to whatever this (stuck) application turns out to
   * be, given its current parameter types. Applications often have none, since
   * their result depends on argument values which aren't known yet.
   */
  readonly computeLowerBound: Option<(parameterTypes: readonly Type[]) => Type>
  /**
   * Where the applied function is located, when it's addressable.
   */
  readonly functionKeyPath: Option<NonEmptyKeyPath>
}

export const makeIntrinsicApplicationType = (
  parameterTypes: readonly Type[],
  reduce: (
    argumentValues: readonly SemanticGraph[],
  ) => Either<FunctionNodeCallError, Type>,
  computeUpperBound: (parameterTypes: readonly Type[]) => Type,
  computeLowerBound: Option<(parameterTypes: readonly Type[]) => Type>,
  functionKeyPath: Option<NonEmptyKeyPath>,
): IntrinsicApplicationType => ({
  kind: 'intrinsicApplication',
  parameterTypes,
  reduce,
  computeUpperBound,
  computeLowerBound,
  functionKeyPath,
})
