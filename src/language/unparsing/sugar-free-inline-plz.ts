import either from '@matt.kantor/either'
import { styleText } from 'node:util'
import type { Molecule } from '../parsing.js'
import {
  moleculeAsKeyValuePairStrings,
  unparseAtom,
  type SemanticContext,
  type UnparseAtomOrMolecule,
} from './plz-utilities.js'
import { punctuation, type Notation } from './unparsing-utilities.js'

const unparseMolecule = (semanticContext: SemanticContext) => {
  const keyValuePairStrings = moleculeAsKeyValuePairStrings({
    flow: 'inline',
    ordinalKeys: 'preserve',
  })({ unparseAtomOrMolecule, semanticContext })

  return (value: Molecule) => {
    const { closeBrace, openBrace, comma } = punctuation(styleText)
    if (value.entries.length === 0) {
      return either.makeRight(openBrace + closeBrace)
    } else {
      return either.map(keyValuePairStrings(value), keyValuePairsAsStrings =>
        openBrace.concat(
          ' ',
          keyValuePairsAsStrings.join(comma.concat(' ')),
          ' ',
          closeBrace,
        ),
      )
    }
  }
}

const unparseAtomOrMolecule: UnparseAtomOrMolecule =
  semanticContext => value =>
    typeof value === 'string' ?
      unparseAtom(value)
    : unparseMolecule(semanticContext)(value)

export const sugarFreeInlinePlz: Notation = {
  atom: unparseAtom,
  molecule: unparseMolecule('default'),
  suffix: '',
}
