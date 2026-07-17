import either from '@matt.kantor/either'
import assert from 'node:assert'
import test, { suite } from 'node:test'
import { toSyntaxTree } from '../../test-utilities.test.js'
import { parseWithSpans } from '../parsing/parser.js'
import type { Span } from '../source-location.js'
import { compile } from './compiler.js'

const compileErrorSpan = (source: string): Span | undefined => {
  const parsed = parseWithSpans(source)
  if (either.isLeft(parsed)) {
    throw new Error(`unexpected parse error: ${parsed.value.message}`)
  } else {
    const result = compile(parsed.value.tree, parsed.value.spans)
    if (either.isRight(result)) {
      throw new Error('expected a compilation error but compilation succeeded')
    } else {
      return result.value.span
    }
  }
}

suite('compile attaches source spans to elaboration errors', () => {
  test('unknown lookup spans the lookup expression', () => {
    assert.deepEqual(compileErrorSpan(':nonexistent'), [0, 12])
  })

  test('type mismatch blames the checked value', () => {
    const source = '{} ~ :boolean.type'
    assert.deepEqual(compileErrorSpan(source), [0, 2])
    assert.equal(source.slice(0, 2), '{}')
  })

  test('missing property blames the first absent key in a chain', () => {
    const source1 = '{}.(1 + 1).(1 + 1).(1 + 1)'
    assert.deepEqual(compileErrorSpan(source1), [3, 10])

    const source2 = '{2: {}}.(1 + 1).(1 + 1).(1 + 1)'
    assert.deepEqual(compileErrorSpan(source2), [16, 23])

    const source3 = '{}.a.b.c'
    assert.deepEqual(compileErrorSpan(source3), [3, 4])

    const source4 = '{ a: {} }.a.b.c'
    assert.deepEqual(compileErrorSpan(source4), [12, 13])
  })

  test('unknown keyword spans the keyword expression', () => {
    assert.deepEqual(compileErrorSpan('@bogus'), [0, 6])
  })

  test('an error inside an object spans the offending sub-expression', () => {
    const source = '{ ok: 1, bad: :missing }'
    assert.deepEqual(compileErrorSpan(source), [14, 22])
    assert.equal(source.slice(14, 22), ':missing')
  })

  test('omits the span when compiled with no spans', () => {
    const lookupNonexistentKey = toSyntaxTree({
      0: '@lookup',
      1: { key: 'nonexistent' },
    })
    const resultWithoutSpans = compile(lookupNonexistentKey, new Map())
    assert(either.isLeft(resultWithoutSpans))
    assert.equal(resultWithoutSpans.value.span, undefined)
  })
})
