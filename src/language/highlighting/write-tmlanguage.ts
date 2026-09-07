import { writeFile } from 'node:fs/promises'
import { tmLanguageGrammar } from './tmlanguage.js'

const outputPath = process.argv[2]

if (outputPath === undefined) {
  throw new Error('Usage: write-tmlanguage.js <output path>')
} else {
  await writeFile(outputPath, `${JSON.stringify(tmLanguageGrammar, null, 2)}\n`)
}
