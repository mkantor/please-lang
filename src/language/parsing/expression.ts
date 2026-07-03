import {
  flatMap,
  lazy,
  map,
  nothing,
  oneOf,
  oneOrMore,
  sequence,
  zeroOrMore,
  type Parser,
} from '@matt.kantor/parsing'
import type { OrderedRecord } from '../../ordered-record.js'
import * as orderedRecord from '../../ordered-record.js'
import { arrayToMolecule, ignoredKey } from '../semantics.js'
import {
  atom,
  atomWithAdditionalQuotationRequirements,
  unquotedAtomParser,
  type Atom,
} from './atom.js'
import {
  atSign,
  closingBrace,
  colon,
  comma,
  dot,
  functionArrow,
  newline,
  openingBrace,
  questionMark,
  signatureArrow,
  tilde,
  unionBar,
} from './literals.js'
import {
  optionallySurroundedByParentheses,
  surroundedByParentheses,
} from './parentheses.js'
import { recordExpressionSpan } from './spans.js'
import { optionalTrivia, trivia, triviaExceptNewlines } from './trivia.js'

// `interface` (not `type`) is used to avoid a circular reference error.
export interface Molecule extends OrderedRecord<Atom | Molecule> {}

const molecule = (
  entries: Iterable<readonly [string, Atom | Molecule]>,
): Molecule => orderedRecord.make(entries)

// Keyless properties are automatically assigned numeric indexes, which uses
// some mutable state.
type Indexer = () => string
const makeIncrementingIndexer = (): Indexer => {
  const state = { currentIndex: 0n }
  return () => {
    const index = state.currentIndex
    // TODO: Consider using a `State` monad or something instead of mutation.
    state.currentIndex += 1n
    return String(index)
  }
}

const optional = <Output>(
  parser: Parser<NonNullable<Output>>,
): Parser<Output | undefined> => oneOf([parser, nothing])

const trailingIndexesAndArgumentsToExpression = (
  root: Atom | Molecule,
  trailingIndexesAndArguments: readonly TrailingIndexOrArgument[],
): Atom | Molecule =>
  trailingIndexesAndArguments.reduce((expression, indexOrArgument) => {
    switch (indexOrArgument.kind) {
      case 'argument':
        return molecule([
          ['0', '@apply'],
          [
            '1',
            molecule([
              ['function', expression],
              ['argument', indexOrArgument.argument],
            ]),
          ],
        ])
      case 'index':
        return molecule([
          ['0', '@index'],
          [
            '1',
            molecule([
              ['object', expression],
              ['query', arrayToMolecule(indexOrArgument.query)],
            ]),
          ],
        ])
    }
  }, root)

const signatureTokensToExpression = (
  tokens: readonly [Atom | Molecule, ...(Atom | Molecule)[], Atom | Molecule],
): Molecule | Atom => {
  const [lastReturnType, lastParameterType, ...additionalParameterTypes] =
    tokens.toReversed()

  if (lastReturnType === undefined) {
    throw new Error('Signature return type did not exist. This is a bug!')
  }
  if (lastParameterType === undefined) {
    throw new Error('Signature parameter type did not exist. This is a bug!')
  }

  const initialSignature = molecule([
    ['0', '@function'],
    [
      '1',
      molecule([
        ['parameter', molecule([[ignoredKey, lastParameterType]])],
        ['body', lastReturnType],
      ]),
    ],
  ])
  return additionalParameterTypes.reduce(
    (expression, additionalParameter) =>
      molecule([
        ['0', '@function'],
        [
          '1',
          molecule([
            ['parameter', molecule([[ignoredKey, additionalParameter]])],
            ['body', expression],
          ]),
        ],
      ]),
    initialSignature,
  )
}

const unionTokensToExpression = (
  tokens: readonly [Atom | Molecule, ...(Atom | Molecule)[], Atom | Molecule],
): Molecule | Atom => {
  const members = molecule(tokens.map((token, index) => [String(index), token]))
  return molecule([
    ['0', '@union'],
    ['1', members],
  ])
}

type InfixOperator = readonly [Atom, readonly TrailingIndexOrArgument[]]
type InfixOperand = Atom | Molecule
type InfixToken = InfixOperator | InfixOperand

