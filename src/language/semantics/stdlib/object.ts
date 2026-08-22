import either from '@matt.kantor/either'
import option, { type Option } from '@matt.kantor/option'
import type { Atom } from '../../parsing.js'
import {
  isObjectNode,
  objectNodeFromOrderedEntries,
  orderedEntriesOfObjectNode,
} from '../object-node.js'
import {
  isAssignable,
  isBottomType,
  makeObjectType,
  makeUnionType,
  types,
  unionOfTypes,
  type ObjectType,
  type Type,
  type UnionType,
} from '../type-system.js'
import {
  asUnionWithLiteralAtomMembers,
  effectiveExcessClauses,
  excessBoundForKey,
  simplifyUnionType,
} from '../type-system/subtyping.js'
import { concreteUpperBound } from '../type-system/type-substitution.js'
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
    return option.match(literalKeyCandidates(keyType), {
      // The key isn't statically known, but every property value is the
      // supplied one.
      none: _ => makeObjectType({}, [{ keys: types.atom, values: valueType }]),
      some: keys =>
        unionOfTypes([
          ...keys
            .values()
            .map(key =>
              makeObjectType({ [key]: valueType }, [
                { keys: types.atom, values: types.nothing },
              ]),
            ),
        ]),
    })
  }
}

const computeOverlayReturnType = (parameterTypes: readonly Type[]): Type => {
  const [rawObject2Type, rawObject1Type] = parameterTypes
  const object2Type =
    rawObject2Type === undefined ? rawObject2Type : (
      concreteUpperBound(rawObject2Type)
    )
  const object1Type =
    rawObject1Type === undefined ? rawObject1Type : (
      concreteUpperBound(rawObject1Type)
    )
  if (object2Type === undefined || object1Type === undefined) {
    throw new Error(
      '`overlay` function did not receive two arguments. This is a bug!',
    )
  } else if (object2Type.kind === 'object' && object1Type.kind === 'object') {
    const object1Excess = effectiveExcessClauses(object1Type.excess)
    const object2Excess = effectiveExcessClauses(object2Type.excess)
    return makeObjectType(
      {
        ...Object.fromEntries(
          Object.entries(object1Type.children)
            .filter(([key]) => object2Type.children[key] === undefined)
            .map(([key, child]) => {
              const object2Bound = excessBoundForKey(key, object2Type.excess)
              return [
                key,
                isBottomType(object2Bound) ? child
                  // The property may exist unlisted in `object2`, in which case
                  // its value overwrites `object1`'s.
                : unionOfTypes([child, object2Bound]),
              ]
            }),
        ),
        ...object2Type.children,
      },
      // Unlisted properties of the result come from either operand's clauses.
      // Which clause applies to which key isn't tracked here, so the result
      // gets a single clause bounding every key, or stays fully open when
      // either operand admits arbitrary values somewhere.
      (
        object1Excess.some(clause => clause.values === types.something) ||
          object2Excess.some(clause => clause.values === types.something)
      ) ?
        []
      : [
          {
            keys: types.atom,
            values: unionOfTypes([
              ...object1Excess.map(clause => clause.values),
              ...object2Excess.map(clause => clause.values),
            ]),
          },
        ],
    )
  } else {
    return types.object
  }
}

/**
 * The type of `lookup`'s result given every property value the key could
 * possibly select. The `some` member is omitted when no value is selectable,
 * and the `none` member is omitted when the key definitely selects a value.
 */
const optionType = ({
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
          [{ keys: types.atom, values: types.nothing }],
        ),
      ]),
    ...(mayBeNone ?
      [
        makeObjectType(
          {
            tag: makeUnionType(['none']),
            value: makeObjectType({}, [
              { keys: types.atom, values: types.nothing },
            ]),
          },
          [{ keys: types.atom, values: types.nothing }],
        ),
      ]
    : []),
  ])

/**
 * Literal atoms the key could be at runtime (when statically enumerable).
 */
const literalKeyCandidates = (keyType: Type): Option<ReadonlySet<Atom>> => {
  const bound = concreteUpperBound(keyType)
  return bound.kind === 'union' ?
      option.map(asUnionWithLiteralAtomMembers(bound), union => union.members)
    : option.none
}

/**
 * Every member of a union as an object type, or `none` when one or more members
 * aren't object types.
 */
