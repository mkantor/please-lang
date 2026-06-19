import type { Either } from '@matt.kantor/either'
import option, { type None, type Some } from '@matt.kantor/option'
import type { Atom } from '../../parsing.js'
import type { FunctionNodeCallError } from '../function-node.js'
import type { SemanticGraph, TypeSymbol } from '../semantic-graph.js'

export type FunctionType = {
  readonly kind: 'function'
  readonly signature: {
    readonly parameter: Type
    readonly return: Type
  }
}

export const makeFunctionType = <Signature extends FunctionType['signature']>(
  signature: Signature,
): FunctionType & {
  readonly signature: Signature
} => ({
  kind: 'function',
  signature,
})

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

export type ObjectType = {
  readonly kind: 'object'
  readonly children: Readonly<Record<Atom, Type>>
  /**
   * When `true`, every inhabitant of this type has exactly the specified keys
   * and can't be subtyped by objects with additional properties.
   */
  readonly exact: boolean
}

export const makeObjectType = <Children extends Readonly<Record<Atom, Type>>>(
  children: Children,
  options: { readonly exact: boolean } = { exact: false },
): ObjectType & { readonly children: Children } => ({
  kind: 'object',
  children,
  exact: options.exact,
})

export type OpaqueType = {
  readonly symbol: TypeSymbol
  readonly kind: 'opaque'
  readonly isAssignableFrom: (source: Type) => boolean
  readonly isAssignableTo: (target: Type) => boolean
}

export const makeOpaqueType = (
  symbol: TypeSymbol,
  subtyping: {
    readonly isAssignableFromLiteralType: (literalType: string) => boolean
    // `upperBoundOfStuckType` is injected to avoid a
    // cycle with `type-substitution.ts`. `makeOpaqueType` is called in static
    // module scope from `prelude-types.ts`.
    readonly upperBoundOfStuckType: (
      type: ApplicationType | IndexedAccessType | IntrinsicApplicationType,
    ) => Type
  } & (
    | {
        readonly nearestOpaqueAssignableFrom: () => None
        readonly nearestOpaqueAssignableTo: () => Some<OpaqueType>
      }
    | {
        readonly nearestOpaqueAssignableFrom: () => Some<OpaqueType>
        readonly nearestOpaqueAssignableTo: () => None
      }
    | {
        readonly nearestOpaqueAssignableFrom: () => Some<OpaqueType>
        readonly nearestOpaqueAssignableTo: () => Some<OpaqueType>
      }
  ),
): OpaqueType => {
  const self: OpaqueType = {
    symbol,
    kind: 'opaque',
    isAssignableFrom: source =>
      matchTypeFormat(source, {
        // A stuck application/indexed access is assignable to an opaque type
        // when its concrete upper bound is.
        application: source =>
          self.isAssignableFrom(subtyping.upperBoundOfStuckType(source)),
        indexedAccess: source =>
          self.isAssignableFrom(subtyping.upperBoundOfStuckType(source)),
        intrinsicApplication: source =>
          self.isAssignableFrom(subtyping.upperBoundOfStuckType(source)),

        function: _ => false,
        object: _ => false,
        opaque: source =>
          source === self ||
          option.match(subtyping.nearestOpaqueAssignableFrom(), {
            none: () => false,
            some: nearestOpaqueAssignableFrom =>
              nearestOpaqueAssignableFrom.isAssignableFrom(source),
          }),
        parameter: source =>
          self.isAssignableFrom(source.constraint.assignableTo),
        union: source => {
          for (const sourceMember of source.members) {
            if (typeof sourceMember === 'string') {
              if (!subtyping.isAssignableFromLiteralType(sourceMember)) {
                return false
              }
            } else if (!self.isAssignableFrom(sourceMember)) {
              return false
            }
          }
          return true
        },
      }),
    isAssignableTo: target =>
      matchTypeFormat(target, {
        application: _ => false,
        function: _ => false,
        indexedAccess: _ => false,
        intrinsicApplication: _ => false,
        object: _ => false,
        opaque: target =>
          target === self ||
          option.match(subtyping.nearestOpaqueAssignableTo(), {
            none: () => false,
            some: nearestOpaqueAssignableTo =>
              nearestOpaqueAssignableTo.isAssignableTo(target),
          }),
        parameter: _ => false,
        union: target => {
          for (const targetMember of target.members) {
            if (
              // Opaque types are never assignable to literal types.
              typeof targetMember !== 'string' &&
              self.isAssignableTo(targetMember)
            ) {
              return true
            }
          }
          return false
        },
      }),
  }
  return self
}

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

export type UnionType = {
  readonly kind: 'union'
  readonly members: ReadonlySet<
    Atom | Exclude<Type, UnionType> // unions are always flat
  >
}

type SpecificUnionType<Member extends Atom | Exclude<Type, UnionType>> = Omit<
  UnionType,
  'members'
> & {
  readonly members: ReadonlySet<Member>
}

export const makeUnionType = <Member extends Atom | Exclude<Type, UnionType>>(
  members: readonly Member[],
): SpecificUnionType<Member> => ({
  kind: 'union',
  members: new Set(members),
})

/**
 * Combine `types` into a single type: the sole element when there is exactly
 * one, otherwise a flattened union.
 */
export const unionOfTypes = (types: readonly Type[]): Type =>
  types.length === 1 && types[0] !== undefined ?
    types[0]
  : makeUnionType(
      types.flatMap(type =>
        type.kind === 'union' ? [...type.members] : [type],
      ),
    )

export type Type =
  | ApplicationType
  | FunctionType
  | IndexedAccessType
  | IntrinsicApplicationType
  | ObjectType
  | OpaqueType
  | TypeParameter
  | UnionType

export const matchTypeFormat = <Result>(
  type: Type,
  cases: {
    application: (type: ApplicationType) => Result
    function: (type: FunctionType) => Result
    indexedAccess: (type: IndexedAccessType) => Result
    intrinsicApplication: (type: IntrinsicApplicationType) => Result
    object: (type: ObjectType) => Result
    opaque: (type: OpaqueType) => Result
    parameter: (type: TypeParameter) => Result
    union: (type: UnionType) => Result
  },
): Result => {
  switch (type.kind) {
    case 'application':
      return cases[type.kind](type)
    case 'function':
      return cases[type.kind](type)
    case 'indexedAccess':
      return cases[type.kind](type)
    case 'intrinsicApplication':
      return cases[type.kind](type)
    case 'object':
      return cases[type.kind](type)
    case 'opaque':
      return cases[type.kind](type)
    case 'parameter':
      return cases[type.kind](type)
    case 'union':
      return cases[type.kind](type)
  }
}
