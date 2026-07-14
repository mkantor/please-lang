import {
  atom,
  atomTypeSymbol,
  integer,
  integerTypeSymbol,
  naturalNumber,
  naturalNumberTypeSymbol,
} from './prelude-types/opaque-types.js'
import { something } from './prelude-types/transparent-types.js'

export * from './prelude-types/opaque-types.js'
export * from './prelude-types/transparent-types.js'

// Despite not being opaque, `something` gets a type symbol to avoid
// complications in value space stemming from its circular definition.
export const somethingTypeSymbol = Symbol('something')

export const typesBySymbol = {
  [atomTypeSymbol]: atom,
  [integerTypeSymbol]: integer,
  [naturalNumberTypeSymbol]: naturalNumber,
  [somethingTypeSymbol]: something,
}
