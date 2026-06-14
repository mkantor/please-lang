import either from '@matt.kantor/either'
import { makeUnionExpression } from '../expressions/union-expression.js'
import { objectNodeFromOrderedEntries } from '../object-node.js'
import { type SemanticGraph } from '../semantic-graph.js'
import { types } from '../type-system.js'
import { makeFunctionType } from '../type-system/type-formats.js'
import {
  computeFromReturnType,
  computeIsReturnType,
} from './return-type-refiners.js'
import {
  preludeFunctionArity1,
  preludeFunctionArity2,
} from './stdlib-utilities.js'

export const boolean = {
  type: makeUnionExpression(
    objectNodeFromOrderedEntries([
      ['0', 'false'],
      ['1', 'true'],
    ]),
  ),

  is: preludeFunctionArity1(
    ['boolean', 'is'],
    {
      parameter: types.something,
      return: types.boolean,
    },
    argument => either.makeRight(nodeIsBoolean(argument) ? 'true' : 'false'),
    computeIsReturnType(types.boolean),
  ),

  from: preludeFunctionArity1(
    ['boolean', 'from'],
    {
      parameter: types.something,
      return: types.option(types.boolean),
    },
    argument =>
      either.makeRight(
        nodeIsBoolean(argument) ?
          objectNodeFromOrderedEntries([
            ['tag', 'some'],
            ['value', argument],
          ])
        : objectNodeFromOrderedEntries([
            ['tag', 'none'],
            ['value', objectNodeFromOrderedEntries([])],
          ]),
      ),
    computeFromReturnType(types.boolean),
  ),

  not: preludeFunctionArity1(
    ['boolean', 'not'],
    {
      parameter: types.boolean,
      return: types.boolean,
    },
    argument => {
      if (!nodeIsBoolean(argument)) {
        return either.makeLeft({
          kind: 'typeMismatch',
          message: '`not` expected a boolean',
        })
      } else {
        return either.makeRight(argument === 'true' ? 'false' : 'true')
      }
    },
  ),

  and: preludeFunctionArity2(
    ['boolean', 'and'],
    {
      parameter: types.boolean,
      return: makeFunctionType({
        parameter: types.boolean,
        return: types.boolean,
      }),
    },
    argument2 => {
      if (!nodeIsBoolean(argument2)) {
        return either.makeLeft({
          kind: 'typeMismatch',
          message: '`and` expected a boolean',
        })
      } else {
        return either.makeRight(argument1 => {
          if (!nodeIsBoolean(argument1)) {
            return either.makeLeft({
              kind: 'typeMismatch',
              message: '`and` expected a boolean',
            })
          } else {
            return either.makeRight(
              String(
                booleanNodeToBoolean(argument1) &&
                  booleanNodeToBoolean(argument2),
              ),
            )
          }
        })
      }
    },
  ),

  or: preludeFunctionArity2(
    ['boolean', 'or'],
    {
      parameter: types.boolean,
      return: makeFunctionType({
        parameter: types.boolean,
        return: types.boolean,
      }),
    },
    argument2 => {
      if (!nodeIsBoolean(argument2)) {
        return either.makeLeft({
          kind: 'typeMismatch',
          message: '`or` expected a boolean',
        })
      } else {
        return either.makeRight(argument1 => {
          if (!nodeIsBoolean(argument1)) {
            return either.makeLeft({
              kind: 'typeMismatch',
              message: '`or` expected a boolean',
            })
          } else {
            return either.makeRight(
              String(
                booleanNodeToBoolean(argument1) ||
                  booleanNodeToBoolean(argument2),
              ),
            )
          }
        })
      }
    },
  ),
} as const

type BooleanNode = 'true' | 'false'
const nodeIsBoolean = (node: SemanticGraph) =>
  node === 'true' || node === 'false'

const booleanNodeToBoolean = (node: BooleanNode): boolean => node === 'true'
