import either from '@matt.kantor/either'
import assert from 'node:assert'
import {
  compileAndRun,
  compileToInlinePlz,
} from '../../../../test-utilities.test.js'
import { elaborationSuite, success } from '../test-utilities.test.js'

elaborationSuite('@index', [
  [{ 0: '@index', 1: { 0: { foo: 'bar' }, 1: { 0: 'foo' } } }, success('bar')],
  [
    { 0: '@index', 1: { object: { foo: 'bar' }, query: { 0: 'foo' } } },
    success('bar'),
  ],
  [
    {
      0: '@index',
      1: {
        object: { a: { b: { c: 'it works' } } },
        query: { 0: 'a', 1: 'b', 2: 'c' },
      },
    },
    success('it works'),
  ],
  [
    {
      0: '@index',
      1: {
        object: { a: { b: { c: 'it works' } } },
        query: { 0: 'a', 1: 'b' },
      },
    },
    success({ c: 'it works' }),
  ],
  [
    {
      0: '@index',
      1: { object: {}, query: { 0: 'thisPropertyDoesNotExist' } },
    },
    output => {
      assert(either.isLeft(output))
    },
  ],
  [
    {
      0: '@index',
      1: {
        object: { foo: { 0: '@union', 1: {} } },
        query: { 0: 'foo' },
      },
    },
    success({ 0: '@union', 1: {} }),
  ],
])

compileAndRun('indexing an unfinished object', [
  [
    `{
      f: (n: :Integer) => {
        checked: @if { :n < 0, then: @panic, else: :n }
        status: ok
      }.status
      main: :f(0 - 1)
    }.main`,
    output => {
      assert(either.isLeft(output))
      assert.deepEqual(output.value.kind, 'panic')
    },
  ],
  [
    `{
      g: (k: :Integer) => @if { :k < 0, then: @panic, else: :k }
      f: (n: :Integer) => { x: :g(:n), r: 1 }.r
      main: :f(0 - 1)
    }.main`,
    output => {
      assert(either.isLeft(output))
      assert.deepEqual(output.value.kind, 'panic')
    },
  ],
])

compileToInlinePlz('indexing an unfinished object, statically', [
  [
    `{
      setup: @runtime { context => :context.log(hello) }
      main: 1
    }.main`,
    either.makeRight(
      '{ setup: @runtime { context => :context.log(hello) }, main: 1 }.main',
    ),
  ],
  [
    `{
      o: {
        x: 1
        y: @runtime { context => :context.log(hello) }
      }
      main: :o.x
    }`,
    either.makeRight(
      '{ o: { x: 1, y: @runtime { context => :context.log(hello) } }, main: 1 }',
    ),
  ],
  [
    '{ f: (n: :Integer) => { a: 1, b: :n }.a }',
    either.makeRight('{ f: (n: :Integer) => 1 }'),
  ],
  [
    '{ m: { x: { a: :m.y, b: 2 }.b, y: :m.x } }',
    either.makeRight('{ m: { x: 2, y: 2 } }'),
  ],
])

compileAndRun('indexing an object through its own name', [
  [
    '{ config: { port: 80, p: :config.port } }.config.p',
    either.makeRight('80'),
  ],
  ['{ m: { n: { g: 1 }, h: :m.n.g } }.m.h', either.makeRight('1')],
  ['{ c: { p: :c.q, q: 1 } }.c.p', either.makeRight('1')],
  ['{ a: { x: :b.y, y: 1 }, b: { y: :a.y } }.a.x', either.makeRight('1')],
  [
    `{
      m: { g: 1, f: (n: :Integer) => :m.g }
      main: :m.f(1)
    }.main`,
    either.makeRight('1'),
  ],
  [
    `{
      m: {
        f: (n: :Integer) => @if {
          :n > 0
          then: :m.f(:n - 1)
          else: done
        }
      }
      main: :m.f(3)
    }.main`,
    either.makeRight('done'),
  ],
])

compileToInlinePlz('indexing an object through its own name, statically', [
  [
    '{ config: { port: 80, p: :config.nope } }',
    output => {
      assert(either.isLeft(output))
      assert.match(output.value.message, /property `\.nope` does not exist/)
    },
  ],
  [
    `{
      m: {
        g: 1
        f: (n: :Integer) => :m.g
        h: (n: :Integer) => :m.f(:n) && true
      }
    }`,
    output => {
      assert(either.isLeft(output))
      assert.match(
        output.value.message,
        /argument with type `1` is not assignable to the parameter type `:Boolean`/,
      )
    },
  ],
  ['{ c: { p: :c.p } }', either.makeRight('{ c: { p: :c.p } }')],
  [
    '{ c: { p: :c.q, q: :c.p } }',
    either.makeRight('{ c: { p: :c.q, q: :c.p } }'),
  ],
])
