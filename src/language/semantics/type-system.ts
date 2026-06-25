export { typeFromSemanticGraph } from './type-system/literal-type.js'
export * as types from './type-system/prelude-types.js'
export { isAssignable } from './type-system/subtyping.js'
export {
  makeTypeParameter,
  type ApplicationType,
  type FunctionType,
  type IndexedAccessType,
  type ObjectType,
  type OpaqueType,
  type Type,
  type TypeParameter,
  type UnionType,
} from './type-system/type-formats.js'
export {
  inferType,
  resolveParameterTypes,
  rigidTypeParameterIdentities,
} from './type-system/type-inference.js'
export {
  functionParameterKey,
  functionReturnKey,
  stringifyTypeKeyPathForEndUser,
  stringifyTypeKeyPathForInternalUse,
  typeKeyPathFromObjectNode,
  typeParameterAssignableToConstraintKey,
  type TypeKeyPath,
  type TypeKeyPathStringifiedForInternalUse,
} from './type-system/type-key-path.js'
export {
  containedTypeParameters,
  typeParameterIdentitiesWithinType,
} from './type-system/type-parameter-analysis.js'
export {
  applicableFunctionSignatures,
  applyKeyPathToType,
  getTypesForTypeParameters,
  recursivelyInexact,
  replaceAllTypeParametersWithTheirConstraints,
  supplyTypeArgument,
  supplyTypeArguments,
} from './type-system/type-substitution.js'
