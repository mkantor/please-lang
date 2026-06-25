import either from '@matt.kantor/either'
import assert from 'node:assert'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import test, { suite } from 'node:test'
import { parse } from './language/parsing/parser.js'
import { lineAndColumnAtOffset } from './language/source-location.js'

const repositoryRootDirectory = path.join(import.meta.dirname, '..')
const readmePath = path.resolve(repositoryRootDirectory, 'README.md')

type CodeBlock = {
  readonly content: string
  readonly startingLineNumber: number
}

type RelativeLink = {
  readonly target: string
  readonly lineNumber: number
}

const fencedCodeBlocks = (
  source: string,
  codeBlockLanguage: string,
): readonly CodeBlock[] => {
  const fencedCodeBlockPattern = new RegExp(
    `\`\`\`${RegExp.escape(codeBlockLanguage)}\\n([\\s\\S]*?)\\n\\s*\`\`\``,
    'g',
  )
  return [...source.matchAll(fencedCodeBlockPattern)].map(match => ({
    content: match[1] ?? '',
    // The line after the opening fence is where code begins:
    startingLineNumber: lineAndColumnAtOffset(source, match.index).line + 1,
  }))
}

const relativeLinks = (source: string): readonly RelativeLink[] => {
  return [...source.matchAll(relativeLinkPattern)].map(match => ({
    target: match[1] ?? '',
    lineNumber: lineAndColumnAtOffset(source, match.index).line,
  }))
}
// This pattern matches links of the form `[text](./path)` or `[text](../path)`:
const relativeLinkPattern = /\[[^\]]*\]\((\.\.?\/[^)\s]+)\)/g

suite('README.md', async () => {
  const readmeSource = await fs.readFile(readmePath, { encoding: 'utf-8' })

  await suite('plz code blocks', async _ => {
    await Promise.all(
      fencedCodeBlocks(readmeSource, 'plz').map(
        ({ content, startingLineNumber }) =>
          test(`parsing code in block at line ${startingLineNumber}`, () => {
            either.match(parse(content), {
              right: _ => undefined,
              left: error =>
                assert.fail(
                  `block beginning at line ${startingLineNumber} couldn't be parsed: ${error.message}`,
                ),
            })
          }),
      ),
    )
  })

  await suite('relative links', async _ => {
    await Promise.all(
      relativeLinks(readmeSource).map(({ target, lineNumber }) =>
        test(`resolving ${target} (line ${lineNumber})`, async () => {
          const [pathPart] = target.split('#')
          const absolutePath = path.resolve(
            repositoryRootDirectory,
            pathPart ?? '',
          )
          return assert.doesNotReject(
            fs.stat(absolutePath),
            `link target \`${pathPart}\` does not exist`,
          )
        }),
      ),
    )
  })

  await test('resolving target line range from reserved character sequences link', async () => {
    const linkPattern =
      /\[.*reserved.*\]\(\.\/(src\/language\/parsing\/atom\.ts)#L(\d+)-L(\d+)\)/
    const match = linkPattern.exec(readmeSource)
    assert(match !== null, 'expected the link to exist')
    const [_, relativePath, linkedStart, linkedEnd] = match
    const linkedStartingLine = BigInt(linkedStart ?? 'start not found')
    const linkedEndingLine = BigInt(linkedEnd ?? 'end not found')

    // If I wanted to be robust here I'd actually parse the TypeScript source,
    // but for now this is good enough.

    const targetFileSourceLines = (
      await fs.readFile(
        path.resolve(repositoryRootDirectory, relativePath ?? ''),
        { encoding: 'utf-8' },
      )
    ).split('\n')

    const declarationStartingLineIndex = targetFileSourceLines.findIndex(line =>
      /^\s*const atomComponentsRequiringQuotation = \[/.test(line),
    )
    assert.notDeepEqual(
      declarationStartingLineIndex,
      -1,
      'could not find `atomComponentsRequiringQuotation` declaration in atom.ts',
    )
    const declarationStartingLine = BigInt(declarationStartingLineIndex + 1)

    const declarationEndingLineIndex = targetFileSourceLines.findIndex(
      (line, index) =>
        index > declarationStartingLineIndex && /^\s*\][^,]*$/.test(line),
    )
    assert.notDeepEqual(
      declarationEndingLineIndex,
      -1,
      'could not find the closing `]` for `atomComponentsRequiringQuotation`',
    )
    const declarationEndingLine = BigInt(declarationEndingLineIndex + 1)

    assert.deepEqual(
      linkedStartingLine,
      declarationStartingLine,
      `README link starts at L${linkedStartingLine} but the \`atomComponentsRequiringQuotation\` declaration starts at L${declarationStartingLine}`,
    )
    assert.deepEqual(
      linkedEndingLine,
      declarationEndingLine,
      `README link ends at L${linkedEndingLine} but the \`atomComponentsRequiringQuotation\` declaration ends at L${declarationEndingLine}`,
    )
  })
})
