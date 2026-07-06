import either, { type Either } from '@matt.kantor/either'
import optionAdt from '@matt.kantor/option'
import assert from 'node:assert'
import { testCases } from '../../../test-utilities.test.js'
import type { FunctionNodeCallError } from '../function-node.js'
import { stringifyKeyPathForEndUser, type KeyPath } from '../key-path.js'
import { objectNodeFromOrderedEntries } from '../object-node.js'
import {
  stringifySemanticGraphForEndUser,
  stringifyTypeForEndUser,
  type SemanticGraph,
} from '../semantic-graph.js'
import { genericizeFunctionParameterAnnotation } from './genericize-function-parameter.js'
import {
  atom,
  integer,
  naturalNumber,
  nothing,
  object,
  option,
  something,
} from './prelude-types.js'
import {
  makeApplicationType,
  makeFunctionType,
  makeIndexedAccessType,
  makeIntrinsicApplicationType,
  makeObjectType,
  makeTypeParameter,
  makeUnionType,
  type Type,
  type TypeParameter,
} from './type-formats.js'
import { nestedIndexedAccess } from './type-key-path.js'
import {
  applyKeyPathToType,
  applyTypeToArgumentType,
  enumerateInhabitants,
  getTypesForTypeParameters,
  supplyTypeArgument,
} from './type-substitution.js'

const A = makeTypeParameter('a', { assignableTo: something })
const B = makeTypeParameter('b', { assignableTo: something })

const extendsAnyAtom = makeTypeParameter('z', {
  assignableTo: atom,
})

const applyKeyPathSuite = testCases(
  // For now non-atom key paths are not exposed in the language (e.g. you cannot
  // dynamically refer to function parameters/returns). If that changes, this
  // will need to be updated.
  ([type, keyPath]: [type: Type, keyPath: KeyPath]) =>
    optionAdt.match(applyKeyPathToType(type, keyPath), {
      none: _ => '(none)',
      some: stringifyTypeForEndUser,
    }),
  ([type, keyPath]) =>
    `applying key path \`${stringifyKeyPathForEndUser(keyPath)}\` to \`${stringifyTypeForEndUser(type)}\``,
)

applyKeyPathSuite('applyKeyPathToType with empty key path', [
  [[atom, []], stringifyTypeForEndUser(atom)],
  [[nothing, []], stringifyTypeForEndUser(nothing)],
  [[something, []], stringifyTypeForEndUser(something)],
  [
    [makeObjectType({ a: atom }), []],
    stringifyTypeForEndUser(makeObjectType({ a: atom })),
  ],
  [
    [makeFunctionType({ parameter: atom, return: something }), []],
    stringifyTypeForEndUser(
      makeFunctionType({ parameter: atom, return: something }),
    ),
  ],
])

applyKeyPathSuite('applyKeyPathToType with object types', [
  [
    [makeObjectType({ a: atom, b: integer }), ['a']],
    stringifyTypeForEndUser(atom),
  ],
  [
    [makeObjectType({ a: atom, b: integer }), ['b']],
    stringifyTypeForEndUser(integer),
  ],
  [[makeObjectType({ a: atom }), ['z']], '(none)'],
  [
    [
      makeObjectType({
        a: makeObjectType({ b: makeUnionType(['hello']) }),
      }),
      ['a', 'b'],
    ],
    stringifyTypeForEndUser(makeUnionType(['hello'])),
  ],
  [[makeObjectType({ a: atom }), ['a', 'b']], '(none)'],
])

applyKeyPathSuite('applyKeyPathToType with non-object types', [
  [[makeFunctionType({ parameter: atom, return: something }), ['a']], '(none)'],
  [[atom, ['a']], '(none)'],
  [[integer, ['a']], '(none)'],
  [[A, ['a']], '(none)'],
])

applyKeyPathSuite('applyKeyPathToType with union types', [
  [
    [
      makeUnionType([
        makeObjectType({ a: makeUnionType(['x']) }),
        makeObjectType({ a: makeUnionType(['y']) }),
      ]),
      ['a'],
    ],
    stringifyTypeForEndUser(makeUnionType(['x', 'y'])),
  ],
  [
    [
      makeUnionType([makeObjectType({ a: makeUnionType(['x']) }), 'some_atom']),
      ['a'],
    ],
    '(none)',
  ],
  [
    [
      makeUnionType([makeObjectType({ b: atom }), makeObjectType({ c: atom })]),
      ['a'],
    ],
    '(none)',
  ],
  [
    [
      makeUnionType([
        makeObjectType({ a: integer }),
        makeFunctionType({ parameter: atom, return: atom }),
      ]),
      ['a'],
    ],
    '(none)',
  ],
])

