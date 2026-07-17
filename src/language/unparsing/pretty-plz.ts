import { moleculeUnparser, unparseAtom } from './plz-utilities.js'
import { type Notation } from './unparsing-utilities.js'

export const prettyPlz: Notation = {
  atom: unparseAtom,
  molecule: moleculeUnparser({
    flow: 'multiline',
    ordinalKeys: 'omit',
  })('default'),
  suffix: '\n',
}
