import { testCases } from '../../../test-utilities.test.js'
import { stringifyTypeForEndUser } from '../semantic-graph.js'
import {
  makeApplicationType,
  makeFunctionType,
  makeIndexedAccessType,
  makeObjectType,
  makeTypeParameter,
  makeUnionType,
  type Type,
  type UnionType,
} from '../type-system.js'
import {
  atom,
  boolean,
  functionType,
  integer,
  naturalNumber,
  nothing,
  nullType,
  object,
  something,
} from './prelude-types.js'
import { isAssignable, simplifyUnionType } from './subtyping.js'

const typeAssignabilitySuite = testCases(
  ([source, target]: [source: Type, target: Type]) =>
    isAssignable({ source, target }),
  ([source, target]) =>
    `assignability of \`${stringifyTypeForEndUser(source)}\` to \`${stringifyTypeForEndUser(target)}\``,
)

const A = makeTypeParameter('a', { assignableTo: something })
const B = makeTypeParameter('b', { assignableTo: something })
const C = makeTypeParameter('c', { assignableTo: something })
const D = makeTypeParameter('d', { assignableTo: something })

const extendsAnyAtom = makeTypeParameter('z', {
  assignableTo: atom,
})
const extendsSpecificAtom = makeTypeParameter('y', {
  assignableTo: makeUnionType(['a']),
})
const extendsUnionOfAtoms = makeTypeParameter('x', {
  assignableTo: makeUnionType(['a', 'b']),
})
const extendsA = makeTypeParameter('w', {
  assignableTo: A,
})
const extendsFunctionFromAtomToValue = makeTypeParameter('i', {
  assignableTo: makeFunctionType({ parameter: atom, return: something }),
})
const extendsFunctionFromValueToAtom = makeTypeParameter('v', {
  assignableTo: makeFunctionType({ parameter: something, return: atom }),
})
const extendsExtendsAnyAtom = makeTypeParameter('u', {
  assignableTo: extendsAnyAtom,
})

const indexedAccessBoolean = makeIndexedAccessType(
  makeObjectType(
    {
      a: makeUnionType(['true']),
      b: makeUnionType(['false']),
    },
    { excess: something },
  ),
  makeTypeParameter('key', {
    assignableTo: makeUnionType(['a', 'b']),
  }),
)

const applicationFunctionParameter = makeTypeParameter('a', {
  assignableTo: something,
})
const applicationReturnParameter = makeTypeParameter('b', {
  assignableTo: boolean,
})
const applicationBoolean = makeApplicationType(
  makeFunctionType({
    parameter: applicationFunctionParameter,
    return: applicationReturnParameter,
  }),
  makeUnionType(['true']),
  new Set([
    applicationFunctionParameter.identity,
    applicationReturnParameter.identity,
  ]),
)
// Same as above:
const applicationBoolean2 = makeApplicationType(
  makeFunctionType({
    parameter: applicationFunctionParameter,
    return: applicationReturnParameter,
  }),
  makeUnionType(['true']),
  new Set([
    applicationFunctionParameter.identity,
    applicationReturnParameter.identity,
  ]),
)

testCases(
  (type: UnionType) => stringifyTypeForEndUser(simplifyUnionType(type)),
  type => `simplifying type \`${stringifyTypeForEndUser(type)}\``,
)('simplifying union types', [
  [
    makeUnionType([
      'a',
      atom,
      makeObjectType(
        {
          a: makeUnionType(['a', 'b']),
        },
        { excess: something },
      ),
      makeObjectType(
        {
          a: makeUnionType(['b']),
        },
        { excess: something },
      ),
      makeObjectType(
        {
          a: makeUnionType(['c']),
        },
        { excess: something },
      ),
    ]),
    ':atom.type | { a: a | b | c }',
  ],
  [
    // Members whose excess bounds disagree must not merge with each other.
    makeUnionType([
      makeObjectType({ a: makeUnionType(['a']) }, { excess: nothing }),
      makeObjectType({ a: makeUnionType(['b']) }, { excess: nothing }),
      makeObjectType({ a: makeUnionType(['c']) }, { excess: something }),
    ]),
    '{ a: a | b } | { a: c }',
  ],
])
typeAssignabilitySuite('prelude types (assignable)', [
  [
    [
      makeFunctionType({ parameter: something, return: something }),
      makeFunctionType({ parameter: something, return: something }),
    ],
    true,
  ],
])

typeAssignabilitySuite('prelude types (assignable)', [
  [[nothing, nothing], true],
  [[nullType, nullType], true],
  [[boolean, boolean], true],
  [[naturalNumber, naturalNumber], true],
  [[integer, integer], true],
  [[atom, atom], true],
  [[object, object], true],
  [[functionType, functionType], true],
  [[something, something], true],
  [[nothing, nullType], true],
  [[nothing, naturalNumber], true],
  [[nothing, atom], true],
  [[nothing, object], true],
  [[nothing, functionType], true],
  [[nothing, something], true],
  [[nullType, atom], true],
  [[nullType, something], true],
  [[boolean, atom], true],
  [[boolean, something], true],
  [[naturalNumber, integer], true],
  [[naturalNumber, atom], true],
  [[naturalNumber, something], true],
  [[integer, atom], true],
  [[integer, something], true],
  [[atom, something], true],
  [[object, something], true],
  [[functionType, something], true],
])