/**
 * Infix operations should be of the following form:
 * ```
 * [InfixOperand, InfixOperator, InfixOperand, InfixOperator, …, InfixOperand]
 * ```
 * However this can't be directly modeled in TypeScript.
 */
type InfixOperation = readonly [InfixToken, ...InfixToken[]]

const isOperand = (value: InfixToken | undefined): value is InfixOperand =>
  !Array.isArray(value)
const isOperator = (value: InfixToken | undefined): value is InfixOperator =>
  Array.isArray(value)

const infixTokensToExpression = (
  operation: InfixOperation,
): Molecule | Atom => {
  const firstToken = operation[0]
  if (operation.length === 1 && isOperand(firstToken)) {
    return firstToken
  } else {
    const leftmostOperationLHS = operation[0]
    if (!isOperand(leftmostOperationLHS)) {
      throw new Error(
        'Leftmost token in infix operation was not an operand. This is a bug!',
      )
    }

    const leftmostOperator = operation[1]
    if (!isOperator(leftmostOperator)) {
      throw new Error(
        'Could not find leftmost operator in infix operation. This is a bug!',
      )
    }

    const leftmostOperationRHS = operation[2]
    if (!isOperand(leftmostOperationRHS)) {
      throw new Error(
        'Missing right-hand side of infix operation. This is a bug!',
      )
    }

    const leftmostFunction = trailingIndexesAndArgumentsToExpression(
      molecule([
        ['0', '@lookup'],
        ['1', molecule([['key', leftmostOperator[0]]])],
      ]),
      leftmostOperator[1],
    )

    const reducedLeftmostOperation = molecule([
      ['0', '@apply'],
      [
        '1',
        molecule([
          [
            'function',
            molecule([
              ['0', '@apply'],
              [
                '1',
                molecule([
                  ['function', leftmostFunction],
                  ['argument', leftmostOperationRHS],
                ]),
              ],
            ]),
          ],
          ['argument', leftmostOperationLHS],
        ]),
      ],
    ])

    return infixTokensToExpression([
      reducedLeftmostOperation,
      ...operation.slice(3),
    ])
  }
}

const atomRequiringDotQuotation = atomWithAdditionalQuotationRequirements(dot)

const namedProperty = map(
  sequence([atom, colon, optionalTrivia, lazy(() => expression)]),
  ([key, _colon, _trivia, value]) => [key, value] as const,
)

const propertyWithOptionalKey = optionallySurroundedByParentheses(
  oneOf([
    namedProperty,
    map(
      lazy(() => expression),
      value => [undefined, value] as const,
    ),
  ]),
)

const propertyDelimiter = oneOf([
  sequence([optionalTrivia, comma, optionalTrivia]),
  sequence([optional(triviaExceptNewlines), newline, optionalTrivia]),
])

const argument = surroundedByParentheses(lazy(() => expression))

const dottedKeyPathKey = recordExpressionSpan(
  oneOf([
    // (a)
    // (1 + 1)
    // (:a.b.c)
    // (:f(x)(y))
    surroundedByParentheses(lazy(() => expression)),

    // :a
    map(sequence([colon, atomRequiringDotQuotation]), ([_colon, key]) =>
      molecule([
        ['0', '@lookup'],
        ['1', molecule([['key', key]])],
      ]),
    ),

    // 1
    // "a.b"
    atomRequiringDotQuotation,
  ]),
)

const compactDottedKeyPathComponent = map(
  sequence([dot, dottedKeyPathKey]),
  ([_dot, key]) => key,
)

const dottedKeyPathComponent = map(
  sequence([optionalTrivia, dot, optionalTrivia, dottedKeyPathKey]),
  ([_trivia1, _dot, _trivia2, key]) => key,
)

