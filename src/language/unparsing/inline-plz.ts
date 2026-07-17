import either, { type Either } from '@matt.kantor/either'
import { styleText } from 'node:util'
import type { UnserializableValueError } from '../errors.js'
import type { Atom, Molecule } from '../parsing.js'
import {
  moleculeAsKeyValuePairStrings,
  moleculeUnparser,
  unparseAtom,
  type SemanticContext,
} from './plz-utilities.js'
import { punctuation, type Notation } from './unparsing-utilities.js'

const unparseSugarFreeMolecule = (value: Molecule) => {
  const { comma, closeBrace, openBrace } = punctuation(styleText)
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
          ' ',
          keyValuePairsAsStrings.join(comma.concat(' ')),
          ' ',
          closeBrace,
        ),
    )
  }
}

const unparseAtomOrMolecule =
  (semanticContext: SemanticContext) =>
  (value: Atom | Molecule): Either<UnserializableValueError, string> =>
    typeof value === 'string' ?
      unparseAtom(value)
    : unparseMolecule(semanticContext)(value)

const unparseMolecule = (semanticContext: SemanticContext) =>
  moleculeUnparser('inline', semanticContext)(
    unparseAtomOrMolecule,
    unparseSugarFreeMolecule,
  )

export const inlinePlz: Notation = {
  atom: unparseAtom,
  molecule: unparseMolecule('default'),
  suffix: '',
}
