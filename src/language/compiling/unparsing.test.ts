import either from '@matt.kantor/either'
import assert from 'node:assert'
import { stripVTControlCharacters } from 'node:util'
import {
  compileWithoutSpans,
  testCases,
  toSyntaxTree,
} from '../../test-utilities.test.js'
import type { JsonValue } from '../../utility-types.js'
import { parseJson } from '../parsing.js'
import { parse } from '../parsing/parser.js'
import {
  inlinePlz,
  prettyJson,
  prettyPlz,
  sugarFreeInlinePlz,
  sugarFreePrettyPlz,
  unparse,
  type Notation,
} from '../unparsing.js'

const unparsers = (rawValue: JsonValue) => {
  const value = toSyntaxTree(rawValue)
  const unparseAndStripAnsi = (notation: Notation) =>
    either.map(
      unparse(value, notation),
      stripVTControlCharacters, // terminal styling is not currently tested
    )

  const unparsedInlinePlz = unparseAndStripAnsi(inlinePlz)
  const unparsedSugarFreeInlinePlz = unparseAndStripAnsi(sugarFreeInlinePlz)
  const unparsedSugarFreePrettyPlz = unparseAndStripAnsi(sugarFreePrettyPlz)
  const unparsedPrettyPlz = unparseAndStripAnsi(prettyPlz)
  const unparsedPrettyJson = unparseAndStripAnsi(prettyJson)

  return {
    inlinePlz: either.flatMap(
      either.flatMap(unparsedInlinePlz, parse),
      roundtrippedValue => {
        assert.deepEqual(
          compileWithoutSpans(roundtrippedValue).value,
          compileWithoutSpans(value).value,
        )
        return unparsedInlinePlz
      },
    ).value,
    sugarFreeInlinePlz: either.flatMap(
      either.flatMap(unparsedSugarFreeInlinePlz, parse),
      roundtrippedValue => {
        assert.deepEqual(
          compileWithoutSpans(roundtrippedValue).value,
          compileWithoutSpans(value).value,
        )
        return unparsedSugarFreeInlinePlz
      },
    ).value,
    prettyPlz: either.flatMap(
      either.flatMap(unparsedPrettyPlz, parse),
      roundtrippedValue => {
        assert.deepEqual(
          compileWithoutSpans(roundtrippedValue).value,
          compileWithoutSpans(value).value,
        )
        return unparsedPrettyPlz
      },
    ).value,
    sugarFreePrettyPlz: either.flatMap(
      either.flatMap(unparsedSugarFreePrettyPlz, parse),
      roundtrippedValue => {
        assert.deepEqual(
          compileWithoutSpans(roundtrippedValue).value,
          compileWithoutSpans(value).value,
        )
        return unparsedSugarFreePrettyPlz
      },
    ).value,
    prettyJson: either.flatMap(
      either.flatMap(unparsedPrettyJson, parseJson),
      roundtrippedValue => {
        assert.deepEqual(roundtrippedValue, value)
        return unparsedPrettyJson
      },
    ).value,
  }
}

