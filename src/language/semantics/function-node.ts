import either, { type Either } from '@matt.kantor/either'
import type { Option } from '@matt.kantor/option'
import type { Writable } from '../../utility-types.js'
import type {
  Bug,
  DependencyUnavailable,
  Panic,
  TypeMismatchError,
  UnserializableValueError,
} from '../errors.js'
import type { Atom } from '../parsing.js'
import type { ExpressionContext } from './expression-elaboration.js'
import type { ObjectNode } from './object-node.js'
import { nodeTag } from './semantic-graph-node-tag.js'
import { serialize, type Output, type SemanticGraph } from './semantic-graph.js'
import type { FunctionType } from './type-system/type-formats.js'

export type FunctionNodeCallError =
  | DependencyUnavailable
  | TypeMismatchError
  | Panic
  | Bug

export type FunctionNodeCallSignature = (
  value: SemanticGraph,
  contextOfApplication: ExpressionContext,
) => Either<FunctionNodeCallError, SemanticGraph>

export type FunctionNode = FunctionNodeCallSignature & {
  readonly [nodeTag]: 'function'
  readonly parameterName: Option<Atom>
  readonly signature: FunctionType['signature']
  readonly serialize: () => Either<UnserializableValueError, ObjectNode>
}

export type FunctionNodeWithSignature<
  Signature extends FunctionType['signature'],
> = FunctionNode & { readonly signature: Signature }

export const isFunctionNode = (node: SemanticGraph) =>
  typeof node === 'function'

export const makeFunctionNode = <Signature extends FunctionType['signature']>(
  signature: Signature,
  serialize: FunctionNode['serialize'],
  parameterName: Option<Atom>,
  f: FunctionNodeCallSignature,
): FunctionNodeWithSignature<Signature> => {
  const node: FunctionNodeCallSignature &
    Writable<FunctionNodeWithSignature<Signature>> = (argument, context) =>
    f(argument, context)
  node[nodeTag] = 'function'
  node.parameterName = parameterName
  node.signature = signature
  node.serialize = serialize
  return node
}

export const serializeFunctionNode = (
  node: FunctionNode,
): Either<UnserializableValueError, Output> =>
  either.flatMap(node.serialize(), serialize)
