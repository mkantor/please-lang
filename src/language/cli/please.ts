import either from '@matt.kantor/either'
import { stripVTControlCharacters } from 'node:util'
import { compile } from '../compiling.js'
import { parseWithSpans } from '../parsing/parser.js'
import { evaluate } from '../runtime.js'
import { prettyPlz } from '../unparsing.js'
import { readString } from './input.js'
import { handleOutput } from './output.js'

const main = async (process: NodeJS.Process): Promise<undefined> => {
  const sourceCode = stripVTControlCharacters(
    await readString(process.stdin),
  ).trim()
  return handleOutput(
    process,
    () => {
      // TODO: Cache intermediate representations to the filesystem.
      const program = either.flatMap(
        parseWithSpans(sourceCode),
        ({ tree, spans }) => compile(tree, spans),
      )
      return either.flatMap(program, evaluate)
    },
    prettyPlz,
    sourceCode,
  )
}

await main(process)
