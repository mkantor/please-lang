import either from '@matt.kantor/either'
import assert from 'node:assert'
import type { JsonValue } from '../../../../utility-types.js'
import {
  arrayToMolecule,
  makeIndexExpression,
  makeLookupExpression,
  objectNodeFromMolecule,
  serialize,
} from '../../../semantics.js'
import { prettyJson, unparse } from '../../../unparsing.js'
import { elaborationSuite, success } from '../test-utilities.test.js'

const resolve = (
  lookupKey: string,
  ...indexQuery: readonly string[]
): JsonValue =>
  either.unwrapOrElse(
    either.map(
      either.flatMap(
        serialize(
          indexQuery.length === 0 ?
            makeLookupExpression(lookupKey)
          : makeIndexExpression({
              object: makeLookupExpression(lookupKey),
              query: objectNodeFromMolecule(arrayToMolecule(indexQuery)),
            }),
        ),
        molecule => unparse(molecule, prettyJson),
      ),
      json =>
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        JSON.parse(json) as JsonValue,
    ),
    error => {
      throw new Error(error.message, { cause: error })
    },
  )

elaborationSuite('@object', [
  [
    {
      0: '@apply',
      1: {
        function: {
          0: '@function',
          1: {
            parameter: {
              x: {
                0: '@object',
                1: {
                  properties: { a: resolve('integer', 'type') },
                  excess: {
                    0: {
                      0: resolve('atom', 'type'),
                      1: resolve('something', 'type'),
                    },
                  },
                },
              },
            },
            body: resolve('x', 'a'),
          },
        },
        argument: { a: 42, b: 'extra' },
      },
    },
    success('42'),
  ],
  [
    {
      0: '@apply',
      1: {
        function: {
          0: '@function',
          1: {
            parameter: {
              x: {
                0: '@object',
                1: {
                  properties: {},
                  excess: {
                    0: {
                      0: resolve('atom', 'type'),
                      1: resolve('integer', 'type'),
                    },
                  },
                },
              },
            },
            body: resolve('x'),
          },
        },
        argument: { a: 1, b: 2 },
      },
    },
    success({ a: 1, b: 2 }),
  ],
  [
    {
      0: '@apply',
      1: {
        function: {
          0: '@function',
          1: {
            parameter: {
              x: {
                0: '@object',
                1: {
                  properties: {},
                  excess: {
                    0: {
                      0: resolve('atom', 'type'),
                      1: resolve('integer', 'type'),
                    },
                  },
                },
              },
            },
            body: resolve('x'),
          },
        },
        argument: { a: 'hello' },
      },
    },
    output => {
      assert(either.isLeft(output))
      assert.deepEqual(output.value.kind, 'typeMismatch')
    },
  ],
  [
    {
      0: '@apply',
      1: {
        function: {
          0: '@function',
          1: {
            parameter: {
              x: {
                0: '@object',
                1: {
                  properties: { a: resolve('integer', 'type') },
                  excess: {
                    0: {
                      0: resolve('atom', 'type'),
                      1: resolve('nothing', 'type'),
                    },
                  },
                },
              },
            },
            body: resolve('x'),
          },
        },
        argument: { a: 1, b: 2 },
      },
    },
    output => {
      assert(either.isLeft(output))
      assert.deepEqual(output.value.kind, 'typeMismatch')
    },
  ],
  [
    {
      0: '@apply',
      1: {
        function: {
          0: '@function',
          1: {
            parameter: {
              x: {
                0: '@object',
                1: {
                  properties: { a: resolve('integer', 'type') },
                  excess: {
                    0: {
                      0: resolve('atom', 'type'),
                      1: resolve('nothing', 'type'),
                    },
                  },
                },
              },
            },
            body: resolve('x'),
          },
        },
        argument: { a: 1 },
      },
    },
    success({ a: '1' }),
  ],
  [
    {
      closed: {
        0: '@object',
        1: {
          properties: {},
          excess: {
            0: {
              0: resolve('atom', 'type'),
              1: resolve('nothing', 'type'),
            },
          },
        },
      },
      result: {
        0: '@apply',
        1: {
          function: {
            0: '@function',
            1: {
              parameter: { x: resolve('closed') },
              body: resolve('x'),
            },
          },
          argument: { a: 1 },
        },
      },
    },
    output => {
      assert(either.isLeft(output))
      assert.deepEqual(output.value.kind, 'typeMismatch')
    },
  ],
  [
    {
      0: '@apply',
      1: {
        function: {
          0: '@function',
          1: {
            parameter: {
              x: {
                0: '@object',
                1: {
                  properties: {},
                  excess: {
                    0: {
                      0: resolve('natural_number', 'type'),
                      1: resolve('integer', 'type'),
                    },
                  },
                },
              },
            },
            body: resolve('x'),
          },
        },
        argument: { 0: -5, foo: {} },
      },
    },
    success({ 0: -5, foo: {} }),
  ],
  [
    {
      0: '@apply',
      1: {
        function: {
          0: '@function',
          1: {
            parameter: {
              x: {
                0: '@object',
                1: {
                  properties: {},
                  excess: {
                    0: {
                      0: resolve('natural_number', 'type'),
                      1: resolve('integer', 'type'),
                    },
                  },
                },
              },
            },
            body: resolve('x'),
          },
        },
        argument: { 0: 'hello' },
      },
    },
    output => {
      assert(either.isLeft(output))
      assert.deepEqual(output.value.kind, 'typeMismatch')
    },
  ],
  [
    {
      0: '@apply',
      1: {
        function: {
          0: '@function',
          1: {
            parameter: {
              x: {
                0: '@hole',
                1: {
                  name: '_',
                  constraint: {
                    assignableTo: {
                      0: '@object',
                      1: {
                        properties: {},
                        excess: {
                          0: {
                            0: resolve('atom', 'type'),
                            1: resolve('atom', 'type'),
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            body: resolve('x'),
          },
        },
        argument: { hello: 'world' },
      },
    },
    success({ hello: 'world' }),
  ],
  [
    {
      0: '@apply',
      1: {
        function: {
          0: '@function',
          1: {
            parameter: {
              x: {
                0: '@hole',
                1: {
                  name: '_',
                  constraint: {
                    assignableTo: {
                      0: '@object',
                      1: {
                        properties: {},
                        excess: {
                          0: {
                            0: resolve('atom', 'type'),
                            1: resolve('atom', 'type'),
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            body: resolve('x'),
          },
        },
        argument: { not_an_atom: {} },
      },
    },
    output => {
      assert(either.isLeft(output))
      assert.deepEqual(output.value.kind, 'typeMismatch')
    },
  ],
  [
    {
      0: '@check',
      1: {
        value: { a: 1 },
        type: {
          0: '@object',
          1: {
            properties: {},
            excess: {
              0: {
                0: resolve('atom', 'type'),
                1: resolve('atom', 'type'),
              },
            },
          },
        },
      },
    },
    success({ a: '1' }),
  ],
  [
    {
      0: '@check',
      1: {
        value: { a: {} },
        type: {
          0: '@object',
          1: {
            properties: {},
            excess: {
              0: {
                0: resolve('atom', 'type'),
                1: resolve('atom', 'type'),
              },
            },
          },
        },
      },
    },
    output => {
      assert(either.isLeft(output))
      assert.deepEqual(output.value.kind, 'typeMismatch')
    },
  ],
  [
    {
      0: '@check',
      1: {
        value: { a: 1 },
        type: {
          0: '@object',
          1: {
            properties: { a: resolve('integer', 'type') },
            excess: {
              0: {
                0: resolve('atom', 'type'),
                1: resolve('nothing', 'type'),
              },
            },
          },
        },
      },
    },
    success({ a: '1' }),
  ],
  [
    {
      0: '@check',
      1: {
        value: { a: 1, b: 2 },
        type: {
          0: '@object',
          1: {
            properties: { a: resolve('integer', 'type') },
            excess: {
              0: {
                0: resolve('atom', 'type'),
                1: resolve('nothing', 'type'),
              },
            },
          },
        },
      },
    },
    output => {
      assert(either.isLeft(output))
      assert.deepEqual(output.value.kind, 'typeMismatch')
    },
  ],
  [
    {
      0: '@check',
      1: {
        value: { a: { b: 1, c: 2 } },
        type: {
          0: '@object',
          1: {
            properties: { a: { b: resolve('integer', 'type') } },
            excess: {
              0: {
                0: resolve('atom', 'type'),
                1: resolve('nothing', 'type'),
              },
            },
          },
        },
      },
    },
    success({ a: { b: '1', c: '2' } }),
  ],
  [
    {
      0: '@check',
      1: {
        value: { a: { b: 1, c: 2 } },
        type: {
          0: '@object',
          1: {
            properties: {
              a: {
                0: '@object',
                1: {
                  properties: { b: resolve('integer', 'type') },
                  excess: {
                    0: {
                      0: resolve('atom', 'type'),
                      1: resolve('nothing', 'type'),
                    },
                  },
                },
              },
            },
            excess: {
              0: {
                0: resolve('atom', 'type'),
                1: resolve('nothing', 'type'),
              },
            },
          },
        },
      },
    },
    output => {
      assert(either.isLeft(output))
      assert.deepEqual(output.value.kind, 'typeMismatch')
    },
  ],
  [
    {
      0: '@check',
      1: {
        value: { a: 1, b: 2 },
        type: {
          0: '@union',
          1: {
            0: {
              0: '@object',
              1: {
                properties: { b: resolve('integer', 'type') },
                excess: {
                  0: {
                    0: resolve('atom', 'type'),
                    1: resolve('nothing', 'type'),
                  },
                },
              },
            },
          },
        },
      },
    },
    output => {
      assert(either.isLeft(output))
      assert.deepEqual(output.value.kind, 'typeMismatch')
    },
  ],
  [
    {
      0: '@check',
      1: {
        value: { 1: 'hello', name: {} },
        type: {
          0: '@object',
          1: {
            properties: {},
            excess: {
              0: {
                0: resolve('natural_number', 'type'),
                1: resolve('atom', 'type'),
              },
            },
          },
        },
      },
    },
    success({ 1: 'hello', name: {} }),
  ],
  [
    {
      0: '@check',
      1: {
        value: { 1: {} },
        type: {
          0: '@object',
          1: {
            properties: {},
            excess: {
              0: {
                0: resolve('natural_number', 'type'),
                1: resolve('atom', 'type'),
              },
            },
          },
        },
      },
    },
    output => {
      assert(either.isLeft(output))
      assert.deepEqual(output.value.kind, 'typeMismatch')
    },
  ],
  // A key inhabiting several clauses' domains is bounded by the last matching
  // clause.
  [
    {
      0: '@check',
      1: {
        value: { 1: 'hello' },
        type: {
          0: '@object',
          1: {
            properties: {},
            excess: {
              0: {
                0: resolve('atom', 'type'),
                1: resolve('nothing', 'type'),
              },
              1: {
                0: resolve('natural_number', 'type'),
                1: resolve('atom', 'type'),
              },
            },
          },
        },
      },
    },
    success({ 1: 'hello' }),
  ],
  [
    {
      0: '@check',
      1: {
        value: { 1: 'hello' },
        type: {
          0: '@object',
          1: {
            properties: {},
            excess: {
              0: {
                0: resolve('atom', 'type'),
                1: resolve('atom', 'type'),
              },
              1: {
                0: resolve('natural_number', 'type'),
                1: resolve('integer', 'type'),
              },
            },
          },
        },
      },
    },
    output => {
      assert(either.isLeft(output))
      assert.deepEqual(output.value.kind, 'typeMismatch')
    },
  ],
  [
    {
      0: '@check',
      1: {
        value: { name: 'x' },
        type: {
          0: '@object',
          1: {
            properties: {},
            excess: {
              0: {
                0: resolve('atom', 'type'),
                1: resolve('nothing', 'type'),
              },
              1: {
                0: resolve('natural_number', 'type'),
                1: resolve('atom', 'type'),
              },
            },
          },
        },
      },
    },
    output => {
      assert(either.isLeft(output))
      assert.deepEqual(output.value.kind, 'typeMismatch')
    },
  ],
  [
    {
      0: '@check',
      1: {
        value: { x: 'hello' },
        type: {
          0: '@object',
          1: {
            properties: {},
            excess: {
              0: {
                0: resolve('atom', 'type'),
                1: resolve('atom', 'type'),
              },
              1: {
                0: resolve('natural_number', 'type'),
                1: resolve('integer', 'type'),
              },
            },
          },
        },
      },
    },
    success({ x: 'hello' }),
  ],
  [
    {
      0: '@check',
      1: {
        value: { a: 'hello' },
        type: {
          0: '@object',
          1: {
            properties: { a: resolve('atom', 'type') },
            excess: {
              0: { 0: 'a', 1: resolve('nothing', 'type') },
            },
          },
        },
      },
    },
    success({ a: 'hello' }),
  ],
  [
    {
      0: '@check',
      1: {
        value: { a: 'hello', b: 'x' },
        type: {
          0: '@object',
          1: {
            properties: { a: resolve('atom', 'type') },
            excess: {
              0: {
                0: { 0: '@union', 1: { 0: 'a', 1: 'b' } },
                1: resolve('nothing', 'type'),
              },
            },
          },
        },
      },
    },
    output => {
      assert(either.isLeft(output))
      assert.deepEqual(output.value.kind, 'typeMismatch')
    },
  ],
  [
    {
      0: '@check',
      1: {
        value: {},
        type: {
          0: '@object',
          1: { properties: {} },
        },
      },
    },
    output => {
      assert(either.isLeft(output))
      assert.deepEqual(output.value.kind, 'invalidExpression')
    },
  ],
  [
    {
      0: '@check',
      1: {
        value: {},
        type: {
          0: '@object',
          1: {
            excess: {
              0: {
                0: resolve('atom', 'type'),
                1: resolve('something', 'type'),
              },
            },
          },
        },
      },
    },
    output => {
      assert(either.isLeft(output))
      assert.deepEqual(output.value.kind, 'invalidExpression')
    },
  ],
  [
    {
      0: '@check',
      1: {
        value: {},
        type: { 0: '@object', 1: {} },
      },
    },
    output => {
      assert(either.isLeft(output))
      assert.deepEqual(output.value.kind, 'invalidExpression')
    },
  ],
  [
    {
      0: '@check',
      1: {
        value: {},
        type: {
          0: '@object',
          1: {
            properties: 'not an object',
            excess: {
              0: {
                0: resolve('atom', 'type'),
                1: resolve('something', 'type'),
              },
            },
          },
        },
      },
    },
    output => {
      assert(either.isLeft(output))
      assert.deepEqual(output.value.kind, 'invalidExpression')
    },
  ],
])