applyKeyPathSuite('applyKeyPathToType with bottom types', [
  [[makeObjectType({ a: nothing }), ['a']], stringifyTypeForEndUser(nothing)],
  [[makeObjectType({ a: nothing }), ['a', 'b']], '(none)'],
  [[nothing, ['a']], '(none)'],
  [
    [
      makeUnionType([
        makeObjectType({ a: nothing }),
        makeObjectType({ a: atom }),
      ]),
      ['a'],
    ],
    stringifyTypeForEndUser(atom),
  ],
])

const keyAssignableToAOrB = makeTypeParameter('key', {
  assignableTo: makeUnionType(['a', 'b']),
})
const stuckAccessWithCommonXProperty = makeIndexedAccessType(
  makeObjectType({
    a: makeObjectType({ x: atom }),
    b: makeObjectType({ x: integer }),
  }),
  keyAssignableToAOrB,
)

applyKeyPathSuite('applyKeyPathToType with indexed access types', [
  [
    [stuckAccessWithCommonXProperty, ['x']],
    stringifyTypeForEndUser(
      nestedIndexedAccess(stuckAccessWithCommonXProperty, ['x']),
    ),
  ],
  [[stuckAccessWithCommonXProperty, ['z']], '(none)'],
  [
    [
      makeIndexedAccessType(
        makeObjectType({
          a: makeObjectType({ x: atom }),
          b: makeObjectType({}),
        }),
        keyAssignableToAOrB,
      ),
      ['x'],
    ],
    '(none)',
  ],
  [
    [
      makeIndexedAccessType(
        makeObjectType({ x: atom, a: atom, b: atom }),
        keyAssignableToAOrB,
      ),
      ['x'],
    ],
    '(none)',
  ],
])

applyKeyPathSuite('applyKeyPathToType with degenerate stuck types', [
  [[makeApplicationType(atom, atom, new Set()), ['x']], '(none)'],
  [[makeIndexedAccessType(makeObjectType({ x: atom }), atom), ['x']], '(none)'],
])

const getTypesForTypeParametersSuite = testCases(
  ([parameterType, argumentType]: readonly [
    parameterType: Type,
    argumentType: Type,
  ]) => getTypesForTypeParameters({ parameterType, argumentType }),
  ([parameterType, argumentType]) =>
    `getting types for type parameters in \`${stringifyTypeForEndUser(parameterType)}\` from \`${stringifyTypeForEndUser(argumentType)}\``,
)

const stuckParameter = makeTypeParameter('stuck', { assignableTo: something })
const stuckApplicationReturningOption = makeApplicationType(
  makeFunctionType({ parameter: stuckParameter, return: option(something) }),
  atom,
  new Set([stuckParameter.identity]),
)

getTypesForTypeParametersSuite('getTypesForTypeParameters', [
  [[A, atom], new Map([[A, atom]])],

  [[option(B), stuckApplicationReturningOption], new Map([[B, something]])],

  [[extendsAnyAtom, atom], new Map([[extendsAnyAtom, atom]])],

  [[something, atom], new Map()],

  [[makeObjectType({ a: A }), atom], new Map()],

  [
    [makeObjectType({ a: A, b: B }), makeObjectType({ a: atom, b: integer })],
    new Map([
      [A, atom],
      [B, integer],
    ]),
  ],

  [
    [
      makeFunctionType({ parameter: A, return: B }),
      makeFunctionType({ parameter: atom, return: integer }),
    ],
    new Map([
      [A, atom],
      [B, integer],
    ]),
  ],

  [
    [
      makeFunctionType({ parameter: A, return: A }),
      makeFunctionType({ parameter: atom, return: integer }),
    ],
    // The first occurrence should be used in situations like this. In real code
    // this will likely result in a type error later.
    new Map([[A, atom]]),
  ],

  [
    [makeObjectType({ a: A, b: A }), makeObjectType({ a: atom, b: integer })],
    // The first occurrence should be used in situations like this. In real code
    // this will likely result in a type error later.
    new Map([[A, atom]]),
  ],

  [[extendsAnyAtom, object], new Map()],

  [[makeUnionType([A, atom]), object], new Map([[A, object]])],

  [[makeUnionType([A, atom]), something], new Map([[A, something]])],

  [[makeUnionType([A, atom]), atom], new Map([[A, atom]])],

  [
    [makeUnionType([A, object]), makeUnionType(['specific atom'])],
    new Map([[A, makeUnionType(['specific atom'])]]),
  ],

  [
    [
      makeUnionType([extendsAnyAtom, object]),
      makeUnionType(['specific atom', object]),
    ],
    new Map([[extendsAnyAtom, makeUnionType(['specific atom'])]]),
  ],

  [[makeUnionType([extendsAnyAtom, object]), object], new Map()],

  [[option(A), option(naturalNumber)], new Map([[A, naturalNumber]])],

  [
    [
      makeFunctionType({ parameter: A, return: option(B) }),
      makeFunctionType({
        parameter: atom,
        return: option(naturalNumber),
      }),
    ],
    new Map<TypeParameter, Type>([
      [A, atom],
      [B, naturalNumber],
    ]),
  ],
])

