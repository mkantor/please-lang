import type { ApplicationType } from './type-formats/application-type.js'
import type { FunctionType } from './type-formats/function-type.js'
import type { IndexedAccessType } from './type-formats/indexed-access-type.js'
import type { IntrinsicApplicationType } from './type-formats/intrinsic-application-type.js'
import type { ObjectType } from './type-formats/object-type.js'
import type { OpaqueType } from './type-formats/opaque-type.js'
import type { TypeParameter } from './type-formats/type-parameter-type.js'
import type { Type } from './type-formats/type.js'
import type { UnionType } from './type-formats/union-type.js'

export * from './type-formats/application-type.js'
export * from './type-formats/function-type.js'
export * from './type-formats/indexed-access-type.js'
export * from './type-formats/intrinsic-application-type.js'
export * from './type-formats/object-type.js'
export * from './type-formats/opaque-type.js'
export * from './type-formats/type-parameter-type.js'
export * from './type-formats/type.js'
export * from './type-formats/union-type.js'

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
