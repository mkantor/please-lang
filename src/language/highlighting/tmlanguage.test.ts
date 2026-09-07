import either from '@matt.kantor/either'
import parsing from '@matt.kantor/parsing'
import assert from 'node:assert'
import { readdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import test, { snapshot, suite } from 'node:test'
import oniguruma from 'vscode-oniguruma'
import textmate from 'vscode-textmate'
import { testCases } from '../../test-utilities.test.js'
import { unquotedAtomParser } from '../parsing/atom.js'
import { tmLanguageGrammar } from './tmlanguage.js'

const repositoryRootPath = path.join(import.meta.dirname, '..', '..', '..')

const grammarFilePath = path.join(
  repositoryRootPath,
  'editors',
  'vscode',
  'syntaxes',
  'please.tmLanguage.json',
)

const languageConfigurationFilePath = path.join(
  repositoryRootPath,
  'editors',
  'vscode',
  'language-configuration.json',
)

snapshot.setResolveSnapshotPath(_ =>
  path.join(
    repositoryRootPath,
    'src',
    'language',
    'highlighting',
    'tmlanguage.test.snapshot',
  ),
)

const loadGrammar = async () => {
  await oniguruma.loadWASM(
    await readFile(
      createRequire(import.meta.url).resolve(
        'vscode-oniguruma/release/onig.wasm',
      ),
    ),
  )
  const registry = new textmate.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: oniguruma.createOnigScanner,
      createOnigString: oniguruma.createOnigString,
    }),
    loadGrammar: scopeName =>
      Promise.resolve(
        scopeName === tmLanguageGrammar.scopeName ?
          textmate.parseRawGrammar(
            JSON.stringify(tmLanguageGrammar),
            path.basename(grammarFilePath),
          )
        : null,
      ),
  })
  const grammar = await registry.loadGrammar(tmLanguageGrammar.scopeName)
  if (grammar === null) {
    throw new Error(`no grammar for \`${tmLanguageGrammar.scopeName}\``)
  } else {
    return grammar
  }
}

const grammar = await loadGrammar()

type ScopedToken = readonly [text: string, scope: string]

/**
 * Every token in `source` that's assigned a scope by the grammar.
 */
const scopedTokens = (source: string): readonly ScopedToken[] =>
  source.split('\n').reduce<{
    readonly ruleStack: typeof textmate.INITIAL
    readonly tokens: readonly ScopedToken[]
  }>(
    ({ ruleStack, tokens }, line) => {
      const lineResult = grammar.tokenizeLine(line, ruleStack)
      return {
        ruleStack: lineResult.ruleStack,
        tokens: [
          ...tokens,
          ...lineResult.tokens.flatMap((token): readonly ScopedToken[] => {
            const scope = token.scopes.at(-1)
            return (
                scope === undefined || scope === tmLanguageGrammar.scopeName
              ) ?
                []
              : [[line.slice(token.startIndex, token.endIndex), scope]]
          }),
        ],
      }
    },
    { ruleStack: textmate.INITIAL, tokens: [] },
  ).tokens

test('the committed grammar is what the generator produces', async () => {
  const committedGrammar: unknown = JSON.parse(
    await readFile(grammarFilePath, 'utf-8'),
  )
  assert.deepEqual(committedGrammar, tmLanguageGrammar)
})

