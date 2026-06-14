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

export const object = {
  type: objectNodeFromOrderedEntries([]),

  lookup: preludeFunctionArity2(
    ['object', 'lookup'],
    {
      // TODO
      parameter: types.atom,
      return: makeFunctionType({
        parameter: types.object,
        return: types.option(types.something),
      }),
    },
    key => {
      if (typeof key !== 'string') {
        return either.makeLeft({
          kind: 'typeMismatch',
          message: '`lookup` key was not an atom',
        })
      } else {
        return either.makeRight(argument => {
          if (!isObjectNode(argument)) {
            return either.makeLeft({
              kind: 'typeMismatch',
              message: '`lookup` expected an object',
            })
          } else {
            const propertyValue = argument[key]
            return either.makeRight(
              propertyValue !== undefined ?
                objectNodeFromOrderedEntries([
                  ['tag', 'some'],
                  ['value', propertyValue],
                ])
              : objectNodeFromOrderedEntries([
                  ['tag', 'none'],
                  ['value', objectNodeFromOrderedEntries([])],
                ]),
            )
          }
        })
      }
    },
  ),

  from: preludeFunctionArity1(
    ['object', 'from'],
    {
      parameter: types.something,
      return: types.option(types.object),
    },
    argument =>
      either.makeRight(
        isObjectNode(argument) ?
          objectNodeFromOrderedEntries([
            ['tag', 'some'],
            ['value', argument],
          ])
        : objectNodeFromOrderedEntries([
            ['tag', 'none'],
            ['value', objectNodeFromOrderedEntries([])],
          ]),
      ),
    computeFromReturnType(types.object),
  ),

  from_property: preludeFunctionArity2(
    ['object', 'from_property'],
    {
      // TODO
      parameter: types.atom,
      return: makeFunctionType({
        parameter: types.something,
        return: types.object,
      }),
    },
    key => {
      if (typeof key !== 'string') {
        return either.makeLeft({
          kind: 'typeMismatch',
          message: '`from_property` key was not an atom',
        })
      } else {
        return either.makeRight(value =>
          either.makeRight(objectNodeFromOrderedEntries([[key, value]])),
        )
      }
    },
  ),

  overlay: preludeFunctionArity2(
    ['object', 'overlay'],
    {
      // TODO
      parameter: types.object,
      return: makeFunctionType({
        parameter: types.object,
        return: types.object,
      }),
    },
    object2 => {
      if (typeof object2 !== 'object') {
        return either.makeLeft({
          kind: 'typeMismatch',
          message: '`overlay` expected an object',
        })
      } else {
        return either.makeRight(object1 => {
          if (!isObjectNode(object1)) {
            return either.makeLeft({
              kind: 'typeMismatch',
              message: '`overlay` expected an object',
            })
          } else {
            // `object1` supplies the initial property order with `object2`
            // overwriting values for shared keys in-place. New keys from
            // `object2` are appended at the end in their original order.
            return either.makeRight(
              objectNodeFromOrderedEntries([
                ...orderedEntriesOfObjectNode(object1).map(
                  ([key, value]) => [key, object2[key] ?? value] as const,
                ),
                ...orderedEntriesOfObjectNode(object2).filter(
                  ([key, _value]) => !(key in object1),
                ),
              ]),
            )
          }
        })
      }
    },
  ),
} as const
