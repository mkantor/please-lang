import option from '@matt.kantor/option'
import assert from 'node:assert'
import { promises as fileSystem } from 'node:fs'
import path from 'node:path'
import test, { suite } from 'node:test'
import { testCases } from '../../test-utilities.test.js'
import { defaultConfiguration } from '../configuration.js'
import { analyze } from './analyze.js'
import { hoverAt } from './hover.js'

const analyzeSource = analyze(defaultConfiguration)

const parse = (source: string) => {
  const { parsed } = analyzeSource(source)
  if (option.isNone(parsed)) {
    throw new Error(`unexpected parse error in: ${source}`)
  } else {
    return parsed.value
  }
}

/**
 * Point at the first occurrence of `target` in `source`, returning the source
 * text and hover type (`<text> :: <type>`).
 */
const hoverIn = (source: string, target: string): string | undefined => {
  const occurrences = source.split(target).length - 1
  if (occurrences !== 1) {
    throw new Error(
      `\`${target}\` appears ${occurrences} times, but must appear exactly once`,
    )
  } else {
    const offset = source.indexOf(target)
    return option.match(hoverAt(parse(source), offset), {
      none: _ => undefined,
      some: ({ span, type }) => `${source.slice(...span)} :: ${type}`,
    })
  }
}

const hoversIn = (source: string) =>
  testCases(
    (target: string) => hoverIn(source, target),
    target => `pointing at \`${target}\``,
  )

// This should cover every keyword.
testCases(
  (source: string) => hoverIn(source, 'f:'),
  source => source,
)('the type of every keyword expression', [
  ['{ f: :identity(1) }', 'f :: 1'], // @apply
  ['{ f: (1 + 1) ~ :Integer }', 'f :: 2'], // @check
  ['{ f: a => :a }', 'f :: ?a ~> :a'], // @function
  ['{ f: (a: ?T) => :a }', 'f :: ?T ~> :T'], // @hole
  ['{ f: @if { true, then: 1, else: 2 } }', 'f :: 1'], // @if
  ['{ g: { h: 1 }, f: :g.h }', 'f :: 1'], // @index
  ['{ g: 1, f: :g }', 'f :: 1'], // @lookup
  ['{ f: { [:Atom]: :Integer } }', 'f :: { [:Atom]: :Integer }'], // @object
  ['{ f: @panic }', 'f :: :Nothing'], // @panic
  ['{ f: @runtime { context => 1 } }', 'f :: 1'], // @runtime
  ['{ f: @todo }', 'f :: {||}'], // @todo
  ['{ f: 1 | 2 }', 'f :: 1 | 2'], // @union
])

testCases(
  (source: string) => hoverIn(source, 'f:'),
  source => source,
)('types simplified for display', [
  ['{ f: :Integer | :Atom }', 'f :: :Atom'],
  ['{ f: { a: 1 } | { a: 2 } }', 'f :: {| a: 1 | 2 |}'],
  [
    `{
      f: (a: :NaturalNumber) =>
        @runtime { context => :context.arguments.lookup(x) } match {
          none: _ => (:a + 1)
          some: (v: :Atom) => :a
        }
    }`,
    'f :: :NaturalNumber ~> :NaturalNumber',
  ],
  [
    `{
      f: @runtime { context => :context.arguments.lookup(x) } match {
        none: _ => nope
        some: (v: :Atom) =>
          @runtime { context => :context.arguments.lookup(x) } match {
            none: _ => nada
            some: (w: :Atom) => 1
          }
      }
    }`,
    'f :: 1 | nada | nope',
  ],
  [
    '{ f: { [:Integer]: :Boolean } | { [:NaturalNumber]: :Atom } }',
    'f :: { [:NaturalNumber]: :Atom }',
  ],
  [
    '{ f: {| [:Integer]: :Atom |} | {| [:NaturalNumber]: :Boolean |} }',
    'f :: {| [:Integer]: :Atom |}',
  ],
])

const program = `{
  count: 3,
  double: (n: :Integer) => :n |> :integer.add(:n),
  doubled: :double(:count),
}`