const sugarFreeMolecule: Parser<Molecule> = map(
  sequence([
    openingBrace,
    optionalTrivia,
    sequence([
      // Allow initial property not preceded by a delimiter (e.g. `{a, b}`).
      optional(propertyWithOptionalKey),
      zeroOrMore(
        map(
          sequence([propertyDelimiter, propertyWithOptionalKey]),
          ([_delimiter, property]) => property,
        ),
      ),
    ]),
    optional(propertyDelimiter),
    optionalTrivia,
    closingBrace,
  ]),
  ([
    _openingBrace,
    _trivia1,
    [optionalInitialProperty, remainingProperties],
    _trailingDelimiter,
    _trivia2,
    _closingBrace,
  ]) => {
    const properties =
      optionalInitialProperty === undefined ? remainingProperties : (
        [optionalInitialProperty, ...remainingProperties]
      )
    const enumerate = makeIncrementingIndexer()
    return molecule(
      properties.map(([key, value]) =>
        // Note that `enumerate()` increments its internal counter as a side
        // effect.
        [key ?? enumerate(), value],
      ),
    )
  },
)

type TrailingIndexOrArgument =
  | {
      readonly kind: 'argument'
      readonly argument: Molecule | Atom
    }
  | {
      readonly kind: 'index'
      readonly query: readonly (Molecule | Atom)[]
    }

const dottedKeyPath = oneOrMore(dottedKeyPathComponent)
const compactDottedKeyPath = oneOrMore(compactDottedKeyPathComponent)

// .a
// (1)
// .a(1).b.c(2)(3)
const trailingIndexesAndArguments: Parser<readonly TrailingIndexOrArgument[]> =
  zeroOrMore(
    oneOf([
      map(dottedKeyPath, query => ({ kind: 'index', query }) as const),
      map(argument, argument => ({ kind: 'argument', argument }) as const),
    ]),
  )

const compactTrailingIndexesAndArguments: Parser<
  readonly TrailingIndexOrArgument[]
> = zeroOrMore(
  oneOf([
    map(compactDottedKeyPath, query => ({ kind: 'index', query }) as const),
    map(argument, argument => ({ kind: 'argument', argument }) as const),
  ]),
)

const infixOperator = sequence([
  atomRequiringDotQuotation,
  compactTrailingIndexesAndArguments,
])

const compactExpression: Parser<Molecule | Atom> = recordExpressionSpan(
  oneOf([
    // (a)
    // (1 + 1)
    // (a => :b)(c)
    // ({ a: 1 } |> :identity).a
    map(
      sequence([
        surroundedByParentheses(lazy(() => expression)),
        compactTrailingIndexesAndArguments,
      ]),
      ([expression, trailingIndexesAndArguments]) =>
        trailingIndexesAndArgumentsToExpression(
          expression,
          trailingIndexesAndArguments,
        ),
    ),
    // :a.b
    // :a.b(1).c
    // :f(x)
    // :a.b(1)(2)
    lazy(() => precededByColonThenAtom),
    // @runtime { x => :x }
    // @panic
    lazy(() => precededByAtSign),
    // {}
    lazy(() => precededByOpeningBrace),
    // 1
    atom,
  ]),
)

// ~> a
// ~> {}
// ~> (1 ~> true ~> {})
// ~> :boolean.type ~> :boolean.type ~> :boolean.type
// ~> :integer.type
const trailingSignatureTokens = map(
  sequence([
    trivia,
    signatureArrow,
    trivia,
    zeroOrMore(
      map(
        sequence([lazy(() => expression), trivia, signatureArrow, trivia]),
        ([parameter, _trivia1, _arrow, _trivia2]) => parameter,
      ),
    ),
    lazy(() => expression),
  ]),
  ([_trivia1, _arrow, _trivia2, trailingParameterTypes, returnType]) =>
    [...trailingParameterTypes, returnType] as const,
)

// | a
// | 1 | true | {}
// | :boolean.type | :integer.type | a
const trailingUnionTokens = map(
  sequence([
    trivia,
    unionBar,
    trivia,
    zeroOrMore(
      map(
        sequence([
          // Don't use `expression` here (which also parses unions) to avoid
          // greedily consuming `|` and following tokens (which should belong to
          // the enclosing union). For example, `a | b | c` should be parsed as
          // a flat union rather than `a | (b | c)`; these are semantically
          // equivalent but are distinct syntax trees which can cause
          // bugs/confusion.
          flatMap(
            lazy(() => expressionWhichMayHaveTrailingExpressions),
            initialExpression =>
              oneOf([
                ...trailingExpressionsExceptUnion(initialExpression),
                map(nothing, _ => initialExpression),
              ]),
          ),
          trivia,
          unionBar,
          trivia,
        ]),
        ([member, _trivia1, _bar, _trivia2]) => member,
      ),
    ),
    lazy(() => expression),
  ]),
  ([_trivia1, _bar, _trivia2, trailingMembers, lastMember]) =>
    [...trailingMembers, lastMember] as const,
)

