import either from '@matt.kantor/either'
import assert from 'node:assert'
import test, { suite } from 'node:test'
import { stringifyKeyPathForInternalUse } from '../semantics.js'
import { parseWithSpans } from './parser.js'
import type { ExpressionSpansByLocation } from './spans.js'

const spansOf = (source: string): ExpressionSpansByLocation => {
  const result = parseWithSpans(source)
  if (either.isLeft(result)) {
    throw new Error(`unexpected parse error: ${result.value.message}`)
  } else {
    return result.value.spans
  }
}

suite('parseWithSpans', () => {
  test('records the whole-program span at the empty key path', () => {
    assert.deepEqual(
      spansOf(':nonexistent').get(stringifyKeyPathForInternalUse([])),
      [0, 12],
    )
  })

  test('keys nested expression spans by their key path', () => {
    const source = '{ a: :b, b: 42 }'
    const spans = spansOf(source)
    assert.deepEqual(spans.get(stringifyKeyPathForInternalUse(['a'])), [5, 7])
    assert.equal(source.slice(5, 7), ':b')
    assert.deepEqual(spans.get(stringifyKeyPathForInternalUse([])), [
      0,
      source.length,
    ])
  })

  test('excludes leading trivia from the program span', () => {
    const source = '// c\n{ a: 1 }'
    assert.deepEqual(spansOf(source).get(stringifyKeyPathForInternalUse([])), [
      5,
      source.length,
    ])
    assert.equal(source.slice(5), '{ a: 1 }')
  })

  test('does not record spans for atoms', () => {
    assert.equal(spansOf('42').size, 0)
  })
})
