import either from '@matt.kantor/either'
import { objectNodeFromOrderedEntries } from '../object-node.js'
import { types } from '../type-system.js'
import { makeFunctionType, makeUnionType } from '../type-system/type-formats.js'
import {
  closedOver,
  computeFromReturnType,
  computeIsReturnType,
} from './return-type-refiners.js'
import {
  preludeFunctionArity1,
  preludeFunctionArity2,
} from './stdlib-utilities.js'

// Addition and multiplication (for example) are closed over the natural
// numbers: the sum or product of natural numbers is always a natural number.
// This isn't true for subtraction (for example).
const closedOverNaturalNumbers = closedOver(types.naturalNumber, types.integer)

export const integer = {
  type: types.integer.symbol,

  add: preludeFunctionArity2(
    ['integer', 'add'],
    {
      parameter: types.integer,
      return: makeFunctionType({
        parameter: types.integer,
        return: types.integer,
      }),
    },
    number2 => {
      if (
        typeof number2 !== 'string' ||
        !types.integer.isAssignableFrom(makeUnionType([number2]))
      ) {
        return either.makeLeft({
          kind: 'typeMismatch',
          message: '`add` expected an integer',
        })
      } else {
        return either.makeRight(number1 => {
          if (
            typeof number1 !== 'string' ||
            !types.integer.isAssignableFrom(makeUnionType([number1]))
          ) {
            return either.makeLeft({
              kind: 'typeMismatch',
              message: '`add` expected an integer',
            })
          } else {
            // FIXME: It's wasteful to always convert here.
            //
            // Consider `add(add(1)(1))(1)`—the `2` returned from the inner
            // `add` is stringified only to be converted back to a bigint.
            // This is acceptable for the prototype, but a real
            // implementation could use a fancier `SemanticGraph` which can
            // model atoms as different native data types.
            return either.makeRight(String(BigInt(number1) + BigInt(number2)))
          }
        })
      }
    },
    closedOverNaturalNumbers,
  ),

  equals: preludeFunctionArity2(
    ['integer', 'equals'],
    {
      parameter: types.integer,
      return: makeFunctionType({
        parameter: types.integer,
        return: types.boolean,
      }),
    },
    number2 => {
      if (
        typeof number2 !== 'string' ||
        !types.integer.isAssignableFrom(makeUnionType([number2]))
      ) {
        return either.makeLeft({
          kind: 'typeMismatch',
          message: '`equals` expected an integer',
        })
      } else {
        return either.makeRight(number1 => {
          if (
            typeof number1 !== 'string' ||
            !types.integer.isAssignableFrom(makeUnionType([number1]))
          ) {
            return either.makeLeft({
              kind: 'typeMismatch',
              message: '`equals` expected an integer',
            })
          } else {
            // TODO: See comment in `integer.add`.
            return either.makeRight(String(BigInt(number1) === BigInt(number2)))
          }
        })
      }
    },
  ),

  is: preludeFunctionArity1(
    ['integer', 'is'],
    {
      parameter: types.something,
      return: types.boolean,
    },
    argument =>
      either.makeRight(
        (
          typeof argument === 'string' &&
            types.integer.isAssignableFrom({
              kind: 'union',
              members: new Set([argument]),
            })
        ) ?
          'true'
        : 'false',
      ),
    computeIsReturnType(types.integer),
  ),

  from: preludeFunctionArity1(
    ['integer', 'from'],
    {
      parameter: types.something,
      return: types.option(types.integer),
    },
    argument =>
      either.makeRight(
        (
          typeof argument === 'string' &&
            types.integer.isAssignableFrom({
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
    computeFromReturnType(types.integer),
  ),

  is_greater_than: preludeFunctionArity2(
    ['integer', 'is_greater_than'],
    {
      parameter: types.integer,
      return: makeFunctionType({
        parameter: types.integer,
        return: types.boolean,
      }),
    },
    number2 => {
      if (
        typeof number2 !== 'string' ||
        !types.integer.isAssignableFrom(makeUnionType([number2]))
      ) {
        return either.makeLeft({
          kind: 'typeMismatch',
          message: '`is_greater_than` expected an integer',
        })
      } else {
        return either.makeRight(number1 => {
          if (
            typeof number1 !== 'string' ||
            !types.integer.isAssignableFrom(makeUnionType([number1]))
          ) {
            return either.makeLeft({
              kind: 'typeMismatch',
              message: '`is_greater_than` expected an integer',
            })
          } else {
            // TODO: See comment in `integer.add`.
            return either.makeRight(String(BigInt(number1) > BigInt(number2)))
          }
        })
      }
    },
  ),

  is_less_than: preludeFunctionArity2(
    ['integer', 'is_less_than'],
    {
      parameter: types.integer,
      return: makeFunctionType({
        parameter: types.integer,
        return: types.boolean,
      }),
    },
    number2 => {
      if (
        typeof number2 !== 'string' ||
        !types.integer.isAssignableFrom(makeUnionType([number2]))
      ) {
        return either.makeLeft({
          kind: 'typeMismatch',
          message: '`is_less_than` expected an integer',
        })
      } else {
        return either.makeRight(number1 => {
          if (
            typeof number1 !== 'string' ||
            !types.integer.isAssignableFrom(makeUnionType([number1]))
          ) {
            return either.makeLeft({
              kind: 'typeMismatch',
              message: '`is_less_than` expected an integer',
            })
          } else {
            // TODO: See comment in `integer.add`.
            return either.makeRight(String(BigInt(number1) < BigInt(number2)))
          }
        })
      }
    },
  ),

  multiply: preludeFunctionArity2(
    ['integer', 'multiply'],
    {
      parameter: types.integer,
      return: makeFunctionType({
        parameter: types.integer,
        return: types.integer,
      }),
    },
    number2 => {
      if (
        typeof number2 !== 'string' ||
        !types.integer.isAssignableFrom(makeUnionType([number2]))
      ) {
        return either.makeLeft({
          kind: 'typeMismatch',
          message: '`multiply` expected an integer',
        })
      } else {
        return either.makeRight(number1 => {
          if (
            typeof number1 !== 'string' ||
            !types.integer.isAssignableFrom(makeUnionType([number1]))
          ) {
            return either.makeLeft({
              kind: 'typeMismatch',
              message: '`multiply` expected an integer',
            })
          } else {
            // TODO: See comment in `integer.add`.
            return either.makeRight(String(BigInt(number1) * BigInt(number2)))
          }
        })
      }
    },
    closedOverNaturalNumbers,
  ),

  subtract: preludeFunctionArity2(
    ['integer', 'subtract'],
    {
      parameter: types.integer,
      return: makeFunctionType({
        parameter: types.integer,
        return: types.integer,
      }),
    },
    number2 => {
      if (
        typeof number2 !== 'string' ||
        !types.integer.isAssignableFrom(makeUnionType([number2]))
      ) {
        return either.makeLeft({
          kind: 'typeMismatch',
          message: '`subtract` expected an integer',
        })
      } else {
        return either.makeRight(number1 => {
          if (
            typeof number1 !== 'string' ||
            !types.integer.isAssignableFrom(makeUnionType([number1]))
          ) {
            return either.makeLeft({
              kind: 'typeMismatch',
              message: '`subtract` expected an integer',
            })
          } else {
            // TODO: See comment in `integer.add`.
            return either.makeRight(String(BigInt(number1) - BigInt(number2)))
          }
        })
      }
    },
  ),
} as const
