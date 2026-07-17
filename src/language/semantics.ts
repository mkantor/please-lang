export {
  attachSpanIfAbsent,
  elaborate,
  elaborateWithContext,
  type ElaboratedSemanticGraph,
  type ExpressionContext,
  type FunctionParameterTypeInfo,
  type KeywordElaborationResult,
  type KeywordHandler,
  type KeywordHandlers,
} from './semantics/expression-elaboration.js'
export { isExpression, type Expression } from './semantics/expression.js'
export {
  makeApplyExpression,
  readApplyExpression,
  type ApplyExpression,
} from './semantics/expressions/apply-expression.js'
export {
  makeCheckExpression,
  readCheckExpression,
  type CheckExpression,
} from './semantics/expressions/check-expression.js'
export {
  asSemanticGraph,
  ignoredKey,
  stringifyKeyForEndUser,
} from './semantics/expressions/expression-utilities.js'
export {
  getParameterName,
  getParameterTypeAnnotation,
  makeFunctionExpression,
  readFunctionExpression,
  type FunctionExpression,
} from './semantics/expressions/function-expression.js'
export {
  readHoleExpression,
  type HoleExpression,
} from './semantics/expressions/hole-expression.js'
export {
  makeIfExpression,
  readIfExpression,
  type IfExpression,
} from './semantics/expressions/if-expression.js'
export {
  makeIndexExpression,
  readIndexExpression,
  type IndexExpression,
} from './semantics/expressions/index-expression.js'
export {
  keyPathToLookupExpression,
  lookup,
  makeLookupExpression,
  readLookupExpression,
  type LookupExpression,
} from './semantics/expressions/lookup-expression.js'
export {
  makeObjectTypeExpression,
  readObjectTypeExpression,
  type ObjectTypeExpression,
} from './semantics/expressions/object-type-expression.js'
export {
  readPanicExpression,
  type PanicExpression,
} from './semantics/expressions/panic-expression.js'
export {
  makeRuntimeExpression,
  readRuntimeExpression,
  type RuntimeExpression,
} from './semantics/expressions/runtime-expression.js'
export { type TodoExpression } from './semantics/expressions/todo-expression.js'
export {
  makeUnionExpression,
  readUnionExpression,
  type UnionExpression,
} from './semantics/expressions/union-expression.js'
export {
  isFunctionNode,
  makeFunctionNode,
  type FunctionNode,
} from './semantics/function-node.js'
export { isSemanticGraph } from './semantics/is-semantic-graph.js'
export {
  arrayToMolecule,
  keyPathFromObjectNode,
  stringifyKeyPathForEndUser,
  stringifyKeyPathForInternalUse,
  type KeyPath,
  type KeyPathStringifiedForInternalUse,
} from './semantics/key-path.js'
export { isKeyword, type Keyword } from './semantics/keyword.js'
export {
  isObjectNode,
  lookupPropertyOfObjectNode,
  makeObjectNode,
  objectNodeFromMolecule,
  objectNodeFromOrderedEntries,
  orderedEntriesOfObjectNode,
  orderedKeys,
  withProperty,
  type ObjectNode,
} from './semantics/object-node.js'
export { prelude } from './semantics/prelude.js'
export { nodeTag } from './semantics/semantic-graph-node-tag.js'
export {
  applyKeyPathToSemanticGraph,
  containsAnyUnelaboratedNodes,
  matchSemanticGraph,
  serialize,
  stringifySemanticGraphForEndUser,
  stringifyTypeForEndUser,
  typeToSemanticGraph,
  updateValueAtKeyPathInSemanticGraph,
  type Output,
  type SemanticGraph,
} from './semantics/semantic-graph.js'
export {
  applicableFunctionSignatures,
  applyKeyPathToType,
  containedTypeParameters,
  getTypesForTypeParameters,
  inferType,
  isAssignable,
  replaceAllTypeParametersWithTheirConstraints,
  resolveParameterTypes,
  rigidTypeParameterIdentities,
  supplyTypeArgument,
  supplyTypeArguments,
  typeFromSemanticGraph,
  typeParameterAssignableToConstraintKey,
  typeParameterIdentitiesWithinType,
  types,
  type ApplicationType,
  type FunctionType,
  type IndexedAccessType,
  type ObjectType,
  type OpaqueType,
  type Type,
  type TypeParameter,
  type UnionType,
} from './semantics/type-system.js'
