import type { Type } from './type.js'

export type TypeParameter = {
  readonly name: string
  readonly kind: 'parameter'
  readonly identity: symbol
  readonly constraint: {
    readonly assignableTo: Type
    // readonly assignableFrom: Type // TODO: Implement lower bound constraints.
  }
}

export const makeTypeParameter = (
  name: string,
  constraint: TypeParameter['constraint'],
): TypeParameter => ({
  name,
  kind: 'parameter',
  identity: Symbol(name),
  constraint,
})

export const isTypeParameter = (value: unknown): value is TypeParameter => {
  // This doesn't exhaustively validate (it doesn't look inside `constraint`),
  // but something very weird would have to be going on for this to have a false
  // positive.
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
    }) satisfies Omit<TypeParameter, 'constraint'> & {
      constraint: Omit<TypeParameter['constraint'], 'assignableTo'>
    }
    return true
  } else {
    return false
  }
}
