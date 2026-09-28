import either from '@matt.kantor/either'
import assert from 'node:assert'
import {
  compileAndRun,
  compileToInlinePlz,
  compileWithoutSpans,
  testCases,
  toSyntaxTree,
  valueAtKeyPath,
} from '../../../../test-utilities.test.js'
import { parse } from '../../../parsing/parser.js'
import { elaborationSuite, success } from '../test-utilities.test.js'

elaborationSuite('@lookup', [
  [
    {
      foo: 'bar',
      bar: { 0: '@lookup', 1: { 0: 'foo' } },
    },
    success({ foo: 'bar', bar: 'bar' }),
  ],
  [
    {
      foo: 'bar',
      bar: { 0: '@lookup', 1: { key: 'foo' } },
    },
    success({ foo: 'bar', bar: 'bar' }),
  ],
  [
    {
      foo: 'bar',
      bar: { 0: '@lookup', 1: { 0: 'foo' } },
    },
    success({ foo: 'bar', bar: 'bar' }),
  ],
  [
    {
      a: 'A',
      b: {
        a: 'different A',
        b: { 0: '@lookup', 1: { key: 'a' } },
      },
    },
    success({
      a: 'A',
      b: {
        a: 'different A',
        b: 'different A',
      },
    }),
  ],
  [
    {
      foo: 'bar',
      bar: { 0: '@lookup', 1: { 0: 'foo' } },
      baz: { 0: '@lookup', 1: { 0: 'bar' } },
    },
    success({ foo: 'bar', bar: 'bar', baz: 'bar' }),
  ],
  [
    { a: { 0: '@lookup', 1: { _: 'missing key' } } },
    output => {
      assert(either.isLeft(output))
    },
  ],
  [
    { a: { 0: '@lookup', 1: { key: 'thisPropertyDoesNotExist' } } },
    output => {
      assert(either.isLeft(output))
    },
  ],

  // lexical scoping
  [
    {
      a: 'C',
      b: {
        c: { 0: '@lookup', 1: { key: 'a' } },
      },
    },
    success({
      a: 'C',
      b: {
        c: 'C',
      },
    }),
  ],
  [
    {
      a: 'C',
      b: {
        a: 'other C', // this `a` should be referenced
        c: { 0: '@lookup', 1: { key: 'a' } },
      },
    },
    success({
      a: 'C',
      b: {
        a: 'other C',
        c: 'other C',
      },
    }),
  ],
])

// `@lookup`s referring to `@function`s they're within stay unelaborated
// (otherwise the `@function` body would double in size every elaboration pass).

const compileSuite = testCases(
  (input: string) => either.flatMap(parse(input), compileWithoutSpans),
  input => `compiling \`${input}\``,
)

compileSuite('self-referential lookups', [
  [
    '{ f: (n: :Integer) => :f(:n) }',
    output => {
      assert(either.isRight(output))
      assert.deepEqual(
        JSON.stringify(output.value).match(/@function/g)?.length,
        1,
        'the recursive definition should appear exactly once',
      )
    },
  ],

  [
    '{ m: { f: (n: :Integer) => { self: :f, parent: :m }, x: :a }, a: :b, b: :identity(1) }',
    output => {
      assert(either.isRight(output))
      assert.deepEqual(
        valueAtKeyPath(output.value, ['m', 'x']),
        '1',
        '`m` should have been re-elaborated',
      )
      assert.deepEqual(
        JSON.stringify(output.value).match(/@function/g)?.length,
        1,
        'the recursive definition should appear exactly once',
      )
    },
  ],

  [
    '{ helper: 1, f: (x: :Integer) => :helper }',
    output => {
      assert(either.isRight(output))
      assert(
        JSON.stringify(output.value).includes('["body","1"]'),
        'the sibling reference should have been substituted into the body',
      )
    },
  ],
])

