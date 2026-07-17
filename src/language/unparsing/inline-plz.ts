import { moleculeUnparser, unparseAtom } from './plz-utilities.js'
import { type Notation } from './unparsing-utilities.js'

export const inlinePlz: Notation = {
  atom: unparseAtom,
  molecule: moleculeUnparser({
    flow: 'inline',
    ordinalKeys: 'omit',
  })('default'),
  suffix: '',
}
