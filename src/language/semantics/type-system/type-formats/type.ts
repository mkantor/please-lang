import type {
  ApplicationType,
  FunctionType,
  IndexedAccessType,
  IntrinsicApplicationType,
  ObjectType,
  TypeParameter,
  UnionType,
} from '../type-formats.js'
import type { OpaqueType } from './opaque-type.js'

export type Type =
  | ApplicationType
  | FunctionType
  | IndexedAccessType
  | IntrinsicApplicationType
  | ObjectType
  | OpaqueType
  | TypeParameter
  | UnionType
