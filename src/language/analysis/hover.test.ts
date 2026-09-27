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

/** Like `hoversIn`, but with a source for each case. */
const hoverCases = testCases(
  ([source, target]: readonly [source: string, target: string]) =>
    hoverIn(source, target),
  ([source, target]) => `pointing at \`${target}\` in \`${source}\``,
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

testCases(
  (source: string) => hoverIn(source, 'f:'),
  source => source,
)('types written with prelude names', [
  ['{ f: false | true }', 'f :: :Boolean'],
  ['{ f: { a: false | true } }', 'f :: {| a: :Boolean |}'],
  [
    '{ f: @runtime { context => :context.arguments.lookup(x) } }',
    'f :: :Option(:Atom)',
  ],
  [
    '{ f: :option.make_some(@runtime { context => :context.arguments.lookup(x) }) }',
    'f :: :Option(:Option(:Atom))',
  ],
  ['{ f: false | true | maybe }', 'f :: false | true | maybe'],
])

hoversIn(`{
  count: 3,
  double: (n: :Integer) => :n |> :integer.add(:n),
  doubled: :double(:count),
}`)('basic keys, parameters, lookups, indexes, and values', [
  ['count:', 'count :: 3'],
  ['double:', 'double :: :Integer ~> :Integer'],
  ['doubled:', 'doubled :: 6'],
  [':double(:count)', ':double(:count) :: 6'],
  [':count)', ':count :: 3'],
  ['3,', '3 :: 3'],
  ['double(:count)', 'double :: :Integer ~> :Integer'],
  ['count)', 'count :: 3'],
  ['n: :Integer', 'n :: :Integer'],
  [':Integer', ':Integer :: :Integer'],
  ['Integer)', 'Integer :: :Integer'],
  ['|>', '|> :: ?a ~> :a'],
  ['add(:n)', 'add :: :Integer ~> :Integer ~> :Integer'],
])

const limitOrZeroProgram = `{
  limitOrZero: (limit: :NaturalNumber) => @if {
    :limit integer.equals 0
    then: :limit
    else: 0
  }
}`

hoverCases('type parameters simplified to their constraint', [
  [['(a: :Integer) => :a', ':a'], ':a :: :Integer'],
  [
    ['(point: { x: :Integer, y: :Integer }) => :point', ':point'],
    ':point :: { x: :Integer, y: :Integer }',
  ],
  [
    ['(a: :Integer) => { b: { :a, :a }, c: { :b, :b } }', 'c:'],
    'c :: {| {| (:a ~ :Integer), :a |}, {| :a, :a |} |}',
  ],
  [['x => { value: :x }', '{ value'], '{ value: :x } :: {| value: :x |}'],
  [
    ['x => (y => { a: :x, b: :y })', '{ a'],
    '{ a: :x, b: :y } :: {| a: :x, b: :y |}',
  ],
  [
    [limitOrZeroProgram, 'limitOrZero:'],
    hover => {
      assert.ok(hover !== undefined)
      assert.match(hover, /^limitOrZero :: \(\?limit: :NaturalNumber\) ~>/)
    },
  ],
  [
    [limitOrZeroProgram, '@if'],
    hover => {
      assert.ok(hover !== undefined)
      assert.ok(hover.includes(':limit'))
      assert.doesNotMatch(hover, /\?limit/)
    },
  ],
  [[limitOrZeroProgram, ':limit integer.equals 0'], ':limit :: :NaturalNumber'],
  [[limitOrZeroProgram, 'then: :limit'], 'then :: :NaturalNumber'],
])

hoverCases('type parameters in `@if`s', [
  [
    ['(a: :Integer) => @if { :a > 1, then: :a, else: 0 }', '@if'],
    '@if { :a > 1, then: :a, else: 0 } :: @if { condition: :a integer.is_greater_than 1, then: :a, else: 0 }',
  ],
  [
    [
      '(a: :Integer) => { c: @if { :a > 1, then: :a, else: 0 }, d: :a }',
      '{ c:',
    ],
    [
      '{ c: @if { :a > 1, then: :a, else: 0 }, d: :a } :: {|',
      '  c: @if {',
      '    condition: :a integer.is_greater_than 1',
      '    then: :a',
      '    else: 0',
      '  }',
      '  d: :a ~ :Integer',
      '|}',
    ].join('\n'),
  ],
])

hoverCases('type parameters which share a name', [
  // `option.get_or_else`'s type parameter is also named `a`.
  [
    ['{ f: (a: :Integer) => :option.get_or_else(:a) }', 'f:'],
    'f :: (?a: :Integer) ~> :Option(?a2) ~> :a2 | :a',
  ],
  [
    ['(a: :Integer) => { x: :a, y: :a, h: :option.get_or_else(:a) }', '{ x'],
    '{ x: :a, y: :a, h: :option.get_or_else(:a) } :: {| x: :a ~ :Integer, y: :a, h: :Option(?a2) ~> :a2 | :a |}',
  ],
  [
    ['(a: :Integer) => { x: :a, h: :option.get_or_else }', '{ x'],
    '{ x: :a, h: :option.get_or_else } :: {| x: :Integer, h: ?b ~> :Option(?a) ~> :a | :b |}',
  ],
])

hoversIn(`{
  f: (x: :Atom) => {
    callback: (k: :x ~> :Integer) => 1
  }
}`)("a type parameter referred to by a function's parameter type", [
  ['callback:', 'callback :: ((:x ~ :Atom) ~> :Integer) ~> 1'],
])

hoversIn(`{
  outer: (state: { current: :NaturalNumber, "odd key": :Atom }) => {
    a: { :state.current, :state.current }
    b: { :state."odd key", :state."odd key" }
  }
  higherOrder: (apply: :Atom ~> :Integer) => (x: :Atom) => {
    c: :apply(:x)
    d: { :c, :c }
  }
}`)('a genericized parameter with structure', [
  [
    'a: { :state',
    'a :: {| (:state.current ~ :NaturalNumber), :state.current |}',
  ],
  ['b: { :state', 'b :: {| (:state."odd key" ~ :Atom), :state."odd key" |}'],
  [
    'outer:',
    hover => {
      assert.ok(hover !== undefined)
      assert.ok(hover.includes('(?"state.current": :NaturalNumber)'))
    },
  ],
  ['d: { :c', 'd :: {| (:"apply.#return" ~ :Integer), :"apply.#return" |}'],
])

// Type parameters with no referents are reduced to their constraints.
hoversIn(`{
  ignoresIt: (n: :Integer) => 0,
  ignoresAnything: n => 0,
  usesIt: (n: :Integer) => :n,
  usesPartOfIt: (state: { current: :Integer, other: :Atom }) => :state.current,
}`)('parameters nothing refers to', [
  ['ignoresIt:', 'ignoresIt :: :Integer ~> 0'],
  ['ignoresAnything:', 'ignoresAnything :: :Something ~> 0'],
  ['usesIt:', 'usesIt :: (?n: :Integer) ~> :n'],
  [
    'usesPartOfIt:',
    'usesPartOfIt :: { current: (?"state.current": :Integer), other: :Atom } ~> :"state.current"',
  ],
])

// Objects in type position are inferred as open object types.
hoversIn(`{
  parameter: (state: { current: :NaturalNumber }) => :state.current
  checked: { a: 1, b: 2 } ~ { a: :Integer }
  hole: (?T: { b: :Atom })
  object: { [:Atom]: { c: :Atom }, d: { e: :Atom } }
}`)('object literals within type positions', [
  ['state:', 'state :: { current: :NaturalNumber }'],
  ['{ a: :Integer }', '{ a: :Integer } :: { a: :Integer }'],
  ['{ b: :Atom }', '{ b: :Atom } :: { b: :Atom }'],
  ['{ c: :Atom }', '{ c: :Atom } :: { c: :Atom }'],
  ['d: { e', 'd :: { e: :Atom }'],
])

hoversIn(`{
  outer: (limit: :NaturalNumber) => {
    helper: (n: :NaturalNumber) => @if {
      :n > :limit
      then: :n
      else: :helper(:n + 1)
    }
    result: :helper(1)
  }.result
}`)('a recursive call', [
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

hoversIn(`{
  wrap: (n: :Integer) => @if {
    :n integer.equals 0
    then: done
    else: { wrapped: :wrap(:n - 1) }
  }
}`)('a recursion which never settles', [
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
  test('large types are written on multiple lines', () => {
    // `:integer` is the whole integer module.
    const hover = hoverIn(':integer.add', 'integer.add')
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

hoversIn('{ one: { two: { three: 1 } }, chain: :one.two.three }')(
  'components of an index query',
  [
    [':one.two.three', ':one.two.three :: 1'],
    ['one.two.three', 'one :: {| two: {| three: 1 |} |}'],
    ['two.three', 'two :: {| three: 1 |}'],
    ['three }', 'three :: 1'],
  ],
)

hoversIn('{\n  a: 1,\n\n  b: 2,\n}')('positions describing nothing', [
  ['\n\n', undefined],
  ['{', undefined],
])

suite('hover', () => {
  test('a semantically-invalid program can still have hover type info', () => {
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
