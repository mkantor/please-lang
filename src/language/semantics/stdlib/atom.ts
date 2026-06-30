import either from '@matt.kantor/either'
import {
  isObjectNode,
  objectNodeFromOrderedEntries,
  orderedEntriesOfObjectNode,
} from '../object-node.js'
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

  length: preludeFunctionArity1(
    ['atom', 'length'],
    { parameter: types.atom, return: types.naturalNumber },
    subject => {
      if (typeof subject !== 'string') {
        return either.makeLeft({
          kind: 'typeMismatch',
          message: '`length` expected an atom',
        })
      } else {
        // Count codepoints rather than JavaScript's internal UTF-16 units.
        return either.makeRight(String(Array.from(subject).length))
      }
    },
  ),

  contains: preludeFunctionArity2(
    ['atom', 'contains'],
    {
      parameter: types.atom,
      return: makeFunctionType({
        parameter: types.atom,
        return: types.boolean,
      }),
    },
    needle => {
      if (typeof needle !== 'string') {
        return either.makeLeft({
          kind: 'typeMismatch',
          message: '`contains` expected an atom',
        })
      } else {
        return either.makeRight(haystack => {
          if (typeof haystack !== 'string') {
            return either.makeLeft({
              kind: 'typeMismatch',
              message: '`contains` expected an atom',
            })
          } else {
            return either.makeRight(String(haystack.includes(needle)))
          }
        })
      }
    },
  ),

  starts_with: preludeFunctionArity2(
    ['atom', 'starts_with'],
    {
      parameter: types.atom,
      return: makeFunctionType({
        parameter: types.atom,
        return: types.boolean,
      }),
    },
    prefix => {
      if (typeof prefix !== 'string') {
        return either.makeLeft({
          kind: 'typeMismatch',
          message: '`starts_with` expected an atom',
        })
      } else {
        return either.makeRight(subject => {
          if (typeof subject !== 'string') {
            return either.makeLeft({
              kind: 'typeMismatch',
              message: '`starts_with` expected an atom',
            })
          } else {
            return either.makeRight(String(subject.startsWith(prefix)))
          }
        })
      }
    },
  ),

  ends_with: preludeFunctionArity2(
    ['atom', 'ends_with'],
    {
      parameter: types.atom,
      return: makeFunctionType({
        parameter: types.atom,
        return: types.boolean,
      }),
    },
    suffix => {
      if (typeof suffix !== 'string') {
        return either.makeLeft({
          kind: 'typeMismatch',
          message: '`ends_with` expected an atom',
        })
      } else {
        return either.makeRight(subject => {
          if (typeof subject !== 'string') {
            return either.makeLeft({
              kind: 'typeMismatch',
              message: '`ends_with` expected an atom',
            })
          } else {
            return either.makeRight(String(subject.endsWith(suffix)))
          }
        })
      }
    },
  ),

  join: preludeFunctionArity2(
    ['atom', 'join'],
    {
      parameter: types.atom,
      return: makeFunctionType({
        parameter: types.object,
        return: types.atom,
      }),
    },
    separator => {
      if (typeof separator !== 'string') {
        return either.makeLeft({
          kind: 'typeMismatch',
          message: '`join` expected an atom',
        })
      } else {
        return either.makeRight(list => {
          if (!isObjectNode(list)) {
            return either.makeLeft({
              kind: 'typeMismatch',
              message: '`join` expected an object',
            })
          } else {
            return either.map(
              either.sequence(
                orderedEntriesOfObjectNode(list).map(([_key, value]) =>
                  typeof value === 'string' ?
                    either.makeRight(value)
                  : either.makeLeft({
                      kind: 'typeMismatch',
                      message: '`join` expected every value to be an atom',
                    }),
                ),
              ),
              values => values.join(separator),
            )
          }
        })
      }
    },
  ),

  split: preludeFunctionArity2(
    ['atom', 'split'],
    {
      parameter: types.atom,
      return: makeFunctionType({
        parameter: types.atom,
        return: types.object,
      }),
    },
    separator => {
      if (typeof separator !== 'string') {
        return either.makeLeft({
          kind: 'typeMismatch',
          message: '`split` expected an atom',
        })
      } else {
        return either.makeRight(subject => {
          if (typeof subject !== 'string') {
            return either.makeLeft({
              kind: 'typeMismatch',
              message: '`split` expected an atom',
            })
          } else {
            return either.makeRight(
              objectNodeFromOrderedEntries(
                subject
                  .split(separator)
                  .map((part, index) => [String(index), part]),
              ),
            )
          }
        })
      }
    },
  ),
} as const
