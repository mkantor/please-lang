import either from '@matt.kantor/either'
import option, { type Option } from '@matt.kantor/option'
import type { Atom } from '../../parsing.js'
import {
  isObjectNode,
  objectNodeFromOrderedEntries,
  orderedEntriesOfObjectNode,
} from '../object-node.js'
import {
  isNothing,
  makeObjectType,
  makeUnionType,
  types,
  unionOfTypes,
  type Type,
} from '../type-system.js'
import { asUnionWithLiteralAtomMembers } from '../type-system/subtyping.js'
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
                makeObjectType({ [key]: valueType }, { excess: types.nothing }),
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
                  isNothing(object2Type.excess) ? child
                    // The property may exist as excess (with an unknown type).
                  : types.something,
                ]),
            ),
            ...object2Type.children,
          },
          {
            excess:
              isNothing(object1Type.excess) && isNothing(object2Type.excess) ?
                types.nothing
              : types.something,
          },
        )
      : types.object
  }
}

/**
 * The type of `lookup`'s result given every property value the key could
 * possibly select. The `some` member is omitted when no value is selectable,
 * and the `none` member is omitted when the key definitely selects a value.
 */
const lookupReturnType = ({
  possibleValueTypes,
  mayBeNone,
}: {
  readonly possibleValueTypes: readonly Type[]
  readonly mayBeNone: boolean
}): Type =>
  unionOfTypes([
    ...(possibleValueTypes.length === 0 ?
      []
    : [
        makeObjectType(
          {
            tag: makeUnionType(['some']),
            value: unionOfTypes(possibleValueTypes),
          },
          { excess: types.nothing },
        ),
      ]),
    ...(mayBeNone ?
      [
        makeObjectType(
          {
            tag: makeUnionType(['none']),
            value: makeObjectType({}, { excess: types.nothing }),
          },
          { excess: types.nothing },
        ),
      ]
    : []),
  ])

/**
 * Literal atoms the key could be at runtime (when statically enumerable).
 */
const literalLookupKeyCandidates = (
  keyType: Type,
): Option<ReadonlySet<Atom>> =>
  keyType.kind === 'union' ?
    option.map(asUnionWithLiteralAtomMembers(keyType), union => union.members)
  : keyType.kind === 'parameter' ?
    literalLookupKeyCandidates(keyType.constraint.assignableTo)
  : option.none

// `lookup(key)(object)` returns `some(object[key])` when the key is definitely
// present, `none` when definitely absent (e.g. a closed object lacking it),
// otherwise a union covering all possible outcomes.
const computeLookupReturnType = (parameterTypes: readonly Type[]): Type => {
  const [keyType, objectType] = parameterTypes
  if (keyType === undefined || objectType === undefined) {
    throw new Error(
      '`lookup` function did not receive two arguments. This is a bug!',
    )
  } else if (objectType.kind !== 'object') {
    // TODO: Consider also supporting stuck/type-parameter object types via
    // their upper bounds.
    return types.option(types.something)
  } else {
    return option.match(literalLookupKeyCandidates(keyType), {
      some: possibleKeys => {
        const presentValueTypes = [...possibleKeys].flatMap(key => {
          const valueType = objectType.children[key]
          return valueType === undefined ? [] : [valueType]
        })
        const someKeyMayBeAbsent =
          presentValueTypes.length !== possibleKeys.size
        return someKeyMayBeAbsent && !isNothing(objectType.excess) ?
            // The key may exist as an excess property (with an unknown type).
            types.option(types.something)
          : lookupReturnType({
              possibleValueTypes: presentValueTypes,
              mayBeNone: someKeyMayBeAbsent,
            })
      },
      none: _ =>
        isNothing(objectType.excess) ?
          // Whatever the key turns out to be, it can only select one of the
          // object's own property values (or nothing).
          lookupReturnType({
            possibleValueTypes: Object.values(objectType.children),
            mayBeNone: true,
          })
        : types.option(types.something),
    })
  }
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
