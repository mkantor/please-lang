import either, { type Either } from '@matt.kantor/either'
import assert from 'node:assert'
import * as orderedRecord from '../../ordered-record.js'
import { withPhantomData } from '../../phantom-data.js'
import { testCases, toSyntaxTree } from '../../test-utilities.test.js'
import type { JsonValue } from '../../utility-types.js'
import type { ElaborationError } from '../errors.js'
import type { Molecule } from '../parsing.js'
import { parse } from '../parsing/parser.js'
import type { Output } from '../semantics.js'
import { compile } from './compiler.js'

const success = (
  expectedOutput: JsonValue | Molecule,
): Either<ElaborationError, Output> =>
  either.makeRight(
    withPhantomData<never>()(
      orderedRecord.isOrderedRecord(expectedOutput) ? expectedOutput : (
        toSyntaxTree(expectedOutput)
      ),
    ),
  )

const canonicalizeAndCompile = (input: JsonValue) =>
  compile(toSyntaxTree(input))

testCases(
  canonicalizeAndCompile,
  input => `compiling \`${JSON.stringify(input)}\``,
)('compiler', [
  ['Hello, world!', success('Hello, world!')],
  [
    {
      true1: true,
      true2: [
        '@apply',
        [['@index', [['@lookup', ['boolean']], ['not']]], false],
      ],
      false1: 'false',
      false2: [
        '@apply',
        [['@index', [['@lookup', ['boolean']], ['is']]], 'not a boolean'],
      ],
    },
    success({
      true1: 'true',
      true2: 'true',
      false1: 'false',
      false2: 'false',
    }),
  ],
  [
    ['@runtime', [['@lookup', ['identity']]]],
    success({
      0: '@runtime',
      1: { function: { 0: '@lookup', 1: { key: 'identity' } } },
    }),
  ],
  [
    [
      '@runtime',
      [
        [
          '@apply',
          [
            ['@lookup', ['identity']],
            ['@lookup', ['identity']],
          ],
        ],
      ],
    ],
    success({
      0: '@runtime',
      1: { function: { 0: '@lookup', 1: { key: 'identity' } } },
    }),
  ],
  [
    [['@lookup', ['compose']]],
    output => {
      assert(either.isLeft(output))
    },
  ],
  [
    ['@runtime', [['@index', [['@lookup', ['boolean']], ['not']]]]],
    output => {
      assert(either.isLeft(output))
      assert(output.value.kind === 'typeMismatch')
    },
  ],
  [
    [
      '@runtime',
      [
        [
          '@apply',
          [
            ['@lookup', ['identity']],
            ['@index', [['@lookup', ['boolean']], ['not']]],
          ],
        ],
      ],
    ],
    output => {
      assert(either.isLeft(output))
      assert(output.value.kind === 'typeMismatch')
    },
  ],
  [
    [
      '@runtime',
      [
        [
          '@apply',
          [
            [
              '@apply',
              [
                ['@lookup', ['flow']],
                ['@lookup', ['identity']],
              ],
            ],
            ['@lookup', ['identity']],
          ],
        ],
      ],
    ],
    success({
      0: '@runtime',
      1: {
        function: {
          0: '@apply',
          1: {
            function: {
              0: '@apply',
              1: {
                function: { 0: '@lookup', 1: { key: 'flow' } },
                argument: { 0: '@lookup', 1: { key: 'identity' } },
              },
            },
            argument: { 0: '@lookup', 1: { key: 'identity' } },
          },
        },
      },
    }),
  ],
  [
    ['@runtime', [['@index', [['@lookup', ['boolean']], ['not']]]]],
    output => {
      assert(either.isLeft(output))
      assert(output.value.kind === 'typeMismatch')
    },
  ],
  [
    {
      0: '@runtime',
      1: {
        function: {
          0: '@apply',
          1: {
            function: {
              0: '@index',
              1: {
                object: { 0: '@lookup', 1: { key: 'object' } },
                query: { 0: 'lookup' },
              },
            },
            argument: 'key which does not exist in runtime context',
          },
        },
      },
    },
    success({
      0: '@runtime',
      1: {
        function: {
          0: '@apply',
          1: {
            function: {
              0: '@index',
              1: {
                object: { 0: '@lookup', 1: { key: 'object' } },
                query: { 0: 'lookup' },
              },
            },
            argument: 'key which does not exist in runtime context',
          },
        },
      },
    }),
  ],
  [
    { a: ['@lookup', ['b']], b: ['@index', [[42], ['0']]] },
    success({ a: '42', b: '42' }),
  ],
])