testCases(unparsers, input => `unparsing \`${JSON.stringify(input)}\``)(
  'unparsing',
  [
    [
      {},
      {
        inlinePlz: '{}',
        sugarFreeInlinePlz: '{}',
        prettyPlz: '{}\n',
        sugarFreePrettyPlz: '{}\n',
        prettyJson: '{}\n',
      },
    ],

    [
      'a',
      {
        inlinePlz: 'a',
        sugarFreeInlinePlz: 'a',
        prettyPlz: 'a\n',
        sugarFreePrettyPlz: 'a\n',
        prettyJson: '"a"\n',
      },
    ],

    [
      'Hello, world!',
      {
        inlinePlz: '"Hello, world!"',
        sugarFreeInlinePlz: '"Hello, world!"',
        prettyPlz: '"Hello, world!"\n',
        sugarFreePrettyPlz: '"Hello, world!"\n',
        prettyJson: '"Hello, world!"\n',
      },
    ],

    [
      '@test',
      {
        inlinePlz: '"@test"',
        sugarFreeInlinePlz: '"@test"',
        prettyPlz: '"@test"\n',
        sugarFreePrettyPlz: '"@test"\n',
        prettyJson: '"@test"\n',
      },
    ],

    [
      { 0: 'a' },
      {
        inlinePlz: '{ a }',
        sugarFreeInlinePlz: '{ 0: a }',
        prettyPlz: '{\n  a\n}\n',
        sugarFreePrettyPlz: '{\n  0: a\n}\n',
        prettyJson: '{\n  "0": "a"\n}\n',
      },
    ],

    [
      { 1: 'a' },
      {
        inlinePlz: '{ 1: a }',
        sugarFreeInlinePlz: '{ 1: a }',
        prettyPlz: '{\n  1: a\n}\n',
        sugarFreePrettyPlz: '{\n  1: a\n}\n',
        prettyJson: '{\n  "1": "a"\n}\n',
      },
    ],

    [
      { 0: 'a', 1: 'b', 3: 'c', somethingElse: 'd' },
      {
        inlinePlz: '{ a, b, 3: c, somethingElse: d }',
        sugarFreeInlinePlz: '{ 0: a, 1: b, 3: c, somethingElse: d }',
        prettyPlz: '{\n  a\n  b\n  3: c\n  somethingElse: d\n}\n',
        sugarFreePrettyPlz:
          '{\n  0: a\n  1: b\n  3: c\n  somethingElse: d\n}\n',
        prettyJson:
          '{\n  "0": "a",\n  "1": "b",\n  "3": "c",\n  "somethingElse": "d"\n}\n',
      },
    ],

    [
      { a: { b: { c: 'd' } } },
      {
        inlinePlz: '{ a: { b: { c: d } } }',
        sugarFreeInlinePlz: '{ a: { b: { c: d } } }',
        prettyPlz: '{\n  a: {\n    b: {\n      c: d\n    }\n  }\n}\n',
        sugarFreePrettyPlz: '{\n  a: {\n    b: {\n      c: d\n    }\n  }\n}\n',
        prettyJson: '{\n  "a": {\n    "b": {\n      "c": "d"\n    }\n  }\n}\n',
      },
    ],

    [
      {
        identity: {
          0: '@function',
          1: {
            parameter: 'a',
            body: { 0: '@lookup', 1: { 0: 'a' } },
          },
        },
        test: {
          0: '@apply',
          1: {
            function: { 0: '@lookup', 1: { 0: 'identity' } },
            argument: 'it works!',
          },
        },
      },
      {
        inlinePlz: '{ identity: a => :a, test: :identity("it works!") }',
        sugarFreeInlinePlz:
          '{ identity: { 0: "@function", 1: { parameter: a, body: { 0: "@lookup", 1: { 0: a } } } }, test: { 0: "@apply", 1: { function: { 0: "@lookup", 1: { 0: identity } }, argument: "it works!" } } }',
        prettyPlz:
          '{\n  identity: a => :a\n  test: :identity("it works!")\n}\n',
        sugarFreePrettyPlz:
          '{\n  identity: {\n    0: "@function"\n    1: {\n      parameter: a\n      body: {\n        0: "@lookup"\n        1: {\n          0: a\n        }\n      }\n    }\n  }\n  test: {\n    0: "@apply"\n    1: {\n      function: {\n        0: "@lookup"\n        1: {\n          0: identity\n        }\n      }\n      argument: "it works!"\n    }\n  }\n}\n',
        prettyJson:
          '{\n  "identity": {\n    "0": "@function",\n    "1": {\n      "parameter": "a",\n      "body": {\n        "0": "@lookup",\n        "1": {\n          "0": "a"\n        }\n      }\n    }\n  },\n  "test": {\n    "0": "@apply",\n    "1": {\n      "function": {\n        "0": "@lookup",\n        "1": {\n          "0": "identity"\n        }\n      },\n      "argument": "it works!"\n    }\n  }\n}\n',
      },
    ],

    [
      {
        0: '@function',
        1: {
          parameter: { a: 'a' },
          body: { 0: '@lookup', 1: { 0: 'a' } },
        },
      },
      {
        inlinePlz: '(a: a) => :a',
        sugarFreeInlinePlz:
          '{ 0: "@function", 1: { parameter: { a: a }, body: { 0: "@lookup", 1: { 0: a } } } }',
        prettyPlz: '(a: a) => :a\n',
        sugarFreePrettyPlz:
          '{\n  0: "@function"\n  1: {\n    parameter: {\n      a: a\n    }\n    body: {\n      0: "@lookup"\n      1: {\n        0: a\n      }\n    }\n  }\n}\n',
        prettyJson:
          '{\n  "0": "@function",\n  "1": {\n    "parameter": {\n      "a": "a"\n    },\n    "body": {\n      "0": "@lookup",\n      "1": {\n        "0": "a"\n      }\n    }\n  }\n}\n',
      },
    ],

    [
      {
        0: '@apply',
        1: {
          function: {
            0: '@function',
            1: {
              parameter: 'a',
              body: { 0: '@lookup', 1: { 0: 'a' } },
            },
          },
          argument: 'it works!',
        },
      },
      {
        inlinePlz: '(a => :a)("it works!")',
        sugarFreeInlinePlz:
          '{ 0: "@apply", 1: { function: { 0: "@function", 1: { parameter: a, body: { 0: "@lookup", 1: { 0: a } } } }, argument: "it works!" } }',
        prettyPlz: '(a => :a)("it works!")\n',
        sugarFreePrettyPlz:
          '{\n  0: "@apply"\n  1: {\n    function: {\n      0: "@function"\n      1: {\n        parameter: a\n        body: {\n          0: "@lookup"\n          1: {\n            0: a\n          }\n        }\n      }\n    }\n    argument: "it works!"\n  }\n}\n',
        prettyJson:
          '{\n  "0": "@apply",\n  "1": {\n    "function": {\n      "0": "@function",\n      "1": {\n        "parameter": "a",\n        "body": {\n          "0": "@lookup",\n          "1": {\n            "0": "a"\n          }\n        }\n      }\n    },\n    "argument": "it works!"\n  }\n}\n',
      },
    ],

    [
      {
        0: '@runtime',
        1: {
          0: {
            0: '@function',
            1: {
              parameter: 'context',
              body: {
                0: '@index',
                1: {
                  object: { 0: '@lookup', 1: { key: 'context' } },
                  query: { 0: 'program', 1: 'start_time' },
                },
              },
            },
          },
        },
      },
      {
        inlinePlz: '@runtime { context => :context.program.start_time }',
        sugarFreeInlinePlz:
          '{ 0: "@runtime", 1: { 0: { 0: "@function", 1: { parameter: context, body: { 0: "@index", 1: { object: { 0: "@lookup", 1: { key: context } }, query: { 0: program, 1: start_time } } } } } } }',
        prettyPlz: '@runtime {\n  context => :context.program.start_time\n}\n',
        sugarFreePrettyPlz:
          '{\n  0: "@runtime"\n  1: {\n    0: {\n      0: "@function"\n      1: {\n        parameter: context\n        body: {\n          0: "@index"\n          1: {\n            object: {\n              0: "@lookup"\n              1: {\n                key: context\n              }\n            }\n            query: {\n              0: program\n              1: start_time\n            }\n          }\n        }\n      }\n    }\n  }\n}\n',
        prettyJson:
          '{\n  "0": "@runtime",\n  "1": {\n    "0": {\n      "0": "@function",\n      "1": {\n        "parameter": "context",\n        "body": {\n          "0": "@index",\n          "1": {\n            "object": {\n              "0": "@lookup",\n              "1": {\n                "key": "context"\n              }\n            },\n            "query": {\n              "0": "program",\n              "1": "start_time"\n            }\n          }\n        }\n      }\n    }\n  }\n}\n',
      },
    ],

    [
      {
        'a.b': {
          'c "d"': {
            'e.f': 'g',
          },
        },
        test: {
          0: '@index',
          1: {
            object: { 0: '@lookup', 1: { 0: 'a.b' } },
            query: { 0: 'c "d"', 1: 'e.f' },
          },
        },
      },
      {
        inlinePlz:
          '{ a.b: { "c \\"d\\"": { e.f: g } }, test: :"a.b"."c \\"d\\""."e.f" }',
        sugarFreeInlinePlz:
          '{ a.b: { "c \\"d\\"": { e.f: g } }, test: { 0: "@index", 1: { object: { 0: "@lookup", 1: { 0: a.b } }, query: { 0: "c \\"d\\"", 1: e.f } } } }',
        prettyPlz:
          '{\n  a.b: {\n    "c \\"d\\"": {\n      e.f: g\n    }\n  }\n  test: :"a.b"."c \\"d\\""."e.f"\n}\n',
        sugarFreePrettyPlz:
          '{\n  a.b: {\n    "c \\"d\\"": {\n      e.f: g\n    }\n  }\n  test: {\n    0: "@index"\n    1: {\n      object: {\n        0: "@lookup"\n        1: {\n          0: a.b\n        }\n      }\n      query: {\n        0: "c \\"d\\""\n        1: e.f\n      }\n    }\n  }\n}\n',
        prettyJson:
          '{\n  "a.b": {\n    "c \\"d\\"": {\n      "e.f": "g"\n    }\n  },\n  "test": {\n    "0": "@index",\n    "1": {\n      "object": {\n        "0": "@lookup",\n        "1": {\n          "0": "a.b"\n        }\n      },\n      "query": {\n        "0": "c \\"d\\"",\n        "1": "e.f"\n      }\n    }\n  }\n}\n',
      },
    ],

    [
      {
        '0': '@apply',
        '1': {
          function: {
            '0': '@apply',
            '1': {
              function: {
                '0': '@lookup',
                '1': {
                  key: '+',
                },
              },
              argument: '2',
            },
          },
          argument: '1',
        },
      },
      {
        inlinePlz: '1 + 2',
        sugarFreeInlinePlz:
          '{ 0: "@apply", 1: { function: { 0: "@apply", 1: { function: { 0: "@lookup", 1: { key: + } }, argument: 2 } }, argument: 1 } }',
        prettyPlz: '1 + 2\n',
        sugarFreePrettyPlz:
          '{\n  0: "@apply"\n  1: {\n    function: {\n      0: "@apply"\n      1: {\n        function: {\n          0: "@lookup"\n          1: {\n            key: +\n          }\n        }\n        argument: 2\n      }\n    }\n    argument: 1\n  }\n}\n',
        prettyJson:
          '{\n  "0": "@apply",\n  "1": {\n    "function": {\n      "0": "@apply",\n      "1": {\n        "function": {\n          "0": "@lookup",\n          "1": {\n            "key": "+"\n          }\n        },\n        "argument": "2"\n      }\n    },\n    "argument": "1"\n  }\n}\n',
      },
    ],

    [
      {
        '0': '@apply',
        '1': {
          function: {
            '0': '@apply',
            '1': {
              function: {
                '0': '@index',
                '1': {
                  object: {
                    '0': '@lookup',
                    '1': {
                      key: 'atom',
                    },
                  },
                  query: {
                    '0': 'append',
                  },
                },
              },
              argument: 'b',
            },
          },
          argument: 'a',
        },
      },
      {
        inlinePlz: 'a atom.append b',
        sugarFreeInlinePlz:
          '{ 0: "@apply", 1: { function: { 0: "@apply", 1: { function: { 0: "@index", 1: { object: { 0: "@lookup", 1: { key: atom } }, query: { 0: append } } }, argument: b } }, argument: a } }',
        prettyPlz: 'a atom.append b\n',
        sugarFreePrettyPlz:
          '{\n  0: "@apply"\n  1: {\n    function: {\n      0: "@apply"\n      1: {\n        function: {\n          0: "@index"\n          1: {\n            object: {\n              0: "@lookup"\n              1: {\n                key: atom\n              }\n            }\n            query: {\n              0: append\n            }\n          }\n        }\n        argument: b\n      }\n    }\n    argument: a\n  }\n}\n',
        prettyJson:
          '{\n  "0": "@apply",\n  "1": {\n    "function": {\n      "0": "@apply",\n      "1": {\n        "function": {\n          "0": "@index",\n          "1": {\n            "object": {\n              "0": "@lookup",\n              "1": {\n                "key": "atom"\n              }\n            },\n            "query": {\n              "0": "append"\n            }\n          }\n        },\n        "argument": "b"\n      }\n    },\n    "argument": "a"\n  }\n}\n',
      },
    ],

    [
      {
        five: '5',
        answer: {
          '0': '@apply',
          '1': {
            function: {
              '0': '@apply',
              '1': {
                function: {
                  '0': '@lookup',
                  '1': {
                    key: '&&',
                  },
                },
                argument: {
                  '0': '@apply',
                  '1': {
                    function: {
                      '0': '@index',
                      '1': {
                        object: {
                          '0': '@lookup',
                          '1': {
                            key: 'boolean',
                          },
                        },
                        query: {
                          '0': 'not',
                        },
                      },
                    },
                    argument: 'true',
                  },
                },
              },
            },
            argument: {
              '0': '@apply',
              '1': {
                function: {
                  '0': '@apply',
                  '1': {
                    function: {
                      '0': '@lookup',
                      '1': {
                        key: '<',
                      },
                    },
                    argument: {
                      '0': '@lookup',
                      '1': {
                        key: 'five',
                      },
                    },
                  },
                },
                argument: {
                  '0': '@apply',
                  '1': {
                    function: {
                      '0': '@apply',
                      '1': {
                        function: {
                          '0': '@lookup',
                          '1': {
                            key: '-',
                          },
                        },
                        argument: {
                          '0': '@apply',
                          '1': {
                            function: {
                              '0': '@apply',
                              '1': {
                                function: {
                                  '0': '@lookup',
                                  '1': {
                                    key: '+',
                                  },
                                },
                                argument: '4',
                              },
                            },
                            argument: '3',
                          },
                        },
                      },
                    },
                    argument: {
                      '0': '@apply',
                      '1': {
                        function: {
                          '0': '@apply',
                          '1': {
                            function: {
                              '0': '@lookup',
                              '1': {
                                key: '+',
                              },
                            },
                            argument: '2',
                          },
                        },
                        argument: '1',
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      {
        inlinePlz:
          '{ five: 5, answer: 1 + 2 - (3 + 4) < :five && :boolean.not(true) }',
        sugarFreeInlinePlz:
          '{ five: 5, answer: { 0: "@apply", 1: { function: { 0: "@apply", 1: { function: { 0: "@lookup", 1: { key: && } }, argument: { 0: "@apply", 1: { function: { 0: "@index", 1: { object: { 0: "@lookup", 1: { key: boolean } }, query: { 0: not } } }, argument: true } } } }, argument: { 0: "@apply", 1: { function: { 0: "@apply", 1: { function: { 0: "@lookup", 1: { key: < } }, argument: { 0: "@lookup", 1: { key: five } } } }, argument: { 0: "@apply", 1: { function: { 0: "@apply", 1: { function: { 0: "@lookup", 1: { key: - } }, argument: { 0: "@apply", 1: { function: { 0: "@apply", 1: { function: { 0: "@lookup", 1: { key: + } }, argument: 4 } }, argument: 3 } } } }, argument: { 0: "@apply", 1: { function: { 0: "@apply", 1: { function: { 0: "@lookup", 1: { key: + } }, argument: 2 } }, argument: 1 } } } } } } } } }',
        prettyPlz:
          '{\n  five: 5\n  answer: 1 + 2 - (3 + 4) < :five && :boolean.not(true)\n}\n',
        sugarFreePrettyPlz:
          '{\n  five: 5\n  answer: {\n    0: "@apply"\n    1: {\n      function: {\n        0: "@apply"\n        1: {\n          function: {\n            0: "@lookup"\n            1: {\n              key: &&\n            }\n          }\n          argument: {\n            0: "@apply"\n            1: {\n              function: {\n                0: "@index"\n                1: {\n                  object: {\n                    0: "@lookup"\n                    1: {\n                      key: boolean\n                    }\n                  }\n                  query: {\n                    0: not\n                  }\n                }\n              }\n              argument: true\n            }\n          }\n        }\n      }\n      argument: {\n        0: "@apply"\n        1: {\n          function: {\n            0: "@apply"\n            1: {\n              function: {\n                0: "@lookup"\n                1: {\n                  key: <\n                }\n              }\n              argument: {\n                0: "@lookup"\n                1: {\n                  key: five\n                }\n              }\n            }\n          }\n          argument: {\n            0: "@apply"\n            1: {\n              function: {\n                0: "@apply"\n                1: {\n                  function: {\n                    0: "@lookup"\n                    1: {\n                      key: -\n                    }\n                  }\n                  argument: {\n                    0: "@apply"\n                    1: {\n                      function: {\n                        0: "@apply"\n                        1: {\n                          function: {\n                            0: "@lookup"\n                            1: {\n                              key: +\n                            }\n                          }\n                          argument: 4\n                        }\n                      }\n                      argument: 3\n                    }\n                  }\n                }\n              }\n              argument: {\n                0: "@apply"\n                1: {\n                  function: {\n                    0: "@apply"\n                    1: {\n                      function: {\n                        0: "@lookup"\n                        1: {\n                          key: +\n                        }\n                      }\n                      argument: 2\n                    }\n                  }\n                  argument: 1\n                }\n              }\n            }\n          }\n        }\n      }\n    }\n  }\n}\n',
        prettyJson:
          '{\n  "five": "5",\n  "answer": {\n    "0": "@apply",\n    "1": {\n      "function": {\n        "0": "@apply",\n        "1": {\n          "function": {\n            "0": "@lookup",\n            "1": {\n              "key": "&&"\n            }\n          },\n          "argument": {\n            "0": "@apply",\n            "1": {\n              "function": {\n                "0": "@index",\n                "1": {\n                  "object": {\n                    "0": "@lookup",\n                    "1": {\n                      "key": "boolean"\n                    }\n                  },\n                  "query": {\n                    "0": "not"\n                  }\n                }\n              },\n              "argument": "true"\n            }\n          }\n        }\n      },\n      "argument": {\n        "0": "@apply",\n        "1": {\n          "function": {\n            "0": "@apply",\n            "1": {\n              "function": {\n                "0": "@lookup",\n                "1": {\n                  "key": "<"\n                }\n              },\n              "argument": {\n                "0": "@lookup",\n                "1": {\n                  "key": "five"\n                }\n              }\n            }\n          },\n          "argument": {\n            "0": "@apply",\n            "1": {\n              "function": {\n                "0": "@apply",\n                "1": {\n                  "function": {\n                    "0": "@lookup",\n                    "1": {\n                      "key": "-"\n                    }\n                  },\n                  "argument": {\n                    "0": "@apply",\n                    "1": {\n                      "function": {\n                        "0": "@apply",\n                        "1": {\n                          "function": {\n                            "0": "@lookup",\n                            "1": {\n                              "key": "+"\n                            }\n                          },\n                          "argument": "4"\n                        }\n                      },\n                      "argument": "3"\n                    }\n                  }\n                }\n              },\n              "argument": {\n                "0": "@apply",\n                "1": {\n                  "function": {\n                    "0": "@apply",\n                    "1": {\n                      "function": {\n                        "0": "@lookup",\n                        "1": {\n                          "key": "+"\n                        }\n                      },\n                      "argument": "2"\n                    }\n                  },\n                  "argument": "1"\n                }\n              }\n            }\n          }\n        }\n      }\n    }\n  }\n}\n',
      },
    ],

    [
      {
        '0': '@apply',
        '1': {
          function: {
            '0': '@apply',
            '1': {
              function: {
                '0': '@apply',
                '1': {
                  function: {
                    '0': '@lookup',
                    '1': {
                      key: '>>',
                    },
                  },
                  argument: {
                    '0': '@function',
                    '1': {
                      parameter: 'a',
                      body: {
                        '0': '@apply',
                        '1': {
                          function: {
                            '0': '@apply',
                            '1': {
                              function: {
                                '0': '@lookup',
                                '1': {
                                  key: '-',
                                },
                              },
                              argument: '1',
                            },
                          },
                          argument: {
                            '0': '@lookup',
                            '1': {
                              key: 'a',
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
              argument: {
                '0': '@function',
                '1': {
                  parameter: 'a',
                  body: {
                    '0': '@apply',
                    '1': {
                      function: {
                        '0': '@apply',
                        '1': {
                          function: {
                            '0': '@lookup',
                            '1': {
                              key: '+',
                            },
                          },
                          argument: '1',
                        },
                      },
                      argument: {
                        '0': '@lookup',
                        '1': {
                          key: 'a',
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          argument: '1',
        },
      },
      {
        inlinePlz: '((a => :a + 1) >> (a => :a - 1))(1)',
        sugarFreeInlinePlz:
          '{ 0: "@apply", 1: { function: { 0: "@apply", 1: { function: { 0: "@apply", 1: { function: { 0: "@lookup", 1: { key: >> } }, argument: { 0: "@function", 1: { parameter: a, body: { 0: "@apply", 1: { function: { 0: "@apply", 1: { function: { 0: "@lookup", 1: { key: - } }, argument: 1 } }, argument: { 0: "@lookup", 1: { key: a } } } } } } } }, argument: { 0: "@function", 1: { parameter: a, body: { 0: "@apply", 1: { function: { 0: "@apply", 1: { function: { 0: "@lookup", 1: { key: + } }, argument: 1 } }, argument: { 0: "@lookup", 1: { key: a } } } } } } } }, argument: 1 } }',
        prettyPlz: '((a => :a + 1) >> (a => :a - 1))(1)\n',
        sugarFreePrettyPlz:
          '{\n  0: "@apply"\n  1: {\n    function: {\n      0: "@apply"\n      1: {\n        function: {\n          0: "@apply"\n          1: {\n            function: {\n              0: "@lookup"\n              1: {\n                key: >>\n              }\n            }\n            argument: {\n              0: "@function"\n              1: {\n                parameter: a\n                body: {\n                  0: "@apply"\n                  1: {\n                    function: {\n                      0: "@apply"\n                      1: {\n                        function: {\n                          0: "@lookup"\n                          1: {\n                            key: -\n                          }\n                        }\n                        argument: 1\n                      }\n                    }\n                    argument: {\n                      0: "@lookup"\n                      1: {\n                        key: a\n                      }\n                    }\n                  }\n                }\n              }\n            }\n          }\n        }\n        argument: {\n          0: "@function"\n          1: {\n            parameter: a\n            body: {\n              0: "@apply"\n              1: {\n                function: {\n                  0: "@apply"\n                  1: {\n                    function: {\n                      0: "@lookup"\n                      1: {\n                        key: +\n                      }\n                    }\n                    argument: 1\n                  }\n                }\n                argument: {\n                  0: "@lookup"\n                  1: {\n                    key: a\n                  }\n                }\n              }\n            }\n          }\n        }\n      }\n    }\n    argument: 1\n  }\n}\n',
        prettyJson:
          '{\n  "0": "@apply",\n  "1": {\n    "function": {\n      "0": "@apply",\n      "1": {\n        "function": {\n          "0": "@apply",\n          "1": {\n            "function": {\n              "0": "@lookup",\n              "1": {\n                "key": ">>"\n              }\n            },\n            "argument": {\n              "0": "@function",\n              "1": {\n                "parameter": "a",\n                "body": {\n                  "0": "@apply",\n                  "1": {\n                    "function": {\n                      "0": "@apply",\n                      "1": {\n                        "function": {\n                          "0": "@lookup",\n                          "1": {\n                            "key": "-"\n                          }\n                        },\n                        "argument": "1"\n                      }\n                    },\n                    "argument": {\n                      "0": "@lookup",\n                      "1": {\n                        "key": "a"\n                      }\n                    }\n                  }\n                }\n              }\n            }\n          }\n        },\n        "argument": {\n          "0": "@function",\n          "1": {\n            "parameter": "a",\n            "body": {\n              "0": "@apply",\n              "1": {\n                "function": {\n                  "0": "@apply",\n                  "1": {\n                    "function": {\n                      "0": "@lookup",\n                      "1": {\n                        "key": "+"\n                      }\n                    },\n                    "argument": "1"\n                  }\n                },\n                "argument": {\n                  "0": "@lookup",\n                  "1": {\n                    "key": "a"\n                  }\n                }\n              }\n            }\n          }\n        }\n      }\n    },\n    "argument": "1"\n  }\n}\n',
      },
    ],

    [
      {
        f: {
          0: '@function',
          1: {
            parameter: {
              x: {
                0: '@hole',
                1: {
                  name: 'b',
                  constraint: {
                    assignableTo: {
                      0: '@index',
                      1: {
                        object: { 0: '@lookup', 1: { key: 'something' } },
                        query: { 0: 'type' },
                      },
                    },
                  },
                },
              },
            },
            body: { 0: '@lookup', 1: { 0: 'x' } },
          },
        },
      },
      {
        inlinePlz: '{ f: (x: ?b) => :x }',
        sugarFreeInlinePlz:
          '{ f: { 0: "@function", 1: { parameter: { x: { 0: "@hole", 1: { name: b, constraint: { assignableTo: { 0: "@index", 1: { object: { 0: "@lookup", 1: { key: something } }, query: { 0: type } } } } } } }, body: { 0: "@lookup", 1: { 0: x } } } } }',
        prettyPlz: '{\n  f: (x: ?b) => :x\n}\n',
        sugarFreePrettyPlz:
          '{\n  f: {\n    0: "@function"\n    1: {\n      parameter: {\n        x: {\n          0: "@hole"\n          1: {\n            name: b\n            constraint: {\n              assignableTo: {\n                0: "@index"\n                1: {\n                  object: {\n                    0: "@lookup"\n                    1: {\n                      key: something\n                    }\n                  }\n                  query: {\n                    0: type\n                  }\n                }\n              }\n            }\n          }\n        }\n      }\n      body: {\n        0: "@lookup"\n        1: {\n          0: x\n        }\n      }\n    }\n  }\n}\n',
        prettyJson:
          '{\n  "f": {\n    "0": "@function",\n    "1": {\n      "parameter": {\n        "x": {\n          "0": "@hole",\n          "1": {\n            "name": "b",\n            "constraint": {\n              "assignableTo": {\n                "0": "@index",\n                "1": {\n                  "object": {\n                    "0": "@lookup",\n                    "1": {\n                      "key": "something"\n                    }\n                  },\n                  "query": {\n                    "0": "type"\n                  }\n                }\n              }\n            }\n          }\n        }\n      },\n      "body": {\n        "0": "@lookup",\n        "1": {\n          "0": "x"\n        }\n      }\n    }\n  }\n}\n',
      },
    ],

    [
      {
        f: {
          0: '@function',
          1: {
            parameter: {
              x: {
                0: '@hole',
                1: {
                  name: 'b',
                  constraint: {
                    assignableTo: {
                      0: '@index',
                      1: {
                        object: { 0: '@lookup', 1: { key: 'atom' } },
                        query: { 0: 'type' },
                      },
                    },
                  },
                },
              },
            },
            body: { 0: '@lookup', 1: { 0: 'x' } },
          },
        },
      },
      {
        inlinePlz: '{ f: (x: (?b: :atom.type)) => :x }',
        sugarFreeInlinePlz:
          '{ f: { 0: "@function", 1: { parameter: { x: { 0: "@hole", 1: { name: b, constraint: { assignableTo: { 0: "@index", 1: { object: { 0: "@lookup", 1: { key: atom } }, query: { 0: type } } } } } } }, body: { 0: "@lookup", 1: { 0: x } } } } }',
        prettyPlz: '{\n  f: (x: (?b: :atom.type)) => :x\n}\n',
        sugarFreePrettyPlz:
          '{\n  f: {\n    0: "@function"\n    1: {\n      parameter: {\n        x: {\n          0: "@hole"\n          1: {\n            name: b\n            constraint: {\n              assignableTo: {\n                0: "@index"\n                1: {\n                  object: {\n                    0: "@lookup"\n                    1: {\n                      key: atom\n                    }\n                  }\n                  query: {\n                    0: type\n                  }\n                }\n              }\n            }\n          }\n        }\n      }\n      body: {\n        0: "@lookup"\n        1: {\n          0: x\n        }\n      }\n    }\n  }\n}\n',
        prettyJson:
          '{\n  "f": {\n    "0": "@function",\n    "1": {\n      "parameter": {\n        "x": {\n          "0": "@hole",\n          "1": {\n            "name": "b",\n            "constraint": {\n              "assignableTo": {\n                "0": "@index",\n                "1": {\n                  "object": {\n                    "0": "@lookup",\n                    "1": {\n                      "key": "atom"\n                    }\n                  },\n                  "query": {\n                    "0": "type"\n                  }\n                }\n              }\n            }\n          }\n        }\n      },\n      "body": {\n        "0": "@lookup",\n        "1": {\n          "0": "x"\n        }\n      }\n    }\n  }\n}\n',
      },
    ],

    [
      {
        key: 'a',
        x: { a: 'found' },
        test: {
          0: '@index',
          1: {
            object: { 0: '@lookup', 1: { key: 'x' } },
            query: { 0: { 0: '@lookup', 1: { key: 'key' } } },
          },
        },
      },
      {
        inlinePlz: '{ key: a, x: { a: found }, test: :x.:key }',
        sugarFreeInlinePlz:
          '{ key: a, x: { a: found }, test: { 0: "@index", 1: { object: { 0: "@lookup", 1: { key: x } }, query: { 0: { 0: "@lookup", 1: { key: key } } } } } }',
        prettyPlz:
          '{\n  key: a\n  x: {\n    a: found\n  }\n  test: :x.:key\n}\n',
        sugarFreePrettyPlz:
          '{\n  key: a\n  x: {\n    a: found\n  }\n  test: {\n    0: "@index"\n    1: {\n      object: {\n        0: "@lookup"\n        1: {\n          key: x\n        }\n      }\n      query: {\n        0: {\n          0: "@lookup"\n          1: {\n            key: key\n          }\n        }\n      }\n    }\n  }\n}\n',
        prettyJson:
          '{\n  "key": "a",\n  "x": {\n    "a": "found"\n  },\n  "test": {\n    "0": "@index",\n    "1": {\n      "object": {\n        "0": "@lookup",\n        "1": {\n          "key": "x"\n        }\n      },\n      "query": {\n        "0": {\n          "0": "@lookup",\n          "1": {\n            "key": "key"\n          }\n        }\n      }\n    }\n  }\n}\n',
      },
    ],

    [
      {
        x: { a: 'found' },
        test: {
          0: '@index',
          1: {
            object: { 0: '@lookup', 1: { key: 'x' } },
            query: {
              0: {
                0: '@apply',
                1: {
                  function: { 0: '@lookup', 1: { key: 'identity' } },
                  argument: 'a',
                },
              },
            },
          },
        },
      },
      {
        inlinePlz: '{ x: { a: found }, test: :x.(:identity(a)) }',
        sugarFreeInlinePlz:
          '{ x: { a: found }, test: { 0: "@index", 1: { object: { 0: "@lookup", 1: { key: x } }, query: { 0: { 0: "@apply", 1: { function: { 0: "@lookup", 1: { key: identity } }, argument: a } } } } } }',
        prettyPlz:
          '{\n  x: {\n    a: found\n  }\n  test: :x.(:identity(a))\n}\n',
        sugarFreePrettyPlz:
          '{\n  x: {\n    a: found\n  }\n  test: {\n    0: "@index"\n    1: {\n      object: {\n        0: "@lookup"\n        1: {\n          key: x\n        }\n      }\n      query: {\n        0: {\n          0: "@apply"\n          1: {\n            function: {\n              0: "@lookup"\n              1: {\n                key: identity\n              }\n            }\n            argument: a\n          }\n        }\n      }\n    }\n  }\n}\n',
        prettyJson:
          '{\n  "x": {\n    "a": "found"\n  },\n  "test": {\n    "0": "@index",\n    "1": {\n      "object": {\n        "0": "@lookup",\n        "1": {\n          "key": "x"\n        }\n      },\n      "query": {\n        "0": {\n          "0": "@apply",\n          "1": {\n            "function": {\n              "0": "@lookup",\n              "1": {\n                "key": "identity"\n              }\n            },\n            "argument": "a"\n          }\n        }\n      }\n    }\n  }\n}\n',
      },
    ],

    [
      {
        0: '@object',
        1: {
          properties: { 0: 'a', 1: 'b', name: 'c' },
          excess: {
            0: {
              0: {
                0: '@index',
                1: {
                  object: { 0: '@lookup', 1: { key: 'atom' } },
                  query: { 0: 'type' },
                },
              },
              1: 'd',
            },
          },
        },
      },
      {
        inlinePlz: '{ [:atom.type]: d, a, b, name: c }',
        sugarFreeInlinePlz:
          '{ 0: "@object", 1: { properties: { 0: a, 1: b, name: c }, excess: { 0: { 0: { 0: "@index", 1: { object: { 0: "@lookup", 1: { key: atom } }, query: { 0: type } } }, 1: d } } } }',
        prettyPlz: '{ [:atom.type]: d, a, b, name: c }\n',
        sugarFreePrettyPlz:
          '{\n  0: "@object"\n  1: {\n    properties: {\n      0: a\n      1: b\n      name: c\n    }\n    excess: {\n      0: {\n        0: {\n          0: "@index"\n          1: {\n            object: {\n              0: "@lookup"\n              1: {\n                key: atom\n              }\n            }\n            query: {\n              0: type\n            }\n          }\n        }\n        1: d\n      }\n    }\n  }\n}\n',
        prettyJson:
          '{\n  "0": "@object",\n  "1": {\n    "properties": {\n      "0": "a",\n      "1": "b",\n      "name": "c"\n    },\n    "excess": {\n      "0": {\n        "0": {\n          "0": "@index",\n          "1": {\n            "object": {\n              "0": "@lookup",\n              "1": {\n                "key": "atom"\n              }\n            },\n            "query": {\n              "0": "type"\n            }\n          }\n        },\n        "1": "d"\n      }\n    }\n  }\n}\n',
      },
    ],

    [
      {
        0: '@object',
        1: {
          properties: {},
          excess: {
            0: {
              0: {
                0: '@index',
                1: {
                  object: { 0: '@lookup', 1: { key: 'atom' } },
                  query: { 0: 'type' },
                },
              },
              1: 'd',
            },
            1: { 0: 'k', 1: 'v' },
          },
        },
      },
      {
        inlinePlz: '{ [:atom.type]: d, [k]: v }',
        sugarFreeInlinePlz:
          '{ 0: "@object", 1: { properties: {}, excess: { 0: { 0: { 0: "@index", 1: { object: { 0: "@lookup", 1: { key: atom } }, query: { 0: type } } }, 1: d }, 1: { 0: k, 1: v } } } }',
        prettyPlz: '{ [:atom.type]: d, [k]: v }\n',
        sugarFreePrettyPlz:
          '{\n  0: "@object"\n  1: {\n    properties: {}\n    excess: {\n      0: {\n        0: {\n          0: "@index"\n          1: {\n            object: {\n              0: "@lookup"\n              1: {\n                key: atom\n              }\n            }\n            query: {\n              0: type\n            }\n          }\n        }\n        1: d\n      }\n      1: {\n        0: k\n        1: v\n      }\n    }\n  }\n}\n',
        prettyJson:
          '{\n  "0": "@object",\n  "1": {\n    "properties": {},\n    "excess": {\n      "0": {\n        "0": {\n          "0": "@index",\n          "1": {\n            "object": {\n              "0": "@lookup",\n              "1": {\n                "key": "atom"\n              }\n            },\n            "query": {\n              "0": "type"\n            }\n          }\n        },\n        "1": "d"\n      },\n      "1": {\n        "0": "k",\n        "1": "v"\n      }\n    }\n  }\n}\n',
      },
    ],

    [
      {
        0: '@object',
        1: {
          properties: {},
          excess: {
            0: { 0: 'k', 1: 'v' },
            1: {
              0: {
                0: '@index',
                1: {
                  object: { 0: '@lookup', 1: { key: 'atom' } },
                  query: { 0: 'type' },
                },
              },
              1: 'd',
            },
          },
        },
      },
      {
        inlinePlz: '{ [k]: v, [:atom.type]: d }',
        sugarFreeInlinePlz:
          '{ 0: "@object", 1: { properties: {}, excess: { 0: { 0: k, 1: v }, 1: { 0: { 0: "@index", 1: { object: { 0: "@lookup", 1: { key: atom } }, query: { 0: type } } }, 1: d } } } }',
        prettyPlz: '{ [k]: v, [:atom.type]: d }\n',
        sugarFreePrettyPlz:
          '{\n  0: "@object"\n  1: {\n    properties: {}\n    excess: {\n      0: {\n        0: k\n        1: v\n      }\n      1: {\n        0: {\n          0: "@index"\n          1: {\n            object: {\n              0: "@lookup"\n              1: {\n                key: atom\n              }\n            }\n            query: {\n              0: type\n            }\n          }\n        }\n        1: d\n      }\n    }\n  }\n}\n',
        prettyJson:
          '{\n  "0": "@object",\n  "1": {\n    "properties": {},\n    "excess": {\n      "0": {\n        "0": "k",\n        "1": "v"\n      },\n      "1": {\n        "0": {\n          "0": "@index",\n          "1": {\n            "object": {\n              "0": "@lookup",\n              "1": {\n                "key": "atom"\n              }\n            },\n            "query": {\n              "0": "type"\n            }\n          }\n        },\n        "1": "d"\n      }\n    }\n  }\n}\n',
      },
    ],
  ],
)