const enumerateInhabitantsSuite = testCases(
  (type: Type) => enumerateInhabitants(type),
  type => `enumerating the inhabitants of \`${stringifyTypeForEndUser(type)}\``,
)

enumerateInhabitantsSuite('enumerateInhabitants', [
  [makeUnionType(['x']), optionAdt.makeSome(['x'])],

  [makeUnionType(['x', 'y']), optionAdt.makeSome(['x', 'y'])],

  // The bottom type has zero inhabitants (which is different from not being
  // enumerable).
  [nothing, optionAdt.makeSome([])],

  [something, optionAdt.none],

  [atom, optionAdt.none],

  [A, optionAdt.none],

  [makeFunctionType({ parameter: atom, return: atom }), optionAdt.none],

  // The `object` type is inexact (any object inhabits it).
  [object, optionAdt.none],

  [
    makeObjectType({}, { exact: true }),
    optionAdt.makeSome([objectNodeFromOrderedEntries([])]),
  ],

  [
    makeObjectType({ a: makeUnionType(['1']) }, { exact: true }),
    optionAdt.makeSome([objectNodeFromOrderedEntries([['a', '1']])]),
  ],

  // Object types default to being inexact.
  [makeObjectType({ a: makeUnionType(['1']) }), optionAdt.none],

  [
    makeObjectType(
      { a: makeUnionType(['1', '2']), b: makeUnionType(['x']) },
      { exact: true },
    ),
    optionAdt.makeSome([
      objectNodeFromOrderedEntries([
        ['a', '1'],
        ['b', 'x'],
      ]),
      objectNodeFromOrderedEntries([
        ['a', '2'],
        ['b', 'x'],
      ]),
    ]),
  ],

  [makeObjectType({ a: atom }, { exact: true }), optionAdt.none],

  [
    makeObjectType(
      { a: makeObjectType({ b: makeUnionType(['1']) }, { exact: true }) },
      { exact: true },
    ),
    optionAdt.makeSome([
      objectNodeFromOrderedEntries([
        ['a', objectNodeFromOrderedEntries([['b', '1']])],
      ]),
    ]),
  ],

  [
    makeObjectType(
      { a: makeObjectType({ b: makeUnionType(['1']) }) },
      { exact: true },
    ),
    optionAdt.none,
  ],

  [
    makeUnionType([
      makeObjectType({ a: makeUnionType(['1']) }, { exact: true }),
      'z',
    ]),
    optionAdt.makeSome([objectNodeFromOrderedEntries([['a', '1']]), 'z']),
  ],
])

/**
 * Describes each argument value as a literal atom type so tests can observe
 * exactly which argument combinations were reduced.
 */
const describeReducedArguments = (
  argumentValues: readonly SemanticGraph[],
): Either<FunctionNodeCallError, Type> =>
  either.makeRight(
    makeUnionType([
      stringifySemanticGraphForEndUser(
        objectNodeFromOrderedEntries(
          argumentValues.map((value, index) => [String(index), value]),
        ),
      ),
    ]),
  )

// This same function is reused to satisfy `assert.deepEqual`.
const computeUpperBound = (_parameterTypes: readonly Type[]): Type => something

const intrinsicReductionSuite = testCases(
  (typeArgument: Type) =>
    supplyTypeArgument(
      makeIntrinsicApplicationType(
        [A, makeObjectType({ b: makeUnionType(['2']) }, { exact: true })],
        describeReducedArguments,
        computeUpperBound,
      ),
      A,
      typeArgument,
    ),
  typeArgument =>
    `supplying \`${stringifyTypeForEndUser(typeArgument)}\` to a stuck intrinsic application`,
)

intrinsicReductionSuite('intrinsic application reduction over object types', [
  [
    makeObjectType({ a: makeUnionType(['1']) }, { exact: true }),
    makeUnionType(['{ { a: 1 }, { b: 2 } }']),
  ],

  [makeUnionType(['z']), makeUnionType(['{ z, { b: 2 } }'])],

  [
    makeUnionType([
      makeObjectType({ a: makeUnionType(['1']) }, { exact: true }),
      makeObjectType({ a: makeUnionType(['2']) }, { exact: true }),
    ]),
    makeUnionType(['{ { a: 1 }, { b: 2 } }', '{ { a: 2 }, { b: 2 } }']),
  ],

  // An inexact object type isn't enumerable, so the application stays stuck.
  [
    makeObjectType({ a: makeUnionType(['1']) }),
    makeIntrinsicApplicationType(
      [
        makeObjectType({ a: makeUnionType(['1']) }),
        makeObjectType({ b: makeUnionType(['2']) }, { exact: true }),
      ],
      describeReducedArguments,
      computeUpperBound,
    ),
  ],
])

