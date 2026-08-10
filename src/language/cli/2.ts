import { defaultConfiguration } from '../configuration.js'
import { evaluate } from '../runtime.js'
import { handleInput } from './input.js'
import { handleOutput } from './output.js'

const main = async (process: NodeJS.Process): Promise<undefined> =>
  handleOutput(process, () =>
    handleInput(process, evaluate(defaultConfiguration)),
  )

await main(process)
