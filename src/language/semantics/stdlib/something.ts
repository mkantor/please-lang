import either from '@matt.kantor/either'
import { types } from '../type-system.js'
import { anyValue } from './parameters.js'
import { computeIsReturnType } from './return-type-refiners.js'
import { preludeFunction } from './stdlib-utilities.js'

export const something = {
  type: types.somethingTypeSymbol,

  is: preludeFunction(
    ['something', 'is'],
    [anyValue(types.something)],
    types.boolean,
    _ => either.makeRight('true'),
    computeIsReturnType(types.something),
  ),
} as const