hoversIn(program)('values and the names bound to them', [
  ['count:', 'count :: 3'],
  ['double:', 'double :: :Integer ~> :Integer'],
  ['doubled:', 'doubled :: 6'],
  [':double(:count)', ':double(:count) :: 6'],
  [':count)', ':count :: 3'],
  ['3,', '3 :: 3'],
])

hoversIn(program)('names of things which are not values', [
  ['double(:count)', 'double :: :Integer ~> :Integer'],
  ['count)', 'count :: 3'],
  ['n: :Integer', 'n :: :Integer'],
  [':Integer', ':Integer :: :Integer'],
  ['Integer)', 'Integer :: :Integer'],
])

hoversIn(program)('applied functions', [
  ['|>', '|> :: ?a ~> :a'],
  ['add(:n)', 'add :: :Integer ~> :Integer ~> :Integer'],
])

const withParameter = `{
  limitOrZero: (limit: :NaturalNumber) => @if {
    :limit integer.equals 0
    then: :limit
    else: 0
  }
}`

hoversIn(withParameter)('a type parameter bound outside what is pointed at', [
  [
    'limitOrZero:',
    hover => {
      assert.ok(hover !== undefined)
      assert.match(hover, /^limitOrZero :: \(\?limit: :NaturalNumber\) ~>/)
    },
  ],
  [
    '@if',
    hover => {
      assert.ok(hover !== undefined)
      assert.ok(hover.includes(':limit'))
      assert.doesNotMatch(hover, /\?limit/)
    },
  ],
  // Type parameters displayed as references include their bounds the first time
  // they're mentioned.
  [':limit integer.equals 0', ':limit :: :limit ~ :NaturalNumber'],
  ['then: :limit', 'then :: :limit ~ :NaturalNumber'],
])

const withParameterInFunctionParameter = `{
  f: (x: :Atom) => {
    callback: (k: :x ~> :Integer) => 1
  }
}`

hoversIn(withParameterInFunctionParameter)(
  "a type parameter bound outside what is pointed at, in a function's parameter",
  [['callback:', 'callback :: ((:x ~ :Atom) ~> :Integer) ~> 1']],
)

const withNestedParameter = `{
  outer: (state: { current: :NaturalNumber, "odd key": :Atom }) => {
    a: :state.current
    b: :state."odd key"
  }
  higherOrder: (apply: :Atom ~> :Integer) => (x: :Atom) => { c: :apply(:x) }
}`

hoversIn(withNestedParameter)('a parameter standing for part of another one', [
  ['a: :state.current', 'a :: :state.current ~ :NaturalNumber'],
  ['b: :state', 'b :: :state."odd key" ~ :Atom'],
  [
    'outer:',
    hover => {
      assert.ok(hover !== undefined)
      assert.ok(hover.includes('(?"state.current": :NaturalNumber)'))
    },
  ],
  ['c: :apply(:x)', 'c :: :"apply.#return" ~ :Integer'],
])

const withUnreferencedParameters = `{
  ignoresIt: (n: :Integer) => 0,
  ignoresAnything: n => 0,
  usesIt: (n: :Integer) => :n,
  usesPartOfIt: (state: { current: :Integer, other: :Atom }) => :state.current,
}`

// Type parameters with no referents are reduced to their constraints.
hoversIn(withUnreferencedParameters)('parameters nothing refers back to', [
  ['ignoresIt:', 'ignoresIt :: :Integer ~> 0'],
  ['ignoresAnything:', 'ignoresAnything :: :Something ~> 0'],
  ['usesIt:', 'usesIt :: (?n: :Integer) ~> :n'],
  [
    'usesPartOfIt:',
    'usesPartOfIt :: { current: (?"state.current": :Integer), other: :Atom } ~> :"state.current"',
  ],
])

const withTypeAnnotations = `{
  parameter: (state: { current: :NaturalNumber }) => :state.current
  checked: { a: 1, b: 2 } ~ { a: :Integer }
  hole: (?T: { b: :Atom })
  object: { [:Atom]: { c: :Atom }, d: { e: :Atom } }
}`