const memberObjectTypes = (
  unionType: UnionType,
): Option<readonly ObjectType[]> =>
  option.sequence(
    [...unionType.members].map(member => {
      if (typeof member === 'string') {
        return option.none
      } else {
        const memberBound = concreteUpperBound(member)
        return memberBound.kind === 'object' ?
            option.makeSome(memberBound)
          : option.none
      }
    }),
  )

const excessClausesReachableFromKey = (
  keyBound: Type,
  excess: ObjectType['excess'],
): ObjectType['excess'] => {
  const clausesMatchEveryPossibleKey = (
    clauses: ObjectType['excess'],
  ): boolean =>
    isAssignable({
      source: keyBound,
      target: unionOfTypes(clauses.map(clause => clause.keys)),
    })
  const matchableClauses =
    clausesMatchEveryPossibleKey(excess) ? excess : (
      effectiveExcessClauses(excess)
    )
  return matchableClauses.filter(
    (_clause, index) =>
      !clausesMatchEveryPossibleKey(matchableClauses.slice(index + 1)),
  )
}

const lookupReturnTypeForObjectType = (
  keyType: Type,
  objectType: ObjectType,
): Type =>
  option.match(literalKeyCandidates(keyType), {
    some: keys => {
      const presentValueTypes = [...keys].flatMap(key => {
        const valueType = objectType.children[key]
        return valueType === undefined ? [] : [valueType]
      })
      const someKeyMayBeAbsent = presentValueTypes.length !== keys.size
      const absentKeyBounds = [...keys]
        .filter(key => objectType.children[key] === undefined)
        .map(key => excessBoundForKey(key, objectType.excess))
      return (
        !someKeyMayBeAbsent ?
          optionType({
            possibleValueTypes: presentValueTypes,
            mayBeNone: false,
          })
          // A key not among the children may exist as an unlisted property,
          // whose value is bounded by the last clause matching the key.
        : absentKeyBounds.some(bound => bound === types.something) ?
          types.option(types.something)
        : optionType({
            possibleValueTypes: [
              ...presentValueTypes,
              ...absentKeyBounds.filter(bound => !isBottomType(bound)),
            ],
            mayBeNone: true,
          })
      )
    },
    none: _ => {
      // Whatever the key turns out to be, it can only select one of the
      // object's own property values, an unlisted property's value (bounded
      // by the object's excess clauses), or nothing. Properties whose key the
      // key type rules out are unselectable, so they bound nothing here.
      const keyBound = concreteUpperBound(keyType)
      const reachableExcess = excessClausesReachableFromKey(
        keyBound,
        objectType.excess,
      )
      return reachableExcess.some(clause => clause.values === types.something) ?
          types.option(types.something)
        : optionType({
            possibleValueTypes: [
              ...Object.entries(objectType.children)
                .filter(([key]) =>
                  isAssignable({
                    source: makeUnionType([key]),
                    target: keyBound,
                  }),
                )
                .map(([_key, valueType]) => valueType),
              ...reachableExcess
                .map(clause => clause.values)
                .filter(clauseValues => !isBottomType(clauseValues)),
            ],
            mayBeNone: true,
          })
    },
  })

// `lookup(key)(object)` returns `some(object[key])` when the key is definitely
// present, `none` when definitely absent (e.g. a closed object lacking it),
// otherwise a union covering all possible outcomes.
const computeLookupReturnType = (parameterTypes: readonly Type[]): Type => {
  const [keyType, rawObjectType] = parameterTypes
  const objectType =
    rawObjectType === undefined ? rawObjectType : (
      concreteUpperBound(rawObjectType)
    )
  if (keyType === undefined || objectType === undefined) {
    throw new Error(
      '`lookup` function did not receive two arguments. This is a bug!',
    )
  } else {
    return (
      objectType.kind === 'object' ?
        lookupReturnTypeForObjectType(keyType, objectType)
      : objectType.kind === 'union' ?
        // For each object-typed member, look up the property, then union the
        // results. `{ a: 1 } | { a: 2 }` with key `a` emits `option(1 | 2)`.
        option.match(memberObjectTypes(objectType), {
          none: _ =>
            // TODO: When one or more members are non-object types, could they
            // be filtered out instead of giving up? A lookup on `a | { z: 1 }`
            // can only ever return `option(1)`, after all.
            types.option(types.something),
          some: members =>
            simplifyIfUnion(
              unionOfTypes(
                members.map(member =>
                  lookupReturnTypeForObjectType(keyType, member),
                ),
              ),
            ),
        })
      : types.option(types.something)
    )
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

const simplifyIfUnion = (type: Type): Type =>
  type.kind === 'union' ? simplifyUnionType(type) : type