testCases(scopedTokens, source => `scopes in \`${source}\``)('highlighting', [
  [
    ':foo// c',
    [
      [':', 'punctuation.definition.variable.plz'],
      ['foo', 'variable.other.constant.plz'],
      ['//', 'punctuation.definition.comment.plz'],
      [' c', 'comment.line.double-slash.plz'],
    ],
  ],

  [
    'a f b g c',
    [
      ['a', 'string.unquoted.plz'],
      ['f', 'entity.name.function.plz'],
      ['b', 'string.unquoted.plz'],
      ['g', 'entity.name.function.plz'],
      ['c', 'string.unquoted.plz'],
    ],
  ],

  [
    'true true true',
    [
      ['true', 'string.unquoted.plz'],
      ['true', 'entity.name.function.plz'],
      ['true', 'string.unquoted.plz'],
    ],
  ],

  [
    '1 1 1',
    [
      ['1', 'string.unquoted.plz'],
      ['1', 'entity.name.function.plz'],
      ['1', 'string.unquoted.plz'],
    ],
  ],

  [
    '-1 -1 -1',
    [
      ['-1', 'string.unquoted.plz'],
      ['-1', 'entity.name.function.plz'],
      ['-1', 'string.unquoted.plz'],
    ],
  ],

  [
    'a true\nb',
    [
      ['a', 'string.unquoted.plz'],
      ['true', 'entity.name.function.plz'],
      ['b', 'string.unquoted.plz'],
    ],
  ],

  [
    '1 + 2\n3 4',
    [
      ['1', 'string.unquoted.plz'],
      ['+', 'entity.name.function.plz'],
      ['2', 'string.unquoted.plz'],
      ['3', 'entity.name.function.plz'],
      ['4', 'string.unquoted.plz'],
    ],
  ],

  [
    '1 + 2 + 3 + 4\n+ 5 + 6 + 7 +\n8 + 9 + 10',
    [
      ['1', 'string.unquoted.plz'],
      ['+', 'entity.name.function.plz'],
      ['2', 'string.unquoted.plz'],
      ['+', 'entity.name.function.plz'],
      ['3', 'string.unquoted.plz'],
      ['+', 'entity.name.function.plz'],
      ['4', 'string.unquoted.plz'],
      ['+', 'entity.name.function.plz'],
      ['5', 'string.unquoted.plz'],
      ['+', 'entity.name.function.plz'],
      ['6', 'string.unquoted.plz'],
      ['+', 'entity.name.function.plz'],
      ['7', 'string.unquoted.plz'],
      ['+', 'entity.name.function.plz'],
      ['8', 'string.unquoted.plz'],
      ['+', 'entity.name.function.plz'],
      ['9', 'string.unquoted.plz'],
      ['+', 'entity.name.function.plz'],
      ['10', 'string.unquoted.plz'],
    ],
  ],

  [
    '{\n  output:\n    f a\n    e b d\n    c c d b e a\n}',
    [
      ['{', 'punctuation.section.braces.plz'],
      ['output', 'variable.parameter.plz'],
      [':', 'punctuation.separator.key-value.plz'],
      ['f', 'string.unquoted.plz'],
      ['a', 'entity.name.function.plz'],
      ['e', 'string.unquoted.plz'],
      ['b', 'entity.name.function.plz'],
      ['d', 'string.unquoted.plz'],
      ['c', 'entity.name.function.plz'],
      ['c', 'string.unquoted.plz'],
      ['d', 'entity.name.function.plz'],
      ['b', 'string.unquoted.plz'],
      ['e', 'entity.name.function.plz'],
      ['a', 'string.unquoted.plz'],
      ['}', 'punctuation.section.braces.plz'],
    ],
  ],

  [
    '1 + // c\n2',
    [
      ['1', 'string.unquoted.plz'],
      ['+', 'entity.name.function.plz'],
      ['//', 'punctuation.definition.comment.plz'],
      [' c', 'comment.line.double-slash.plz'],
      ['2', 'string.unquoted.plz'],
    ],
  ],

  [
    '1 + /* c */ 2',
    [
      ['1', 'string.unquoted.plz'],
      ['+', 'entity.name.function.plz'],
      ['/*', 'punctuation.definition.comment.begin.plz'],
      [' c ', 'comment.block.plz'],
      ['*/', 'punctuation.definition.comment.end.plz'],
      ['2', 'string.unquoted.plz'],
    ],
  ],

  [
    '{\n  a: x => _\n  b: 2\n}',
    [
      ['{', 'punctuation.section.braces.plz'],
      ['a', 'variable.parameter.plz'],
      [':', 'punctuation.separator.key-value.plz'],
      ['x', 'variable.parameter.plz'],
      ['=>', 'storage.type.function.arrow.plz'],
      ['_', 'string.unquoted.plz'],
      ['b', 'variable.parameter.plz'],
      [':', 'punctuation.separator.key-value.plz'],
      ['2', 'string.unquoted.plz'],
      ['}', 'punctuation.section.braces.plz'],
    ],
  ],

  [
    'a atom.append b',
    [
      ['a', 'string.unquoted.plz'],
      ['atom', 'entity.name.function.plz'],
      ['.', 'punctuation.accessor.plz'],
      ['append', 'entity.name.function.plz'],
      ['b', 'string.unquoted.plz'],
    ],
  ],

  [
    ':input\n  option.flat_map :natural_number.from',
    [
      [':', 'punctuation.definition.variable.plz'],
      ['input', 'variable.other.constant.plz'],
      ['option', 'entity.name.function.plz'],
      ['.', 'punctuation.accessor.plz'],
      ['flat_map', 'entity.name.function.plz'],
      [':', 'punctuation.definition.variable.plz'],
      ['natural_number', 'variable.other.constant.plz'],
      ['.', 'punctuation.accessor.plz'],
      ['from', 'variable.other.constant.plz'],
    ],
  ],

  [
    'x f a.b g c',
    [
      ['x', 'string.unquoted.plz'],
      ['f', 'entity.name.function.plz'],
      ['a.b', 'string.unquoted.plz'],
      ['g', 'entity.name.function.plz'],
      ['c', 'string.unquoted.plz'],
    ],
  ],

  [
    'a f(2) b',
    [
      ['a', 'string.unquoted.plz'],
      ['f', 'entity.name.function.plz'],
      ['(', 'punctuation.section.parens.plz'],
      ['2', 'string.unquoted.plz'],
      [')', 'punctuation.section.parens.plz'],
      ['b', 'string.unquoted.plz'],
    ],
  ],

  [
    'a f.:g b',
    [
      ['a', 'string.unquoted.plz'],
      ['f', 'entity.name.function.plz'],
      ['.', 'punctuation.accessor.plz'],
      [':', 'punctuation.definition.variable.plz'],
      ['g', 'variable.other.constant.plz'],
      ['b', 'string.unquoted.plz'],
    ],
  ],

  [
    'a f."x" b',
    [
      ['a', 'string.unquoted.plz'],
      ['f', 'entity.name.function.plz'],
      ['.', 'punctuation.accessor.plz'],
      ['"', 'punctuation.definition.quoted-atom.begin.plz'],
      ['x', 'string.quoted.plz'],
      ['"', 'punctuation.definition.quoted-atom.end.plz'],
      ['b', 'string.unquoted.plz'],
    ],
  ],

  [
    'a f.(1 + 1) b',
    [
      ['a', 'string.unquoted.plz'],
      ['f', 'entity.name.function.plz'],
      ['.', 'punctuation.accessor.plz'],
      ['(', 'punctuation.section.parens.plz'],
      ['1', 'string.unquoted.plz'],
      ['+', 'entity.name.function.plz'],
      ['1', 'string.unquoted.plz'],
      [')', 'punctuation.section.parens.plz'],
      ['b', 'string.unquoted.plz'],
    ],
  ],

  [
    'a f.|> b',
    [
      ['a', 'string.unquoted.plz'],
      ['f', 'entity.name.function.plz'],
      ['.', 'punctuation.accessor.plz'],
      ['|>', 'string.unquoted.plz'],
      ['b', 'string.unquoted.plz'],
    ],
  ],

  [
    'a f(1).:g b',
    [
      ['a', 'string.unquoted.plz'],
      ['f', 'entity.name.function.plz'],
      ['(', 'punctuation.section.parens.plz'],
      ['1', 'string.unquoted.plz'],
      [')', 'punctuation.section.parens.plz'],
      ['.', 'punctuation.accessor.plz'],
      [':', 'punctuation.definition.variable.plz'],
      ['g', 'variable.other.constant.plz'],
      ['b', 'string.unquoted.plz'],
    ],
  ],

  [
    'a "f" b',
    [
      ['a', 'string.unquoted.plz'],
      ['"', 'punctuation.definition.quoted-atom.begin.plz'],
      ['f', 'entity.name.function.plz'],
      ['"', 'punctuation.definition.quoted-atom.end.plz'],
      ['b', 'string.unquoted.plz'],
    ],
  ],

  [
    'a "f"(1) b',
    [
      ['a', 'string.unquoted.plz'],
      ['"', 'punctuation.definition.quoted-atom.begin.plz'],
      ['f', 'entity.name.function.plz'],
      ['"', 'punctuation.definition.quoted-atom.end.plz'],
      ['(', 'punctuation.section.parens.plz'],
      ['1', 'string.unquoted.plz'],
      [')', 'punctuation.section.parens.plz'],
      ['b', 'string.unquoted.plz'],
    ],
  ],

  [
    'x\n  "f" b',
    [
      ['x', 'string.unquoted.plz'],
      ['"', 'punctuation.definition.quoted-atom.begin.plz'],
      ['f', 'entity.name.function.plz'],
      ['"', 'punctuation.definition.quoted-atom.end.plz'],
      ['b', 'string.unquoted.plz'],
    ],
  ],

  [
    'a (f) b',
    [
      ['a', 'string.unquoted.plz'],
      ['(', 'punctuation.section.parens.plz'],
      ['f', 'entity.name.function.plz'],
      [')', 'punctuation.section.parens.plz'],
      ['b', 'string.unquoted.plz'],
    ],
  ],

  [
    'a ("f") b',
    [
      ['a', 'string.unquoted.plz'],
      ['(', 'punctuation.section.parens.plz'],
      ['"', 'punctuation.definition.quoted-atom.begin.plz'],
      ['f', 'entity.name.function.plz'],
      ['"', 'punctuation.definition.quoted-atom.end.plz'],
      [')', 'punctuation.section.parens.plz'],
      ['b', 'string.unquoted.plz'],
    ],
  ],

  [
    'a f "str" g h',
    [
      ['a', 'string.unquoted.plz'],
      ['f', 'entity.name.function.plz'],
      ['"', 'punctuation.definition.quoted-atom.begin.plz'],
      ['str', 'string.quoted.plz'],
      ['"', 'punctuation.definition.quoted-atom.end.plz'],
      ['g', 'entity.name.function.plz'],
      ['h', 'string.unquoted.plz'],
    ],
  ],

  [
    '@panic blah',
    [
      ['@panic', 'storage.modifier.plz'],
      ['blah', 'string.unquoted.plz'],
    ],
  ],
  [
    '@panic "blah"',
    [
      ['@panic', 'storage.modifier.plz'],
      ['"', 'punctuation.definition.quoted-atom.begin.plz'],
      ['blah', 'string.quoted.plz'],
      ['"', 'punctuation.definition.quoted-atom.end.plz'],
    ],
  ],

  [
    'a f (2)',
    [
      ['a', 'string.unquoted.plz'],
      ['f', 'entity.name.function.plz'],
      ['(', 'punctuation.section.parens.plz'],
      ['2', 'string.unquoted.plz'],
      [')', 'punctuation.section.parens.plz'],
    ],
  ],

  [
    'a f(1).c(2) b',
    [
      ['a', 'string.unquoted.plz'],
      ['f', 'entity.name.function.plz'],
      ['(', 'punctuation.section.parens.plz'],
      ['1', 'string.unquoted.plz'],
      [')', 'punctuation.section.parens.plz'],
      ['.', 'punctuation.accessor.plz'],
      ['c', 'variable.other.constant.plz'],
      ['(', 'punctuation.section.parens.plz'],
      ['2', 'string.unquoted.plz'],
      [')', 'punctuation.section.parens.plz'],
      ['b', 'string.unquoted.plz'],
    ],
  ],

  [
    'a f((1)) b',
    [
      ['a', 'string.unquoted.plz'],
      ['f', 'entity.name.function.plz'],
      ['(', 'punctuation.section.parens.plz'],
      ['(', 'punctuation.section.parens.plz'],
      ['1', 'string.unquoted.plz'],
      [')', 'punctuation.section.parens.plz'],
      [')', 'punctuation.section.parens.plz'],
      ['b', 'string.unquoted.plz'],
    ],
  ],

  [
    'a f(\n  1\n) b',
    [
      ['a', 'string.unquoted.plz'],
      ['f', 'entity.name.function.plz'],
      ['(', 'punctuation.section.parens.plz'],
      ['1', 'string.unquoted.plz'],
      [')', 'punctuation.section.parens.plz'],
      ['b', 'string.unquoted.plz'],
    ],
  ],

  [
    'a ~>\nf b c',
    [
      ['a', 'string.unquoted.plz'],
      ['~>', 'storage.type.function.arrow.plz'],
      ['f', 'string.unquoted.plz'],
      ['b', 'entity.name.function.plz'],
      ['c', 'string.unquoted.plz'],
    ],
  ],

  [
    'a ~\nf b c',
    [
      ['a', 'string.unquoted.plz'],
      ['~', 'keyword.operator.plz'],
      ['f', 'string.unquoted.plz'],
      ['b', 'entity.name.function.plz'],
      ['c', 'string.unquoted.plz'],
    ],
  ],

  [
    'a |\nf b c',
    [
      ['a', 'string.unquoted.plz'],
      ['|', 'keyword.operator.plz'],
      ['f', 'string.unquoted.plz'],
      ['b', 'entity.name.function.plz'],
      ['c', 'string.unquoted.plz'],
    ],
  ],

  [
    'a f {x: 1} g c',
    [
      ['a', 'string.unquoted.plz'],
      ['f', 'entity.name.function.plz'],
      ['{', 'punctuation.section.braces.plz'],
      ['x', 'variable.parameter.plz'],
      [':', 'punctuation.separator.key-value.plz'],
      ['1', 'string.unquoted.plz'],
      ['}', 'punctuation.section.braces.plz'],
      ['g', 'entity.name.function.plz'],
      ['c', 'string.unquoted.plz'],
    ],
  ],

  [
    ':|>',
    [
      [':', 'punctuation.definition.variable.plz'],
      ['|>', 'variable.other.constant.plz'],
    ],
  ],

  [
    '{ |>: 1 }',
    [
      ['{', 'punctuation.section.braces.plz'],
      ['|>', 'variable.parameter.plz'],
      [':', 'punctuation.separator.key-value.plz'],
      ['1', 'string.unquoted.plz'],
      ['}', 'punctuation.section.braces.plz'],
    ],
  ],

  [
    '{ |> }',
    [
      ['{', 'punctuation.section.braces.plz'],
      ['|>', 'string.unquoted.plz'],
      ['}', 'punctuation.section.braces.plz'],
    ],
  ],

  [
    'a f |>',
    [
      ['a', 'string.unquoted.plz'],
      ['f', 'entity.name.function.plz'],
      ['|>', 'string.unquoted.plz'],
    ],
  ],

  [
    'a f ||',
    [
      ['a', 'string.unquoted.plz'],
      ['f', 'entity.name.function.plz'],
      ['||', 'string.unquoted.plz'],
    ],
  ],

  [
    ':(b)',
    [
      [':', 'punctuation.definition.variable.plz'],
      ['(', 'punctuation.section.parens.plz'],
      ['b', 'variable.other.constant.plz'],
      [')', 'punctuation.section.parens.plz'],
    ],
  ],

  [
    ':"b"',
    [
      [':', 'punctuation.definition.variable.plz'],
      ['"', 'punctuation.definition.quoted-atom.begin.plz'],
      ['b', 'variable.other.constant.plz'],
      ['"', 'punctuation.definition.quoted-atom.end.plz'],
    ],
  ],

  [
    '{ "a": "b" }',
    [
      ['{', 'punctuation.section.braces.plz'],
      ['"', 'punctuation.definition.quoted-atom.begin.plz'],
      ['a', 'variable.parameter.plz'],
      ['"', 'punctuation.definition.quoted-atom.end.plz'],
      [':', 'punctuation.separator.key-value.plz'],
      ['"', 'punctuation.definition.quoted-atom.begin.plz'],
      ['b', 'string.quoted.plz'],
      ['"', 'punctuation.definition.quoted-atom.end.plz'],
      ['}', 'punctuation.section.braces.plz'],
    ],
  ],

  [
    '{ a: { b: c } }\n  .a\n  .b',
    [
      ['{', 'punctuation.section.braces.plz'],
      ['a', 'variable.parameter.plz'],
      [':', 'punctuation.separator.key-value.plz'],
      ['{', 'punctuation.section.braces.plz'],
      ['b', 'variable.parameter.plz'],
      [':', 'punctuation.separator.key-value.plz'],
      ['c', 'string.unquoted.plz'],
      ['}', 'punctuation.section.braces.plz'],
      ['}', 'punctuation.section.braces.plz'],
      ['.', 'punctuation.accessor.plz'],
      ['a', 'variable.other.constant.plz'],
      ['.', 'punctuation.accessor.plz'],
      ['b', 'variable.other.constant.plz'],
    ],
  ],

  [
    '{ success }/**/.0',
    [
      ['{', 'punctuation.section.braces.plz'],
      ['success', 'string.unquoted.plz'],
      ['}', 'punctuation.section.braces.plz'],
      ['/*', 'punctuation.definition.comment.begin.plz'],
      ['*/', 'punctuation.definition.comment.end.plz'],
      ['.', 'punctuation.accessor.plz'],
      ['0', 'variable.other.constant.plz'],
    ],
  ],

  [
    '{ a: 1 } . a',
    [
      ['{', 'punctuation.section.braces.plz'],
      ['a', 'variable.parameter.plz'],
      [':', 'punctuation.separator.key-value.plz'],
      ['1', 'string.unquoted.plz'],
      ['}', 'punctuation.section.braces.plz'],
      ['.', 'punctuation.accessor.plz'],
      ['a', 'string.unquoted.plz'],
    ],
  ],

  [
    ':f(1)',
    [
      [':', 'punctuation.definition.variable.plz'],
      ['f', 'entity.name.function.plz'],
      ['(', 'punctuation.section.parens.plz'],
      ['1', 'string.unquoted.plz'],
      [')', 'punctuation.section.parens.plz'],
    ],
  ],

  [
    '{}.a.b',
    [
      ['{', 'punctuation.section.braces.plz'],
      ['}', 'punctuation.section.braces.plz'],
      ['.', 'punctuation.accessor.plz'],
      ['a', 'variable.other.constant.plz'],
      ['.', 'punctuation.accessor.plz'],
      ['b', 'variable.other.constant.plz'],
    ],
  ],

  [
    '{ a.b: 1 }',
    [
      ['{', 'punctuation.section.braces.plz'],
      ['a.b', 'variable.parameter.plz'],
      [':', 'punctuation.separator.key-value.plz'],
      ['1', 'string.unquoted.plz'],
      ['}', 'punctuation.section.braces.plz'],
    ],
  ],

  [
    '{| a: 1, [:Integer]: :Boolean |}',
    [
      ['{|', 'punctuation.section.braces.plz'],
      ['a', 'variable.parameter.plz'],
      [':', 'punctuation.separator.key-value.plz'],
      ['1', 'string.unquoted.plz'],
      [',', 'punctuation.separator.plz'],
      ['[', 'punctuation.section.brackets.plz'],
      [':', 'punctuation.definition.variable.plz'],
      ['Integer', 'variable.other.constant.plz'],
      [']', 'punctuation.section.brackets.plz'],
      [':', 'punctuation.separator.key-value.plz'],
      [':', 'punctuation.definition.variable.plz'],
      ['Boolean', 'variable.other.constant.plz'],
      ['|}', 'punctuation.section.braces.plz'],
    ],
  ],

  [
    '{||}',
    [
      ['{|', 'punctuation.section.braces.plz'],
      ['|}', 'punctuation.section.braces.plz'],
    ],
  ],

  [
    '{|\n  foo + 1\n|}',
    [
      ['{|', 'punctuation.section.braces.plz'],
      ['foo', 'string.unquoted.plz'],
      ['+', 'entity.name.function.plz'],
      ['1', 'string.unquoted.plz'],
      ['|}', 'punctuation.section.braces.plz'],
    ],
  ],

  [
    'x => :x',
    [
      ['x', 'variable.parameter.plz'],
      ['=>', 'storage.type.function.arrow.plz'],
      [':', 'punctuation.definition.variable.plz'],
      ['x', 'variable.other.constant.plz'],
    ],
  ],

  [
    '{ "a": 1 }',
    [
      ['{', 'punctuation.section.braces.plz'],
      ['"', 'punctuation.definition.quoted-atom.begin.plz'],
      ['a', 'variable.parameter.plz'],
      ['"', 'punctuation.definition.quoted-atom.end.plz'],
      [':', 'punctuation.separator.key-value.plz'],
      ['1', 'string.unquoted.plz'],
      ['}', 'punctuation.section.braces.plz'],
    ],
  ],

  [
    '{ (a): 1 }',
    [
      ['{', 'punctuation.section.braces.plz'],
      ['(', 'punctuation.section.parens.plz'],
      ['a', 'variable.parameter.plz'],
      [')', 'punctuation.section.parens.plz'],
      [':', 'punctuation.separator.key-value.plz'],
      ['1', 'string.unquoted.plz'],
      ['}', 'punctuation.section.braces.plz'],
    ],
  ],

  [
    '{ ("a b"): 1 }',
    [
      ['{', 'punctuation.section.braces.plz'],
      ['(', 'punctuation.section.parens.plz'],
      ['"', 'punctuation.definition.quoted-atom.begin.plz'],
      ['a b', 'variable.parameter.plz'],
      ['"', 'punctuation.definition.quoted-atom.end.plz'],
      [')', 'punctuation.section.parens.plz'],
      [':', 'punctuation.separator.key-value.plz'],
      ['1', 'string.unquoted.plz'],
      ['}', 'punctuation.section.braces.plz'],
    ],
  ],

  [
    '"x" => 1',
    [
      ['"', 'punctuation.definition.quoted-atom.begin.plz'],
      ['x', 'variable.parameter.plz'],
      ['"', 'punctuation.definition.quoted-atom.end.plz'],
      ['=>', 'storage.type.function.arrow.plz'],
      ['1', 'string.unquoted.plz'],
    ],
  ],

  [
    '("x": :Atom) => 1',
    [
      ['(', 'punctuation.section.parens.plz'],
      ['"', 'punctuation.definition.quoted-atom.begin.plz'],
      ['x', 'variable.parameter.plz'],
      ['"', 'punctuation.definition.quoted-atom.end.plz'],
      [':', 'punctuation.separator.key-value.plz'],
      [':', 'punctuation.definition.variable.plz'],
      ['Atom', 'variable.other.constant.plz'],
      [')', 'punctuation.section.parens.plz'],
      ['=>', 'storage.type.function.arrow.plz'],
      ['1', 'string.unquoted.plz'],
    ],
  ],

  [
    '(x: T)',
    [
      ['(', 'punctuation.section.parens.plz'],
      ['x', 'variable.parameter.plz'],
      [':', 'punctuation.separator.key-value.plz'],
      ['T', 'string.unquoted.plz'],
      [')', 'punctuation.section.parens.plz'],
    ],
  ],

  [
    '{ [:Atom]: :Nothing }',
    [
      ['{', 'punctuation.section.braces.plz'],
      ['[', 'punctuation.section.brackets.plz'],
      [':', 'punctuation.definition.variable.plz'],
      ['Atom', 'variable.other.constant.plz'],
      [']', 'punctuation.section.brackets.plz'],
      [':', 'punctuation.separator.key-value.plz'],
      [':', 'punctuation.definition.variable.plz'],
      ['Nothing', 'variable.other.constant.plz'],
      ['}', 'punctuation.section.braces.plz'],
    ],
  ],

  [
    '(?b: :Atom)',
    [
      ['(', 'punctuation.section.parens.plz'],
      ['?', 'punctuation.definition.type-parameter.plz'],
      ['b', 'entity.name.type.plz'],
      [':', 'punctuation.separator.key-value.plz'],
      [':', 'punctuation.definition.variable.plz'],
      ['Atom', 'variable.other.constant.plz'],
      [')', 'punctuation.section.parens.plz'],
    ],
  ],

  [
    '{ a: ?b, c: 1 }',
    [
      ['{', 'punctuation.section.braces.plz'],
      ['a', 'variable.parameter.plz'],
      [':', 'punctuation.separator.key-value.plz'],
      ['?', 'punctuation.definition.type-parameter.plz'],
      ['b', 'entity.name.type.plz'],
      [',', 'punctuation.separator.plz'],
      ['c', 'variable.parameter.plz'],
      [':', 'punctuation.separator.key-value.plz'],
      ['1', 'string.unquoted.plz'],
      ['}', 'punctuation.section.braces.plz'],
    ],
  ],

  [
    '?T',
    [
      ['?', 'punctuation.definition.type-parameter.plz'],
      ['T', 'entity.name.type.plz'],
    ],
  ],

  ['@runtime', [['@runtime', 'storage.modifier.plz']]],

  [
    '"@@escaped"',
    [
      ['"', 'punctuation.definition.quoted-atom.begin.plz'],
      ['@@', 'constant.character.escape.plz'],
      ['escaped', 'string.quoted.plz'],
      ['"', 'punctuation.definition.quoted-atom.end.plz'],
    ],
  ],

  [
    '"a\\"b"',
    [
      ['"', 'punctuation.definition.quoted-atom.begin.plz'],
      ['a', 'string.quoted.plz'],
      ['\\"', 'constant.character.escape.plz'],
      ['b', 'string.quoted.plz'],
      ['"', 'punctuation.definition.quoted-atom.end.plz'],
    ],
  ],
])