// These are interpreted as types, where object literals are open.
hoversIn(withTypeAnnotations)('object literals within type annotations', [
  ['state:', 'state :: { current: :NaturalNumber }'],
  ['{ a: :Integer }', '{ a: :Integer } :: { a: :Integer }'],
  ['{ b: :Atom }', '{ b: :Atom } :: { b: :Atom }'],
  ['{ c: :Atom }', '{ c: :Atom } :: { c: :Atom }'],
  ['d: { e', 'd :: { e: :Atom }'],
])

const withRecursion = `{
  outer: (limit: :NaturalNumber) => {
    helper: (n: :NaturalNumber) => @if {
      :n > :limit
      then: :n
      else: :helper(:n + 1)
    }
    result: :helper(1)
  }.result
}`

hoversIn(withRecursion)('a recursive call', [
  [':helper(:n + 1)', ':helper(:n + 1) :: :NaturalNumber'],
  ['helper(:n + 1)', 'helper :: :NaturalNumber ~> :NaturalNumber'],
  [
    'outer:',
    hover => {
      assert.ok(hover !== undefined)
      assert.doesNotMatch(hover, /:Nothing/)
    },
  ],
])

const withUnsettlingRecursion = `{
  wrap: (n: :Integer) => @if {
    :n integer.equals 0
    then: done
    else: { wrapped: :wrap(:n - 1) }
  }
}`

hoversIn(withUnsettlingRecursion)('a recursion which never settles', [
  // `wrap` returns an object with arbitrary nesting depth, so iterative type
  // derivation never settles.
  [
    'wrap:',
    hover => {
      assert.ok(hover !== undefined)
      assert.ok(hover.includes('wrapped: :Something'))
    },
  ],
])

suite('rendering', () => {
  test('a type too wide to read on one line is spread over several', () => {
    // `:integer` is the whole integer module.
    const hover = hoverIn(program, 'integer.add')
    assert.ok(hover !== undefined)
    assert.equal(
      hover.split('\n').slice(0, 3).join('\n'),
      [
        'integer :: {|',
        '  type: :Integer',
        '  add: :Integer ~> :Integer ~> :Integer',
      ].join('\n'),
    )
    assert.ok(!hover.endsWith('\n'))
  })
})

const chain = '{ one: { two: { three: 1 } }, chain: :one.two.three }'

hoversIn(chain)('components of a dotted chain', [
  [':one.two.three', ':one.two.three :: 1'],
  ['one.two.three', 'one :: {| two: {| three: 1 |} |}'],
  ['two.three', 'two :: {| three: 1 |}'],
  ['three }', 'three :: 1'],
])

hoversIn('{\n  a: 1,\n\n  b: 2,\n}')('positions describing nothing', [
  ['\n\n', undefined],
  ['{', undefined],
])

suite('hover', () => {
  test('nothing is reported for a program which is only an atom', () => {
    assert.equal(hoverIn('42', '42'), undefined)
  })

  test('a program which fails to compile still describes what it can', () => {
    const source = '{ good: 1 + 1, bad: :nonexistent }'
    assert.equal(analyzeSource(source).diagnostics.length, 1)
    assert.equal(hoverIn(source, 'good:'), 'good :: 2')
  })
})

const examplesDirectory = path.join(import.meta.dirname, '../../../examples')

suite('hovering everywhere in the examples', async () => {
  const fileNames = (await fileSystem.readdir(examplesDirectory)).filter(
    fileName => fileName.endsWith('.plz'),
  )

  fileNames.forEach(fileName => {
    test(fileName, async () => {
      const source = await fileSystem.readFile(
        path.join(examplesDirectory, fileName),
        'utf8',
      )
      const parsedProgram = parse(source)
      Array.from({ length: source.length }, (_, offset) => offset).forEach(
        offset =>
          option.match(hoverAt(parsedProgram, offset), {
            none: _ => undefined,
            some: ({ span, type }) => {
              assert.ok(
                offset >= span[0] && offset < span[1],
                `hover at ${offset} reported ${JSON.stringify(span)}`,
              )
              // Check that all keywords are handled (not inferred as their raw
              // expression structure).
              assert.doesNotMatch(
                type,
                /"@/,
                `hover at ${offset} described an expression's structure`,
              )
            },
          }),
      )
    })
  })
})
