import either from '@matt.kantor/either'
import option from '@matt.kantor/option'
import assert from 'node:assert'
import { formatError } from './language/cli/error-formatting.js'
import { defaultConfiguration } from './language/configuration.js'
import { parse } from './language/parsing/parser.js'
import { evaluate } from './language/runtime.js'
import * as orderedRecord from './ordered-record.js'
import {
  compileWithoutSpans,
  parseAndCompileAndRun,
  testCases,
  toSyntaxTree,
  unparseAndRoundtrip,
  type ProgramResult,
} from './test-utilities.test.js'
import type { JsonValue } from './utility-types.js'

const assertSuccess = (result: ProgramResult) => {
  if (either.isLeft(result)) {
    assert.fail(formatError(result.value, { filename: '<test>' }))
  }
  assert(either.isRight(result))
}

const success = (value: JsonValue) => either.makeRight(toSyntaxTree(value))

const endToEnd = (input: string) => {
  const syntaxTree = parse(input)
  const runtimeOutputFromRoundtrippingSyntaxTree = either.flatMap(
    syntaxTree,
    unparseAndRoundtrip,
  )

  const program = either.flatMap(syntaxTree, compileWithoutSpans)
  const runtimeOutputFromRoundtrippingProgram = either.flatMap(
    program,
    unparseAndRoundtrip,
  )

  const runtimeOutput: ProgramResult = either.flatMap(
    program,
    evaluate(defaultConfiguration),
  )

  // These errors could be stitched into the returned `Either`'s left, but
  // that'd lead to worse test reporting.
  assert.deepEqual(
    runtimeOutput,
    runtimeOutputFromRoundtrippingSyntaxTree,
    'Unexpected syntax tree roundtrip result',
  )
  assert.deepEqual(
    runtimeOutput,
    runtimeOutputFromRoundtrippingProgram,
    'Unexpected program roundtrip result',
  )

  return runtimeOutput
}

const typeMismatch = (result: ProgramResult) => {
  assert(either.isLeft(result), 'expected a typeMismatch error')
  assert('kind' in result.value)
  assert.deepEqual(result.value.kind, 'typeMismatch')
}

const invalidExpression = (result: ProgramResult) => {
  assert(either.isLeft(result), 'expected an invalidExpression error')
  assert('kind' in result.value)
  assert.deepEqual(result.value.kind, 'invalidExpression')
}

const panic = (result: ProgramResult) => {
  assert(either.isLeft(result), 'expected an panic')
  assert('kind' in result.value)
  assert.deepEqual(result.value.kind, 'panic')
}

// These tests can't be fully-roundtripped because their output depends on
// runtime state.
testCases(parseAndCompileAndRun, code => code)('runtime-derived values', [
  [
    `@runtime { context => :identity(:context).program.start_time }`,
    output => {
      if (either.isLeft(output)) {
        assert.fail(output.value.message)
      }
      assert(typeof output.value === 'string')
    },
  ],
  [
    `{
      my_function: n => :n
      input: @runtime { _context => { tag: some, value: 42 } }
      output: :input match {
        none: _ => "missing value"
        some: input => @if {
          :natural_number.is(:input)
          then: :my_function(:input)
          else: "--input must be a natural number"
        }
      }
    }.output`,
    success('42'),
  ],
  [
    `((a: :NaturalNumber) => {
      my_function: (b: :NaturalNumber) => @if {
        :b > :a
        then: @panic "should not go down this branch"
        else: 2 + @if {
          :b > 1
          then: @panic "should not go down this branch either"
          else: 3
        }
      }
      return: :my_function(0)
    })(2).return`,
    success('5'),
  ],
  [
    `{
      count: (limit: :NaturalNumber) => {
        count_internal: (state: { current: :Integer, output: :Atom }) =>
          @if {
            :state.current > :limit
            then: :state.output
            else: :count_internal({
              output: :state.output atom.append :state.current atom.append @if {
                :state.current > 1
                then: " (greater than one) "
                else: " (not greater than one) "
              }
              current: :state.current + 1
            })
          }
        return: :count_internal({ current: 0, output: "" })
      }.return
    }.count(2)`,
    success(
      '0 (not greater than one) 1 (not greater than one) 2 (greater than one) ',
    ),
  ],
])

