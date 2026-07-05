import either from '@matt.kantor/either'
import assert from 'node:assert'
import * as orderedRecord from '../../ordered-record.js'
import { testCases } from '../../test-utilities.test.js'
import type { Atom, SyntaxTree } from '../parsing.js'
import { parse } from '../parsing/parser.js'

type Entries = readonly (readonly [string, Atom | Entries])[]

const syntaxTree = (input: Atom | Entries): SyntaxTree =>
  typeof input === 'string' ? input : (
    orderedRecord.make(input.map(([key, value]) => [key, syntaxTree(value)]))
  )

testCases(parse, input => `parsing \`${input}\``)('parsing', [
  ['a', either.makeRight(syntaxTree('a'))],

  ['{}', either.makeRight(syntaxTree([]))],

  [
    ':a',
    either.makeRight(
      syntaxTree([
        ['0', '@lookup'],
        ['1', [['key', 'a']]],
      ]),
    ),
  ],

  [
    '{}.a',
    either.makeRight(
      syntaxTree([
        ['0', '@index'],
        [
          '1',
          [
            ['object', []],
            ['query', [['0', 'a']]],
          ],
        ],
      ]),
    ),
  ],

  [
    'a => b',
    either.makeRight(
      syntaxTree([
        ['0', '@function'],
        [
          '1',
          [
            ['parameter', 'a'],
            ['body', 'b'],
          ],
        ],
      ]),
    ),
  ],

  [
    'a => b => c',
    either.makeRight(
      syntaxTree([
        ['0', '@function'],
        [
          '1',
          [
            ['parameter', 'a'],
            [
              'body',
              [
                ['0', '@function'],
                [
                  '1',
                  [
                    ['parameter', 'b'],
                    ['body', 'c'],
                  ],
                ],
              ],
            ],
          ],
        ],
      ]),
    ),
  ],

  [
    '(a: b) => c',
    either.makeRight(
      syntaxTree([
        ['0', '@function'],
        [
          '1',
          [
            ['parameter', [['a', 'b']]],
            ['body', 'c'],
          ],
        ],
      ]),
    ),
  ],

  [
    '(a: :integer.type) => :a',
    either.makeRight(
      syntaxTree([
        ['0', '@function'],
        [
          '1',
          [
            [
              'parameter',
              [
                [
                  'a',
                  [
                    ['0', '@index'],
                    [
                      '1',
                      [
                        [
                          'object',
                          [
                            ['0', '@lookup'],
                            ['1', [['key', 'integer']]],
                          ],
                        ],
                        ['query', [['0', 'type']]],
                      ],
                    ],
                  ],
                ],
              ],
            ],
            [
              'body',
              [
                ['0', '@lookup'],
                ['1', [['key', 'a']]],
              ],
            ],
          ],
        ],
      ]),
    ),
  ],

  [
    '(a: b) => (c: d) => e',
    either.makeRight(
      syntaxTree([
        ['0', '@function'],
        [
          '1',
          [
            ['parameter', [['a', 'b']]],
            [
              'body',
              [
                ['0', '@function'],
                [
                  '1',
                  [
                    ['parameter', [['c', 'd']]],
                    ['body', 'e'],
                  ],
                ],
              ],
            ],
          ],
        ],
      ]),
    ),
  ],

  [
    'a => (b: c) => d',
    either.makeRight(
      syntaxTree([
        ['0', '@function'],
        [
          '1',
          [
            ['parameter', 'a'],
            [
              'body',
              [
                ['0', '@function'],
                [
                  '1',
                  [
                    ['parameter', [['b', 'c']]],
                    ['body', 'd'],
                  ],
                ],
              ],
            ],
          ],
        ],
      ]),
    ),
  ],

  [
    'a ~> b',
    either.makeRight(
      syntaxTree([
        ['0', '@function'],
        [
          '1',
          [
            ['parameter', [['_', 'a']]],
            ['body', 'b'],
          ],
        ],
      ]),
    ),
  ],
  [
    'a ~> b ~> c',
    either.makeRight(
      syntaxTree([
        ['0', '@function'],
        [
          '1',
          [
            ['parameter', [['_', 'a']]],
            [
              'body',
              [
                ['0', '@function'],
                [
                  '1',
                  [
                    ['parameter', [['_', 'b']]],
                    ['body', 'c'],
                  ],
                ],
              ],
            ],
          ],
        ],
      ]),
    ),
  ],

  [
    'a ~ b',
    either.makeRight(
      syntaxTree([
        ['0', '@check'],
        [
          '1',
          [
            ['value', 'a'],
            ['type', 'b'],
          ],
        ],
      ]),
    ),
  ],

  [
    ':a ~ :integer.type',
    either.makeRight(
      syntaxTree([
        ['0', '@check'],
        [
          '1',
          [
            [
              'value',
              [
                ['0', '@lookup'],
                ['1', [['key', 'a']]],
              ],
            ],
            [
              'type',
              [
                ['0', '@index'],
                [
                  '1',
                  [
                    [
                      'object',
                      [
                        ['0', '@lookup'],
                        ['1', [['key', 'integer']]],
                      ],
                    ],
                    ['query', [['0', 'type']]],
                  ],
                ],
              ],
            ],
          ],
        ],
      ]),
    ),
  ],

  [
    '(a => a)(a)',
    either.makeRight(
      syntaxTree([
        ['0', '@apply'],
        [
          '1',
          [
            [
              'function',
              [
                ['0', '@function'],
                [
                  '1',
                  [
                    ['parameter', 'a'],
                    ['body', 'a'],
                  ],
                ],
              ],
            ],
            ['argument', 'a'],
          ],
        ],
      ]),
    ),
  ],

  [
    '1 + 1',
    either.makeRight(
      syntaxTree([
        ['0', '@apply'],
        [
          '1',
          [
            [
              'function',
              [
                ['0', '@apply'],
                [
                  '1',
                  [
                    [
                      'function',
                      [
                        ['0', '@lookup'],
                        ['1', [['key', '+']]],
                      ],
                    ],
                    ['argument', '1'],
                  ],
                ],
              ],
            ],
            ['argument', '1'],
          ],
        ],
      ]),
    ),
  ],

  [
    'a | b',
    either.makeRight(
      syntaxTree([
        ['0', '@union'],
        [
          '1',
          [
            ['0', 'a'],
            ['1', 'b'],
          ],
        ],
      ]),
    ),
  ],

  [
    '?a',
    either.makeRight(
      syntaxTree([
        ['0', '@hole'],
        [
          '1',
          [
            ['name', 'a'],
            [
              'constraint',
              [
                [
                  'assignableTo',
                  [
                    ['0', '@index'],
                    [
                      '1',
                      [
                        [
                          'object',
                          [
                            ['0', '@lookup'],
                            ['1', [['key', 'something']]],
                          ],
                        ],
                        ['query', [['0', 'type']]],
                      ],
                    ],
                  ],
                ],
              ],
            ],
          ],
        ],
      ]),
    ),
  ],

  [
    '(?a: :atom.type)',
    either.makeRight(
      syntaxTree([
        ['0', '@hole'],
        [
          '1',
          [
            ['name', 'a'],
            [
              'constraint',
              [
                [
                  'assignableTo',
                  [
                    ['0', '@index'],
                    [
                      '1',
                      [
                        [
                          'object',
                          [
                            ['0', '@lookup'],
                            ['1', [['key', 'atom']]],
                          ],
                        ],
                        ['query', [['0', 'type']]],
                      ],
                    ],
                  ],
                ],
              ],
            ],
          ],
        ],
      ]),
    ),
  ],

  // `|`s in atoms must generally be quoted, with a few exceptions.
  [
    '|',
    result => {
      assert(either.isLeft(result))
    },
  ],
  ['"|"', either.makeRight(syntaxTree('|'))],
  ['||', either.makeRight(syntaxTree('||'))],
  ['|>', either.makeRight(syntaxTree('|>'))],
  ['<|', either.makeRight(syntaxTree('<|'))],
  [
    '||invalid',
    result => {
      assert(either.isLeft(result))
    },
  ],
  [
    'invalid||',
    result => {
      assert(either.isLeft(result))
    },
  ],
  ['"||valid"', either.makeRight(syntaxTree('||valid'))],
  ['"valid||"', either.makeRight(syntaxTree('valid||'))],
])
