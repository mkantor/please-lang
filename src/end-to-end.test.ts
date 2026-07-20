import either from '@matt.kantor/either'
import option from '@matt.kantor/option'
import assert from 'node:assert'
import { formatError } from './language/cli/error-formatting.js'
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

  const runtimeOutput: ProgramResult = either.flatMap(program, evaluate)

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
    `((a: :natural_number.type) => {
      my_function: (b: :natural_number.type) => @if {
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
      count: (limit: :natural_number.type) => {
        count_internal: (state: { current: :integer.type, output: :atom.type }) =>
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
      fibonacci: (n: :integer.type) =>
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
      +: (a: :integer.type) => (b: :integer.type) => :integer.add(:a)(:b)
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
  [`((a: :integer.type) => (1 + :a))(1)`, success('2')],
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
    '((a: :atom.type) => (:option.make_some(:a) option.get_or_else other) ~ :atom.type)(hello)',
    success('hello'),
  ],
  [':option.is_some(:option.make_some(7))', success('true')],
  [':option.is_some(:option.none)', success('false')],
  [':option.is_none(:option.none)', success('true')],
  [':option.is_none(:option.make_some(7))', success('false')],
  [
    `:option.make_some(key) option.flat_map ((a: :atom.type) => { key: value } object.lookup :a)`,
    success({ tag: 'some', value: 'value' }),
  ],
  [
    `((code: :atom.type) =>
      ({ en: Hello, es: Hola } object.lookup :code option.get_or_else Hi) ~ :atom.type
    )(es)`,
    success('Hola'),
  ],
  [`((x: { a: :integer.type }) => :x.a)({ a: 42, b: extra })`, success('42')],
  [`((x: :object.type) => :x)({ a: 1, b: {} })`, success({ a: '1', b: {} })],
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
      a: 42 assume :natural_number.type
      b: true ~ :boolean.type
      c: {} ~ :object.type
      d: { z: -42 } assume { z: :integer.type }
      e: "not a number" assume @union { :integer.type, "not a number" }
    }`,
    success({
      a: '42',
      b: 'true',
      c: {},
      d: { z: '-42' },
      e: 'not a number',
    }),
  ],
  [`"not a number" assume :integer.type`, typeMismatch],
  [
    `@runtime { context =>
      :context.environment.lookup("not a legal environment variable name")
    } match {
      none: _ => a
      some: _ => b
    }`,
    success('a'),
  ],
  [`((a: :integer.type) => (b: :integer.type) => :a + :b)(1)(1)`, success('2')],
  [
    `{
      f: (state: { current: :integer.type, limit: :integer.type }) => @if {
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
    `((inner: { a: :boolean.type }) => @if {
      :inner.a
      then: "it works"
      else: { @panic }
    })({ a: true })`,
    success('it works'),
  ],
  [
    `((outer: :boolean.type) =>
      ((inner: { value: :boolean.type }) =>
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
    `((outer: :boolean.type) =>
      ((inner: { value: :boolean.type }) =>
        @if {
          condition: :boolean.or(:outer)(:inner.value)
          then: "it works"
          else: :boolean.not(:inner.value)
        }
      )({ value: false })
    )(true)`,
    success('it works'),
  ],
  [`(:boolean.not ~ (:boolean.type ~> :boolean.type))(false)`, success('true')],
  [`:boolean.not ~ (:boolean.type ~> :integer.type)`, typeMismatch],
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
  [`(1 + 1) ~ :integer.type`, success('2')],
  [
    `{
      1 ~ :something.type
      blah ~ :something.type
      {} ~ :something.type
      (a => :a) ~ :something.type
    }`,
    assertSuccess,
  ],
  [`"arbitrary value" ~ :nothing.type`, typeMismatch],
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
        parameter: { a: :integer.type }
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
        { :atom.type, :nothing.type }
        { :natural_number.type, :atom.type }
      }
    }) =>
      (:x ~ @object {
        properties: {}
        excess: {
          { :atom.type, :atom.type }
        }
      })`,
    assertSuccess,
  ],
  [
    `(x: @object {
      properties: {}
      excess: {
        { :atom.type, :atom.type }
      }
    }) =>
      (:x ~ @object {
        properties: {}
        excess: {
          { :atom.type, :atom.type }
          { :natural_number.type, :integer.type }
        }
      })`,
    typeMismatch,
  ],
  [
    `(x: @object {
      properties: { a: :integer.type }
      excess: {
        { :atom.type, :atom.type }
        { :natural_number.type, :integer.type }
      }
    }) =>
      (:object.lookup(5)(:x) ~ :option.type(:integer.type))`,
    assertSuccess,
  ],
  [
    `(x: { a: :atom.type }) => (y: { b: :atom.type }) =>
      (:object.overlay(:x)(:y) ~ @object {
        properties: { a: :atom.type, b: :something.type }
        excess: {
          { :atom.type, :nothing.type }
        }
      })`,
    typeMismatch,
  ],
  [
    `:match({ a: (v: :integer.type) => :v })({ tag: a, value: hello })`,
    typeMismatch,
  ],
  [
    `:match({ a: (v: :integer.type) => :v + 1 })({ tag: a, value: 41 })`,
    success('42'),
  ],
  [
    `((x: { [:atom.type]: :integer.type }) => :x)({ a: 1, b: 2 })`,
    success({ a: '1', b: '2' }),
  ],
  [`((x: { [:atom.type]: :integer.type }) => :x)({ a: hello })`, typeMismatch],
  [
    `((x: { [:atom.type]: :nothing.type, a: :integer.type }) => :x)({ a: 1, b: 2 })`,
    typeMismatch,
  ],
  [
    `((x: { [:atom.type]: :nothing.type, a: :integer.type }) => :x)({ a: 1 })`,
    success({ a: '1' }),
  ],
  [`{ a: 1 } ~ { [:atom.type]: :atom.type }`, success({ a: '1' })],
  [`{ a: {} } ~ { [:atom.type]: :atom.type }`, typeMismatch],
  [
    `{ 1: hello, name: x } ~ { [:natural_number.type]: :atom.type }`,
    success({ 1: 'hello', name: 'x' }),
  ],
  [`{ 1: {}, name: x } ~ { [:natural_number.type]: :atom.type }`, typeMismatch],
  [
    `{ 1: hello, name: x } ~ { [:atom.type]: :nothing.type, [:natural_number.type]: :atom.type }`,
    typeMismatch,
  ],
  [
    `{ 1: hello } ~ { [:atom.type]: :atom.type, [:natural_number.type]: :integer.type }`,
    typeMismatch,
  ],
  [
    `{ x: hello } ~ { [:atom.type]: :atom.type, [:natural_number.type]: :integer.type }`,
    success({ x: 'hello' }),
  ],
  [
    `{ a: hello } ~ { [a]: :nothing.type, a: :atom.type }`,
    success({ a: 'hello' }),
  ],
  [
    `{ a: hello, b: x } ~ { a: :atom.type, [@union { a, b }]: :nothing.type }`,
    typeMismatch,
  ],
  [
    `{} ~ { [:atom.type]: :atom.type, [:atom.type]: :nothing.type }`,
    success({}),
  ],
  [`{} ~ { [:atom.type]: a, [:atom.type]: b }`, success({})],
  [
    `{ a: 1, b: 2 } ~ @union { 0: { [:atom.type]: :nothing.type, a: :integer.type } }`,
    typeMismatch,
  ],
])
