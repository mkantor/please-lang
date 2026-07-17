import either from '@matt.kantor/either'
import { styleText } from 'node:util'
import type { Molecule } from '../parsing.js'
import {
  moleculeAsKeyValuePairStrings,
  moleculeUnparser,
  unparseAtom,
  type SemanticContext,
  type UnparseAtomOrMolecule,
} from './plz-utilities.js'
import { indent, punctuation, type Notation } from './unparsing-utilities.js'

const unparseSugarFreeMolecule = (value: Molecule) => {
  const { closeBrace, openBrace } = punctuation(styleText)
  if (value.entries.length === 0) {
    return either.makeRight(openBrace + closeBrace)
  } else {
    return either.map(
      moleculeAsKeyValuePairStrings(
        value,
        { unparseAtomOrMolecule, semanticContext: 'default' },
        {
          ordinalKeys: 'omit',
        },
      ),
      keyValuePairsAsStrings =>
        openBrace.concat(
          '\n',
          indent(2, keyValuePairsAsStrings.join('\n')),
          '\n',
          closeBrace,
        ),
    )
  }
}

const unparseAtomOrMolecule: UnparseAtomOrMolecule =
  semanticContext => value =>
    typeof value === 'string' ?
      unparseAtom(value)
    : unparseMolecule(semanticContext)(value)

const unparseMolecule = (semanticContext: SemanticContext) =>
  moleculeUnparser('multiline', semanticContext)(
    unparseAtomOrMolecule,
    unparseSugarFreeMolecule,
  )

export const prettyPlz: Notation = {
  atom: unparseAtom,
  molecule: unparseMolecule('default'),
  suffix: '\n',
}
