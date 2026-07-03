import either from '@matt.kantor/either'
import { makeUnionExpression } from '../expressions/union-expression.js'
import { objectNodeFromOrderedEntries } from '../object-node.js'
import { types } from '../type-system.js'
import { anyValue } from './parameters.js'
import { preludeFunction } from './stdlib-utilities.js'

export const nothing = {
  type: makeUnionExpression(objectNodeFromOrderedEntries([])),

  is: preludeFunction(
    ['nothing', 'is'],
    [anyValue(types.something)],
    types.boolean,
    _ => either.makeRight('false'),
  ),
} as const
