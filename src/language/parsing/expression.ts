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
import { ignoredKey } from '../semantics.js'
import {
  atomWithAdditionalQuotationRequirements,
  atom as rawAtom,
  unquotedAtomParser,
  type Atom,
} from './atom.js'
import {
  atSign,
  closingBrace,
  closingBracket,
  colon,
  comma,
  dot,
  functionArrow,
  newline,
  openingBrace,
  openingBracket,
  questionMark,
  signatureArrow,
  tilde,
  unionBar,
} from './literals.js'
import {
  optionallySurroundedByParentheses,
  surroundedByParentheses,
} from './parentheses.js'
import {
  recordSpan,
  spannedAtom,
  syntheticAtom,
  syntheticMolecule,
  type SpannedAtom,
  type SpannedMolecule,
  type SpannedTree,
} from './spans.js'
import { optionalTrivia, trivia, triviaExceptNewlines } from './trivia.js'

// `interface` (not `type`) is used to avoid a circular reference error.
export interface Molecule extends OrderedRecord<Atom | Molecule> {}

// Leaf atoms carry their own source spans.
const atom: Parser<SpannedAtom> = spannedAtom(rawAtom)

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

const spannedArrayToMolecule = (
  elements: readonly SpannedTree[],
): SpannedMolecule =>
  syntheticMolecule(elements.map((element, index) => [String(index), element]))

const trailingIndexesAndArgumentsToExpression = (
  root: SpannedTree,
  trailingIndexesAndArguments: readonly TrailingIndexOrArgument[],
): SpannedTree =>
  trailingIndexesAndArguments.reduce<SpannedTree>(
    (expression, indexOrArgument) => {
      switch (indexOrArgument.kind) {
        case 'argument':
          return syntheticMolecule([
            ['0', syntheticAtom('@apply')],
            [
              '1',
              syntheticMolecule([
                ['function', expression],
                ['argument', indexOrArgument.argument],
              ]),
            ],
          ])
        case 'index':
          return syntheticMolecule([
            ['0', syntheticAtom('@index')],
            [
              '1',
              syntheticMolecule([
                ['object', expression],
                ['query', spannedArrayToMolecule(indexOrArgument.query)],
              ]),
            ],
          ])
      }
    },
    root,
  )

const signatureTokensToExpression = (
  tokens: readonly [SpannedTree, ...SpannedTree[], SpannedTree],
): SpannedTree => {
  const [lastReturnType, lastParameterType, ...additionalParameterTypes] =
    tokens.toReversed()

  if (lastReturnType === undefined) {
    throw new Error('Signature return type did not exist. This is a bug!')
  }
  if (lastParameterType === undefined) {
    throw new Error('Signature parameter type did not exist. This is a bug!')
  }

  const initialSignature = syntheticMolecule([
    ['0', syntheticAtom('@function')],
    [
      '1',
      syntheticMolecule([
        ['parameter', syntheticMolecule([[ignoredKey, lastParameterType]])],
        ['body', lastReturnType],
      ]),
    ],
  ])
  return additionalParameterTypes.reduce<SpannedTree>(
    (expression, additionalParameter) =>
      syntheticMolecule([
        ['0', syntheticAtom('@function')],
        [
          '1',
          syntheticMolecule([
            [
              'parameter',
              syntheticMolecule([[ignoredKey, additionalParameter]]),
            ],
            ['body', expression],
          ]),
        ],
      ]),
    initialSignature,
  )
}

const unionTokensToExpression = (
  tokens: readonly [SpannedTree, ...SpannedTree[], SpannedTree],
): SpannedTree => {
  const members = syntheticMolecule(
    tokens.map((token, index) => [String(index), token]),
  )
  return syntheticMolecule([
    ['0', syntheticAtom('@union')],
    ['1', members],
  ])
}

type InfixOperator = readonly [SpannedAtom, readonly TrailingIndexOrArgument[]]
type InfixOperand = SpannedTree
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

