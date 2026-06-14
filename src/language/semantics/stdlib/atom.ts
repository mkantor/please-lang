import either from '@matt.kantor/either'
import { objectNodeFromOrderedEntries } from '../object-node.js'
import { types } from '../type-system.js'
import { makeFunctionType } from '../type-system/type-formats.js'
import { computeFromReturnType } from './return-type-refiners.js'
import {
  preludeFunctionArity1,
  preludeFunctionArity2,
} from './stdlib-utilities.js'

export const atom = {
  type: types.atom.symbol,

  append: preludeFunctionArity2(
    ['atom', 'append'],
    {
      parameter: types.atom,
      return: makeFunctionType({
        parameter: types.atom,
        return: types.atom,
      }),
    },
    atomToAppend => {
      if (typeof atomToAppend !== 'string') {
        return either.makeLeft({
          kind: 'typeMismatch',
          message: '`append` expected an atom',
        })
      } else {
        return either.makeRight(atomToAppendTo => {
          if (typeof atomToAppendTo !== 'string') {
            return either.makeLeft({
              kind: 'typeMismatch',
              message: '`append` expected an atom',
            })
          } else {
            return either.makeRight(atomToAppendTo + atomToAppend)
          }
        })
      }
    },
  ),

  // Note that this is simple string equality; e.g. `:atom.equals(1)(01)`
  // is `false`. For this reason it should not be aliased as a global `==`
  // operator or similar as its behavior may not be what users expect for all
  // types of values.
  equals: preludeFunctionArity2(
    ['atom', 'equals'],
    {
      parameter: types.atom,
      return: makeFunctionType({
        parameter: types.atom,
        return: types.boolean,
      }),
    },
    atom2 => {
      if (typeof atom2 !== 'string') {
        return either.makeLeft({
          kind: 'typeMismatch',
          message: '`equals` expected an atom',
        })
      } else {
        return either.makeRight(atom1 => {
          if (typeof atom1 !== 'string') {
            return either.makeLeft({
              kind: 'typeMismatch',
              message: '`equals` expected an atom',
            })
          } else {
            return either.makeRight(String(atom1 === atom2))
          }
        })
      }
    },
  ),

  from: preludeFunctionArity1(
    ['atom', 'from'],
    {
      parameter: types.something,
      return: types.option(types.atom),
    },
    argument =>
      either.makeRight(
        typeof argument === 'string' ?
          objectNodeFromOrderedEntries([
            ['tag', 'some'],
            ['value', argument],
          ])
        : objectNodeFromOrderedEntries([
            ['tag', 'none'],
            ['value', objectNodeFromOrderedEntries([])],
          ]),
      ),
    computeFromReturnType(types.atom),
  ),

  prepend: preludeFunctionArity2(
    ['atom', 'prepend'],
    {
      parameter: types.atom,
      return: makeFunctionType({
        parameter: types.atom,
        return: types.atom,
      }),
    },
    atomToPrepend => {
      if (typeof atomToPrepend !== 'string') {
        return either.makeLeft({
          kind: 'typeMismatch',
          message: '`prepend` expected an atom',
        })
      } else {
        return either.makeRight(atomToPrependTo => {
          if (typeof atomToPrependTo !== 'string') {
            return either.makeLeft({
              kind: 'typeMismatch',
              message: '`prepend` expected an atom',
            })
          } else {
            return either.makeRight(atomToPrepend + atomToPrependTo)
          }
        })
      }
    },
  ),
} as const