const genericizationConstraintSuite = testCases(
  (annotation: Type) =>
    genericizeFunctionParameterAnnotation('x', annotation).type,
  annotation =>
    `genericizing \`x: ${stringifyTypeForEndUser(annotation)}\` strips exactness`,
)

genericizationConstraintSuite(
  'genericization produces inexact object constraints',
  [
    [
      // The constraint is an upper bound for its instantiations (which should
      // admit subtypes), so it must not be exact.
      makeUnionType([
        makeObjectType({ a: makeUnionType(['1']) }, { exact: true }),
      ]),
      parameterType => {
        assert(parameterType.kind === 'parameter')
        const constraint = parameterType.constraint.assignableTo
        assert(constraint.kind === 'union')
        const [member] = constraint.members
        assert(typeof member === 'object' && member.kind === 'object')
        assert.deepEqual(member.exact, false)
      },
    ],
  ],
)

const genericizeParameterAnnotationSuite = testCases(
  ([parameterName, annotation]: readonly [
    parameterName: string,
    annotation: Type,
  ]) =>
    // I'd prefer to check the actual `Type` rather than its string
    // representation, but since synthesized type parameters contain fresh
    // symbols they can't be structurally compared to `Type`s instantiated here.
    // TODO: Consider traversing the returned type to substitute symbols.
    stringifyTypeForEndUser(
      genericizeFunctionParameterAnnotation(parameterName, annotation).type,
    ),
  ([parameterName, annotation]) =>
    `genericizing \`${parameterName}: ${stringifyTypeForEndUser(annotation)}\``,
)

genericizeParameterAnnotationSuite('genericizeParameterAnnotation', [
  [['a', atom], '(?a: :atom.type)'],

  [['a', integer], '(?a: :integer.type)'],

  [['a', makeUnionType(['foo', 'bar'])], '(?a: foo | bar)'],

  [['a', something], '?a'],

  [
    [
      'x',
      makeObjectType({
        a: integer,
        b: atom,
      }),
    ],
    '{ a: (?"x.a": :integer.type), b: (?"x.b": :atom.type) }',
  ],

  [
    [
      'x',
      makeObjectType({
        a: makeObjectType({ b: atom }),
      }),
    ],
    '{ a: { b: (?"x.a.b": :atom.type) } }',
  ],

  [
    [
      'x',
      makeObjectType({
        callback: makeFunctionType({ parameter: atom, return: integer }),
      }),
    ],
    '{ callback: (?"x.callback.#parameter": :atom.type) ~> (?"x.callback.#return": :integer.type) }',
  ],

  [['empty', makeObjectType({})], '(?empty: {})'],

  [['identity', makeFunctionType({ parameter: A, return: A })], '?a ~> :a'],

  [
    ['wrap', makeObjectType({ value: A })],
    `{ value: ${stringifyTypeForEndUser(A)} }`,
  ],
])

const applyTypeToArgumentTypeSuite = testCases(
  ([functionLikeType, argumentType]: readonly [
    functionLikeType: Type,
    argumentType: Type,
  ]) =>
    optionAdt.match(applyTypeToArgumentType(functionLikeType, argumentType), {
      none: _ => 'none',
      some: stringifyTypeForEndUser,
    }),
  ([functionLikeType, argumentType]) =>
    `applying \`${stringifyTypeForEndUser(functionLikeType)}\` to \`${stringifyTypeForEndUser(argumentType)}\``,
)

applyTypeToArgumentTypeSuite('applyTypeToArgumentType', [
  [
    [makeFunctionType({ parameter: A, return: A }), integer],
    stringifyTypeForEndUser(integer),
  ],

  [
    [makeFunctionType({ parameter: atom, return: integer }), atom],
    stringifyTypeForEndUser(integer),
  ],

  [
    [
      makeTypeParameter('f', {
        assignableTo: makeFunctionType({ parameter: A, return: A }),
      }),
      integer,
    ],
    stringifyTypeForEndUser(integer),
  ],

  [
    [
      makeUnionType([
        makeFunctionType({ parameter: atom, return: integer }),
        makeFunctionType({ parameter: atom, return: atom }),
      ]),
      atom,
    ],
    stringifyTypeForEndUser(makeUnionType([integer, atom])),
  ],

  [[object, integer], 'none'],
  [[integer, atom], 'none'],
])
