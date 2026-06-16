import either from '@matt.kantor/either'
import { types } from '../type-system.js'
import { computeIsReturnType } from './return-type-refiners.js'
import { preludeFunctionArity1 } from './stdlib-utilities.js'

export const something = {
  type: types.somethingTypeSymbol,

  is: preludeFunctionArity1(
    ['something', 'is'],
    {
      parameter: types.something,
      return: types.boolean,
    },
    _ => either.makeRight('true'),
    computeIsReturnType(types.something),
  ),
} as const
