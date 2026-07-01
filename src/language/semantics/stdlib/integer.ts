import either from '@matt.kantor/either'
import { objectNodeFromOrderedEntries } from '../object-node.js'
import { types } from '../type-system.js'
import { makeUnionType } from '../type-system/type-formats.js'
import { anyValue, integerParameter } from './parameters.js'
import {
  closedOver,
  computeFromReturnType,
  computeIsReturnType,
} from './return-type-refiners.js'
import { preludeFunction } from './stdlib-utilities.js'

// Addition and multiplication (for example) are closed over the natural
// numbers: the sum or product of natural numbers is always a natural number.
// This isn't true for subtraction (for example).
const closedOverNaturalNumbers = closedOver(types.naturalNumber, types.integer)

export const integer = {
  type: types.integer.symbol,

  add: preludeFunction(
    ['integer', 'add'],
    [integerParameter, integerParameter],
    types.integer,
    // FIXME: It's wasteful to always convert here.
    //
    // Consider `add(add(1)(1))(1)`—the `2` returned from the inner `add` is
    // stringified only to be converted back to a bigint. This is acceptable
    // for the prototype, but a real implementation could use a fancier
    // `SemanticGraph` which can model atoms as different native data types.
    number2 =>
      either.makeRight(number1 =>
        either.makeRight(String(BigInt(number1) + BigInt(number2))),
      ),
    closedOverNaturalNumbers,
  ),

  equals: preludeFunction(
    ['integer', 'equals'],
    [integerParameter, integerParameter],
    types.boolean,
    number2 =>
      either.makeRight(number1 =>
        either.makeRight(String(BigInt(number1) === BigInt(number2))),
      ),
  ),

  is: preludeFunction(
    ['integer', 'is'],
    [anyValue(types.something)],
    types.boolean,
    argument =>
      either.makeRight(
        (
          typeof argument === 'string' &&
            types.integer.isAssignableFrom(makeUnionType([argument]))
        ) ?
          'true'
        : 'false',
      ),
    computeIsReturnType(types.integer),
  ),

  from: preludeFunction(
    ['integer', 'from'],
    [anyValue(types.something)],
    types.option(types.integer),
    argument =>
      either.makeRight(
        (
          typeof argument === 'string' &&
            types.integer.isAssignableFrom(makeUnionType([argument]))
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

  is_greater_than: preludeFunction(
    ['integer', 'is_greater_than'],
    [integerParameter, integerParameter],
    types.boolean,
    number2 =>
      either.makeRight(number1 =>
        either.makeRight(String(BigInt(number1) > BigInt(number2))),
      ),
  ),

  is_less_than: preludeFunction(
    ['integer', 'is_less_than'],
    [integerParameter, integerParameter],
    types.boolean,
    number2 =>
      either.makeRight(number1 =>
        either.makeRight(String(BigInt(number1) < BigInt(number2))),
      ),
  ),

  multiply: preludeFunction(
    ['integer', 'multiply'],
    [integerParameter, integerParameter],
    types.integer,
    number2 =>
      either.makeRight(number1 =>
        either.makeRight(String(BigInt(number1) * BigInt(number2))),
      ),
    closedOverNaturalNumbers,
  ),

  subtract: preludeFunction(
    ['integer', 'subtract'],
    [integerParameter, integerParameter],
    types.integer,
    number2 =>
      either.makeRight(number1 =>
        either.makeRight(String(BigInt(number1) - BigInt(number2))),
      ),
  ),
} as const
