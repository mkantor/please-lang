import assert from 'node:assert'
import test, { suite } from 'node:test'
import {
  testCases,
  withEnvironmentVariables,
} from '../../test-utilities.test.js'
import { defaultConfiguration } from '../configuration.js'
import { diagnose } from './analyze.js'

const diagnoseSource = diagnose(defaultConfiguration)

testCases(diagnoseSource, source => `diagnosing \`${source}\``)('diagnose', [
  // No errors means no diagnostics.
  ['1 + 1', []],
  ['{ a: 1, b: :a }', []],
  ['@runtime { context => :context.program.start_time }', []],

  [
    ':nonexistent',
    [
      {
        severity: 'error',
        code: 'invalidExpression',
        message: 'cannot find a value for `:nonexistent`',
        span: [0, 12],
        relatedSpans: [],
      },
    ],
  ],

  [
    '{ a: 1',
    [
      {
        severity: 'error',
        code: 'badSyntax',
        message: 'expected one of: a value after `:`, `,`, `\n`, `}`',
        span: [6, 6],
        relatedSpans: [{ message: 'unclosed `{`', span: [0, 1] }],
      },
    ],
  ],

  [
    '{} ~ :Boolean',
    [
      {
        severity: 'error',
        code: 'typeMismatch',
        message: 'the value `{}` is not assignable to the type `false | true`',
        span: [0, 2],
        relatedSpans: [],
      },
    ],
  ],

  [
    '@bogus',
    [
      {
        severity: 'error',
        code: 'unknownKeyword',
        message: 'unknown keyword: `@bogus`',
        span: [0, 6],
        relatedSpans: [],
      },
    ],
  ],
])

const firstDiagnostic = (source: string) => diagnoseSource(source)[0]

suite('diagnose blames the right source region', () => {
  test('an error within an object spans the offending sub-expression', () => {
    const source = '{ ok: 1, bad: :missing }'
    assert.deepEqual(firstDiagnostic(source)?.span, [14, 22])
    assert.equal(source.slice(14, 22), ':missing')
  })

  test('errors inside `@runtime` expressions are still reported', () => {
    const source = '@runtime { context => :context.nope }'
    const diagnostic = firstDiagnostic(source)
    assert.equal(diagnostic?.code, 'typeMismatch')
    assert.deepEqual(diagnostic?.span, [31, 35])
    assert.equal(source.slice(31, 35), 'nope')
  })

  test('leading whitespace does not shift offsets', () => {
    const source = '\n\n  :nonexistent'
    assert.deepEqual(firstDiagnostic(source)?.span, [4, 16])
    assert.equal(source.slice(4, 16), ':nonexistent')
  })

  test('an empty program reports a syntax error at the start', () => {
    const diagnostic = firstDiagnostic('')
    assert.equal(diagnostic?.code, 'badSyntax')
    assert.deepEqual(diagnostic?.span, [0, 0])
  })
})

test('messages never contain ANSI escape sequences', () => {
  withEnvironmentVariables({ FORCE_COLOR: '3', NO_COLOR: undefined }, () => {
    const message = firstDiagnostic('{} ~ :Boolean')?.message
    assert.ok(message !== undefined)
    assert.ok(
      !message.includes('\u001B'),
      `message was colorized: ${JSON.stringify(message)}`,
    )
  })
})
