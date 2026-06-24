import { compile } from '../compiling/compiler.js'
import { handleInput } from './input.js'
import { handleOutput } from './output.js'

const main = (process: NodeJS.Process): Promise<undefined> =>
  handleOutput(process, () =>
    handleInput(process, input => compile(input, new Map())),
  )

await main(process)
