import type { ApplicationType } from './application-type.js'
import type { FunctionType } from './function-type.js'
import type { IndexedAccessType } from './indexed-access-type.js'
import type { IntrinsicApplicationType } from './intrinsic-application-type.js'
import type { ObjectType } from './object-type.js'
import type { OpaqueType } from './opaque-type.js'
import type { TypeParameter } from './type-parameter-type.js'
import type { UnionType } from './union-type.js'

export type Type =
  | ApplicationType
  | FunctionType
  | IndexedAccessType
  | IntrinsicApplicationType
  | ObjectType
  | OpaqueType
  | TypeParameter
  | UnionType