typeAssignabilitySuite('indexed-access types (assignable)', [
  [[indexedAccessBoolean, boolean], true],
  [[indexedAccessBoolean, atom], true],
  [[indexedAccessBoolean, something], true],
])

typeAssignabilitySuite('indexed-access types (not assignable)', [
  [[indexedAccessBoolean, makeUnionType(['true'])], false],
  [[makeUnionType(['true']), indexedAccessBoolean], false],

  // Despite being `true` or `false` at runtime, `indexedAccessBoolean` can't
  // have `boolean` assigned to it as it's *specifically* either `true` or
  // `false` depending on how its type parameter is instantiated.
  [[boolean, indexedAccessBoolean], false],
])

typeAssignabilitySuite('application types (assignable)', [
  [[applicationBoolean, boolean], true],
  [[applicationBoolean, atom], true],
  [[applicationBoolean, something], true],
  // A stuck application is assignable to an identical one.
  [[applicationBoolean, applicationBoolean2], true],
])

typeAssignabilitySuite('application types (not assignable)', [
  [[applicationBoolean, makeUnionType(['true'])], false],
  [[makeUnionType(['true']), applicationBoolean], false],

  // As with stuck indexed accesses, `boolean` can't be assigned to a stuck
  // application even though the application's upper bound is `boolean`.
  [[boolean, applicationBoolean], false],
])

typeAssignabilitySuite('stuck application in a contravariant position', [
  // A function which can handle arbitrary booleans satisfies a consumer of an
  // unknown specific boolean.
  [
    [
      makeFunctionType({ parameter: boolean, return: something }),
      makeFunctionType({ parameter: applicationBoolean, return: something }),
    ],
    true,
  ],

  [
    [
      makeFunctionType({
        parameter: makeUnionType(['true']),
        return: something,
      }),
      makeFunctionType({ parameter: applicationBoolean, return: something }),
    ],
    false,
  ],
])

typeAssignabilitySuite('opaque type from stuck type (assignable)', [
  [[makeUnionType([applicationBoolean]), atom], true],
  [[makeUnionType([indexedAccessBoolean]), atom], true],
])

typeAssignabilitySuite('opaque type from stuck type (not assignable)', [
  [[makeUnionType([applicationBoolean]), integer], false],
  [[makeUnionType([indexedAccessBoolean]), integer], false],
])

typeAssignabilitySuite('prelude types (not assignable)', [
  [[nullType, nothing], false],
  [[nullType, boolean], false],
  [[nullType, naturalNumber], false],
  [[nullType, integer], false],
  [[nullType, object], false],
  [[nullType, functionType], false],
  [[boolean, nothing], false],
  [[boolean, nullType], false],
  [[boolean, naturalNumber], false],
  [[boolean, integer], false],
  [[boolean, object], false],
  [[boolean, functionType], false],
  [[naturalNumber, nothing], false],
  [[naturalNumber, nullType], false],
  [[naturalNumber, boolean], false],
  [[naturalNumber, object], false],
  [[naturalNumber, functionType], false],
  [[integer, nothing], false],
  [[integer, nullType], false],
  [[integer, boolean], false],
  [[integer, naturalNumber], false],
  [[integer, object], false],
  [[integer, functionType], false],
  [[atom, nothing], false],
  [[atom, nullType], false],
  [[atom, boolean], false],
  [[atom, naturalNumber], false],
  [[atom, integer], false],
  [[atom, object], false],
  [[atom, functionType], false],
  [[object, nothing], false],
  [[object, nullType], false],
  [[object, boolean], false],
  [[object, naturalNumber], false],
  [[object, integer], false],
  [[object, atom], false],
  [[object, functionType], false],
  [[functionType, nothing], false],
  [[functionType, nullType], false],
  [[functionType, boolean], false],
  [[functionType, naturalNumber], false],
  [[functionType, integer], false],
  [[functionType, atom], false],
  [[functionType, object], false],
  [[something, nothing], false],
  [[something, nullType], false],
  [[something, boolean], false],
  [[something, naturalNumber], false],
  [[something, integer], false],
  [[something, atom], false],
  [[something, object], false],
  [[something, functionType], false],
])

