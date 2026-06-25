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

  test('records an atom span', () => {
    const source = '{ a: 5 }'
    assert.deepEqual(
      spansOf(source).get(stringifyKeyPathForInternalUse(['a'])),
      [5, 6],
    )
    assert.equal(source.slice(5, 6), '5')
  })

  test('records distinct spans for repeated atoms', () => {
    const source = '{ a: 1, b: 1 }'
    const spans = spansOf(source)
    assert.deepEqual(spans.get(stringifyKeyPathForInternalUse(['a'])), [5, 6])
    assert.deepEqual(spans.get(stringifyKeyPathForInternalUse(['b'])), [11, 12])
    assert.equal(source.slice(5, 6), '1')
    assert.equal(source.slice(11, 12), '1')
  })

  test('records a quoted atom span covering its source form', () => {
    const source = '{ a: "x y" }'
    assert.deepEqual(
      spansOf(source).get(stringifyKeyPathForInternalUse(['a'])),
      [5, 10],
    )
    assert.equal(source.slice(5, 10), '"x y"')
  })

  test('records the whole-program span for a bare top-level atom', () => {
    assert.deepEqual(
      spansOf('42').get(stringifyKeyPathForInternalUse([])),
      [0, 2],
    )
  })
})
