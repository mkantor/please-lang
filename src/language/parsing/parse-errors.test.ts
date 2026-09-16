import either from '@matt.kantor/either'
import { testCases } from '../../test-utilities.test.js'
import { formatError } from '../cli/error-formatting.js'
import { parse } from './parser.js'

const renderParseError = (source: string): string =>
  either.match(parse(source), {
    left: error => formatError(error, { filename: '<stdin>', source }),
    right: _ => 'this program parsed successfully',
  })

testCases(renderParseError, source => `parsing ${JSON.stringify(source)}`)(
  'parse errors',
  [
    [
      // an empty program
      '',
      [
        'Error: expected an expression',
        '',
        '<stdin>:1:1',
        '  │',
        '1 │ ',
        '  │ ▔',
      ].join('\n'),
    ],
    [
      // an unclosed object
      '{ a: 1',
      [
        'Error: expected one of: a value after `:`, `,`, `',
        '`, `}`',
        '',
        '<stdin>:1:7',
        '  │',
        '1 │ { a: 1',
        '  │       ▔',
        '',
        'note: unclosed `{`',
        '<stdin>:1:1',
        '  │',
        '1 │ { a: 1',
        '  │ ▔',
      ].join('\n'),
    ],
    [
      // an object property with no value
      '{ a: 1, b: }',
      [
        'Error: expected a value after `:`',
        '',
        '<stdin>:1:12',
        '  │',
        '1 │ { a: 1, b: }',
        '  │            ▔',
      ].join('\n'),
    ],
    [
      // a failure nested several objects deep
      '{ a: { b: { c: ( 1 + ) } } }',
      [
        'Error: expected an expression',
        '',
        '<stdin>:1:22',
        '  │',
        '1 │ { a: { b: { c: ( 1 + ) } } }',
        '  │                      ▔',
      ].join('\n'),
    ],
    [
      // the same failure unnested
      '( 1 + )',
      [
        'Error: expected an expression',
        '',
        '<stdin>:1:7',
        '  │',
        '1 │ ( 1 + )',
        '  │       ▔',
      ].join('\n'),
    ],
    [
      // a trailing infix operator
      '1 + ',
      [
        'Error: expected an expression',
        '',
        '<stdin>:1:5',
        '  │',
        '1 │ 1 + ',
        '  │     ▔',
      ].join('\n'),
    ],
    [
      // a function with no body
      'a => ',
      [
        "Error: expected one of: a parameter, the function's body after `=>`",
        '',
        '<stdin>:1:6',
        '  │',
        '1 │ a => ',
        '  │      ▔',
      ].join('\n'),
    ],
    [
      // a signature with no return type
      'a ~> ',
      [
        'Error: expected a type after `~>`',
        '',
        '<stdin>:1:6',
        '  │',
        '1 │ a ~> ',
        '  │      ▔',
      ].join('\n'),
    ],
    [
      // a union with no final member
      ':Integer | ',
      [
        'Error: expected a union member after `|`',
        '',
        '<stdin>:1:12',
        '  │',
        '1 │ :Integer | ',
        '  │            ▔',
      ].join('\n'),
    ],
    [
      // a check with no type
      '1 ~ ',
      [
        'Error: expected a type after `~`',
        '',
        '<stdin>:1:5',
        '  │',
        '1 │ 1 ~ ',
        '  │     ▔',
      ].join('\n'),
    ],
    [
      // a key path with no final key
      ':a.',
      [
        'Error: expected a key after `.`',
        '',
        '<stdin>:1:4',
        '  │',
        '1 │ :a.',
        '  │    ▔',
      ].join('\n'),
    ],
    [
      // an at sign with no keyword
      '@',
      [
        'Error: expected a keyword name after `@`',
        '',
        '<stdin>:1:2',
        '  │',
        '1 │ @',
        '  │  ▔',
      ].join('\n'),
    ],
    [
      // a typed parameter with no type
      '(a: ) => 1',
      [
        'Error: expected an expression',
        '',
        '<stdin>:1:5',
        '  │',
        '1 │ (a: ) => 1',
        '  │     ▔',
      ].join('\n'),
    ],
    [
      // a colon with no key
      ':',
      [
        'Error: expected a name after `:`',
        '',
        '<stdin>:1:2',
        '  │',
        '1 │ :',
        '  │  ▔',
      ].join('\n'),
    ],
    [
      // an unmatched closing brace
      '}',
      [
        'Error: expected an expression',
        '',
        '<stdin>:1:1',
        '  │',
        '1 │ }',
        '  │ ▔',
      ].join('\n'),
    ],
    [
      // an unmatched closing parenthesis
      '1 + 1 )',
      [
        'Error: expected one of: an operator, `~>`, `~`, `|`, end of input',
        '',
        '<stdin>:1:7',
        '  │',
        '1 │ 1 + 1 )',
        '  │       ▔',
      ].join('\n'),
    ],
    [
      // an unterminated quoted atom
      '"hello',
      [
        'Error: expected `"`',
        '',
        '<stdin>:1:7',
        '  │',
        '1 │ "hello',
        '  │       ▔',
        '',
        'note: unclosed `"`',
        '<stdin>:1:1',
        '  │',
        '1 │ "hello',
        '  │ ▔',
      ].join('\n'),
    ],
    [
      // an unclosed parenthesis
      '(1 + 1',
      [
        'Error: expected one of: an expression, `)`',
        '',
        '<stdin>:1:7',
        '  │',
        '1 │ (1 + 1',
        '  │       ▔',
        '',
        'note: unclosed `(`',
        '<stdin>:1:1',
        '  │',
        '1 │ (1 + 1',
        '  │ ▔',
      ].join('\n'),
    ],
    [
      // an excess clause with no value
      '{ [:Atom]: }',
      [
        'Error: expected an expression',
        '',
        '<stdin>:1:12',
        '  │',
        '1 │ { [:Atom]: }',
        '  │            ▔',
      ].join('\n'),
    ],
    [
      // an unterminated block comment
      '/* unterminated',
      [
        'Error: expected `*/`',
        '',
        '<stdin>:1:16',
        '  │',
        '1 │ /* unterminated',
        '  │                ▔',
        '',
        'note: unclosed `/*`',
        '<stdin>:1:1',
        '  │',
        '1 │ /* unterminated',
        '  │ ▔▔',
      ].join('\n'),
    ],
    [
      // an unclosed argument list
      'f(',
      [
        'Error: expected one of: an expression, end of input',
        '',
        '<stdin>:1:2',
        '  │',
        '1 │ f(',
        '  │  ▔',
      ].join('\n'),
    ],
    [
      // an unfinished infix operation
      '1 + 1 +',
      [
        'Error: expected one of: an operator, `.`, `(`',
        '',
        '<stdin>:1:8',
        '  │',
        '1 │ 1 + 1 +',
        '  │        ▔',
      ].join('\n'),
    ],
    [
      // a failure on a later line
      '{\n  a: 1\n  b: (\n}',
      [
        'Error: expected one of: `?`, an expression, an atom, `(`',
        '',
        '<stdin>:4:1',
        '  │',
        '4 │ }',
        '  │ ▔',
      ].join('\n'),
    ],
    [
      // two unclosed objects
      '{ a: { b: 1',
      // prettier-ignore
      [
        'Error: expected one of: a value after `:`, `,`, `',
        '`, `}`',
        '',
        '<stdin>:1:12',
        '  │',
        '1 │ { a: { b: 1',
        '  │            ▔',
        '',
        'note: unclosed `{`',
        '<stdin>:1:6',
        '  │',
        '1 │ { a: { b: 1',
        '  │      ▔',
        '',
        'note: unclosed `{`',
        '<stdin>:1:1',
        '  │',
        '1 │ { a: { b: 1',
        '  │ ▔',
      ].join('\n'),
    ],
    [
      // a failure inside balanced delimiters
      '{ a: ( 1 + ) }',
      // prettier-ignore
      [
        'Error: expected an expression',
        '',
        '<stdin>:1:12',
        '  │',
        '1 │ { a: ( 1 + ) }',
        '  │            ▔',
      ].join('\n'),
    ],
  ],
)
