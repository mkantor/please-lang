import either from '@matt.kantor/either'
import assert from 'node:assert'
import {
  compileWithoutSpans,
  parseAndCompileAndRun,
  testCases,
  toSyntaxTree,
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
    '{ f: (n: :integer.type) => :f(:n) }',
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
    '{ helper: 1, f: (x: :integer.type) => :helper }',
    output => {
      assert(either.isRight(output))
      assert(
        JSON.stringify(output.value).includes('["body","1"]'),
        'the sibling reference should have been substituted into the body',
      )
    },
  ],
])

const compileAndRun = testCases(
  parseAndCompileAndRun,
  input => `running \`${input}\``,
)

compileAndRun('types of self-referential lookups', [
  [
    `{
      f: (n: :integer.type) => @if { :n < 1, then: 0, else: 1 + :f(:n - 1) }
      main: :f(3)
    }.main`,
    output => {
      assert(either.isRight(output))
      assert.deepEqual(output.value, toSyntaxTree('3'))
    },
  ],
])

compileAndRun('unbounded recursion within a self-referential function', [
  [
    '{ f: (n: :integer.type) => :f(1), main: :f(0) }.main',
    output => {
      assert(either.isLeft(output))
      assert('kind' in output.value)
      assert.deepEqual(output.value.kind, 'panic')
      assert.match(output.value.message, /evaluation did not terminate/)
    },
  ],
])
