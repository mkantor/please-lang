import { testCases } from '../../test-utilities.test.js'
import { formatError } from './error-formatting.js'

testCases(
  ([error, context]: Parameters<typeof formatError>) =>
    formatError(error, context),
  ([error, context]) => JSON.stringify({ error, ...context }),
)('formatError', [
  [
    [
      { message: 'expected "}"', span: [6, 6] },
      { source: '{ a: 1', filename: '<stdin>' },
    ],
    // prettier-ignore
    [
      'Error: expected "}"',
      '',
      '<stdin>:1:7',
      '  │',
      '1 │ { a: 1',
      '  │       ▔',
    ].join('\n'),
  ],

  [
    [
      { message: 'oops', span: [0, 0] },
      { source: 'hi', filename: 'greeting.plz' },
    ],
    // prettier-ignore
    [
      'Error: oops',
      '',
      'greeting.plz:1:1',
      '  │',
      '1 │ hi',
      '  │ ▔',
    ].join('\n'),
  ],

  [
    [
      { message: 'bad', span: [8, 11] },
      { source: 'foo\nbar baz', filename: '<stdin>' },
    ],
    // prettier-ignore
    [
      'Error: bad',
      '',
      '<stdin>:2:5',
      '  │',
      '2 │ bar baz',
      '  │     ▔▔▔',
    ].join('\n'),
  ],

  [
    [
      { message: 'e', span: [18, 19] },
      {
        source: Array.from({ length: 10 }, () => 'x').join('\n'),
        filename: '<stdin>',
      },
    ],
    // prettier-ignore
    [
      'Error: e',
      '',
      '<stdin>:10:1',
      '   │',
      '10 │ x',
      '   │ ▔',
    ].join('\n'),
  ],

  [[{ message: 'no source' }, { filename: 'a' }], 'Error: no source'],

  [
    [{ message: 'no span' }, { source: 'some source', filename: 'a' }],
    'Error: no span',
  ],
])
