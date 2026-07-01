import either from '@matt.kantor/either'
import { objectNodeFromOrderedEntries } from '../object-node.js'
import { types } from '../type-system.js'
import { makeUnionType } from '../type-system/type-formats.js'
import { anyValue, naturalNumberParameter } from './parameters.js'
import {
  computeFromReturnType,
  computeIsReturnType,
} from './return-type-refiners.js'
import { preludeFunction } from './stdlib-utilities.js'

export const natural_number = {
  type: types.naturalNumber.symbol,

  is: preludeFunction(
    ['natural_number', 'is'],
    [anyValue(types.something)],
    types.boolean,
    argument =>
      either.makeRight(
        (
          typeof argument === 'string' &&
            types.naturalNumber.isAssignableFrom(makeUnionType([argument]))
        ) ?
          'true'
        : 'false',
      ),
    computeIsReturnType(types.naturalNumber),
  ),

  from: preludeFunction(
    ['natural_number', 'from'],
    [anyValue(types.something)],
    types.option(types.naturalNumber),
    argument =>
      either.makeRight(
        (
          typeof argument === 'string' &&
            types.naturalNumber.isAssignableFrom(makeUnionType([argument]))
        ) ?
          objectNodeFromOrderedEntries([
            ['tag', 'some'],
            ['value', argument],
          ])
        : objectNodeFromOrderedEntries([
            ['tag', 'none'],
            ['value', objectNodeFromOrderedEntries([])],
          ]),
      ),
    computeFromReturnType(types.naturalNumber),
  ),

  modulo: preludeFunction(
    ['natural_number', 'modulo'],
    [naturalNumberParameter, naturalNumberParameter],
    types.naturalNumber,
    number2 =>
      either.makeRight(number1 =>
        either.makeRight(String(BigInt(number1) % BigInt(number2))),
      ),
  ),
} as const