typeAssignabilitySuite('custom types (assignable)', [
  [[makeUnionType(['a']), makeUnionType(['a', 'b'])], true],
  [[makeUnionType(['a']), atom], true],
  [[makeUnionType(['a', 'b']), atom], true],
  [[makeUnionType(['a']), makeUnionType([atom, 'b'])], true],
  [[makeUnionType(['1']), naturalNumber], true],
  [[makeUnionType(['0', '1']), naturalNumber], true],
  [
    [
      makeUnionType(['9876543210']),
      makeUnionType([naturalNumber, 'not a number']),
    ],
    true,
  ],
  [[makeUnionType(['0', '-1']), integer], true],
  [
    [
      makeObjectType(
        {
          a: makeUnionType(['a']),
          b: object,
        },
        { excess: something },
      ),
      makeObjectType(
        {
          a: atom,
          b: object,
        },
        { excess: something },
      ),
    ],
    true,
  ],
  [
    [
      makeObjectType(
        {
          a: makeUnionType(['a']),
          b: makeObjectType({ c: boolean }, { excess: something }),
          c: nullType,
        },
        { excess: something },
      ),
      makeObjectType(
        {
          a: atom,
          b: object,
        },
        { excess: something },
      ),
    ],
    true,
  ],
  [
    [
      makeObjectType(
        {
          a: makeUnionType(['a']),
        },
        { excess: something },
      ),
      makeUnionType([
        makeObjectType(
          {
            a: makeUnionType(['a']),
          },
          { excess: something },
        ),
      ]),
    ],
    true,
  ],
  [
    [
      makeUnionType([
        makeObjectType(
          {
            a: makeUnionType(['a']),
          },
          { excess: something },
        ),
      ]),
      makeObjectType(
        {
          a: makeUnionType(['a']),
        },
        { excess: something },
      ),
    ],
    true,
  ],
  [
    [
      // `{ a: a } | { a: b }` is assignable to `{ a: a | b }`
      makeUnionType([
        makeObjectType(
          {
            a: makeUnionType(['a']),
          },
          { excess: something },
        ),
        makeObjectType(
          {
            a: makeUnionType(['b']),
          },
          { excess: something },
        ),
      ]),
      makeObjectType(
        {
          a: makeUnionType(['a', 'b']),
        },
        { excess: something },
      ),
    ],
    true,
  ],
  [
    [
      // `{ a: a } | { a: b }` is assignable to `{ a: a | b | c }`
      makeUnionType([
        makeObjectType(
          {
            a: makeUnionType(['a']),
          },
          { excess: something },
        ),
        makeObjectType(
          {
            a: makeUnionType(['b']),
          },
          { excess: something },
        ),
      ]),
      makeObjectType(
        {
          a: makeUnionType(['a', 'b', 'c']),
        },
        { excess: something },
      ),
    ],
    true,
  ],
  [
    [
      // `{ a: a, b: a } | { a: b, b: b }` is assignable to `{ a: a | b, b: a | b }`
      makeUnionType([
        makeObjectType(
          {
            a: makeUnionType(['a']),
            b: makeUnionType(['a']),
          },
          { excess: something },
        ),
        makeObjectType(
          {
            a: makeUnionType(['b']),
            b: makeUnionType(['b']),
          },
          { excess: something },
        ),
      ]),
      makeObjectType(
        {
          a: makeUnionType(['a', 'b']),
          b: makeUnionType(['a', 'b']),
        },
        { excess: something },
      ),
    ],
    true,
  ],
  [
    [
      // `{ a: a } | { a: b } | c` is assignable to `{ a: a | b } | c`
      makeUnionType([
        makeObjectType(
          {
            a: makeUnionType(['a']),
          },
          { excess: something },
        ),
        makeObjectType(
          {
            a: makeUnionType(['b']),
          },
          { excess: something },
        ),
        'c',
      ]),
      makeUnionType([
        makeObjectType(
          {
            a: makeUnionType(['a', 'b']),
          },
          { excess: something },
        ),
        'c',
      ]),
    ],
    true,
  ],
  [
    [
      // `{ a: a | b }` is assignable to `{ a: a } | { a: b }`
      makeObjectType(
        {
          a: makeUnionType(['a', 'b']),
        },
        { excess: something },
      ),
      makeUnionType([
        makeObjectType(
          {
            a: makeUnionType(['a']),
          },
          { excess: something },
        ),
        makeObjectType(
          {
            a: makeUnionType(['b']),
          },
          { excess: something },
        ),
      ]),
    ],
    true,
  ],
  [
    [
      // `{ a: a | b }` is assignable to `{ a: a } | { a: b } | { a: c }`
      makeObjectType(
        {
          a: makeUnionType(['a', 'b']),
        },
        { excess: something },
      ),
      makeUnionType([
        makeObjectType(
          {
            a: makeUnionType(['a']),
          },
          { excess: something },
        ),
        makeObjectType(
          {
            a: makeUnionType(['b']),
          },
          { excess: something },
        ),
        makeObjectType(
          {
            a: makeUnionType(['c']),
          },
          { excess: something },
        ),
      ]),
    ],
    true,
  ],
  [
    [
      // `{ a: { a: a | b } }` is assignable to `{ a: { a: a } | { a: b } }`
      makeObjectType(
        {
          a: makeObjectType(
            {
              a: makeUnionType(['a', 'b']),
            },
            { excess: something },
          ),
        },
        { excess: something },
      ),
      makeObjectType(
        {
          a: makeUnionType([
            makeObjectType(
              {
                a: makeUnionType(['a']),
              },
              { excess: something },
            ),
            makeObjectType(
              {
                a: makeUnionType(['b']),
              },
              { excess: something },
            ),
          ]),
        },
        { excess: something },
      ),
    ],
    true,
  ],
  [
    [
      // `{ a: a } | { a: b, b: c }` is assignable to `{ a: a | b }`
      makeUnionType([
        makeObjectType({ a: makeUnionType(['a']) }, { excess: something }),
        makeObjectType(
          {
            a: makeUnionType(['b']),
            b: makeUnionType(['c']),
          },
          { excess: something },
        ),
      ]),
      makeObjectType(
        {
          a: makeUnionType(['a', 'b']),
        },
        { excess: something },
      ),
    ],
    true,
  ],
  [
    [
      // `{ a: a | b } | c` is assignable to `{ a: a } | { a: b } | c`
      makeUnionType([
        makeObjectType(
          {
            a: makeUnionType(['a', 'b']),
          },
          { excess: something },
        ),
        'c',
      ]),
      makeUnionType([
        makeObjectType(
          {
            a: makeUnionType(['a']),
          },
          { excess: something },
        ),
        makeObjectType(
          {
            a: makeUnionType(['b']),
          },
          { excess: something },
        ),
        'c',
      ]),
    ],
    true,
  ],
  [
    [
      // `{ a: a | b } | { b: a | b }` is assignable to `{ a: a } | { a: b } | { b: a } | { b: b }`
      makeObjectType(
        {
          a: makeUnionType(['a', 'b']),
          b: makeUnionType(['a', 'b']),
        },
        { excess: something },
      ),
      makeUnionType([
        makeObjectType({ a: makeUnionType(['a']) }, { excess: something }),
        makeObjectType({ a: makeUnionType(['b']) }, { excess: something }),
        makeObjectType({ b: makeUnionType(['a']) }, { excess: something }),
        makeObjectType({ b: makeUnionType(['b']) }, { excess: something }),
      ]),
    ],
    true,
  ],
  [
    [
      // `{ a: a } | { a: b } | { b: a } | { b: b }` is assignable to `{ a: a | b } | { b: a | b }`
      makeUnionType([
        makeObjectType({ a: makeUnionType(['a']) }, { excess: something }),
        makeObjectType({ a: makeUnionType(['b']) }, { excess: something }),
        makeObjectType({ b: makeUnionType(['a']) }, { excess: something }),
        makeObjectType({ b: makeUnionType(['b']) }, { excess: something }),
      ]),
      makeUnionType([
        makeObjectType(
          {
            a: makeUnionType(['a', 'b']),
          },
          { excess: something },
        ),
        makeObjectType(
          {
            b: makeUnionType(['a', 'b']),
          },
          { excess: something },
        ),
      ]),
    ],
    true,
  ],
  [
    [
      makeFunctionType({ parameter: something, return: something }),
      makeFunctionType({ parameter: something, return: something }),
    ],
    true,
  ],
  [
    [
      makeFunctionType({
        parameter: makeUnionType(['a']),
        return: makeUnionType(['a']),
      }),
      makeFunctionType({
        parameter: makeUnionType(['a']),
        return: makeUnionType(['a']),
      }),
    ],
    true,
  ],
  [
    [
      makeFunctionType({
        parameter: makeUnionType(['a', 'b', 'c']),
        return: makeUnionType(['d', 'e']),
      }),
      makeFunctionType({
        parameter: makeUnionType(['a', 'b']),
        return: makeUnionType(['d', 'e', 'f']),
      }),
    ],
    true,
  ],
  [
    [
      makeFunctionType({
        parameter: makeUnionType(['a']),
        return: makeUnionType(['a']),
      }),
      makeFunctionType({ parameter: nothing, return: something }),
    ],
    true,
  ],
  [
    [
      makeFunctionType({ parameter: something, return: nothing }),
      makeFunctionType({ parameter: nothing, return: something }),
    ],
    true,
  ],
  [
    [
      // `:atom.type ~> a | :atom.type ~> b` is assignable to `a ~> a | b`
      makeUnionType([
        makeFunctionType({
          parameter: atom,
          return: makeUnionType(['a']),
        }),
        makeFunctionType({
          parameter: atom,
          return: makeUnionType(['b']),
        }),
      ]),
      makeFunctionType({
        parameter: makeUnionType(['a']),
        return: makeUnionType(['a', 'b']),
      }),
    ],
    true,
  ],
  [
    [
      makeFunctionType({
        parameter: makeUnionType(['a']),
        return: makeUnionType(['a']),
      }),
      makeUnionType([
        makeFunctionType({
          parameter: makeUnionType(['a']),
          return: makeUnionType(['a']),
        }),
        makeFunctionType({
          parameter: makeUnionType(['b']),
          return: makeUnionType(['b']),
        }),
      ]),
    ],
    true,
  ],
  [
    [
      makeObjectType({}, { excess: nothing }),
      makeObjectType({}, { excess: nothing }),
    ],
    true,
  ],
  [
    [
      // Closed object types are assignable to open ones.
      makeObjectType({ a: makeUnionType(['a']) }, { excess: nothing }),
      makeObjectType({}, { excess: something }),
    ],
    true,
  ],
  // TODO: Improve assignability checks for unions of objects to make this test
  // case pass:
  // [
  //   [
  //     // `{ a: a | b, b: c }` is assignable to `{ a: a } | { a: b, b: c }`
  //     makeObjectType({
  //       a: makeUnionType(['a', 'b']),
  //       b: makeUnionType(['c']),
  //     }, { excess: something }),
  //     makeUnionType([
  //       makeObjectType({ a: makeUnionType(['a']) }, { excess: something }),
  //       makeObjectType({
  //         a: makeUnionType(['b']),
  //         b: makeUnionType(['c']),
  //       }, { excess: something }),
  //     ]),
  //   ],
  //   true,
  // ],
])