testCases(endToEnd, code => code)('end-to-end tests', [
  ['""', success('')],
  ['{}', success({})],
  ['hi', success('hi')],
  ['1.1', success('1.1')],
  ['{{{}}}', success({ 0: { 0: {} } })],
  ['"hello world"', success('hello world')],
  ['{foo:bar}', success({ foo: 'bar' })],
  ['{hi}', success({ 0: 'hi' })],
  ['{a,b,c}', success({ 0: 'a', 1: 'b', 2: 'c' })],
  ['{,a,b,c,}', success({ 0: 'a', 1: 'b', 2: 'c' })],
  ['{a,1:overwritten,c}', success({ 0: 'a', 1: 'c' })],
  ['{overwritten,0:a,c}', success({ 0: 'a', 1: 'c' })],
  ['@check {type:true, value:true}', success('true')],
  ['@panic', panic],
  ['{a:A, b:{"@lookup", {a}}}', success({ a: 'A', b: 'A' })],
  [
    '{a:A, {"@lookup", {a}}}',
    either.makeRight(
      orderedRecord.make([
        ['a', 'A'],
        ['0', 'A'],
      ]),
    ),
  ],
  ['{a:A, b: :a}', success({ a: 'A', b: 'A' })],
  [
    '{a:A, :a}',
    either.makeRight(
      orderedRecord.make([
        ['a', 'A'],
        ['0', 'A'],
      ]),
    ),
  ],
  [`_ => @panic`, assertSuccess],
  ['@runtime {_ => @panic}', panic],
  [
    'a => :a',
    success({
      0: '@function',
      1: {
        parameter: 'a',
        body: { 0: '@lookup', 1: { key: 'a' } },
      },
    }),
  ],
  [
    '(a => :a)',
    success({
      0: '@function',
      1: {
        parameter: 'a',
        body: { 0: '@lookup', 1: { key: 'a' } },
      },
    }),
  ],
  ['{ a: ({ A }) }', success({ a: { 0: 'A' } })],
  ['{ a: ( A ) }', success({ a: 'A' })],
  ['{ a: ("A A A") }', success({ a: 'A A A' })],
  ['{ ("a"): A }', success({ a: 'A' })],
  ['{ a: :(b), b: B }', success({ a: 'B', b: 'B' })],
  ['{ a: :("b"), b: B }', success({ a: 'B', b: 'B' })],
  ['{ (a: A), (b: B) }', success({ a: 'A', b: 'B' })],
  ['( { ((a): :(b)), ( ( b ): B ) } )', success({ a: 'B', b: 'B' })],
  ['{ (a: :(")")), (")": (B)) }', success({ a: 'B', ')': 'B' })],
  [`/**/a/**/`, success('a')],
  ['hello//world', success('hello')],
  [`"hello//world"`, success('hello//world')],
  [`/**/{/**/a:/**/b/**/,/**/c:/**/d/**/}/**/`, success({ a: 'b', c: 'd' })],
  [
    `{
      // foo: bar
      "static data":"blah blah blah"
      "evaluated data": {
        0:"@runtime"
        1:{
          function:{
            0:"@apply"
            1:{
              function:{0:"@index", 1:{object:{0:"@lookup", 1:{key:object}}, query:{0:lookup}}}
              argument:"key which does not exist in runtime context"
            }
          }
        }
      }
    }`,
    success({
      'static data': 'blah blah blah',
      'evaluated data': { tag: 'none', value: {} },
    }),
  ],
  ['(a => :a)(A)', success('A')],
  ['{ a: (a => :a)(A) }', success({ a: 'A' })],
  ['{ a: ( a => :a )( A ) }', success({ a: 'A' })],
  ['(_ => B)(A)', success('B')],
  ['{ success }.0', success('success')],
  ['{ f: :identity }.f(success)', success('success')],
  ['{ f: :identity }.f({ a: success }).a', success('success')],
  [
    '{ f: :identity }.f({ g: :identity }).g({ a: success }).a',
    success('success'),
  ],
  ['{ a: { b: success } }.a.b', success('success')],
  [
    '{ a: { "b.c(d) e \\" {}": success } }.a."b.c(d) e \\" {}"',
    success('success'),
  ],
  ['(a => { b: :a }.b)(success)', success('success')],
  ['(a => { b: :a })(success).b', success('success')],
  ['{ success }/**/./**/0', success('success')],
  [
    `
      { a: { b: success } } // blah
        // blah
        .a // blah
        // blah
        .b // blah
    `,
    success('success'),
  ],
  [`/**/(/**/a/**/=>/**/:a/**/)(/**/output/**/)/**/`, success('output')],
  [':identity(output)', success('output')],
  [
    '{ a: a => :a, b: :a(A) }',
    result => {
      if (either.isLeft(result)) {
        assert.fail(result.value.message)
      }
      assert(typeof result.value === 'object')
      assert.deepEqual(
        orderedRecord.get(result.value, 'b'),
        option.makeSome('A'),
      )
    },
  ],
  [':boolean.or(false)(false)', success('false')],
  [':boolean.or(false)(true)', success('true')],
  [':boolean.or(true)(false)', success('true')],
  [':boolean.or(true)(true)', success('true')],
  [':boolean.and(false)(false)', success('false')],
  [':boolean.and(false)(true)', success('false')],
  [':boolean.and(true)(false)', success('false')],
  [':boolean.and(true)(true)', success('true')],
  [':match({ a: A })({ tag: a, value: {} })', success('A')],
  [':atom.prepend(a)(b)', success('ab')],
  [
    `{
      :atom.equals(hello)(hello)
      :atom.equals("")("")
      :atom.equals(hello)(Hello)
      :atom.equals("1.0")("1.00")
    }`,
    success({ 0: 'true', 1: 'true', 2: 'false', 3: 'false' }),
  ],
  [`:atom.length(hello)`, success('5')],
  [`:atom.length("")`, success('0')],
  [`:atom.length(👾) ~ 1`, success('1')],
  [`hello atom.contains ell`, success('true')],
  [`hello atom.contains xyz`, success('false')],
  [`hello atom.starts_with he`, success('true')],
  [`hello atom.starts_with lo`, success('false')],
  [`hello atom.ends_with lo`, success('true')],
  [`{ a, b, c } atom.join ", "`, success('a, b, c')],
  [`{} atom.join "-"`, success('')],
  [`"a,b,c" atom.split ","`, success({ 0: 'a', 1: 'b', 2: 'c' })],
  [`("a,b,c" atom.split ",") atom.join "-"`, success('a-b-c')],
  [`hello atom.split ""`, success({ 0: 'h', 1: 'e', 2: 'l', 3: 'l', 4: 'o' })],
  [`"a👾b" atom.split ""`, success({ 0: 'a', 1: '👾', 2: 'b' })],
  [`:atom.length("a👾b") ~ 3`, success('3')],
  [`"" atom.split ""`, success({})],
  [`"🇺🇸" atom.split ""`, success({ 0: '🇺', 1: '🇸' })],
  [`"a👾b" atom.split 👾`, success({ 0: 'a', 1: 'b' })],
  [`("a👾b" atom.split "") atom.join ""`, success('a👾b')],
  [`{ a: { nested: x } } atom.join ", "`, typeMismatch],
  [`:integer.add(1)(1)`, success('2')],
  [
    `:integer.add(one)(juan)`,
    output => {
      assert(either.isLeft(output))
    },
  ],
  [`:integer.add(42)(-1)`, success('41')],
  [`42 + -1`, success('41')],
  [`:integer.subtract(-1)(-1)`, success('0')],
  [`-1 - -1`, success('0')],
  [`2 - 1`, success('1')],
  [`1 - 2 - 3`, success('-4')],
  [`1 - (2 - 3)`, success('2')],
  [`(1 - 2) - 3`, success('-4')],
  [`:integer.multiply(2)(2)`, success('4')],
  [`2 * 2`, success('4')],
  [`2 * -2`, success('-4')],
  [`-2 * -2`, success('4')],
  [`2 * 0`, success('0')],
  [':flow(:atom.append(b))(:atom.append(a))(z)', success('zab')],
  [
    `@runtime { :object.lookup("key which does not exist in runtime context") }`,
    success({ tag: 'none', value: {} }),
  ],
  [
    `:object.lookup(output)({
      add_one: :integer.add(1)
      is_less_than_three: :integer.is_less_than(3)
      output: :is_less_than_three(:add_one(1))
    })`,
    success({
      tag: 'some',
      value: 'true',
    }),
  ],
  [
    `:integer.add(
      :integer.subtract(1)(2)
    )(
      :integer.subtract(2)(4)
    )`,
    success('3'),
  ],
  [
    `{
      true: true
      false: :boolean.not(:true)
    }`,
    success({ true: 'true', false: 'false' }),
  ],
  [
    `@runtime {
      :flow(
        :match({
          none: "environment does not exist"
          some: :flow(
            :match({
              none: "environment.lookup does not exist"
              some: :apply(PATH)
            })
          )(
            :object.lookup(lookup)
          )
        })
      )(
        :object.lookup(environment)
      )
    }`,
    output => {
      if (either.isLeft(output)) {
        assert.fail(output.value.message)
      }
      assert(typeof output.value === 'object')
      assert.deepEqual(
        orderedRecord.get(output.value, 'tag'),
        option.makeSome('some'),
      )
      option.match(orderedRecord.get(output.value, 'value'), {
        none: () => assert.fail('expected `value` property'),
        some: value => {
          assert.equal(typeof value, 'string')
        },
      })
    },
  ],
  [
    `(a => b => c => { :a, :b, :c })(0)(1)(2)`,
    success({ 0: '0', 1: '1', 2: '2' }),
  ],
  [
    `{
      a: {
        b: {
          c: z => {
            d: y => x => {
              e: {
                f: w => { g: { :z, :y, :x, :w, } }
              }
            }
          }
        }
      }
    }.a.b.c(a).d(b)(c).e.f(d).g`,
    success({ 0: 'a', 1: 'b', 2: 'c', 3: 'd' }),
  ],
  [
    `@runtime { context =>
      :context.environment.lookup(PATH)
    }`,
    output => {
      if (either.isLeft(output)) {
        assert.fail(output.value.message)
      }
      assert(typeof output.value === 'object')
      assert.deepEqual(
        orderedRecord.get(output.value, 'tag'),
        option.makeSome('some'),
      )
      option.match(orderedRecord.get(output.value, 'value'), {
        none: () => assert.fail('expected `value` property'),
        some: value => {
          assert.equal(typeof value, 'string')
        },
      })
    },
  ],
  [
    `@if {
      true
      "it works!"
      @panic
    }`,
    success('it works!'),
  ],
  [
    `{
      a
      b
      c
    }`,
    success({ 0: 'a', 1: 'b', 2: 'c' }),
  ],
  [
    `@runtime { context =>
      @if {
        :boolean.not(:boolean.is(:context))
        "it works!"
        @panic
      }
    }`,
    success('it works!'),
  ],
  [
    `{
      fibonacci: (n: :Integer) =>
        @if {
          :integer.is_less_than(2)(:n)
          then: :n
          else: :fibonacci(:n - 1) + :fibonacci(:n - 2)
        }
      result: :fibonacci(10)
    }.result`,
    success('55'),
  ],
  [
    `{
      +: (a: :Integer) => (b: :Integer) => :integer.add(:a)(:b)
      result: 1 + 1
     }.result`,
    success('2'),
  ],
  [`1 + 1`, success('2')],
  [`1 integer.add 1`, success('2')],
  [`(1 + 1)`, success('2')],
  [`(2 - 1) + (4 - 2)`, success('3')],
  [`0 < 1`, success('true')],
  [`1 > 0`, success('true')],
  [`0 < 0`, success('false')],
  [`0 > 0`, success('false')],
  [`1 < 0`, success('false')],
  [`0 > 1`, success('false')],
  [`((a: :Integer) => (1 + :a))(1)`, success('2')],
  [`2 |> (a => :a)`, success('2')],
  [`a atom.append b atom.append c`, success('abc')],
  [`b atom.append c atom.prepend a`, success('abc')],
  [`(b atom.append c) atom.prepend a`, success('abc')],
  [`a atom.append (c atom.prepend b)`, success('abc')],
  [
    `{ a: "it works!" } object.lookup a`,
    success({ tag: 'some', value: 'it works!' }),
  ],
  [`{ a: :identity }.a(1) + 1`, success('2')],
  [
    `1
      + 2
      + 3
      + 4`,
    success('10'),
  ],
  [
    `1 +
     2 +
     3 +
     4`,
    success('10'),
  ],
  [`{ f: _ => 5 % 3 }.f(whatever)`, success('2')],
  [
    `{
      one: 1
      two: :one + :one
    }.two`,
    success('2'),
  ],
  [
    `@runtime { context =>
      (
        PATH
          |> :context.environment.lookup
          |> :match({
            none: _ => "$PATH not set"
            some: :atom.prepend("PATH=")
          })
      )
    }`,
    result => {
      if (either.isLeft(result)) {
        assert.fail(result.value.message)
      }
      const output = result.value
      assert(typeof output === 'string')
      assert(output.startsWith('PATH='))
    },
  ],
  [
    `{
      one: 1
      two: 2
      three: 3
      four: 4
      ten: :one + :two + :three + :four
    }.ten`,
    success('10'),
  ],
  [
    `{
      add_ten: :integer.add(1) >> :integer.add(9)
    }.add_ten(0)`,
    success('10'),
  ],
  [`1 + @if { true, 9, 1 }`, success('10')],
  [
    `{
      1 + @if
      { true, 9, 1 }
    }.0`,
    success('10'),
  ],
  [
    `(
      :+(1)
        >> :+(2)
        >> :+(3)
        >> :+(4)
    )(0)`,
    success('10'),
  ],
  [
    `(
      :+(1) >>
      :+(2) >>
      :+(3) >>
      :+(4)
    )(0)`,
    success('10'),
  ],
  [`a |> :atom.append(b) |> :atom.append(c)`, success('abc')],
  [`a |> (:atom.append(b) >> :atom.append(c))`, success('abc')],
  [`:|>(:>>(:atom.append(c))(:atom.append(b)))(a)`, success('abc')],
  [
    `{
      append_bc: :atom.append(b) >> :atom.append(c)
      abc: a |> :append_bc
    }.abc`,
    success('abc'),
  ],
  [
    `{
      nested_option: {
        tag: some,
        value: {
          tag: some,
          value: {
            tag: some,
            value: "it works!"
          }
        }
      }
      output: :nested_option match {
        none: unreachable
        some: :identity
      } match {
        none: unreachable
        some: :identity
      } match {
        none: unreachable
        some: :identity
      }
    }.output`,
    success('it works!'),
  ],
  [':option.make_some(7) option.get_or_else 0', success('7')],
  [':option.none option.get_or_else 0', success('0')],
  [':option.make_some(value) option.get_or_else fallback', success('value')],
  [':option.none |> :option.get_or_else(fallback)', success('fallback')],
  [
    '((a: :Atom) => (:option.make_some(:a) option.get_or_else other) ~ :Atom)(hello)',
    success('hello'),
  ],
  [':option.is_some(:option.make_some(7))', success('true')],
  [':option.is_some(:option.none)', success('false')],
  [':option.is_none(:option.none)', success('true')],
  [':option.is_none(:option.make_some(7))', success('false')],
  [
    `:option.make_some(key) option.flat_map ((a: :Atom) => { key: value } object.lookup :a)`,
    success({ tag: 'some', value: 'value' }),
  ],
  [
    `((code: :Atom) =>
      ({ en: Hello, es: Hola } object.lookup :code option.get_or_else Hi) ~ :Atom
    )(es)`,
    success('Hola'),
  ],
  [`((x: { a: :Integer }) => :x.a)({ a: 42, b: extra })`, success('42')],
  [`((x: :Object) => :x)({ a: 1, b: {} })`, success({ a: '1', b: {} })],
  [
    // Lookups should never target keyword expression properties.
    `{
      {
        0: "it works!",
        result: { 0: "@lookup", 1: { 0: 0 } }
      }.result
      {
        1: "it works!",
        result: { 0: "@lookup", 1: { key: 1 } }
      }.result
      {
        key: "it works!",
        result: { 0: "@lookup", 1: { key: key } }
      }.result
      {
        body: "it works!",
        result: { 0: "@function", 1: { parameter: _, body: :body } }(_)
      }.result
      {
        parameter: "it works!",
        result: { 0: "@function", 1: { parameter: _, body: :parameter } }(_)
      }.result
      {
        1: "it works!",
        result: { 0: "@function", 1: { 0: _, 1: :1 } }(_)
      }.result
      {
        0: "it works!",
        result: { 0: "@function", 1: { 0: _, 1: :0 } }(_)
      }.result
      {
        1: "it works!",
        result: { 0: "@lookup", 1: { key: 1 } }
      }.result
      {
        1: "it does not work"
        result: {
          1: "it works!",
          result: { 0: "@lookup", 1: { key: 1 } }
        }.result
      }.result
    }`,
    success({
      0: 'it works!',
      1: 'it works!',
      2: 'it works!',
      3: 'it works!',
      4: 'it works!',
      5: 'it works!',
      6: 'it works!',
      7: 'it works!',
      8: 'it works!',
    }),
  ],
  [
    `{
      a: 42 assume :NaturalNumber
      b: true ~ :Boolean
      c: {} ~ :Object
      d: { z: -42 } assume { z: :Integer }
      e: "not a number" assume @union { :Integer, "not a number" }
    }`,
    success({
      a: '42',
      b: 'true',
      c: {},
      d: { z: '-42' },
      e: 'not a number',
    }),
  ],
  [`"not a number" assume :Integer`, typeMismatch],
  [
    `@runtime { context =>
      :context.environment.lookup("not a legal environment variable name")
    } match {
      none: _ => a
      some: _ => b
    }`,
    success('a'),
  ],
  [`((a: :Integer) => (b: :Integer) => :a + :b)(1)(1)`, success('2')],
  [
    `{
      f: (state: { current: :Integer, limit: :Integer }) => @if {
        :state.current > :state.limit
        then: "it works"
        else: :f({
          current: :state.current + 1
          limit: :state.limit
        })
      }
    }.f({ current: 0, limit: 3 })`,
    success('it works'),
  ],
  [
    `((inner: { a: :Boolean }) => @if {
      :inner.a
      then: "it works"
      else: { @panic }
    })({ a: true })`,
    success('it works'),
  ],
  [
    `((outer: :Boolean) =>
      ((inner: { value: :Boolean }) =>
        @if {
          condition: :boolean.or(:outer)(:inner.value)
          then: { @panic }
          else: :boolean.not(:inner.value)
        }
      )({ value: false })
    )(false)`,
    success('true'),
  ],
  [
    `((outer: :Boolean) =>
      ((inner: { value: :Boolean }) =>
        @if {
          condition: :boolean.or(:outer)(:inner.value)
          then: "it works"
          else: :boolean.not(:inner.value)
        }
      )({ value: false })
    )(true)`,
    success('it works'),
  ],
  [`(:boolean.not ~ (:Boolean ~> :Boolean))(false)`, success('true')],
  [`:boolean.not ~ (:Boolean ~> :Integer)`, typeMismatch],
  [
    `{ 1 integer.equals 1, 1 integer.equals 2 }`,
    success({ 0: 'true', 1: 'false' }),
  ],
  [
    `{ b: 1, c: 1, d: 1 } object.overlay { a: 1, b: 2, c: 3 }`,
    either.makeRight(
      orderedRecord.make([
        ['b', '2'],
        ['c', '3'],
        ['d', '1'],
        ['a', '1'],
      ]),
    ),
  ],
  [`:object.from_property(key)(value)`, success({ key: 'value' })],
  [`(1 + 1) ~ :Integer`, success('2')],
  [
    `{
      1 ~ :Something
      blah ~ :Something
      {} ~ :Something
      (a => :a) ~ :Something
    }`,
    assertSuccess,
  ],
  [`"arbitrary value" ~ :Nothing`, typeMismatch],
  [
    // `true | (false || true) | false`
    'true | false || true | false',
    success({
      0: '@union',
      // TODO: Consider normalizing away the duplicate `true`s.
      1: { 0: 'true', 1: 'true', 2: 'false' },
    }),
  ],
  [
    // `true | (false ~> (true | false))`
    'true | false ~> true | false',
    success({
      '0': '@union',
      '1': {
        '0': 'true',
        '1': {
          '0': '@function',
          '1': {
            parameter: { _: 'false' },
            body: { '0': '@union', '1': { '0': 'true', '1': 'false' } },
          },
        },
      },
    }),
  ],
  [
    // `true | (false => (true | false))`
    'true | false => true | false',
    success({
      '0': '@union',
      '1': {
        '0': 'true',
        '1': {
          '0': '@function',
          '1': {
            parameter: 'false',
            body: { '0': '@union', '1': { '0': 'true', '1': 'false' } },
          },
        },
      },
    }),
  ],
  [
    // `false | (true ~ true) | false`
    'false | true ~ true | false',
    success({
      '0': '@union',
      // TODO: Consider normalizing away the duplicate `false`s.
      '1': { '0': 'false', '1': 'true', '2': 'false' },
    }),
  ],
  [
    // `(1 + 1) ~ 2`
    '1 + 1 ~ 2',
    success('2'),
  ],
  [
    // `(1 + 1) | 3`
    '1 + 1 | 3',
    success({ '0': '@union', '1': { '0': '2', '1': '3' } }),
  ],
  [
    // `false | ((1 + 1) ~ 2) | true`
    'false | 1 + 1 ~ 2 | true',
    success({ '0': '@union', '1': { '0': 'false', '1': '2', '2': 'true' } }),
  ],
  [
    // `(a: :Atom) => ((:a ~ :Atom) ~ :Atom)`
    '(a: :Atom) => :a ~ :Atom ~ :Atom',
    assertSuccess,
  ],
  [
    // `(stuff: {}) => ((:stuff object.lookup a) ~ :Option(:Something))`
    '(stuff: {}) => :stuff object.lookup a ~ :Option(:Something)',
    assertSuccess,
  ],
  [`(stuff: {}) => :stuff object.lookup a ~ :Integer`, typeMismatch],
  [
    `(stuff: { [:Atom]: :Integer }) => :stuff object.lookup a ~ :Option(:Integer)`,
    assertSuccess,
  ],
  [
    `(stuff: { [:Atom]: :Integer }) => :stuff object.lookup a ~ :Option(:Boolean)`,
    typeMismatch,
  ],
  [
    `(stuff: { [a | b]: :Integer }) => :stuff object.lookup a ~ :Option(:Integer)`,
    assertSuccess,
  ],
  [
    `(stuff: { [a | b]: :Integer }) => :stuff object.lookup c ~ :Option(:Integer)`,
    typeMismatch,
  ],
  [
    `(stuff: { a: :Integer } | { a: :Boolean }) => :stuff object.lookup a ~ :Option(:Integer | :Boolean)`,
    assertSuccess,
  ],
  [
    `(stuff: { a: :Integer } | { a: :Boolean }) => :stuff object.lookup a ~ :Option(:Integer)`,
    typeMismatch,
  ],
  [
    `(stuff: {
      a: :Integer
      [:Atom]: :Nothing
    } | {
      b: :Boolean
      [:Atom]: :Nothing
    }) => :stuff object.lookup a ~ :Option(:Integer)`,
    assertSuccess,
  ],
  [
    `(stuff: { a: :Integer } | { b: :Boolean }) =>
      :stuff object.lookup a ~ :Option(:Integer)`,
    typeMismatch,
  ],
  [
    `((x: { [:Atom]: :Integer }) => :x)({ a: 42 }) ~ { a: 42 }`,
    success({ a: '42' }),
  ],
  [
    `(key: :NaturalNumber) =>
      (stuff: { [:NaturalNumber]: :Integer }) =>
        :stuff object.lookup :key ~ :Option(:Integer)`,
    assertSuccess,
  ],
  [
    `(key: :NaturalNumber) =>
      (stuff: { [:NaturalNumber]: :Integer }) =>
        :stuff object.lookup :key ~ :Option(:Boolean)`,
    typeMismatch,
  ],
  [
    `(key: :Atom) =>
      (stuff: { [:NaturalNumber]: :Integer }) =>
        :stuff object.lookup :key ~ :Option(:Integer)`,
    typeMismatch,
  ],
  [
    `(key: :NaturalNumber) =>
      (stuff: { [:Atom]: :Boolean, [:NaturalNumber]: :Integer }) =>
        :stuff object.lookup :key ~ :Option(:Integer)`,
    assertSuccess,
  ],
  [
    `(key: :NaturalNumber) =>
      (stuff: { foo: true, [:NaturalNumber]: :Integer }) =>
        :stuff object.lookup :key ~ :Option(:Integer)`,
    assertSuccess,
  ],
  [
    `{
      |>: (f: ?a ~> ?b) => (a: :a) => :f(:a)
      ab: a |> :atom.append(b)
      abc: :ab |> :atom.append(c)
    }.abc`,
    success('abc'),
  ],
  [
    `{
      |>: (f: ?a ~> ?b) => (a: :a) => :f(:a)
      three: 1 |> :integer.add(2)
      six: :three |> :integer.add(3)
    }.six`,
    success('6'),
  ],
  [
    `{
      <|: a => (f: :a ~> ?b) => :f(:a)
      ab: :atom.append(b) <| a
      abc: :atom.append(c) <| :ab
    }.abc`,
    success('abc'),
  ],
  [
    `{
      increment: @function {
        parameter: { a: :Integer }
        body: :a + 1
      }
      two: :increment(1)
    }.two`,
    success('2'),
  ],
  // `_` is an ignored property/parameter:
  [`(_ => :_)(a)`, invalidExpression],
  [`{ _: a, b: :_ }`, invalidExpression],
  // `_` can still be used as part of an `@index` query:
  [`{ _: a }._`, success('a')],
  [
    `{
      key1: b
      get_key2: _ => false
      {a:{b:{1:{2:{true:{false:{🎉:"it works"}}}}}}}.a.:key1.(1).(1 + 1).(:boolean.not(false)).(:get_key2(_)).(@runtime { _ => 🎉 })
    }.0`,
    success('it works'),
  ],
  [
    `(x: @object {
      properties: {}
      excess: {
        { :Atom, :Nothing }
        { :NaturalNumber, :Atom }
      }
    }) =>
      (:x ~ @object {
        properties: {}
        excess: {
          { :Atom, :Atom }
        }
      })`,
    assertSuccess,
  ],
  [
    `(x: @object {
      properties: {}
      excess: {
        { :Atom, :Atom }
      }
    }) =>
      (:x ~ @object {
        properties: {}
        excess: {
          { :Atom, :Atom }
          { :NaturalNumber, :Integer }
        }
      })`,
    typeMismatch,
  ],
  [
    `(x: @object {
      properties: { a: :Integer }
      excess: {
        { :Atom, :Atom }
        { :NaturalNumber, :Integer }
      }
    }) =>
      (:object.lookup(5)(:x) ~ :Option(:Integer))`,
    assertSuccess,
  ],
  [
    `(o: :Object) => {
      first: :o object.lookup 0
      return: :identity(:first.value)
    }.return`,
    assertSuccess,
  ],
  [
    `{
      deferred: @runtime { _context => { value: 1 } }
      out: :deferred.value
    }`,
    success({ deferred: { value: '1' }, out: '1' }),
  ],
  [
    `(o: :Object) => {
      first: :o object.lookup 0
      return: :first.value + 1
    }.return`,
    typeMismatch,
  ],
  [
    `(o: :Object) => {
      first: :o object.lookup 0
      return: :first.value(1)
    }.return`,
    invalidExpression,
  ],
  [
    `(x: { a: :Atom }) => (y: { b: :Atom }) =>
      (:object.overlay(:x)(:y) ~ @object {
        properties: { a: :Atom, b: :Something }
        excess: {
          { :Atom, :Nothing }
        }
      })`,
    typeMismatch,
  ],
  [
    `:match({ a: (v: :Integer) => :v })({ tag: a, value: hello })`,
    typeMismatch,
  ],
  [
    `:match({ a: (v: :Integer) => :v + 1 })({ tag: a, value: 41 })`,
    success('42'),
  ],
  [
    `((x: { [:Atom]: :Integer }) => :x)({ a: 1, b: 2 })`,
    success({ a: '1', b: '2' }),
  ],
  [`((x: { [:Atom]: :Integer }) => :x)({ a: hello })`, typeMismatch],
  [
    `((x: { [:Atom]: :Nothing, a: :Integer }) => :x)({ a: 1, b: 2 })`,
    typeMismatch,
  ],
  [
    `((x: { [:Atom]: :Nothing, a: :Integer }) => :x)({ a: 1 })`,
    success({ a: '1' }),
  ],
  [`{ a: 1 } ~ { [:Atom]: :Atom }`, success({ a: '1' })],
  [`{ a: {} } ~ { [:Atom]: :Atom }`, typeMismatch],
  [
    `{ 1: hello, name: x } ~ { [:NaturalNumber]: :Atom }`,
    success({ 1: 'hello', name: 'x' }),
  ],
  [`{ 1: {}, name: x } ~ { [:NaturalNumber]: :Atom }`, typeMismatch],
  [
    `{ 1: hello, name: x } ~ { [:Atom]: :Nothing, [:NaturalNumber]: :Atom }`,
    typeMismatch,
  ],
  [
    `{ 1: hello } ~ { [:Atom]: :Atom, [:NaturalNumber]: :Integer }`,
    typeMismatch,
  ],
  [
    `{ x: hello } ~ { [:Atom]: :Atom, [:NaturalNumber]: :Integer }`,
    success({ x: 'hello' }),
  ],
  [`{ a: hello } ~ { [a]: :Nothing, a: :Atom }`, success({ a: 'hello' })],
  [
    `{ a: hello, b: x } ~ { a: :Atom, [@union { a, b }]: :Nothing }`,
    typeMismatch,
  ],
  [`{} ~ { [:Atom]: :Atom, [:Atom]: :Nothing }`, success({})],
  [`{} ~ { [:Atom]: a, [:Atom]: b }`, success({})],
  [
    `{ a: 1, b: 2 } ~ @union { 0: { [:Atom]: :Nothing, a: :Integer } }`,
    typeMismatch,
  ],
  [`{ a: 1 } ~ {| a: :Integer |}`, success({ a: '1' })],
  [`{ a: 1 } ~ {||}`, typeMismatch],
  // Excess clause key types much be a subtype of `atom`.
  [`(a: { [:Something]: a }) => _`, typeMismatch],
  [`(a: { [{}]: b }) => _`, typeMismatch],
  [
    `{
      sum: (start_key: :NaturalNumber) =>
        (sequence: { [:NaturalNumber]: :Integer }) =>
          :sequence object.lookup :start_key option.map (
            (value1: :Integer) =>
              :sequence sum (:start_key + 1) match {
                some: (value2: :Integer) => :value1 + :value2
                none: _ => :value1
              }
          )
      results: {
        from_start: :sum(0)({ 10, 20, 30 })
        from_middle: :sum(1)({ 10, 20, 30 })
        past_end: :sum(3)({ 10, 20, 30 })
        empty: :sum(0)({})
      }
    }.results`,
    success({
      from_start: { tag: 'some', value: '60' },
      from_middle: { tag: 'some', value: '50' },
      past_end: { tag: 'none', value: {} },
      empty: { tag: 'none', value: {} },
    }),
  ],
  [
    `{
      sum: (start_key: :NaturalNumber) =>
        (sequence: { [:NaturalNumber]: :Integer }) =>
          :sequence object.lookup :start_key option.map (
            (value1: :Integer) =>
              :sequence sum (:start_key + 1) match {
                some: (value2: :Integer) => :value1 + :value2
                none: _ => :value1
              }
          )
      numbers: @runtime { _context => { 10, 20, 30 } }
      start: @runtime { _context => 0 }
      output: :numbers sum :start
    }.output`,
    success({ tag: 'some', value: '60' }),
  ],
  [
    `{
      even: (n: :Integer) => @if { :n < 1, true, else: :odd(:n - 1) }
      odd: (n: :Integer) => @if { :n < 1, false, else: :even(:n - 1) }
      results: {
        six: :even(6)
        seven: :even(7)
        mapped: :option.make_some(6) option.map :even
      }
    }.results`,
    success({
      six: 'true',
      seven: 'false',
      mapped: { tag: 'some', value: 'true' },
    }),
  ],

  // PascalCased names like `:Boolean` are the idiomatic way to name types, but
  // standard library types are also reachable at `:module.type`.
  [`hello ~ :atom.type ~ :Atom`, success('hello')],
  [`(:boolean.not ~ (:boolean.type ~> :Boolean))(false)`, success('true')],
  [`(1 + 1) ~ :integer.type ~ :Integer`, success('2')],
  [`42 ~ :natural_number.type ~ :NaturalNumber`, success('42')],
  [
    `:option.make_some(1) ~ :option.type(:Integer)`,
    success({ tag: 'some', value: '1' }),
  ],
  [`{ a: 1 } ~ :object.type ~ :Object`, success({ a: '1' })],
  [`{} ~ :something.type ~ :Something`, success({})],
  [`{ a: 1 } ~ { [:atom.type]: :Nothing, a: :Integer }`, success({ a: '1' })],
  [`((a: :atom.type) => :a) ~ (:Atom ~> :Atom)`, assertSuccess],
])
