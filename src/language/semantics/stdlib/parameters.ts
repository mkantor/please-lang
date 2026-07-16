import option, { type Option } from '@matt.kantor/option'
import type { Atom } from '../../parsing.js'
import { isFunctionNode, type FunctionNode } from '../function-node.js'
import {
  isObjectNode,
  orderedEntriesOfObjectNode,
  type ObjectNode,
} from '../object-node.js'
import type { SemanticGraph } from '../semantic-graph.js'
import {
  makeObjectType,
  makeUnionType,
  types,
  type Type,
} from '../type-system.js'

/**
 * Describes a standard library function parameter. `Value` should be a runtime
 * representation of the given `Type` (it may be wider; e.g. numeric types are
 * `Parameter<Atom>`s).
 */
export type Parameter<Value extends SemanticGraph> = {
  readonly type: Type
  readonly asExpected: (value: SemanticGraph) => Option<Value>
  readonly expected: string
}

export type AnyParameter = Parameter<SemanticGraph>

export type NonEmptyParameters = readonly [
  AnyParameter,
  ...(readonly AnyParameter[]),
]

export type BooleanNode = 'true' | 'false'
export const nodeIsBoolean = (node: SemanticGraph) =>
  node === 'true' || node === 'false'

export type OptionLikeNode = ObjectNode & {
  readonly tag: 'some' | 'none'
  readonly value: SemanticGraph
}

export const nodeIsOptionLike = (node: SemanticGraph): node is OptionLikeNode =>
  isObjectNode(node) &&
  (node['tag'] === 'some' || node['tag'] === 'none') &&
  node['value'] !== undefined

export type TaggedNode = ObjectNode & {
  readonly tag: Atom
  readonly value: SemanticGraph
}
export const nodeIsTagged = (node: SemanticGraph): node is TaggedNode =>
  isObjectNode(node) &&
  typeof node['tag'] === 'string' &&
  node['value'] !== undefined

export const atomParameter: Parameter<Atom> = {
  type: types.atom,
  asExpected: value =>
    typeof value === 'string' ? option.makeSome(value) : option.none,
  expected: 'an atom',
}

export const objectParameter: Parameter<ObjectNode> = {
  type: types.object,
  asExpected: value =>
    isObjectNode(value) ? option.makeSome(value) : option.none,
  expected: 'an object',
}

export const objectOfAtomsParameter: Parameter<ObjectNode> = {
  type: makeObjectType({}, [{ keys: types.atom, values: types.atom }]),
  asExpected: value =>
    (
      isObjectNode(value) &&
      orderedEntriesOfObjectNode(value).every(
        ([_key, value]) => typeof value === 'string',
      )
    ) ?
      option.makeSome(value)
    : option.none,
  expected: 'an object whose property values are atoms',
}

export const booleanParameter: Parameter<BooleanNode> = {
  type: types.boolean,
  asExpected: value =>
    nodeIsBoolean(value) ? option.makeSome(value) : option.none,
  expected: 'a boolean',
}

export const integerParameter: Parameter<Atom> = {
  type: types.integer,
  asExpected: value =>
    (
      typeof value === 'string' &&
      types.integer.isAssignableFrom(makeUnionType([value]))
    ) ?
      option.makeSome(value)
    : option.none,
  expected: 'an integer',
}

export const naturalNumberParameter: Parameter<Atom> = {
  type: types.naturalNumber,
  asExpected: value =>
    (
      typeof value === 'string' &&
      types.naturalNumber.isAssignableFrom(makeUnionType([value]))
    ) ?
      option.makeSome(value)
    : option.none,
  expected: 'a natural number',
}

export const functionParameter = (type: Type): Parameter<FunctionNode> => ({
  type,
  asExpected: value =>
    isFunctionNode(value) ? option.makeSome(value) : option.none,
  expected: 'a function',
})

export const optionParameter = (
  elementType: Type,
): Parameter<OptionLikeNode> => ({
  type: types.option(elementType),
  asExpected: value =>
    nodeIsOptionLike(value) ? option.makeSome(value) : option.none,
  expected: 'an option',
})

export const taggedParameter: Parameter<TaggedNode> = {
  type: makeObjectType({
    tag: types.atom,
    value: types.something,
  }),
  asExpected: value =>
    nodeIsTagged(value) ? option.makeSome(value) : option.none,
  expected: 'a tagged value',
}

export const anyValue = (type: Type): Parameter<SemanticGraph> => ({
  type,
  asExpected: option.makeSome,
  expected: 'a value',
})
