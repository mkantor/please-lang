import either from '@matt.kantor/either'
import { makeUnionExpression } from '../expressions/union-expression.js'
import { objectNodeFromOrderedEntries } from '../object-node.js'
import { types } from '../type-system.js'
import {
  anyValue,
  booleanParameter,
  nodeIsBoolean,
  type BooleanNode,
} from './parameters.js'
import {
  computeFromReturnType,
  computeIsReturnType,
} from './return-type-refiners.js'
import { preludeFunction } from './stdlib-utilities.js'

export const boolean = {
  type: makeUnionExpression(
    objectNodeFromOrderedEntries([
      ['0', 'false'],
      ['1', 'true'],
    ]),
  ),

  is: preludeFunction(
    ['boolean', 'is'],
    [anyValue(types.something)],
    types.boolean,
    argument => either.makeRight(nodeIsBoolean(argument) ? 'true' : 'false'),
    computeIsReturnType(types.boolean),
  ),

  from: preludeFunction(
    ['boolean', 'from'],
    [anyValue(types.something)],
    types.option(types.boolean),
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

  not: preludeFunction(
    ['boolean', 'not'],
    [booleanParameter],
    types.boolean,
    argument => either.makeRight(argument === 'true' ? 'false' : 'true'),
  ),

  and: preludeFunction(
    ['boolean', 'and'],
    [booleanParameter, booleanParameter],
    types.boolean,
    argument2 =>
      either.makeRight(argument1 =>
        either.makeRight(
          String(
            booleanNodeToBoolean(argument1) && booleanNodeToBoolean(argument2),
          ),
        ),
      ),
  ),

  or: preludeFunction(
    ['boolean', 'or'],
    [booleanParameter, booleanParameter],
    types.boolean,
    argument2 =>
      either.makeRight(argument1 =>
        either.makeRight(
          String(
            booleanNodeToBoolean(argument1) || booleanNodeToBoolean(argument2),
          ),
        ),
      ),
  ),
} as const

const booleanNodeToBoolean = (node: BooleanNode): boolean => node === 'true'