typeAssignabilitySuite('custom types (not assignable)', [
  [[makeUnionType(['a', 'b', 'c']), makeUnionType(['b', 'c', 'd'])], false],
  [[makeUnionType(['-1']), naturalNumber], false],
  [[makeUnionType(['-0']), integer], false],
  [
    [
      makeObjectType(
        {
          a: atom,
          b: object,
        },
        { excess: something },
      ),
      makeObjectType(
        {
          a: atom,
          b: object,
          c: boolean, // required property in target not present in source
        },
        { excess: something },
      ),
    ],
    false,
  ],
  [
    [
      // `{ a: a | b, b: a | b }` is not assignable to `{ a: a, b: a } | { a: b, b: b }`
      makeObjectType(
        {
          a: makeUnionType(['a', 'b']),
          b: makeUnionType(['a', 'b']),
        },
        { excess: something },
      ),
      makeUnionType([
        makeObjectType(
          {
            a: makeUnionType(['a']),
            b: makeUnionType(['a']),
          },
          { excess: something },
        ),
        makeObjectType(
          {
            a: makeUnionType(['b']),
            b: makeUnionType(['b']),
          },
          { excess: something },
        ),
      ]),
    ],
    false,
  ],
  [
    [
      // `{ a: a, b: b }` is not assignable to `{ a: a, b: z } | { b: b, a: z }`
      makeObjectType(
        {
          a: makeUnionType(['a']),
          b: makeUnionType(['b']),
        },
        { excess: something },
      ),
      makeUnionType([
        makeObjectType(
          {
            a: makeUnionType(['a']),
            b: makeUnionType(['z']),
          },
          { excess: something },
        ),
        makeObjectType(
          {
            a: makeUnionType(['z']),
            b: makeUnionType(['b']),
          },
          { excess: something },
        ),
      ]),
    ],
    false,
  ],
  [
    [
      // `{ a: a } | { a: b, b: c }` is not assignable to `{ a: a | b, b: c }`
      makeUnionType([
        makeObjectType(
          {
            a: makeUnionType(['a']),
          },
          { excess: something },
        ),
        makeObjectType(
          {
            a: makeUnionType(['b']),
            b: makeUnionType(['c']),
          },
          { excess: something },
        ),
      ]),
      makeObjectType(
        {
          a: makeUnionType(['a', 'b']),
          b: makeUnionType(['c']),
        },
        { excess: something },
      ),
    ],
    false,
  ],
  [
    [
      makeFunctionType({ parameter: atom, return: atom }),
      makeFunctionType({ parameter: object, return: object }),
    ],
    false,
  ],
  [
    [
      makeFunctionType({ parameter: atom, return: object }),
      makeFunctionType({ parameter: object, return: object }),
    ],
    false,
  ],
  [
    [
      makeFunctionType({ parameter: object, return: atom }),
      makeFunctionType({ parameter: object, return: object }),
    ],
    false,
  ],
  [
    [
      makeFunctionType({ parameter: atom, return: atom }),
      makeFunctionType({ parameter: something, return: something }),
    ],
    false,
  ],
  [
    [
      makeFunctionType({ parameter: something, return: something }),
      makeFunctionType({ parameter: atom, return: atom }),
    ],
    false,
  ],
  [
    [
      makeFunctionType({ parameter: nothing, return: something }),
      makeFunctionType({ parameter: something, return: nothing }),
    ],
    false,
  ],
  [
    [
      // `(a ~> a) | (b ~> b)` is not assignable to `(a | b) ~> (a | b)`
      // (a value of the former may only be able to handle `a` as an argument)
      makeUnionType([
        makeFunctionType({
          parameter: makeUnionType(['a']),
          return: makeUnionType(['a']),
        }),
        makeFunctionType({
          parameter: makeUnionType(['b']),
          return: makeUnionType(['b']),
        }),
      ]),
      makeFunctionType({
        parameter: makeUnionType(['a', 'b']),
        return: makeUnionType(['a', 'b']),
      }),
    ],
    false,
  ],
  [
    [
      // Open object types aren't assignable to closed ones.
      makeObjectType({}, { excess: something }),
      makeObjectType({}, { excess: nothing }),
    ],
    false,
  ],
  [
    [
      // Closed objects with extra properties aren't assignable to closed
      // objects lacking them.
      makeObjectType(
        { a: makeUnionType(['a']), b: makeUnionType(['b']) },
        { excess: nothing },
      ),
      makeObjectType({ a: makeUnionType(['a']) }, { excess: nothing }),
    ],
    false,
  ],
  [
    [
      // Similar to above, but with unions in the mix.
      makeObjectType(
        { a: makeUnionType(['a']), b: makeUnionType(['b']) },
        { excess: nothing },
      ),
      makeUnionType([
        makeObjectType({ a: makeUnionType(['a']) }, { excess: nothing }),
        makeObjectType({ b: makeUnionType(['b']) }, { excess: nothing }),
      ]),
    ],
    false,
  ],
])

