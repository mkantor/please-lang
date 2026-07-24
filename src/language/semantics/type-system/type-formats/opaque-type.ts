import option, { type None, type Option, type Some } from '@matt.kantor/option'
import type { TypeSymbol } from '../../semantic-graph.js'
import type { ApplicationType } from './application-type.js'
import type { IndexedAccessType } from './indexed-access-type.js'
import type { IntrinsicApplicationType } from './intrinsic-application-type.js'
import type { Type } from './type.js'

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
    // `upperBoundOfStuckType` is injected to avoid a static dependency cycle.
    // `makeOpaqueType` is called in static module scope to initialize prelude
    // types.
    readonly upperBoundOfStuckType: (
      type: ApplicationType | IndexedAccessType | IntrinsicApplicationType,
    ) => Option<Type>
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
    isAssignableFrom: source => {
      switch (source.kind) {
        case 'application':
        case 'indexedAccess':
        case 'intrinsicApplication':
          return option.match(subtyping.upperBoundOfStuckType(source), {
            none: _ => false,
            some: upperBound => self.isAssignableFrom(upperBound),
          })
        case 'function':
          return false
        case 'object':
          return false
        case 'opaque':
          return (
            source === self ||
            option.match(subtyping.nearestOpaqueAssignableFrom(), {
              none: _ => false,
              some: nearestOpaqueAssignableFrom =>
                nearestOpaqueAssignableFrom.isAssignableFrom(source),
            })
          )
        case 'parameter':
          return self.isAssignableFrom(source.constraint.assignableTo)
        case 'union':
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
      }
    },
    isAssignableTo: target => {
      switch (target.kind) {
        case 'application':
          return false
        case 'indexedAccess':
          return false
        case 'intrinsicApplication':
          return false
        case 'function':
          return false
        case 'object':
          return false
        case 'opaque':
          return (
            target === self ||
            option.match(subtyping.nearestOpaqueAssignableTo(), {
              none: _ => false,
              some: nearestOpaqueAssignableTo =>
                nearestOpaqueAssignableTo.isAssignableTo(target),
            })
          )
        case 'parameter':
          return false
        case 'union':
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
      }
    },
  }
  return self
}
