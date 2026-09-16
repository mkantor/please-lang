import either from '@matt.kantor/either'
import assert from 'node:assert'
import test, { suite } from 'node:test'
import { stringifyKeyPathForInternalUse } from '../semantics.js'
import { parseWithSpans } from './parser.js'
import type { ExpressionSpans, PropertyKeySpans } from './spans.js'

const parseOrThrow = (source: string) => {
  const result = parseWithSpans(source)
  if (either.isLeft(result)) {
    throw new Error(`unexpected parse error: ${result.value.message}`)
  } else {
    return result.value
  }
}

const spansOf = (source: string): ExpressionSpans => parseOrThrow(source).spans

const propertyKeySpansOf = (source: string): PropertyKeySpans =>
  parseOrThrow(source).propertyKeySpans

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

suite('property key spans', () => {
  test("are keyed by their property's key path and cover the key, not its value", () => {
    const source = '{ a: 1, b: 2 }'
    const keySpans = propertyKeySpansOf(source)
    const firstPropertyLocation = stringifyKeyPathForInternalUse(['a'])
    assert.deepEqual(keySpans.get(firstPropertyLocation), [2, 3])
    assert.deepEqual(spansOf(source).get(firstPropertyLocation), [5, 6])
    assert.deepEqual(
      keySpans.get(stringifyKeyPathForInternalUse(['b'])),
      [8, 9],
    )
    assert.equal(source.slice(2, 3), 'a')
    assert.equal(source.slice(5, 6), '1')
    assert.equal(source.slice(8, 9), 'b')
  })

  test('are recorded for nested properties', () => {
    const source = '{ outer: { inner: 1 } }'
    assert.deepEqual(
      propertyKeySpansOf(source).get(
        stringifyKeyPathForInternalUse(['outer', 'inner']),
      ),
      [11, 16],
    )
    assert.equal(source.slice(11, 16), 'inner')
  })

  test('cover a quoted key in its source form', () => {
    const source = '{ "a b": 1 }'
    assert.deepEqual(
      propertyKeySpansOf(source).get(stringifyKeyPathForInternalUse(['a b'])),
      [2, 7],
    )
    assert.equal(source.slice(2, 7), '"a b"')
  })

  test('are absent for keys assigned by enumeration', () => {
    const source = '{ a: 1, b, c: 2 }'
    const keySpans = propertyKeySpansOf(source)
    assert.deepEqual(
      keySpans.get(stringifyKeyPathForInternalUse(['a'])),
      [2, 3],
    )
    assert.deepEqual(
      keySpans.get(stringifyKeyPathForInternalUse(['c'])),
      [11, 12],
    )
    assert.equal(keySpans.size, 2)
    assert.equal(source.slice(2, 3), 'a')
    assert.equal(source.slice(11, 12), 'c')
  })

  test('are absent when an enumerated key shadows a written one', () => {
    assert.equal(propertyKeySpansOf('{ 0: x, y }').size, 0)
  })

  test('are absent for keys introduced by desugaring', () => {
    // `:a` desugars to `{ 0: @lookup, 1: { key: a } }`
    assert.equal(propertyKeySpansOf(':a').size, 0)
  })

  test("are recorded for a typed function parameter's name", () => {
    const source = '(a: :Atom) => :a'
    assert.deepEqual(
      propertyKeySpansOf(source).get(
        stringifyKeyPathForInternalUse(['1', 'parameter', 'a']),
      ),
      [1, 2],
    )
    assert.equal(source.slice(1, 2), 'a')
  })

  test('follow properties relocated by an excess clause', () => {
    const source = '{ [:Atom]: :Integer, a: 1 }'
    assert.deepEqual(
      propertyKeySpansOf(source).get(
        stringifyKeyPathForInternalUse(['1', 'properties', 'a']),
      ),
      [21, 22],
    )
    assert.equal(source.slice(21, 22), 'a')
  })

  test('record the last occurrence of a duplicated key', () => {
    const source = '{ a: 1, a: 2 }'
    assert.deepEqual(
      propertyKeySpansOf(source).get(stringifyKeyPathForInternalUse(['a'])),
      [8, 9],
    )
    assert.equal(source.slice(8, 9), 'a')
  })
})
