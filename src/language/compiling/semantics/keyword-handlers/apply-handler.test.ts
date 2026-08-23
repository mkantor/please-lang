import either from '@matt.kantor/either'
import option from '@matt.kantor/option'
import assert from 'node:assert'
import * as orderedRecord from '../../../../ordered-record.js'
import {
  compileWithoutSpans,
  parseAndCompileAndRun,
  testCases,
  toSyntaxTree,
} from '../../../../test-utilities.test.js'
import type { Atom, Molecule } from '../../../parsing.js'
import { parse } from '../../../parsing/parser.js'
import { elaborationSuite, success } from '../test-utilities.test.js'

elaborationSuite('@apply', [
  [
    { 0: '@apply', 1: { 0: { 0: '@lookup', 1: { key: 'identity' } }, 1: 'a' } },
    success('a'),
  ],
  [
    {
      0: '@apply',
      1: {
        function: { 0: '@lookup', 1: { key: 'identity' } },
        argument: 'a',
      },
    },
    success('a'),
  ],
  [
    {
      0: '@apply',
      1: {
        function: { 0: '@lookup', 1: { key: 'identity' } },
        argument: { foo: 'bar' },
      },
    },
    success({ foo: 'bar' }),
  ],
  [
    { 0: '@apply', 1: { function: 'not a function', argument: 'a' } },
    output => {
      assert(either.isLeft(output))
    },
  ],
  [
    {
      0: '@apply',
      1: {
        function: {
          0: '@function',
          1: { 0: 'x', 1: { 0: '@lookup', 1: { 0: 'x' } } },
        },
        argument: 'identity is identical',
      },
    },
    success('identity is identical'),
  ],
  [
    {
      0: '@apply',
      1: {
        function: {
          0: '@function',
          1: {
            parameter: 'a',
            body: {
              0: '@apply',
              1: {
                function: {
                  0: '@function',
                  1: {
                    parameter: 'b',
                    body: {
                      A: { 0: '@lookup', 1: { key: 'a' } },
                      B: { 0: '@lookup', 1: { key: 'b' } },
                    },
                  },
                },
                argument: 'b',
              },
            },
          },
        },
        argument: 'a',
      },
    },
    success({ A: 'a', B: 'b' }),
  ],
  [
    {
      0: '@apply',
      1: {
        function: {
          0: '@function',
          1: {
            0: {
              x: {
                0: '@index',
                1: {
                  0: { 0: '@lookup', 1: { 0: 'boolean' } },
                  1: { 0: 'type' },
                },
              },
            },
            1: {
              0: '@apply',
              1: {
                function: {
                  0: '@index',
                  1: {
                    0: { 0: '@lookup', 1: { 0: 'boolean' } },
                    1: { 0: 'not' },
                  },
                },
                argument: { 0: '@lookup', 1: { 0: 'x' } },
              },
            },
          },
        },
        argument: 'false',
      },
    },
    success('true'),
  ],
  [
    {
      0: '@apply',
      1: {
        function: {
          0: '@function',
          1: {
            0: { x: { a: 'it works' } },
            1: {
              0: '@index',
              1: {
                0: { 0: '@lookup', 1: { 0: 'x' } },
                1: { 0: 'a' },
              },
            },
          },
        },
        argument: { a: 'it works' },
      },
    },
    success('it works'),
  ],
  [
    // {
    //   a: "a"
    //   b: (a => {
    //     a: "b"
    //     b: (a => :a)("it works")
    //   })("unused")
    // }
    {
      a: 'a',
      b: {
        0: '@apply',
        1: {
          function: {
            0: '@function',
            1: {
              parameter: 'a',
              body: {
                a: 'b',
                b: {
                  0: '@apply',
                  1: {
                    function: {
                      0: '@function',
                      1: {
                        parameter: 'a',
                        body: {
                          0: '@lookup',
                          1: { key: 'a' },
                        },
                      },
                    },
                    argument: 'it works',
                  },
                },
              },
            },
          },
          argument: 'unused',
        },
      },
    },
    success({
      a: 'a',
      b: {
        a: 'b',
        b: 'it works',
      },
    }),
  ],
  [
    // {
    //   a: "a"
    //   b: (a => {
    //     a: "it works"
    //     b: (a => :a)(:a)
    //   })("unused")
    // }
    {
      a: 'a',
      b: {
        0: '@apply',
        1: {
          function: {
            0: '@function',
            1: {
              parameter: 'a',
              body: {
                a: 'it works',
                b: {
                  0: '@apply',
                  1: {
                    function: {
                      0: '@function',
                      1: {
                        parameter: 'a',
                        body: { 0: '@lookup', 1: { key: 'a' } },
                      },
                    },
                    argument: { 0: '@lookup', 1: { key: 'a' } },
                  },
                },
              },
            },
          },
          argument: 'unused',
        },
      },
    },
    success({
      a: 'a',
      b: {
        a: 'it works',
        b: 'it works',
      },
    }),
  ],
  [
    // {
    //   a:"it works"
    //   b: (a => {
    //     b: (a => :a)(:a)
    //   })(:a)
    // }
    {
      a: 'it works',
      b: {
        0: '@apply',
        1: {
          function: {
            0: '@function',
            1: {
              parameter: 'a',
              body: {
                b: {
                  0: '@apply',
                  1: {
                    function: {
                      0: '@function',
                      1: {
                        parameter: 'a',
                        body: { 0: '@lookup', 1: { key: 'a' } },
                      },
                    },
                    argument: { 0: '@lookup', 1: { key: 'a' } },
                  },
                },
              },
            },
          },
          argument: { 0: '@lookup', 1: { key: 'a' } },
        },
      },
    },
    success({
      a: 'it works',
      b: {
        b: 'it works',
      },
    }),
  ],
  [
    // {
    //   a: "a"
    //   b: (a => {
    //     a: "it works"
    //     b: (b => :a)("unused")
    //   })("unused")
    // }
    {
      a: 'a',
      b: {
        0: '@apply',
        1: {
          function: {
            0: '@function',
            1: {
              parameter: 'a',
              body: {
                a: 'it works',
                b: {
                  0: '@apply',
                  1: {
                    function: {
                      0: '@function',
                      1: {
                        parameter: 'b',
                        body: { 0: '@lookup', 1: { key: 'a' } },
                      },
                    },
                    argument: 'unused',
                  },
                },
              },
            },
          },
          argument: 'unused',
        },
      },
    },
    success({
      a: 'a',
      b: {
        a: 'it works',
        b: 'it works',
      },
    }),
  ],
  [
    // {
    //   a: "it works"
    //   b: (b => {
    //     b: "b"
    //     c: (b => :a)("unused")
    //   })("unused")
    // }
    {
      a: 'it works',
      b: {
        0: '@apply',
        1: {
          function: {
            0: '@function',
            1: {
              parameter: 'b',
              body: {
                b: 'b',
                c: {
                  0: '@apply',
                  1: {
                    function: {
                      0: '@function',
                      1: {
                        parameter: 'b',
                        body: { 0: '@lookup', 1: { key: 'a' } },
                      },
                    },
                    argument: 'unused',
                  },
                },
              },
            },
          },
          argument: 'unused',
        },
      },
    },
    success({
      a: 'it works',
      b: {
        b: 'b',
        c: 'it works',
      },
    }),
  ],
])

