import either from '@matt.kantor/either'
import assert from 'node:assert'
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
