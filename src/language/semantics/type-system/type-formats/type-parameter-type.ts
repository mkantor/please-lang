import option, { type Option } from '@matt.kantor/option'
import type { NonEmptyKeyPath } from '../../key-path.js'
import type { Type } from './type.js'

export type TypeParameter = {
  readonly name: string
  readonly kind: 'parameter'
  readonly identity: symbol
  readonly constraint: {
    readonly assignableTo: Type
    // readonly assignableFrom: Type // TODO: Implement lower bound constraints.
  }
  /**
   * A key path where this type parameter can be reached (e.g. `:x.a` in the
   * body of `(x: { a: :Atom, b: :Atom }) => …`.
   */
  readonly valueKeyPath: Option<NonEmptyKeyPath>
}

export const makeTypeParameter = (
  name: string,
  constraint: TypeParameter['constraint'],
  valueKeyPath: Option<NonEmptyKeyPath> = option.none,
): TypeParameter => ({
  name,
  kind: 'parameter',
  identity: Symbol(name),
  constraint,
  valueKeyPath,
})

/**
 * A copy of `typeParameter` with its constraint replaced, preserving the
 * `TypeParameter`'s `identity`.
 */
export const typeParameterWithConstraint = (
  typeParameter: TypeParameter,
  assignableTo: Type,
): TypeParameter =>
  assignableTo === typeParameter.constraint.assignableTo ?
    // Avoid an unnecessary allocation.
    typeParameter
  : {
      ...typeParameter,
      constraint: { ...typeParameter.constraint, assignableTo },
    }

export const isTypeParameter = (value: unknown): value is TypeParameter => {
  // This doesn't exhaustively validate (it doesn't look inside `constraint` or
  // at `valueKeyPath`), but something very weird would have to be going on for
  // this to have a false positive.
  if (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof value.name === 'string' &&
    'kind' in value &&
    value.kind === 'parameter' &&
    'constraint' in value &&
    typeof value.constraint === 'object' &&
    value.constraint !== null &&
    'identity' in value &&
    typeof value.identity === 'symbol'
  ) {
    ;({
      name: value.name,
      kind: value.kind,
      constraint: value.constraint,
      identity: value.identity,
    }) satisfies Omit<TypeParameter, 'constraint' | 'valueKeyPath'> & {
      constraint: {}
    }
    return true
  } else {
    return false
  }
}