// ~ a
// ~ {}
// ~ (:boolean.type | :integer.type)
// ~ (a ~> b)
const trailingCheckToken = map(
  sequence([trivia, tilde, trivia, compactExpression]),
  ([_trivia1, _tilde, _trivia2, type]) => type,
)

const checkTokenToExpression = (
  value: Atom | Molecule,
  type: Atom | Molecule,
): Molecule =>
  molecule([
    ['0', '@check'],
    [
      '1',
      molecule([
        ['value', value],
        ['type', type],
      ]),
    ],
  ])

const trailingInfixTokens = oneOrMore(
  map(
    oneOf([
      // Allowing newlines both before and after operators could lead to
      // ambiguity between three enumerated object properties, or a single
      // enumerated property whose value is the result of an infix expression:
      // ```
      // {
      //   1
      //   +
      //   1
      // }
      // ```
      // TODO: This could be made context-dependent, only forbidding newlines
      // when between curly braces. Currently this forbids the above formatting
      // even within parentheses, where there would be no ambiguity.
      sequence([
        trivia,
        infixOperator,
        triviaExceptNewlines,
        compactExpression,
      ]),
      sequence([
        triviaExceptNewlines,
        infixOperator,
        trivia,
        compactExpression,
      ]),
    ]),
    ([_trivia1, operator, _trivia2, operand]) => [operator, operand] as const,
  ),
)

// (a: :integer.type) => :a + 1
const typedFunctionParameter: Parser<Molecule> = surroundedByParentheses(
  map(
    sequence([
      atom,
      optionalTrivia,
      colon,
      optionalTrivia,
      lazy(() => expression),
    ]),
    ([name, _trivia1, _colon, _trivia2, type]) => molecule([[name, type]]),
  ),
)

const functionParameter: Parser<Atom | Molecule> = oneOf([
  typedFunctionParameter,
  atom,
])

// a => :b
// a => {}
// a => (b => c => :d)
// a => b => c => d
// a => 1 + 1
// (a: :integer.type) => :a + 1
// (a: :integer.type) => (b: :integer.type) => :a + :b
const precededByAtomThenFunctionArrow = map(
  sequence([
    functionParameter,
    trivia,
    functionArrow,
    trivia,
    zeroOrMore(
      map(
        sequence([functionParameter, trivia, functionArrow, trivia]),
        ([parameter, _trivia1, _arrow, _trivia2]) => parameter,
      ),
    ),
    lazy(() => expression),
  ]),
  ([
    initialParameter,
    _trivia1,
    _arrow,
    _trivia2,
    trailingParameters,
    body,
  ]) => {
    const [lastParameter, ...additionalParameters] = [
      ...trailingParameters.toReversed(),
      initialParameter,
    ]
    const initialFunction = molecule([
      ['0', '@function'],
      [
        '1',
        molecule([
          ['parameter', lastParameter],
          ['body', body],
        ]),
      ],
    ])
    return additionalParameters.reduce(
      (expression, additionalParameter) =>
        molecule([
          ['0', '@function'],
          [
            '1',
            molecule([
              ['parameter', additionalParameter],
              ['body', expression],
            ]),
          ],
        ]),
      initialFunction,
    )
  },
)

// @runtime { context => … }
// @panic
// @todo blah
const precededByAtSign = map(
  sequence([
    atSign,
    unquotedAtomParser,
    optionalTrivia,
    optional(lazy(() => compactExpression)),
  ]),
  ([_atSign, keyword, _trivia, argument]) =>
    molecule([
      ['0', `@${keyword}`],
      ['1', argument ?? orderedRecord.empty],
    ]),
)

// :a
// :a.b
// :a.b(1).c
// :f(x)
// :a.b(1)(2)
const precededByColonThenAtom = map(
  sequence([colon, atomRequiringDotQuotation, trailingIndexesAndArguments]),
  ([_colon, key, trailingIndexesAndArguments]) =>
    trailingIndexesAndArgumentsToExpression(
      molecule([
        ['0', '@lookup'],
        ['1', molecule([['key', key]])],
      ]),
      trailingIndexesAndArguments,
    ),
)