typeAssignabilitySuite('bounded-excess object types', [
  [
    [
      makeObjectType(
        { a: makeUnionType(['a']), b: makeUnionType(['b']) },
        { excess: nothing },
      ),
      makeObjectType({ a: makeUnionType(['a']) }, { excess: atom }),
    ],
    true,
  ],
  [
    [
      makeObjectType(
        { a: makeUnionType(['a']), b: object },
        { excess: nothing },
      ),
      makeObjectType({ a: makeUnionType(['a']) }, { excess: atom }),
    ],
    false,
  ],
  [
    [
      makeObjectType({}, { excess: naturalNumber }),
      makeObjectType({}, { excess: integer }),
    ],
    true,
  ],
  [
    [
      makeObjectType({}, { excess: atom }),
      makeObjectType({}, { excess: naturalNumber }),
    ],
    false,
  ],
  [[object, makeObjectType({}, { excess: atom })], false],
  [[makeObjectType({}, { excess: atom }), object], true],
  [
    [
      makeObjectType({}, { excess: nothing }),
      makeObjectType({}, { excess: atom }),
    ],
    true,
  ],
  [
    [
      makeObjectType({}, { excess: atom }),
      makeObjectType({ a: atom }, { excess: something }),
    ],
    false,
  ],
])

typeAssignabilitySuite('generic function types (assignable)', [
  [
    [
      // `?a ~> :a` is assignable to itself
      makeFunctionType({
        parameter: A,
        return: A,
      }),
      makeFunctionType({
        parameter: B,
        return: B,
      }),
    ],
    true,
  ],
  [
    [
      // `?a ~> :a` is assignable to `(?a: :atom.type) ~> a`
      makeFunctionType({
        parameter: A,
        return: A,
      }),
      makeFunctionType({
        parameter: extendsAnyAtom,
        return: extendsAnyAtom,
      }),
    ],
    true,
  ],
  [
    [
      // `?a ~> :a` is assignable to `:atom.type ~> :atom.type`
      makeFunctionType({
        parameter: A,
        return: A,
      }),
      makeFunctionType({
        parameter: atom,
        return: atom,
      }),
    ],
    true,
  ],
  [
    [
      // `(?a: :atom.type) ~> :a` is assignable to `:atom.type ~> :something.type`
      makeFunctionType({
        parameter: extendsAnyAtom,
        return: extendsAnyAtom,
      }),
      makeFunctionType({
        parameter: atom,
        return: something,
      }),
    ],
    true,
  ],
  [
    [
      // `(?a: :atom.type) ~> { a: :a }` is assignable to `:atom.type ~> :something.type`
      makeFunctionType({
        parameter: extendsAnyAtom,
        return: makeObjectType({ a: extendsAnyAtom }, { excess: something }),
      }),
      makeFunctionType({
        parameter: atom,
        return: something,
      }),
    ],
    true,
  ],
  [
    [
      // `?a ~> { a: :a, b: :atom.type }` is assignable to `(?a: :atom.type) ~> { a: a }`
      makeFunctionType({
        parameter: A,
        return: makeObjectType(
          {
            a: A,
            b: atom,
          },
          { excess: something },
        ),
      }),
      makeFunctionType({
        parameter: extendsAnyAtom,
        return: makeObjectType({ a: extendsAnyAtom }, { excess: something }),
      }),
    ],
    true,
  ],
  [
    [
      // `(?a: :atom.type) ~> { a: :a }` is assignable to `:atom.type ~> { a: :atom.type }`
      makeFunctionType({
        parameter: extendsAnyAtom,
        return: makeObjectType({ a: extendsAnyAtom }, { excess: something }),
      }),
      makeFunctionType({
        parameter: atom,
        return: makeObjectType({ a: atom }, { excess: something }),
      }),
    ],
    true,
  ],
  [
    [
      // `{ a: ?a } ~> :a` is assignable to `{ a: (?a: :atom.type) } ~> :a`
      makeFunctionType({
        parameter: makeObjectType(
          {
            a: A,
          },
          { excess: something },
        ),
        return: A,
      }),
      makeFunctionType({
        parameter: makeObjectType(
          {
            a: extendsAnyAtom,
          },
          { excess: something },
        ),
        return: extendsAnyAtom,
      }),
    ],
    true,
  ],
  [
    [
      // `{ a: a } ~> { b: a }` is assignable to `{ a: (?a: :atom.type) } ~> { b: a }`
      makeFunctionType({
        parameter: makeObjectType(
          {
            a: A,
          },
          { excess: something },
        ),
        return: makeObjectType(
          {
            b: A,
          },
          { excess: something },
        ),
      }),
      makeFunctionType({
        parameter: makeObjectType(
          {
            a: extendsAnyAtom,
          },
          { excess: something },
        ),
        return: makeObjectType(
          {
            b: extendsAnyAtom,
          },
          { excess: something },
        ),
      }),
    ],
    true,
  ],
  [
    [
      // `((?a: :atom.type) | {}) ~> (:a | z)` is assignable to `(?a: (a | b)) ~> (:a | y | z)`
      makeFunctionType({
        parameter: makeUnionType([extendsAnyAtom, object]),
        return: makeUnionType([extendsAnyAtom, 'z']),
      }),
      makeFunctionType({
        parameter: extendsUnionOfAtoms,
        return: makeUnionType([extendsUnionOfAtoms, 'y', 'z']),
      }),
    ],
    true,
  ],
  [
    [
      // `(?a: (:atom.type ~> :something.type)) ~> :a` is assignable to `(?b: (:something.type ~> :atom.type)) ~> :b`
      makeFunctionType({
        parameter: extendsFunctionFromAtomToValue,
        return: extendsFunctionFromAtomToValue,
      }),
      makeFunctionType({
        parameter: extendsFunctionFromValueToAtom,
        return: extendsFunctionFromValueToAtom,
      }),
    ],
    true,
  ],

  [
    [
      // `(?a: (:atom.type ~> :something.type)) ~> :a` is assignable to `(:something.type ~> :something.type) ~> (:something.type ~> :something.type)`
      makeFunctionType({
        parameter: extendsFunctionFromAtomToValue,
        return: extendsFunctionFromAtomToValue,
      }),
      makeFunctionType({
        parameter: makeFunctionType({
          parameter: something,
          return: something,
        }),
        return: makeFunctionType({
          parameter: something,
          return: something,
        }),
      }),
    ],
    true,
  ],
  [
    [
      // `?a ~> { 0: :a, 1: :a }` is assignable to `(?a: :atom.type) ~> { 0: :a, 1: :atom.type }`
      makeFunctionType({
        parameter: A,
        return: makeObjectType(
          {
            0: A,
            1: A,
          },
          { excess: something },
        ),
      }),
      makeFunctionType({
        parameter: extendsAnyAtom,
        return: makeObjectType(
          {
            0: extendsAnyAtom,
            1: atom,
          },
          { excess: something },
        ),
      }),
    ],
    true,
  ],
  [
    [
      // `{ 0: ?a, 1: ?b } ~> { 0: :b, 1: :a }` is assignable to `{ 0: ?a, 1: ?b } ~> { 0: :b, 1: :a }`
      makeFunctionType({
        parameter: makeObjectType(
          {
            0: A,
            1: B,
          },
          { excess: something },
        ),
        return: makeObjectType(
          {
            0: B,
            1: A,
          },
          { excess: something },
        ),
      }),
      makeFunctionType({
        parameter: makeObjectType(
          {
            0: C,
            1: D,
          },
          { excess: something },
        ),
        return: makeObjectType(
          {
            0: D,
            1: C,
          },
          { excess: something },
        ),
      }),
    ],
    true,
  ],
  [
    [
      // `{ 0: ?a, 1: ?b } ~> { 0: :b, 1: :a }` is assignable to `{ 0: (?a: :atom.type), 1: (?b: a) } ~> { 0: :b, 1: ?a }`
      makeFunctionType({
        parameter: makeObjectType(
          {
            0: A,
            1: B,
          },
          { excess: something },
        ),
        return: makeObjectType(
          {
            0: B,
            1: A,
          },
          { excess: something },
        ),
      }),
      makeFunctionType({
        parameter: makeObjectType(
          {
            0: extendsAnyAtom,
            1: extendsSpecificAtom,
          },
          { excess: something },
        ),
        return: makeObjectType(
          {
            0: extendsSpecificAtom,
            1: extendsAnyAtom,
          },
          { excess: something },
        ),
      }),
    ],
    true,
  ],
  [
    [
      // `{ 0: ?a, 1: ?b } ~> { 0: ?b, 1: ?a }` is assignable to `{ 0: ?a, 1: (?b: :a) } ~> { 0: :b, 1: :a }`
      makeFunctionType({
        parameter: makeObjectType(
          {
            0: B,
            1: C,
          },
          { excess: something },
        ),
        return: makeObjectType(
          {
            0: C,
            1: B,
          },
          { excess: something },
        ),
      }),
      makeFunctionType({
        parameter: makeObjectType(
          {
            0: A,
            1: extendsA,
          },
          { excess: something },
        ),
        return: makeObjectType(
          {
            0: extendsA,
            1: A,
          },
          { excess: something },
        ),
      }),
    ],
    true,
  ],
  [
    [
      // `{ a: ?a, b: ?b, c: :atom.type | :b } ~> { b: :a, a: :b, c: :a }` is assignable to `{ a: (?a: :atom.type), b: (?b: :a), c: :b } ~> { b: :a, a: :b | :a, c: :atom.type }`
      makeFunctionType({
        parameter: makeObjectType(
          {
            a: A,
            b: B,
            c: makeUnionType([atom, B]),
          },
          { excess: something },
        ),
        return: makeObjectType(
          {
            b: A,
            a: B,
            c: A,
          },
          { excess: something },
        ),
      }),
      makeFunctionType({
        parameter: makeObjectType(
          {
            a: extendsAnyAtom,
            b: extendsExtendsAnyAtom,
            c: extendsExtendsAnyAtom,
          },
          { excess: something },
        ),
        return: makeObjectType(
          {
            b: extendsAnyAtom,
            a: makeUnionType([extendsAnyAtom, extendsExtendsAnyAtom]),
            c: atom,
          },
          { excess: something },
        ),
      }),
    ],
    true,
  ],
])

