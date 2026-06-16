import either from '@matt.kantor/either'
import { objectNodeFromOrderedEntries } from '../object-node.js'
import { types } from '../type-system.js'
import { makeFunctionType, makeUnionType } from '../type-system/type-formats.js'
import {
  computeFromReturnType,
  computeIsReturnType,
} from './return-type-refiners.js'
import {
  preludeFunctionArity1,
  preludeFunctionArity2,
} from './stdlib-utilities.js'

export const natural_number = {
  type: types.naturalNumber.symbol,

  is: preludeFunctionArity1(
    ['natural_number', 'is'],
    {
      parameter: types.something,
      return: types.boolean,
    },
    argument =>
      either.makeRight(
        (
          typeof argument === 'string' &&
            types.naturalNumber.isAssignableFrom({
              kind: 'union',
              members: new Set([argument]),
            })
        ) ?
          'true'
        : 'false',
      ),
    computeIsReturnType(types.naturalNumber),
  ),

  from: preludeFunctionArity1(
    ['natural_number', 'from'],
    {
      parameter: types.something,
      return: types.option(types.naturalNumber),
    },
    argument =>
      either.makeRight(
        (
          typeof argument === 'string' &&
            types.naturalNumber.isAssignableFrom({
              kind: 'union',
              members: new Set([argument]),
            })
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

  modulo: preludeFunctionArity2(
    ['natural_number', 'modulo'],
    {
      parameter: types.naturalNumber,
      return: makeFunctionType({
        parameter: types.naturalNumber,
        return: types.naturalNumber,
      }),
    },
    number2 => {
      if (
        typeof number2 !== 'string' ||
        !types.naturalNumber.isAssignableFrom(makeUnionType([number2]))
      ) {
        return either.makeLeft({
          kind: 'typeMismatch',
          message: '`modulo` expected a natural number',
        })
      } else {
        return either.makeRight(number1 => {
          if (
            typeof number1 !== 'string' ||
            !types.naturalNumber.isAssignableFrom(makeUnionType([number1]))
          ) {
            return either.makeLeft({
              kind: 'typeMismatch',
              message: '`modulo` expected a natural number',
            })
          } else {
            return either.makeRight(String(BigInt(number1) % BigInt(number2)))
          }
        })
      }
    },
  ),
} as const
