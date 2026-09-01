import assert from 'node:assert'
import test from 'node:test'
import { testCases } from '../test-utilities.test.js'
import {
  lineAndColumnAtOffset,
  offsetAtLineAndColumn,
  snippetAtSpan,
  type LineAndColumn,
  type Span,
} from './source-location.js'

testCases(
  ([source, offset]: readonly [string, number]) =>
    lineAndColumnAtOffset(source, offset),
  ([source, offset]) => `${JSON.stringify(source)} @ ${offset}`,
)('lineAndColumnAtOffset', [
  [['hello', 0], { line: 1, column: 1 }],
  [['hello', 3], { line: 1, column: 4 }],
  [['hello', 5], { line: 1, column: 6 }],
  [['a\nb\nc', 2], { line: 2, column: 1 }],
  [['a\nbc\nd', 4], { line: 2, column: 3 }],
  [['line1\nline2', 6], { line: 2, column: 1 }],
  // TODO: Perhaps `column` shouldn't go more than one character past the input,
  // even with bogus offsets like this?
  [['hello', 7], { line: 1, column: 8 }],
])

testCases(
  ([source, lineAndColumn]: readonly [string, LineAndColumn]) =>
    offsetAtLineAndColumn(source, lineAndColumn),
  ([source, { line, column }]) =>
    `${JSON.stringify(source)} @ ${line}:${column}`,
)('offsetAtLineAndColumn', [
  [['a\nbc\nd', { line: 2, column: 3 }], 4],
  // Positions outside the source are clamped.
  [['ab\ncd', { line: 1, column: 99 }], 2],
  [['ab\ncd', { line: 99, column: 1 }], 3],
  [['ab\ncd', { line: 2, column: 99 }], 5],
  [['ab\ncd', { line: 0, column: 0 }], 0],
  [['', { line: 1, column: 1 }], 0],
])

test('offsetAtLineAndColumn inverts lineAndColumnAtOffset', () => {
  const source = 'a\nbb\n\nccc\n'
  const offsets = Array.from({ length: source.length + 1 }, (_, index) => index)
  assert.deepEqual(
    offsets.map(offset =>
      offsetAtLineAndColumn(source, lineAndColumnAtOffset(source, offset)),
    ),
    offsets,
  )
})

testCases(
  ([source, span]: readonly [string, Span]) => snippetAtSpan(source, span),
  ([source, span]) => `${JSON.stringify(source)} @ [${span[0]}, ${span[1]}]`,
)('snippetAtSpan', [
  [
    ['hello', [0, 0]],
    { line: 1, column: 1, lineText: 'hello', highlightLength: 1 },
  ],
  [
    ['hello', [1, 3]],
    { line: 1, column: 2, lineText: 'hello', highlightLength: 2 },
  ],
  [
    ['a\nbb\nc', [3, 4]],
    { line: 2, column: 2, lineText: 'bb', highlightLength: 1 },
  ],
  [
    // A span crossing a newline is clamped to its first line.
    ['ab\ncd', [1, 5]],
    { line: 1, column: 2, lineText: 'ab', highlightLength: 1 },
  ],
  [
    ['hello', [5, 5]],
    { line: 1, column: 6, lineText: 'hello', highlightLength: 1 },
  ],
])