typeAssignabilitySuite('generic function types (not assignable)', [
  [
    [
      // `(?a: :atom.type) ~> :a` is not assignable to `:object.type ~> :object.type`
      makeFunctionType({
        parameter: extendsAnyAtom,
        return: extendsAnyAtom,
      }),
      makeFunctionType({
        parameter: object,
        return: object,
      }),
    ],
    false,
  ],
  [
    [
      // `(?a: a) ~> :a` is not assignable to `:atom.type ~> :atom.type`
      makeFunctionType({
        parameter: extendsSpecificAtom,
        return: extendsSpecificAtom,
      }),
      makeFunctionType({
        parameter: atom,
        return: atom,
      }),
    ],
    false,
  ],
  [
    [
      // `(?a: :atom.type) ~> :a` is not assignable to `?a ~> :a`
      makeFunctionType({
        parameter: extendsAnyAtom,
        return: extendsAnyAtom,
      }),
      makeFunctionType({
        parameter: A,
        return: A,
      }),
    ],
    false,
  ],
  [
    [
      // `?a ~> :a` is not assignable to `:something.type ~> :atom.type`
      makeFunctionType({
        parameter: A,
        return: A,
      }),
      makeFunctionType({
        parameter: something,
        return: atom,
      }),
    ],
    false,
  ],
  [
    [
      // `?a ~> { a: :a }` is not assignable to `?a ~> { b: :a }`
      makeFunctionType({
        parameter: A,
        return: makeObjectType({ a: A }, { excess: something }),
      }),
      makeFunctionType({
        parameter: A,
        return: makeObjectType({ b: A }, { excess: something }),
      }),
    ],
    false,
  ],
  [
    [
      // `((?a: :atom.type) | {}) ~> (:a | z)` is not assignable to `(?a: :atom.type) ~> :a`
      makeFunctionType({
        parameter: makeUnionType([extendsAnyAtom, object]),
        return: makeUnionType([extendsAnyAtom, 'z']),
      }),
      makeFunctionType({
        parameter: extendsAnyAtom,
        return: extendsAnyAtom,
      }),
    ],
    false,
  ],
  [
    [
      // `{ 0: ?a, 1: (?b: :a) } ~> { 0: :b, 1: :a }` is not assignable to `{ 0: ?a, 1: ?b } ~> { 0: :b, 1: :a }`
      makeFunctionType({
        parameter: makeObjectType(
          {
            0: A,
            1: extendsA,
          },
          { excess: something },
        ),
        return: makeObjectType(
          {
            0: extendsA,
            1: A,
          },
          { excess: something },
        ),
      }),
      makeFunctionType({
        parameter: makeObjectType(
          {
            0: A,
            1: B,
          },
          { excess: something },
        ),
        return: makeObjectType(
          {
            0: B,
            1: A,
          },
          { excess: something },
        ),
      }),
    ],
    false,
  ],
  [
    [
      // `(?a: (:something.type ~> :atom.type)) ~> :a` is not assignable to `((?b: :atom.type) ~> :something.type) ~> :b`
      makeFunctionType({
        parameter: extendsFunctionFromValueToAtom,
        return: extendsFunctionFromValueToAtom,
      }),
      makeFunctionType({
        parameter: extendsFunctionFromAtomToValue,
        return: extendsFunctionFromAtomToValue,
      }),
    ],
    false,
  ],
  [
    [
      // `?a ~> :a` is not assignable to `(:something.type ~> :something.type) ~> :atom.type
      makeFunctionType({
        parameter: A,
        return: A,
      }),
      makeFunctionType({
        parameter: makeFunctionType({
          parameter: something,
          return: something,
        }),
        return: atom,
      }),
    ],
    false,
  ],
  [
    [
      // `{ a: ?a } ~> :a` is not assignable to `{ b: ?a } ~> :a`
      makeFunctionType({
        parameter: makeObjectType(
          {
            a: A,
          },
          { excess: something },
        ),
        return: A,
      }),
      makeFunctionType({
        parameter: makeObjectType(
          {
            b: A,
          },
          { excess: something },
        ),
        return: A,
      }),
    ],
    false,
  ],
  [
    [
      // `?a ~> { a: :a }` is not assignable to `?a ~> { b: :a }`
      makeFunctionType({
        parameter: A,
        return: makeObjectType(
          {
            a: A,
          },
          { excess: something },
        ),
      }),
      makeFunctionType({
        parameter: A,
        return: makeObjectType(
          {
            b: A,
          },
          { excess: something },
        ),
      }),
    ],
    false,
  ],
])