const patternOf = (ruleName: string): string => {
  const pattern = tmLanguageGrammar.repository[ruleName]?.match
  if (pattern === undefined) {
    throw new Error(`\`${ruleName}\` has no \`match\``)
  } else {
    return pattern
  }
}

const unquotedAtomPattern = new RegExp(`^(?:${patternOf('unquoted-atom')})$`)

const wordPatternOf = (languageConfiguration: unknown): unknown =>
  (
    typeof languageConfiguration === 'object' &&
    languageConfiguration !== null &&
    'wordPattern' in languageConfiguration
  ) ?
    languageConfiguration.wordPattern
  : undefined

// A word, for the purpose of double-clicking one, is a bare atom.
test("the editor's word pattern is the grammar's atom pattern", async () => {
  const languageConfiguration: unknown = JSON.parse(
    await readFile(languageConfigurationFilePath, 'utf-8'),
  )
  assert.equal(wordPatternOf(languageConfiguration), patternOf('unquoted-atom'))
})

const printableAsciiCharacters = Array.from(
  { length: 0x7f - 0x20 },
  (_, index) => String.fromCodePoint(0x20 + index),
)

const atomCandidates = [
  ...printableAsciiCharacters,
  '世',
  'é',
  '→',
  '//',
  '/*',
  '*/',
  'a//b',
  'a/*b',
  'a*/b',
  'a/b',
  'a*b',
  '|>',
  '<|',
  '||',
]

suite('the grammar and the parser agree about what an unquoted atom is', () => {
  atomCandidates.forEach(candidate => {
    test(`\`${candidate}\``, () => {
      assert.equal(
        unquotedAtomPattern.test(candidate),
        either.isRight(parsing.parse(unquotedAtomParser, candidate)),
      )
    })
  })
})

const exampleDirectoryPath = path.join(repositoryRootPath, 'examples')

suite('scopes assigned to the examples', async () => {
  const exampleFileNames = (await readdir(exampleDirectoryPath)).filter(
    fileName => fileName.endsWith('.plz'),
  )
  await Promise.all(
    exampleFileNames.map(async exampleFileName => {
      const source = await readFile(
        path.join(exampleDirectoryPath, exampleFileName),
        'utf-8',
      )
      return test(exampleFileName, t => {
        t.assert.snapshot(
          scopedTokens(source)
            .map(([text, scope]) => `${JSON.stringify(text)} ${scope}`)
            .join('\n'),
          { serializers: [value => String(value)] },
        )
      })
    }),
  )
})
