import { testCases } from '../test-utilities.test.js'
import {
  lineAndColumnAtOffset,
  snippetAtSpan,
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
