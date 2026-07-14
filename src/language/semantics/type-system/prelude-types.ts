import { atom, integer, naturalNumber } from './prelude-types/opaque-types.js'
import { something } from './prelude-types/transparent-types.js'
import {
  atomTypeSymbol,
  integerTypeSymbol,
  naturalNumberTypeSymbol,
  somethingTypeSymbol,
} from './prelude-types/type-symbols.js'

export * from './prelude-types/opaque-types.js'
export * from './prelude-types/transparent-types.js'
export * from './prelude-types/type-symbols.js'

export const typesBySymbol = {
  [atomTypeSymbol]: atom,
  [integerTypeSymbol]: integer,
  [naturalNumberTypeSymbol]: naturalNumber,
  [somethingTypeSymbol]: something,
}
