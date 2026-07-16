import type { Type } from './type.js'

/**
 * A stuck application (i.e. `function(argument)`), produced when an `@apply`
 * can't be fully resolved because the applied function's type depends on type
 * parameters whose concrete types only arrive when an enclosing
 * (not-yet-applied) function is eventually applied.
 *
 * `parametersStuckOn` holds the `identity`s of those type parameters. The
 * application stays stuck while its `function` still contains any of them, and
 * reduces once they have all been substituted away (the applied function's own
 * quantifiers are then bound from the argument, and any appearing only in the
 * return legitimately remain).
 */
export type ApplicationType = {
  readonly kind: 'application'
  readonly function: Type
  readonly argument: Type
  readonly parametersStuckOn: ReadonlySet<symbol>
}

export const makeApplicationType = (
  functionType: Type,
  argument: Type,
  parametersStuckOn: ReadonlySet<symbol>,
): ApplicationType => ({
  kind: 'application',
  function: functionType,
  argument,
  parametersStuckOn,
})
