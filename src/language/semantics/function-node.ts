import either, { type Either } from '@matt.kantor/either'
import option, { type Option } from '@matt.kantor/option'
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
import {
  getParameterName,
  type FunctionExpression,
} from './expressions/function-expression.js'
import type { ObjectNode } from './object-node.js'
import { nodeTag } from './semantic-graph-node-tag.js'
import { serialize, type Output, type SemanticGraph } from './semantic-graph.js'
import type { FunctionType } from './type-system.js'

export type FunctionNodeCallError =
  DependencyUnavailable | TypeMismatchError | Panic | Bug

export type FunctionNodeCallSignature = (
  value: SemanticGraph,
  contextOfApplication: ExpressionContext,
) => Either<FunctionNodeCallError, SemanticGraph>

export type FunctionNode = FunctionNodeCallSignature & {
  readonly [nodeTag]: 'function'
  readonly parameterName: Option<Atom>
  readonly signature: FunctionType['signature']
  readonly serialize: () => Either<UnserializableValueError, ObjectNode>
  readonly definition: Option<FunctionDefinition>
}

export type FunctionDefinition = {
  readonly expression: FunctionExpression
  readonly context: ExpressionContext
}

export type FunctionNodeWithSignature<
  Signature extends FunctionType['signature'],
> = FunctionNode & { readonly signature: Signature }

export const isFunctionNode = (node: SemanticGraph) =>
  typeof node === 'function'

export const makeNativeFunctionNode = <
  Signature extends FunctionType['signature'],
>({
  signature,
  serialize,
  call,
}: {
  readonly signature: Signature
  readonly serialize: FunctionNode['serialize']
  readonly call: FunctionNodeCallSignature
}): FunctionNodeWithSignature<Signature> => {
  const node: FunctionNodeCallSignature &
    Writable<FunctionNodeWithSignature<Signature>> = (argument, context) =>
    call(argument, context)
  node[nodeTag] = 'function'
  node.signature = signature
  node.serialize = serialize

  node.parameterName = option.none
  node.definition = option.none

  return node
}

/**
 * A function written in the program, serialized as its definition's
 * expression.
 */
export const makeFunctionNodeFromDefinition = <
  Signature extends FunctionType['signature'],
>({
  signature,
  definition,
  call,
}: {
  readonly signature: Signature
  readonly definition: FunctionDefinition
  readonly call: FunctionNodeCallSignature
}): FunctionNodeWithSignature<Signature> => {
  const node: FunctionNodeCallSignature &
    Writable<FunctionNodeWithSignature<Signature>> = (argument, context) =>
    call(argument, context)
  node[nodeTag] = 'function'
  node.signature = signature
  node.definition = option.makeSome(definition)

  node.serialize = () => either.makeRight(definition.expression)
  node.parameterName = option.makeSome(getParameterName(definition.expression))

  return node
}

export const serializeFunctionNode = (
  node: FunctionNode,
): Either<UnserializableValueError, Output> =>
  either.flatMap(node.serialize(), serialize)
