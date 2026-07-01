import either from '@matt.kantor/either'
import { makeUnionExpression } from '../expressions/union-expression.js'
import { isFunctionNode } from '../function-node.js'
import {
  isObjectNode,
  objectNodeFromOrderedEntries,
  type ObjectNode,
} from '../object-node.js'
import { type SemanticGraph } from '../semantic-graph.js'
import { types } from '../type-system.js'
import {
  makeFunctionType,
  makeTypeParameter,
  makeUnionType,
} from '../type-system/type-formats.js'
import {
  emptyContextForStdlibApplications,
  preludeFunctionArity1,
  preludeFunctionArity2,
} from './stdlib-utilities.js'

const A = makeTypeParameter('a', { assignableTo: types.something })
const B = makeTypeParameter('b', { assignableTo: types.something })

export const option = {
  type: preludeFunctionArity1(
    ['option', 'type'],
    { parameter: A, return: types.option(A) },
    value =>
      either.makeRight(
        makeUnionExpression(
          objectNodeFromOrderedEntries([
            [
              '0',
              objectNodeFromOrderedEntries([
                ['tag', 'some'],
                ['value', value],
              ]),
            ],
            [
              '1',
              objectNodeFromOrderedEntries([
                ['tag', 'none'],
                ['value', objectNodeFromOrderedEntries([])],
              ]),
            ],
          ]),
        ),
      ),
  ),

  none: objectNodeFromOrderedEntries([
    ['tag', 'none'],
    ['value', objectNodeFromOrderedEntries([])],
  ]),

  make_some: preludeFunctionArity1(
    ['option', 'make_some'],
    { parameter: A, return: types.option(A) },
    value =>
      either.makeRight(
        objectNodeFromOrderedEntries([
          ['tag', 'some'],
          ['value', value],
        ]),
      ),
  ),

  // (a ~> b) ~> option(a) ~> option(b)
  map: preludeFunctionArity2(
    ['option', 'map'],
    {
      parameter: makeFunctionType({ parameter: A, return: B }),
      return: makeFunctionType({
        parameter: types.option(A),
        return: types.option(B),
      }),
    },
    transform => {
      if (!isFunctionNode(transform)) {
        return either.makeLeft({
          kind: 'typeMismatch',
          message: '`map` expected a function',
        })
      } else {
        return either.makeRight(optionValue => {
          if (!nodeIsOptionLike(optionValue)) {
            return either.makeLeft({
              kind: 'typeMismatch',
              message: '`map` expected an option',
            })
          } else if (optionValue.tag === 'none') {
            return either.makeRight(optionValue)
          } else {
            return either.map(
              transform(optionValue.value, emptyContextForStdlibApplications),
              transformedValue =>
                objectNodeFromOrderedEntries([
                  ['tag', 'some'],
                  ['value', transformedValue],
                ]),
            )
          }
        })
      }
    },
  ),

  // (a ~> option(b)) ~> option(a) ~> option(b)
  flat_map: preludeFunctionArity2(
    ['option', 'flat_map'],
    {
      parameter: makeFunctionType({
        parameter: A,
        return: types.option(B),
      }),
      return: makeFunctionType({
        parameter: types.option(A),
        return: types.option(B),
      }),
    },
    transform => {
      if (!isFunctionNode(transform)) {
        return either.makeLeft({
          kind: 'typeMismatch',
          message: '`flat_map` expected a function',
        })
      } else {
        return either.makeRight(optionValue => {
          if (!nodeIsOptionLike(optionValue)) {
            return either.makeLeft({
              kind: 'typeMismatch',
              message: '`flat_map` expected an option',
            })
          } else if (optionValue.tag === 'none') {
            return either.makeRight(optionValue)
          } else {
            return either.flatMap(
              transform(optionValue.value, emptyContextForStdlibApplications),
              transformedValue => {
                if (!nodeIsOptionLike(transformedValue)) {
                  return either.makeLeft({
                    kind: 'typeMismatch',
                    message: '`flat_map` function did not return an option',
                  })
                } else {
                  return either.makeRight(transformedValue)
                }
              },
            )
          }
        })
      }
    },
  ),

  get_or_else: preludeFunctionArity2(
    ['option', 'get_or_else'],
    {
      parameter: B,
      return: makeFunctionType({
        parameter: types.option(A),
        return: makeUnionType([A, B]),
      }),
    },
    fallback =>
      either.makeRight(optionValue => {
        if (!nodeIsOptionLike(optionValue)) {
          return either.makeLeft({
            kind: 'typeMismatch',
            message: '`get_or_else` expected an option',
          })
        } else {
          return either.makeRight(
            optionValue.tag === 'none' ? fallback : optionValue.value,
          )
        }
      }),
  ),

  is_some: preludeFunctionArity1(
    ['option', 'is_some'],
    { parameter: types.option(types.something), return: types.boolean },
    optionValue => {
      if (!nodeIsOptionLike(optionValue)) {
        return either.makeLeft({
          kind: 'typeMismatch',
          message: '`is_some` expected an option',
        })
      } else {
        return either.makeRight(String(optionValue.tag === 'some'))
      }
    },
  ),

  is_none: preludeFunctionArity1(
    ['option', 'is_none'],
    { parameter: types.option(types.something), return: types.boolean },
    optionValue => {
      if (!nodeIsOptionLike(optionValue)) {
        return either.makeLeft({
          kind: 'typeMismatch',
          message: '`is_none` expected an option',
        })
      } else {
        return either.makeRight(String(optionValue.tag === 'none'))
      }
    },
  ),
} as const

type OptionLikeNode = ObjectNode & {
  readonly tag: 'some' | 'none'
  readonly value: SemanticGraph
}

// TODO: Consider using a type system assignability check instead.
const nodeIsOptionLike = (node: SemanticGraph): node is OptionLikeNode =>
  isObjectNode(node) &&
  (node['tag'] === 'some' || node['tag'] === 'none') &&
  node['value'] !== undefined
