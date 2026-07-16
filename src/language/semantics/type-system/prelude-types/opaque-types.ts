import optionAdt from '@matt.kantor/option'
import { makeOpaqueType } from '../type-formats/opaque-type.js'
import { replaceAllTypeParametersWithTheirConstraints } from '../type-substitution.js'
import {
  atomTypeSymbol,
  integerTypeSymbol,
  naturalNumberTypeSymbol,
} from './type-symbols.js'

// The current type hierarchy for opaque types is:
//  - atom
//    - integer
//      - natural_number

export const atom = makeOpaqueType(atomTypeSymbol, {
  isAssignableFromLiteralType: (_literalType: string) => true,
  upperBoundOfStuckType: replaceAllTypeParametersWithTheirConstraints,
  nearestOpaqueAssignableFrom: () => optionAdt.makeSome(integer),
  nearestOpaqueAssignableTo: () => optionAdt.none,
})

export const integer = makeOpaqueType(integerTypeSymbol, {
  isAssignableFromLiteralType: literalType =>
    /^(?:0|-?[1-9][0-9]*)$/.test(literalType),
  upperBoundOfStuckType: replaceAllTypeParametersWithTheirConstraints,
  nearestOpaqueAssignableFrom: () => optionAdt.makeSome(naturalNumber),
  nearestOpaqueAssignableTo: () => optionAdt.makeSome(atom),
})

export const naturalNumber = makeOpaqueType(naturalNumberTypeSymbol, {
  isAssignableFromLiteralType: literalType =>
    /^(?:0|[1-9][0-9]*)$/.test(literalType),
  upperBoundOfStuckType: replaceAllTypeParametersWithTheirConstraints,
  nearestOpaqueAssignableFrom: () => optionAdt.none,
  nearestOpaqueAssignableTo: () => optionAdt.makeSome(integer),
})
