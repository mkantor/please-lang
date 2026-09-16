import { compile } from '../compiling/compiler.js'
import { defaultConfiguration } from '../configuration.js'
import { emptyExpressionSpans } from '../parsing.js'
import { handleInput } from './input.js'
import { handleOutput } from './output.js'

const main = (process: NodeJS.Process): Promise<undefined> =>
  handleOutput(process, () =>
    handleInput(process, input =>
      compile(defaultConfiguration)(input, emptyExpressionSpans),
    ),
  )

await main(process)