const infixTokensToExpression = (operation: InfixOperation): SpannedTree => {
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
      syntheticMolecule([
        ['0', syntheticAtom('@lookup')],
        ['1', syntheticMolecule([['key', leftmostOperator[0]]])],
      ]),
      leftmostOperator[1],
    )

    const reducedLeftmostOperation = syntheticMolecule([
      ['0', syntheticAtom('@apply')],
      [
        '1',
        syntheticMolecule([
          [
            'function',
            syntheticMolecule([
              ['0', syntheticAtom('@apply')],
              [
                '1',
                syntheticMolecule([
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

const atomRequiringDotQuotation: Parser<SpannedAtom> = spannedAtom(
  atomWithAdditionalQuotationRequirements(dot),
)

const namedProperty = map(
  sequence([atom, colon, optionalTrivia, lazy(() => expression)]),
  ([key, _colon, _trivia, value]) => [key.value, value] as const,
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

type ExcessClause = readonly [keys: SpannedTree, values: SpannedTree]

// [a]: b
const excessClause: Parser<ExcessClause> = map(
  sequence([
    openingBracket,
    lazy(() => expression),
    closingBracket,
    colon,
    optionalTrivia,
    lazy(() => expression),
  ]),
  ([_openingBracket, keys, _closingBracket, _colon, _trivia, values]) => [
    keys,
    values,
  ],
)

const argument = surroundedByParentheses(lazy(() => expression))

const dottedKeyPathKey = recordSpan(
  oneOf([
    // (a)
    // (1 + 1)
    // (:a.b.c)
    // (:f(x)(y))
    surroundedByParentheses(lazy(() => expression)),

    // :a
    map(sequence([colon, atomRequiringDotQuotation]), ([_colon, key]) =>
      syntheticMolecule([
        ['0', syntheticAtom('@lookup')],
        ['1', syntheticMolecule([['key', key]])],
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

type MoleculeContents = {
  readonly properties: readonly (readonly [Atom | undefined, SpannedTree])[]
  readonly excessClauses: readonly ExcessClause[]
}

type MoleculeEntry =
  | {
      readonly kind: 'property'
      readonly property: readonly [Atom | undefined, SpannedTree]
    }
  | {
      readonly kind: 'excessClause'
      readonly clause: ExcessClause
    }

const moleculeEntry: Parser<MoleculeEntry> = oneOf([
  map(excessClause, clause => ({
    kind: 'excessClause' as const,
    clause,
  })),
  map(propertyWithOptionalKey, property => ({
    kind: 'property' as const,
    property,
  })),
])

const moleculeContents: Parser<MoleculeContents> = map(
  sequence([
    // Allow initial entry not preceded by a delimiter (e.g. `{a, b}`).
    optional(moleculeEntry),
    zeroOrMore(
      map(
        sequence([propertyDelimiter, moleculeEntry]),
        ([_delimiter, entry]) => entry,
      ),
    ),
  ]),
  ([optionalInitialEntry, remainingEntries]) => {
    const entries =
      optionalInitialEntry === undefined ? remainingEntries : (
        [optionalInitialEntry, ...remainingEntries]
      )
    return {
      properties: entries.flatMap(entry =>
        entry.kind === 'property' ? [entry.property] : [],
      ),
      excessClauses: entries.flatMap(entry =>
        entry.kind === 'excessClause' ? [entry.clause] : [],
      ),
    }
  },
)

const sugarFreeMolecule: Parser<SpannedMolecule> = map(
  sequence([
    openingBrace,
    optionalTrivia,
    moleculeContents,
    optional(propertyDelimiter),
    optionalTrivia,
    closingBrace,
  ]),
  ([
    _openingBrace,
    _trivia1,
    { properties, excessClauses },
    _trailingDelimiter,
    _trivia2,
    _closingBrace,
  ]) => {
    const enumerate = makeIncrementingIndexer()
    const propertiesAsMolecule = syntheticMolecule(
      properties.map(([key, value]) =>
        // Note that `enumerate()` increments its internal counter as a side
        // effect.
        [key ?? enumerate(), value],
      ),
    )
    return excessClauses.length === 0 ?
        propertiesAsMolecule
      : syntheticMolecule([
          ['0', syntheticAtom('@object')],
          [
            '1',
            syntheticMolecule([
              ['properties', propertiesAsMolecule],
              [
                'excess',
                syntheticMolecule(
                  excessClauses.map((clause, index) => [
                    String(index),
                    syntheticMolecule(
                      clause.map((value, index) => [String(index), value]),
                    ),
                  ]),
                ),
              ],
            ]),
          ],
        ])
  },
)

type TrailingIndexOrArgument =
  | {
      readonly kind: 'argument'
      readonly argument: SpannedTree
    }
  | {
      readonly kind: 'index'
      readonly query: readonly SpannedTree[]
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

const compactExpression: Parser<SpannedTree> = recordSpan(
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
  value: SpannedTree,
  type: SpannedTree,
): SpannedMolecule =>
  syntheticMolecule([
    ['0', syntheticAtom('@check')],
    [
      '1',
      syntheticMolecule([
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
const typedFunctionParameter: Parser<SpannedMolecule> = surroundedByParentheses(
  map(
    sequence([
      atom,
      optionalTrivia,
      colon,
      optionalTrivia,
      lazy(() => expression),
    ]),
    ([name, _trivia1, _colon, _trivia2, type]) =>
      syntheticMolecule([[name.value, type]]),
  ),
)

const functionParameter: Parser<SpannedTree> = oneOf([
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
    const initialFunction = syntheticMolecule([
      ['0', syntheticAtom('@function')],
      [
        '1',
        syntheticMolecule([
          ['parameter', lastParameter],
          ['body', body],
        ]),
      ],
    ])
    return additionalParameters.reduce<SpannedTree>(
      (expression, additionalParameter) =>
        syntheticMolecule([
          ['0', syntheticAtom('@function')],
          [
            '1',
            syntheticMolecule([
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
    syntheticMolecule([
      ['0', syntheticAtom(`@${keyword}`)],
      ['1', argument ?? syntheticMolecule([])],
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
      syntheticMolecule([
        ['0', syntheticAtom('@lookup')],
        ['1', syntheticMolecule([['key', key]])],
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
const topTypeAsMolecule = syntheticMolecule([
  ['0', syntheticAtom('@index')],
  [
    '1',
    syntheticMolecule([
      [
        'object',
        syntheticMolecule([
          ['0', syntheticAtom('@lookup')],
          ['1', syntheticMolecule([['key', syntheticAtom('something')]])],
        ]),
      ],
      ['query', syntheticMolecule([['0', syntheticAtom('type')]])],
    ]),
  ],
])

const makeHoleMolecule = (
  name: SpannedTree,
  constraint: SpannedMolecule,
): SpannedMolecule =>
  syntheticMolecule([
    ['0', syntheticAtom('@hole')],
    [
      '1',
      syntheticMolecule([
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
      name ?? syntheticAtom(ignoredKey),
      syntheticMolecule([['assignableTo', topTypeAsMolecule]]),
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
        name ?? syntheticAtom(ignoredKey),
        syntheticMolecule([['assignableTo', constraint]]),
      ),
  ),
)

const expressionWhichMayHaveTrailingExpressions = recordSpan(
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

const trailingInfixExpression = (initialExpression: SpannedTree) =>
  map(trailingInfixTokens, trailingInfixTokens =>
    infixTokensToExpression([initialExpression, ...trailingInfixTokens.flat()]),
  )

const trailingSignatureExpression = (initialExpression: SpannedTree) =>
  map(trailingSignatureTokens, trailingSignatureTokens =>
    signatureTokensToExpression([
      initialExpression,
      ...trailingSignatureTokens,
    ]),
  )

const trailingCheckExpression = (initialExpression: SpannedTree) =>
  map(trailingCheckToken, trailingCheckType =>
    checkTokenToExpression(initialExpression, trailingCheckType),
  )

const trailingUnionExpression = (initialExpression: SpannedTree) =>
  map(trailingUnionTokens, trailingUnionTokens =>
    unionTokensToExpression([initialExpression, ...trailingUnionTokens]),
  )

const trailingExpressionsExceptUnion = (initialExpression: SpannedTree) =>
  [
    trailingInfixExpression(initialExpression),
    trailingSignatureExpression(initialExpression),
    trailingCheckExpression(initialExpression),
  ] as const

export const expression: Parser<SpannedTree> = recordSpan(
  flatMap(expressionWhichMayHaveTrailingExpressions, initialExpression =>
    oneOf([
      ...trailingExpressionsExceptUnion(initialExpression),
      trailingUnionExpression(initialExpression),
      map(nothing, _ => initialExpression),
    ]),
  ),
)