const stuckApplication =
  '{ f: (n: :Integer) => :n, x: @runtime { _context => 1 }, main: :f(:x) }'

const valueAtKeyPath = (
  value: Atom | Molecule,
  keyPath: readonly string[],
): Atom | Molecule | undefined =>
  keyPath.reduce<Atom | Molecule | undefined>(
    (valueSoFar, key) =>
      valueSoFar === undefined || typeof valueSoFar === 'string' ?
        undefined
      : option.match(orderedRecord.get(valueSoFar, key), {
          none: () => undefined,
          some: propertyValue => propertyValue,
        }),
    value,
  )

testCases(
  (input: string) => either.flatMap(parse(input), compileWithoutSpans),
  input => `compiling \`${input}\``,
)('residual form of stuck applications', [
  [
    stuckApplication,
    output => {
      assert(either.isRight(output))
      assert.deepEqual(
        valueAtKeyPath(output.value, ['main', '1', 'function', '0']),
        '@lookup',
      )
    },
  ],
])

testCases(parseAndCompileAndRun, input => `running \`${input}\``)(
  'evaluation of stuck applications',
  [
    [
      `${stuckApplication}.main`,
      output => {
        assert(either.isRight(output))
        assert.deepEqual(output.value, toSyntaxTree('1'))
      },
    ],
  ],
)
