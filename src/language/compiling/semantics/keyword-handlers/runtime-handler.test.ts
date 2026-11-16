import either from '@matt.kantor/either'
import assert from 'node:assert'
import { withPhantomData } from '../../../../phantom-data.js'
import {
  compileWithoutSpans,
  testCases,
  valueAtKeyPath,
} from '../../../../test-utilities.test.js'
import { parse } from '../../../parsing/parser.js'
import { objectNodeFromOrderedEntries, prelude } from '../../../semantics.js'
import { inlinePlz, unparse } from '../../../unparsing.js'
import { elaborationSuite } from '../test-utilities.test.js'

elaborationSuite('@runtime', [
  [
    { 0: '@runtime', 1: { 0: { 0: '@lookup', 1: { key: 'identity' } } } },
    either.makeRight(
      withPhantomData<never>()(
        objectNodeFromOrderedEntries([
          ['0', '@runtime'],
          ['1', objectNodeFromOrderedEntries([['function', prelude.identity]])],
        ]),
      ),
    ),
  ],
  [
    { 0: '@runtime', 1: { 0: 'not a function' } },
    output => {
      assert(either.isLeft(output))
    },
  ],
])

testCases(
  (input: string) => either.flatMap(parse(input), compileWithoutSpans),
  input => `compiling \`${input}\``,
)('references within a runtime function', [
  [
    `{
      input: @runtime { context => {
        v: {
          h: (o: :Option(:Atom)) => :o
          a: :h(:context.arguments.lookup(a))
        }
        p: :v.a
      }}
      output: :input.p
    }`,
    output => {
      assert(either.isRight(output))
      const p = valueAtKeyPath(output.value, [
        'input',
        '1',
        'function',
        '1',
        'body',
        'p',
      ])
      assert(p !== undefined)
      assert.deepEqual(unparse(p, inlinePlz), either.makeRight(':v.a'))
    },
  ],
])