const parseAndCompile = (input: string) => either.flatMap(parse(input), compile)

testCases(
  parseAndCompile,
  input => `parsing & compiling \`${JSON.stringify(input)}\``,
)('parser + compiler', [
  // NOTE: @runtime is used in many of these test cases to defer elaboration.
  // Otherwise some of these programs would reduce at compile time such that
  // they don't assert anything interesting (e.g. type inference; it's more
  // useful to test `(a => :a)(1) ~ 1` in an unelaborated form than what would
  // happen after compile-time evaluation: `1 ~ 1`).

  ['{ a: :b, b: :c, c: 42 }', success({ a: '42', b: '42', c: '42' })],

  [
    '{ a: false, b: { :a, a: true } }',
    success({ a: 'false', b: { 0: 'true', a: 'true' } }),
  ],

  ['{ a: :b, b: { 42 }.0 }', success({ a: '42', b: '42' })],

  ['{ a: :b, b: :identity(42) }', success({ a: '42', b: '42' })],

  [
    '{ a: @if { true, true, 42 }, :a }',
    success(
      orderedRecord.make([
        ['a', 'true'],
        ['0', 'true'],
      ]),
    ),
  ],

  [
    '{ a: @if { true, true, 42 }, b: :a, :b }',
    success(
      orderedRecord.make([
        ['a', 'true'],
        ['b', 'true'],
        ['0', 'true'],
      ]),
    ),
  ],

  [
    '{ a: :identity(1), b: :identity(2), :a, :b }',
    success(
      orderedRecord.make([
        ['a', '1'],
        ['b', '2'],
        ['0', '1'],
        ['1', '2'],
      ]),
    ),
  ],

  [
    '@runtime { _ => 42 ~ :integer.type }',
    success({
      '0': '@runtime',
      '1': {
        function: {
          '0': '@function',
          '1': { parameter: '_', body: '42' },
        },
      },
    }),
  ],

  [
    '@runtime { _ => { some_integer: 42, same_integer: :some_integer ~ :integer.type } }',
    success({
      '0': '@runtime',
      '1': {
        function: {
          '0': '@function',
          '1': {
            parameter: '_',
            body: { some_integer: '42', same_integer: '42' },
          },
        },
      },
    }),
  ],

  [
    '@runtime { context => :context.program.start_time ~ :atom.type }',
    success({
      '0': '@runtime',
      '1': {
        function: {
          '0': '@function',
          '1': {
            parameter: 'context',
            body: {
              '0': '@index',
              '1': {
                object: {
                  '0': '@lookup',
                  '1': { key: 'context' },
                },
                query: {
                  '0': 'program',
                  '1': 'start_time',
                },
              },
            },
          },
        },
      },
    }),
  ],

  [
    '@runtime { _ => 42 ~ :boolean.type }',
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    '@runtime { context => :context.program.start_time ~ :object.type }',
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    '@runtime { context => { a: :context.program.start_time, :a ~ :atom.type } }',
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    '@runtime { context => :context.program.start_time } ~ :atom.type',
    success({
      '0': '@runtime',
      '1': {
        function: {
          '0': '@function',
          '1': {
            parameter: 'context',
            body: {
              '0': '@index',
              '1': {
                object: {
                  '0': '@lookup',
                  '1': { key: 'context' },
                },
                query: {
                  '0': 'program',
                  '1': 'start_time',
                },
              },
            },
          },
        },
      },
    }),
  ],

  [
    '@runtime { context => :context.program.start_time } ~ :atom.type',
    success({
      '0': '@runtime',
      '1': {
        function: {
          '0': '@function',
          '1': {
            parameter: 'context',
            body: {
              '0': '@index',
              '1': {
                object: {
                  '0': '@lookup',
                  '1': { key: 'context' },
                },
                query: {
                  '0': 'program',
                  '1': 'start_time',
                },
              },
            },
          },
        },
      },
    }),
  ],

  [
    '@runtime { context => { a: :context.program.start_time } ~ { a: :atom.type } }',
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    '{ a: @runtime { context => :context.program.start_time }, :a ~ :atom.type }',
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    '@runtime { context => { a: :context.program.start_time, b: :a, :b ~ :atom.type } }',
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    '{ a: @runtime { context => :context.program.start_time }, b: :a, :b ~ :atom.type }',
    result => {
      assert(either.isRight(result))
    },
  ],

  ['@if { true, true, 42 } ~ :boolean.type', success('true')],

  [
    '{ a: 42, b: :a, @runtime { _ => :b } ~ :integer.type }',
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    '{ a: 42, (_ => :a)(@runtime { _ => _ }) ~ :integer.type }',
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    '{ a: 42, b: _ => :a, c: :b(_) ~ :integer.type }',
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    '{ a: 42, b: _ => :a, :b(@runtime { _ => _ }) ~ :integer.type }',
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    '{ a: 42, b: _ => :a }.b(_) ~ :integer.type',
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    '{ a: _ => 42, b: :a, :b(@runtime { _ => _ }) ~ :integer.type }',
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    '(_ => 42) ~ (:something.type ~> :integer.type)',
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    '(_ => 42) ~ (:something.type ~> :boolean.type)',
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    '{ a: 42, f: _ => :a, @runtime { _ => :f } ~ (:something.type ~> :integer.type) }',
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    '{ a: @if { true, true, 42 }, @runtime { _ => :a } ~ :boolean.type }',
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    '{ a: true, b: 42, @runtime { _ => @if { true, :a, :b } } ~ :boolean.type }',
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    '@if { @runtime { _ => true }, 1, "not an integer" } ~ :integer.type',
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `@if {
      @runtime { context =>
        :context.program.start_time atom.equals "arbitrary atom"
      }
      then: 1
      else: "not an integer"
    } ~ (1 | "not an integer")`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `:boolean.not("not a boolean")`,
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `:boolean.not(@runtime { _ => "not a boolean" })`,
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `@runtime { _ => :integer.is_greater_than(1)(2) } ~ :boolean.type`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `@runtime { _ => 1 |> :identity } ~ 1`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    ':identity(@runtime { _ => 1 }) ~ 1',
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    '{ f: :identity >> :identity, :f(@runtime { _ => 1 }) ~ 1 }',
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `(:identity >> :identity)(@runtime { _ => 1 }) ~ 1`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    ':flow(@runtime { _ => "not a function" })',
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    // `:f` isn't necessarily a function, e.g. `:oops("not a function")` is a
    // legal call.
    '{ oops: f => :f(42) }',
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'invalidExpression')
    },
  ],

  [
    '(a => :a)(@runtime { _ => 1 }) ~ 1',
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `@runtime { context => (a => :a)(:context.program.start_time) } ~ :atom.type`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `@runtime { context => (a => :a)(:context.program.start_time) } ~ :integer.type`,
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `@runtime { context => (a => :context.log(:a))(1) } ~ 1`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `@runtime { context => (a => :context.log(:a))(1) } ~ 2`,
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `{
      integer_identity: @function {
        parameter: { a: :integer.type }
        body: :a
      }
      :integer_identity("not an integer")
    }`,
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `a => :a ~ :boolean.type`,
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    // `:a` is a lookup of an unannotated parameter, so its inferred type is an
    // unconstrained type parameter, which is not assignable to `:integer.type`.
    // If the language eventually gains Hindley–Milner-style inference this
    // program may become valid (and this test case will need updating).
    `(a => :integer.add(1)(:a))(1)`,
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `@if {
      @runtime { context =>
        :context.program.start_time atom.equals "arbitrary atom"
      }
      then: 42
      else: @panic
    } ~ :integer.type`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `@if { @runtime { _ => true }, :boolean.not("not a boolean"), oops }`,
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `@if { @runtime { _ => true }, "not a boolean" ~ :boolean.type, oops }`,
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `{ a: {}, @runtime { _ => :a.non_existent_property } }`,
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `a => :a.non_existent_property`,
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `{ a: {}, @runtime { _ => @if { @runtime { _ => true }, :a.non_existent_property, oops } } }`,
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `{ a: { b: {} }, @runtime { _ => :a.b.non_existent_property } }`,
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `{ a: "not an object", @runtime { _ => :a.non_existent_property } }`,
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `{ a: { b: 1 }, @runtime { _ => :a.non_existent_property.another_non_existent_property } }`,
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `{ a: :identity, @runtime { _ => :a.non_existent_property } }`,
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `@if { @runtime { _ => "not a boolean" }, a, b }`,
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `@runtime { (context: "not the correct type") => {} }`,
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `@runtime { (context: { program: { start_time: yesterday } }) => {} }`,
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [`((a: :integer.type) => :a)(42) ~ 42`, success('42')],

  [
    `{
      swap: (parameters: { :something.type, :something.type }) =>
        { :parameters.1, :parameters.0 }
    }.swap({ a, b }) ~ { b, a }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{
      constrain_function: (f: { a: :atom.type } ~> :atom.type) => :f({ a: hello })
      should_use_contextual_type: :constrain_function(x => :x.a)
    }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{
      f: (x: { a: :something.type }) => {}
      :f({ a: a })
    }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{
      type: :boolean.type
      f: (x: { a: :type }) => {}
      :f({ a: true })
    }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{
      f: (x: 1 + 1) => {}
      :f(2)
    }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{
      a: 2
      b: { a: 1, :a }
      :b.0 ~ 1
    }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `(_ => (f: :atom.type) => :f) ~ (:something.type ~> (:atom.type ~> :atom.type))`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `(@runtime { _ =>
      { constrain_function: (f: { a: :atom.type } ~> :atom.type) => :f({ a: hello }) }
    }).constrain_function(x => :x.a) ~ :atom.type`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    '(_ => 42) ~ ((_: :something.type) => :integer.type)',
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    '(_ => 42) ~ ((_: :something.type) => :boolean.type)',
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    '{ a: 42, f: _ => :a, :f ~ ((_: :something.type) => :integer.type) }',
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    '((a: :boolean.type) => 42) ~ ((a: :boolean.type) => :integer.type)',
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    '((a: :boolean.type) => :a) ~ ((a: :boolean.type) => :boolean.type)',
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    '((a: :boolean.type) => :boolean.not(:a)) ~ ((a: :boolean.type) => :boolean.type)',
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    ':boolean.not ~ ((a: :boolean.type) => :boolean.type)',
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `((x: :atom.type) => @if {
       @runtime { context => :context.program.start_time atom.equals foo }
       { deeper: :x }
       foo
     }) ~ ((y: :atom.type) => { deeper: :y })`,
    result => {
      assert(either.isLeft(result))
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `{
      consume: (g: ((y: :atom.type) => { deeper: :y })) =>
        @runtime { _ => :g(hello).deeper }
      :consume((x: :atom.type) => @if {
        @runtime { context => :context.program.start_time atom.equals foo }
        { deeper: :x }
        foo
      })
    }`,
    result => {
      assert(either.isLeft(result))
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `((x: :atom.type) => ({ deeper: :x } | foo)) ~ ((y: :atom.type) => ({ deeper: :y } | foo))`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `((x: :atom.type) => @if {
       @runtime { context => :context.program.start_time atom.equals foo }
       { deeper: :x }
       foo
     }) ~ ((y: :atom.type) => ({ deeper: :y } | foo))`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `(x: :atom.type) => (:x ~ :x)`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `(x: :atom.type) =>
      (@if {
         @runtime { context => :context.program.start_time atom.equals foo }
         :x
         foo
       } ~ (:x | foo))`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `(x: :atom.type) => (:x ~ (:x | foo))`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `(x: :natural_number.type) => (:x ~ (:integer.type | foo))`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `a => (x: (:a | :a)) => (:x ~ :a)`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `a => b => (x: (:a | :a)) => (:x ~ :b)`,
    result => {
      assert(either.isLeft(result))
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `{
      apply_to_1: (identity: (a => :a)) => :identity(1)
      :apply_to_1(:identity) ~ 1
    }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{
      apply_to_1:
        (integer_identity: (a: :integer.type) => :a) => :integer_identity(1)
    }.apply_to_1(a => :a) ~ 1`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `((a: @runtime { _ => 1 } + 1) => _)(2)`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{
      dynamically_constrained_identity: a => (f: :a ~> :a) => :f(:a)
      :dynamically_constrained_identity(a)(_a => a) ~ a
    }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{
      dynamically_constrained_identity: a => (f: :a ~> :a) => :f(:a)
      :dynamically_constrained_identity(a)(_a => oops)
      //                                         ^ not \`a\`
    }`,
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `{
      identity: a => :a
      id_of_42: :identity(42)
      :id_of_42 ~ 42
    }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{
      combine: a => b => { :a, :b }
      partial: :combine(1)
      :partial(true) ~ { 1, true }
    }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{
      identity: a => :a
      id_alias: :identity
      :id_alias(42) ~ 42
    }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{
      f: (x: @hole { name: t, constraint: { assignableTo: :something.type } })
        => :x
      :f(42) ~ 42
    }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{
      apply: a => (f: :a ~> ?b) => :f(:a)
      ab: :apply(a)(:atom.append(b))
    }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{
      apply2: a => (f: :a ~> ?b) => (g: :b ~> ?c) => :g(:f(:a))
      :apply2(42)(_n => true)(_b => x) ~ x
    }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{
      pipe: (f: ?a ~> ?b) => (a: :a) => :f(:a)
      ab: :pipe(:atom.append(b))(a)
    }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{
      pipe: (f: ?a ~> ?b) => (a: :a) => :f(:a)
      bad: :pipe(:integer.add(1))(a)
    }`,
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `{
      f: (x: (?b: :atom.type)) => :x
      :f(hello) ~ hello
    }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `((x: ?) => :x)(42) ~ 42`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{
      outer: a => (f: :a ~> ?b) => (g: :b ~> ?b) => :g
    }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `(config: { x: ?a, y: ?a }) => :config`,
    result => {
      assert(either.isLeft(result))
      assert.deepEqual(result.value.kind, 'invalidExpression')
    },
  ],

  [
    `_ => @panic`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `@runtime { _ => @panic }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{ obj: { a: 1, b: 2 }, get: (key: a | b) => :obj.:key ~ (1 | 2) }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{ obj: { a: 1, b: 2 }, get: (key: a | b) => :obj.(:key) ~ 1 }`,
    result => {
      assert(either.isLeft(result))
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `{ x: { a: 1 }, y: :x.({}) }`,
    result => {
      assert(either.isLeft(result))
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `{
      f: (u: { x: 1 } | done) => :u.x
      r: :f(@runtime { _ => done }) ~ 1
    }`,
    result => {
      assert(either.isLeft(result))
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `{
      f: (u: { x: 1 } | { y: 2 }) => :u.x
      r: :f(@runtime { _ => { y: 2 } }) ~ 1
    }`,
    result => {
      assert(either.isLeft(result))
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `{
      a: @if {
        @runtime { context => :context.program.start_time atom.equals x }
        { x: 1 }
        done
      }
      r: :a.x ~ 1
    }`,
    result => {
      assert(either.isLeft(result))
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `{ obj: { a: 1 }, get: (key: a | b) => :obj.:key }`,
    result => {
      assert(either.isLeft(result))
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `{ f: (u: { x: { deep: 1 } } | { x: 2 }) => :u.x.deep }`,
    result => {
      assert(either.isLeft(result))
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `{
      f: (u: { x: 1 } | { x: 2, y: 3 }) => :u.x
      r: :f(@runtime { _ => { x: 2, y: 3 } }) ~ (1 | 2)
    }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{
      not: (a: :boolean.type) => @if { :a, false, true }
      :not(@runtime { context =>
        :context.program.start_time atom.equals "arbitrary atom"
      }) ~ false
    }`,
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `{
      x: true
      f: _ => :x
      inner: {
        x: false
        :f(@runtime { _ => _ }) ~ true
      }
    }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{
      x: true
      f: _ => @runtime { _ => :x }
      inner: {
        x: false
        :f(@runtime { _ => _ }) ~ true
      }
    }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{
      lookup_within: (object: { a: :something.type }) => :object.a
      :lookup_within(@runtime { _ => { a: true } }) ~ true
    }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{
      not: (a: :boolean.type) => @if { :a, false, true }
      :not(@runtime { _ => false }) ~ true
    }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{
      lookup: (key: a | b) => { a: true, b: false }.:key
      :lookup(@runtime { _ => a }) ~ true
    }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{
      lookup: (key: a | b) => { a: { x: true }, b: { x: false } }.:key.x
      :lookup(@runtime { _ => a }) ~ true
    }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{
      lookup: (keys: { a | b, x | y }) =>
        { a: { x: true, y: false }, b: { x: false, y: false } }.(:keys.0).(:keys.1)
      :lookup(@runtime { _ => { a, x } }) ~ true
    }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{
      not: (a: :boolean.type) => @if { :a, false, true }
      :not(@runtime { _ => false }) ~ false
    }`,
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `{
      lookup: (key: a | b) => { a: true, b: false }.:key
      :lookup(@runtime { _ => b }) ~ true
    }`,
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `{
      lookup_within: (object: (?o: { a: :something.type })) => :object.a
      :lookup_within(@runtime { _ => { a: true } }) ~ true
    }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{
      apply_to_true: (f: :something.type ~> :something.type) => :f(true)
      :apply_to_true(@runtime { _ => a => :a }) ~ true
    }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{
      apply_to_true: (f: :something.type ~> :something.type) => :f(true)
      :apply_to_true(@runtime { _ => a => :a }) ~ false
    }`,
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `{
      apply_to_true: (f: (?g: :something.type ~> :something.type)) => :f(true)
      :apply_to_true(@runtime { _ => a => :a }) ~ true
    }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{
      apply_to_true: (f: (?g: :something.type ~> :something.type)) => :f(true)
      :apply_to_true(@runtime { _ => a => :a }) ~ false
    }`,
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `{
      apply_to_true: (f: (?g: :something.type ~> :something.type)) => :f(true)
      :apply_to_true(@runtime { _ => _ => false }) ~ false
    }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{
      apply_to_true: (f: :something.type ~> :something.type) => :f(true)
      first: x => _y => :x
      :apply_to_true(@runtime { _ => :first }) ~ (:something.type ~> true)
    }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{
      apply_to_true: (f: :something.type ~> :something.type) => :f(true)
      first: x => _y => :x
      :apply_to_true(@runtime { _ => :first }) ~ (:something.type ~> false)
    }`,
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `{
      lookup_foo: (f: :something.type ~> (?b: { foo: :something.type })) => :f(true).foo
      :lookup_foo(@runtime { _ => _ => { foo: 42 } }) ~ 42
    }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{
      lookup_foo: (f: :something.type ~> (?b: { foo: :something.type })) => :f(true).foo
      :lookup_foo(@runtime { _ => _ => { foo: 42 } }) ~ 43
    }`,
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `{ lookup_foo: (f: :something.type ~> (?b: { foo: :something.type })) => :f(true).bar }`,
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `{
      lookup_foo: a => (f: :a ~> (?b: { foo: :a })) => :f(:a).foo
      :lookup_foo(hello)(@runtime { _ => _ => { foo: hello } }) ~ hello
    }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{ outer: a => (f: :a ~> ?b) => ((g: :f(:a)) => :g)(:f(:a)) }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `(a: :something.type) => (f: :a ~> :something.type) => :f("an arbitrary value")`,
    result => {
      assert(either.isLeft(result))
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `{
      example: (a: :something.type) => (f: :a ~> :something.type) => :f("an arbitrary value")
      result: :example(@runtime { _ => 1 })((n: :integer.type) => :integer.add(1)(:n))
    }`,
    result => {
      assert(either.isLeft(result))
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `(f: ?a ~> ?b) => :f(true)`,
    result => {
      assert(either.isLeft(result))
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `(f: ? ~> ?) => :f(true)`,
    result => {
      assert(either.isLeft(result))
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `(x: { a: :atom.type }) =>
      ((h: :x.a ~> :atom.type) => :h(forged))((v: :x.a) => :v)`,
    result => {
      assert(either.isLeft(result))
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `{
      caller: (g: { a: :atom.type } ~> :atom.type) =>
        @runtime { _ => :g({ a: actual }) }
      result: :caller(x =>
        ((h: :x.a ~> :atom.type) => :h(forged))((v: :x.a) => :v))
    }`,
    result => {
      assert(either.isLeft(result))
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `{
      caller: (g: { a: :atom.type } ~> { got: :atom.type }) =>
        @runtime { _ => :g({ a: actual }) }
      result: :caller(x =>
        ((h: :x.a ~> { got: :x.a }) => :h(forged))((v: :x.a) => { got: :v }))
    }`,
    result => {
      assert(either.isLeft(result))
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    // There was an inference cache pollution issue causing the second
    // application below to unsoundly succeed because the prior call locked in
    // `:a`'s type as `1`.
    `{
      call_with: x => (f: :something.type ~> :something.type) => :f(:x)
      first: :call_with(1)((n: :integer.type) => :n)
      second: :call_with(a)((n: :integer.type) => :n)
    }`,
    result => {
      assert(either.isLeft(result))
      // Body re-checks happen during function application, so the type
      // mismatch surfaces as a panic.
      assert.deepEqual(result.value.kind, 'panic')
      assert(result.value.message.includes('is not assignable to'))
    },
  ],

  [
    `{
      test: (f: (:something.type ~> :integer.type) | (:something.type ~> :boolean.type)) =>
        :f(_)
      :test(@runtime { _ => _ => 42 }) ~ :integer.type
    }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{
      test: (f: (:something.type ~> :integer.type) | (:something.type ~> :boolean.type)) =>
        :f(_)
      :test(@runtime { _ => _ => 42 }) ~ :boolean.type
    }`,
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `{
      apply_natural: (f:
        (:integer.type ~> :something.type) | (:natural_number.type ~> :something.type)
      ) => :f(5)
    }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{
      apply_natural: (f:
        (:integer.type ~> :something.type) | (:natural_number.type ~> :something.type)
      ) => :f(-1)
    }`,
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `{
      test: (object: {
        a: :integer.type
        f: :integer.type ~> :something.type
      } | {
        a: :boolean.type
        f: :boolean.type ~> :something.type
      }) => :object.f(:object.a)
      :test({
        a: @runtime { _ => true }
        f: (x: :boolean.type) => @if { :x, yes, no }
      }) ~ yes
    }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{
      test: (object: {
        a: :integer.type
        f: :integer.type ~> :something.type
      } | {
        a: :boolean.type
        f: :boolean.type ~> :something.type
      }) => :object.f(:object.a)
      :test({
        a: @runtime { _ => true }
        f: (x: :boolean.type) => @if { :x, yes, no }
      }) ~ no
    }`,
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `{
      test: (object: (?o: {
        a: :boolean.type
        f: :boolean.type ~> :something.type
      })) => :object.f(:object.a)
      :test(@runtime { _ => {
        a: true
        f: (x: :boolean.type) => @if { :x, yes, no }
      }}) ~ yes
    }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{
      test: (object: {
        a: :integer.type
        f: :boolean.type ~> :something.type
      } | {
        a: :boolean.type
        f: :integer.type ~> :something.type
      }) => :object.f(:object.a)
    }`,
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `{
      test: (object: {
        a: :integer.type
        f: :integer.type ~> ?x
      } | {
        a: :boolean.type
        f: :boolean.type ~> ?y
      }) => :object.f(:object.a)
    }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `:boolean.not(@runtime { _ => true }) ~ false`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `:atom.append(@runtime { _ => b })(a) ~ ab`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `(1 + @runtime { _ => 1 }) ~ 2`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `(1 + @runtime { context =>
      @if {
        @runtime { context =>
          :context.program.start_time atom.equals "arbitrary atom"
        }
        1
        2
      }
    }) ~ (2 | 3)`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{
      add_natural_numbers: (b: :natural_number.type) => (a: :natural_number.type) => :a + :b
      requires_a_natural_number: (a: :natural_number.type) => :a
      :requires_a_natural_number(:add_natural_numbers(@runtime { _ => 1 })(@runtime { _ => 1 }))
    }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{
      add_natural_numbers: (b: :natural_number.type) => (a: :natural_number.type) => :a + :b
      requires_a_natural_number: (a: :natural_number.type) => :a
      :requires_a_natural_number(:add_natural_numbers(@runtime { _ => 1 })(@runtime { _ => -1 }))
    }`,
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `{
      add_natural_numbers: (b: :natural_number.type) => (a: :natural_number.type) => :a + :b
      requires_a_natural_number: (a: :natural_number.type) => :a
      :requires_a_natural_number(:add_natural_numbers(@runtime { _ => -1 })(@runtime { _ => 1 }))
    }`,
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `{
      subtract_natural_numbers: (b: :natural_number.type) => (a: :natural_number.type) => :a - :b
      requires_a_natural_number: (a: :natural_number.type) => :a
      :requires_a_natural_number(:subtract_natural_numbers(@runtime { _ => 2 })(@runtime { _ => 1 }))
    }`,
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `{
      subtract_natural_numbers: (b: :natural_number.type) => (a: :natural_number.type) => :a + :b
      requires_a_natural_number: (a: :natural_number.type) => :a
      illegal: (a: :integer.type) => :requires_a_natural_number(:subtract_natural_numbers(@runtime { _ => 1 })(:a))
    }`,
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `{ increment: (x: :natural_number.type) => (1 + :x) ~ :natural_number.type }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{ increment: (x: :natural_number.type) => (:x + 1) ~ :natural_number.type }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{ double: (x: :natural_number.type) => (2 * :x) ~ :natural_number.type }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{ f: (x: :natural_number.type) => ((1 + :x) + :x) ~ :natural_number.type }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{ decrement: (x: :natural_number.type) => (:x - 1) ~ :natural_number.type }`,
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `{ increment: (x: :integer.type) => (1 + :x) ~ :natural_number.type }`,
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `{ f: (x: :integer.type) => :integer.is(:x) ~ true }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{ f: (x: :natural_number.type) => :integer.is(:x) ~ true }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{ f: (x: :atom.type) => :integer.is(:x) ~ true }`,
    result => {
      assert(either.isLeft(result))
      assert('kind' in result.value)
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `{ f: (x: :something.type) => :something.is(:x) ~ true }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{
      needs_some: (o: { tag: some, value: :integer.type }) => :o
      use: (x: :integer.type) => :needs_some(:integer.from(:x))
    }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `"-1-1" ~ :integer.type`,
    result => {
      assert(either.isLeft(result))
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `"00" ~ :natural_number.type`,
    result => {
      assert(either.isLeft(result))
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `1 + "-1-1"`,
    result => {
      assert(either.isLeft(result))
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `{ a: 1, b: 2 } ~ ({ a: 1, b: 2 } | { a: 1, b: 2 })`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `(_ => x) ~ ((:something.type ~> :atom.type) | (:something.type ~> :atom.type))`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{
      apply_to_multiple_types: (f: a => :a) => { :f(42), :f(hello) }
      :apply_to_multiple_types(@runtime { _ => a => :a }) ~ { 42, hello }
    }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `{
      apply_to_multiple_types: (f: a => :a) => { :f(42), :f(hello) }
      :apply_to_multiple_types(@runtime { _ => a => :a }) ~ { hello, 42 }
    }`,
    result => {
      assert(either.isLeft(result))
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `({ a: 1 } object.overlay @runtime { _ => { b: 2 } }) ~ { a: 1, b: 2 }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `({ a: 1 } object.overlay @runtime { _ => { a: 2 } }) ~ { a: 2 }`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `({ a: 1 } object.overlay @runtime { _ => { a: 2 } }) ~ { a: 1 }`,
    result => {
      assert(either.isLeft(result))
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `({ a: 1 } object.overlay @runtime { context =>
      @if {
        @runtime { context =>
          :context.program.start_time atom.equals "arbitrary atom"
        }
        { b: 2 }
        { b: 3 }
      }
    }) ~ ({ a: 1, b: 2 } | { a: 1, b: 3 })`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    // TODO: It'd be great to be able to reason generically about non-literal
    // standard library function arguments so cases like this typecheck.
    `({ a: 1 } object.overlay @runtime { context => { b: :context.program.start_time } }) ~ { a: 1, b: :atom.type }`,
    result => {
      assert(either.isLeft(result))
      assert.deepEqual(result.value.kind, 'typeMismatch')
    },
  ],

  [
    `({ a: 1 } object.overlay @runtime { context => { b: :context.program.start_time } }) ~ :something.type`,
    result => {
      assert(either.isRight(result))
    },
  ],

  [
    `:object.from_property(@runtime { _ => some_key })("some value") ~ { some_key: "some value" }`,
    result => {
      assert(either.isRight(result))
    },
  ],
])