// (1 + 1)
// (1 + 2 + 3 + 4)
// (x => :x)
// (x => :x)(x).b
// (1 + 1).b
// (:x => x)(1)
// (:f >> :g)(1)
const precededByOpeningParenthesis = map(
  sequence([
    surroundedByParentheses(lazy(() => expression)),
    trailingIndexesAndArguments,
  ]),
  ([expression, trailingIndexesAndArguments]) =>
    trailingIndexesAndArgumentsToExpression(
      expression,
      trailingIndexesAndArguments,
    ),
)

// {}
// { a: b }
// { 1, 2, 3 }
const precededByOpeningBrace = map(
  sequence([sugarFreeMolecule, trailingIndexesAndArguments]),
  ([expression, trailingIndexesAndArguments]) =>
    trailingIndexesAndArgumentsToExpression(
      expression,
      trailingIndexesAndArguments,
    ),
)

/** `:something.type` in desugared form. */
const topTypeAsMolecule = molecule([
  ['0', '@index'],
  [
    '1',
    molecule([
      [
        'object',
        molecule([
          ['0', '@lookup'],
          ['1', molecule([['key', 'something']])],
        ]),
      ],
      ['query', molecule([['0', 'type']])],
    ]),
  ],
])

const makeHoleMolecule = (name: Atom, constraint: Molecule): Molecule =>
  molecule([
    ['0', '@hole'],
    [
      '1',
      molecule([
        ['name', name],
        ['constraint', constraint],
      ]),
    ],
  ])

// `?name`
// `?`
const hole = map(
  sequence([questionMark, optional(atomRequiringDotQuotation)]),
  ([_questionMark, name]) =>
    makeHoleMolecule(
      name ?? ignoredKey,
      molecule([['assignableTo', topTypeAsMolecule]]),
    ),
)

// `(?name: type)`
// `(?: type)`
const parenthesizedHole = surroundedByParentheses(
  map(
    sequence([
      questionMark,
      optional(atomRequiringDotQuotation),
      optionalTrivia,
      colon,
      optionalTrivia,
      lazy(() => expression),
    ]),
    ([_questionMark, name, _trivia1, _colon, _trivia2, constraint]) =>
      makeHoleMolecule(
        name ?? ignoredKey,
        molecule([['assignableTo', constraint]]),
      ),
  ),
)

const expressionWhichMayHaveTrailingExpressions = recordExpressionSpan(
  oneOf([
    parenthesizedHole,
    precededByOpeningParenthesis,
    precededByOpeningBrace,
    precededByAtSign,
    precededByColonThenAtom,
    hole,
    precededByAtomThenFunctionArrow,
    atom,
  ]),
)

const trailingInfixExpression = (initialExpression: string | Molecule) =>
  map(trailingInfixTokens, trailingInfixTokens =>
    infixTokensToExpression([initialExpression, ...trailingInfixTokens.flat()]),
  )

const trailingSignatureExpression = (initialExpression: string | Molecule) =>
  map(trailingSignatureTokens, trailingSignatureTokens =>
    signatureTokensToExpression([
      initialExpression,
      ...trailingSignatureTokens,
    ]),
  )

const trailingCheckExpression = (initialExpression: string | Molecule) =>
  map(trailingCheckToken, trailingCheckType =>
    checkTokenToExpression(initialExpression, trailingCheckType),
  )

const trailingUnionExpression = (initialExpression: string | Molecule) =>
  map(trailingUnionTokens, trailingUnionTokens =>
    unionTokensToExpression([initialExpression, ...trailingUnionTokens]),
  )

const trailingExpressionsExceptUnion = (initialExpression: string | Molecule) =>
  [
    trailingInfixExpression(initialExpression),
    trailingSignatureExpression(initialExpression),
    trailingCheckExpression(initialExpression),
  ] as const

export const expression: Parser<Atom | Molecule> = recordExpressionSpan(
  flatMap(expressionWhichMayHaveTrailingExpressions, initialExpression =>
    oneOf([
      ...trailingExpressionsExceptUnion(initialExpression),
      trailingUnionExpression(initialExpression),
      map(nothing, _ => initialExpression),
    ]),
  ),
)
