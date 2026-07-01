import either from '@matt.kantor/either'
import option from '@matt.kantor/option'
import type { Atom } from '../../parsing.js'
import {
  isObjectNode,
  objectNodeFromOrderedEntries,
  orderedEntriesOfObjectNode,
} from '../object-node.js'
import { types } from '../type-system.js'
import { asUnionWithLiteralAtomMembers } from '../type-system/subtyping.js'
import {
  makeObjectType,
  makeUnionType,
  unionOfTypes,
  type ObjectType,
  type Type,
} from '../type-system/type-formats.js'
import { applyKeyPathToType } from '../type-system/type-substitution.js'
import { anyValue, atomParameter, objectParameter } from './parameters.js'
import { computeFromReturnType } from './return-type-refiners.js'
import { preludeFunction } from './stdlib-utilities.js'

const computeFromPropertyReturnType = (
  parameterTypes: readonly Type[],
): Type => {
  const [keyType, valueType] = parameterTypes
  if (keyType === undefined || valueType === undefined) {
    throw new Error(
      '`from_property` function did not receive two arguments. This is a bug!',
    )
  } else {
    return option.match(
      // TODO: Consider also supporting type parameters/stuck types via their
      // upper bounds.
      keyType.kind === 'union' ?
        asUnionWithLiteralAtomMembers(keyType)
      : option.none,
      {
        none: _ => types.object,
        some: keys =>
          unionOfTypes([
            ...keys.members
              .values()
              .map(key =>
                makeObjectType({ [key]: valueType }, { exact: true }),
              ),
          ]),
      },
    )
  }
}

const computeOverlayReturnType = (parameterTypes: readonly Type[]): Type => {
  const [object2Type, object1Type] = parameterTypes
  if (object2Type === undefined || object1Type === undefined) {
    throw new Error(
      '`overlay` function did not receive two arguments. This is a bug!',
    )
  } else {
    // TODO: Consider also supporting type parameters/stuck types via their
    // upper bounds.
    return object2Type.kind === 'object' && object1Type.kind === 'object' ?
        makeObjectType(
          {
            ...Object.fromEntries(
              Object.entries(object1Type.children)
                .filter(([key]) => object2Type.children[key] === undefined)
                .map(([key, child]) => [
                  key,
                  object2Type.exact ? child
                    // The property may exist as excess (with an unknown type).
                  : types.something,
                ]),
            ),
            ...object2Type.children,
          },
          { exact: object1Type.exact && object2Type.exact },
        )
      : types.object
  }
}

const computeLookupReturnType = (parameterTypes: readonly Type[]): Type => {
  const [keyType, objectType] = parameterTypes
  if (keyType === undefined || objectType === undefined) {
    throw new Error(
      '`lookup` function did not receive two arguments. This is a bug!',
    )
  } else {
    // TODO: Consider also supporting type parameters/stuck types via their
    // upper bounds.
    return keyType.kind === 'union' && objectType.kind === 'object' ?
        option.match(asUnionWithLiteralAtomMembers(keyType), {
          none: _ => types.option(types.something),
          some: keys => {
            const keysAsArray = [...keys.members]
            return keysAsArray.length === 1 && keysAsArray[0] !== undefined ?
                lookupReturnForKey(keysAsArray[0], objectType)
              : types.option(types.something)
          },
        })
      : types.option(types.something)
  }
}

// `lookup(key)(object)` returns `some(object[key])` when the key is definitely
// present, `none` when it is definitely absent (an `exact` object lacking it),
// or an `option` otherwise (the key may be an excess property).
const lookupReturnForKey = (key: Atom, objectType: ObjectType): Type => {
  const valueType = applyKeyPathToType(objectType, [key])
  return (
    valueType.kind === 'union' && valueType.members.size === 0 ?
      objectType.exact ?
        makeObjectType(
          {
            tag: makeUnionType(['none']),
            value: makeObjectType({}, { exact: true }),
          },
          { exact: true },
        )
      : types.option(types.something)
    : makeObjectType(
        { tag: makeUnionType(['some']), value: valueType },
        { exact: true },
      )
  )
}

export const object = {
  type: objectNodeFromOrderedEntries([]),

  lookup: preludeFunction(
    ['object', 'lookup'],
    [atomParameter, objectParameter],
    types.option(types.something),
    key =>
      either.makeRight(argument => {
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
      }),
    computeLookupReturnType,
  ),

  from: preludeFunction(
    ['object', 'from'],
    [anyValue(types.something)],
    types.option(types.object),
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

  from_property: preludeFunction(
    ['object', 'from_property'],
    [atomParameter, anyValue(types.something)],
    types.object,
    key =>
      either.makeRight(value =>
        either.makeRight(objectNodeFromOrderedEntries([[key, value]])),
      ),
    computeFromPropertyReturnType,
  ),

  overlay: preludeFunction(
    ['object', 'overlay'],
    [objectParameter, objectParameter],
    types.object,
    // `object1` supplies the initial property order with `object2` overwriting
    // values for shared keys in-place. New keys from `object2` are appended at
    // the end in their original order.
    object2 =>
      either.makeRight(object1 =>
        either.makeRight(
          objectNodeFromOrderedEntries([
            ...orderedEntriesOfObjectNode(object1).map(
              ([key, value]) => [key, object2[key] ?? value] as const,
            ),
            ...orderedEntriesOfObjectNode(object2).filter(
              ([key, _value]) => !(key in object1),
            ),
          ]),
        ),
      ),
    computeOverlayReturnType,
  ),
} as const
