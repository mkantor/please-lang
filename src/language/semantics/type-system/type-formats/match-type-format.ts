import type { ApplicationType } from './application-type.js'
import type { FunctionType } from './function-type.js'
import type { IndexedAccessType } from './indexed-access-type.js'
import type { IntrinsicApplicationType } from './intrinsic-application-type.js'
import type { ObjectType } from './object-type.js'
import type { OpaqueType } from './opaque-type.js'
import type { TypeParameter } from './type-parameter-type.js'
import type { Type } from './type.js'
import type { UnionType } from './union-type.js'

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