compileToInlinePlz('calls of functions referring to enclosing bindings', [
  [
    `{
      m: {
        f: (n: :Integer) => :m
        x: :f(1)
      }
    }`,
    either.makeRight(`{
      m: {
        f: (n: :Integer) => :m
        x: :f(1)
      }
    }`),
  ],
  [
    `{
      f: (a: :Integer) => {
        g: (b: :Integer) => :f
        r: :g(1)
      }
    }`,
    either.makeRight(`{
      f: (a: :Integer) => {
        g: (b: :Integer) => :f
        r: :f
      }
    }`),
  ],
  [
    `{
      m: {
        f: (n: :Integer) => :m
        x: :f(1)
      }
      r: :m
    }`,
    either.makeRight(`{
      m: {
        f: (n: :Integer) => :m
        x: :f(1)
      }
      r: :m
    }`),
  ],
  [
    `{
      m: {
        f: (n: :Integer) => :m
        x: :f(1)
      }
      r: :m.x
    }`,
    either.makeRight(`{
      m: {
        f: (n: :Integer) => :m
        x: :f(1)
      }
      r: :m.x
    }`),
  ],
  [
    `{
      m: {
        f: (n: :Integer) => :m
        x: :identity(:f)(1)
      }
      r: :m
    }`,
    either.makeRight(`{
      m: {
        f: (n: :Integer) => :m
        x: ((n: :Integer) => :m)(1)
      }
      r: :m
    }`),
  ],
  [
    `{
      m: {
        f: (n: :Integer) => :m
        x: :apply(1)(:f)
      }
      r: :m
    }`,
    either.makeRight(`{
      m: {
        f: (n: :Integer) => :m
        x: ((n: :Integer) => :m) apply 1
      }
      r: :m
    }`),
  ],
  [
    `{
      m: {
        f: (n: :Integer) => :m
        x: :option.map(:f)({ tag: some, value: 1 })
      }
      r: :m
    }`,
    either.makeRight(`{
      m: {
        f: (n: :Integer) => :m
        x: { tag: some, value: 1 } option.map ((n: :Integer) => :m)
      }
      r: :m
    }`),
  ],
  [
    `{
      m: {
        f: (n: :Integer) => :m
        x: (:f >> :identity)(1)
      }
      r: :m
    }`,
    either.makeRight(`{
      m: {
        f: (n: :Integer) => :m
        x: (((n: :Integer) => :m) flow :identity)(1)
      }
      r: :m
    }`),
  ],
])

compileAndRun('types of self-referential lookups', [
  [
    `{
      f: (n: :Integer) => @if { :n < 1, then: 0, else: 1 + :f(:n - 1) }
      main: :f(3)
    }.main`,
    output => {
      assert(either.isRight(output))
      assert.deepEqual(output.value, toSyntaxTree('3'))
    },
  ],
])

compileAndRun('self-references to bindings enclosing a function', [
  [
    `{
      f: { value: (n: :Integer) => @if { :n > 0, then: :f(:n - 1), else: done } }.value
      main: :f(3)
    }.main`,
    either.makeRight('done'),
  ],
  [
    `{
      f: :identity((n: :Integer) => @if { :n > 0, then: :f(:n - 1), else: done })
      main: :f(3)
    }.main`,
    either.makeRight('done'),
  ],
  [
    `{
      f: { value: (n: :Integer) => { number: :n, next: :f } }.value
      main: :f(1).next(2).number
    }.main`,
    either.makeRight('2'),
  ],
  [
    `{
      m: { f: (n: :Integer) => :m, g: 42 }
      main: :m.f(1).f(2).g
    }.main`,
    either.makeRight('42'),
  ],
  [
    `{
      a: {
        b: { f: (n: :Integer) => { x: :a, y: :b } }
        w: 2
      }
      main: :a.b.f(1).y.f(2).x.w
    }.main`,
    either.makeRight('2'),
  ],
  [
    `{
      return: { value: (n: :Integer) => @if { :n > 0, then: :return(:n - 1), else: done } }.value
      main: :return(3)
    }.main`,
    either.makeRight('done'),
  ],
])

compileAndRun('unbounded recursion within a self-referential function', [
  [
    '{ f: (n: :Integer) => :f(1), main: :f(0) }.main',
    output => {
      assert(either.isLeft(output))
      assert('kind' in output.value)
      assert.deepEqual(output.value.kind, 'panic')
      assert.match(output.value.message, /evaluation did not terminate/)
    },
  ],
])
