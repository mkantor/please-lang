import either, { type Either } from '@matt.kantor/either'
import { parseArgs } from 'node:util'
import type { SyntaxTree } from '../parsing/syntax-tree.js'
import {
  prettyJson,
  prettyPlz,
  sugarFreePrettyPlz,
  unparse,
  type Notation,
} from '../unparsing.js'
import { formatError, type DiagnosticError } from './error-formatting.js'

export const handleOutput = async (
  process: NodeJS.Process,
  command: () =>
    | Either<DiagnosticError, SyntaxTree>
    | Promise<Either<DiagnosticError, SyntaxTree>>,
  defaultOutputNotation?: Notation,
  source?: string,
): Promise<undefined> => {
  const args = parseArgs({
    args: process.argv.slice(2), // remove `execPath` and `filename`
    strict: false,
    options: {
      'no-color': { type: 'boolean' },
      'output-format': { type: 'string' },
    },
  })

  const noColorArg = args.values['no-color'] ?? false
  if (typeof noColorArg !== 'boolean') {
    throw new Error('Unsupported value for --no-color')
  } else if (noColorArg) {
    // Warning: the global state mutation here means that we can't style text in
    // static contexts! Functions like `node:util`'s `styleText` shouldn't be
    // called from the top level of modules.
    delete process.env['FORCE_COLOR']
    process.env['NO_COLOR'] = 'true'
  }

  const outputFormatArg = args.values['output-format']
  let notation: Notation
  if (outputFormatArg === undefined) {
    if (defaultOutputNotation !== undefined) {
      notation = defaultOutputNotation
    } else {
      throw new Error('Missing required option: --output-format')
    }
  } else if (outputFormatArg === 'json') {
    notation = prettyJson
  } else if (outputFormatArg === 'plz') {
    notation = prettyPlz
  } else if (outputFormatArg === 'sugar-free-plz') {
    notation = sugarFreePrettyPlz
  } else {
    throw new Error(`Unsupported output format: "${outputFormatArg}"`)
  }

  const result = await command()
  either.match(result, {
    left: error => {
      process.stderr.write(
        `${formatError(error, { filename: '<stdin>', ...(source === undefined ? {} : { source }) })}\n`,
      )
      process.exitCode = 1
      return undefined
    },
    right: output => {
      writeOutput(process.stdout, notation, output)
      return undefined
    },
  })
}

export const writeOutput = (
  writeStream: NodeJS.WritableStream,
  notation: Notation,
  output: SyntaxTree,
): void => {
  const outputAsString = unparse(output, notation)
  if (either.isLeft(outputAsString)) {
    throw new Error(outputAsString.value.message)
  } else {
    writeStream.write(outputAsString.value)
  }
}