typeAssignabilitySuite('union to type parameter (assignable)', [
  // `?a | :nothing.type` is assignable to `?a`
  [[makeUnionType([A]), A], true],
  // `?a | :a` is assignable to `?a`
  [[makeUnionType([A, A]), A], true],
  // `?a | :nothing.type` is assignable to `?a | :a`
  [[makeUnionType([A]), makeUnionType([A, A])], true],
  // `?a | :a` is assignable to `?a | :a`
  [[makeUnionType([A, A]), makeUnionType([A, A])], true],
  // `?a | :nothing.type` is assignable to `?a | ?b`
  [[makeUnionType([A]), makeUnionType([A, B])], true],
  // `(?a: :atom.type) | :nothing.type` is assignable to `(?a: :atom.type)`
  [[makeUnionType([extendsAnyAtom]), extendsAnyAtom], true],
])

typeAssignabilitySuite(
  'union with a broadly-constrained type-parameter member (assignable)',
  [
    [[makeUnionType([A, object]), something], true],
    [
      [makeUnionType([A, makeObjectType({}, { excess: nothing })]), something],
      true,
    ],
    [
      [
        makeFunctionType({
          parameter: something,
          return: makeUnionType([A, makeObjectType({}, { excess: nothing })]),
        }),
        something,
      ],
      true,
    ],
  ],
)

typeAssignabilitySuite(
  'union with a broadly-constrained type-parameter member (not assignable)',
  [[[makeUnionType([A, 'x']), atom], false]],
)

typeAssignabilitySuite('union to type parameter (not assignable)', [
  // `1 | :nothing.type` is not assignable to `?a`
  [[makeUnionType(['1']), A], false],
  // `1 | :nothing.type` is not assignable to `?a: :atom.type`
  [[makeUnionType(['1']), extendsAnyAtom], false],
  // `a | :nothing.type` is not assignable to `?a: a`
  [[makeUnionType(['a']), extendsSpecificAtom], false],
  // `:atom.type | :nothing.type` is not assignable to `?a`
  [[makeUnionType([atom]), A], false],
  // `:object.type | :nothing.type` is not assignable to `?a`
  [[makeUnionType([object]), A], false],
  // `?b | :nothing.type` is not assignable to `?a`
  [[makeUnionType([B]), A], false],
  // `?a | hello` is not assignable to `?a`
  [[makeUnionType([A, 'hello']), A], false],
  // `?a | ?b` is not assignable to `?a`
  [[makeUnionType([A, B]), A], false],
])
