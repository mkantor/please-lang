import optionAdt from '@matt.kantor/option'
import { makeOpaqueType, type OpaqueType } from '../type-formats/opaque-type.js'
import { upperBoundOfStuckType } from '../type-substitution.js'
import {
  atomTypeSymbol,
  integerTypeSymbol,
  naturalNumberTypeSymbol,
  pendingTypeSymbol,
} from './type-symbols.js'

/**
 * The type of an expression whose real type isn't known yet, which can happen
 * during analysis of recursive definitions.
 */
export const pending: OpaqueType = {
  symbol: pendingTypeSymbol,
  kind: 'opaque',
  isAssignableFrom: _source => true,
  isAssignableTo: _target => true,
}

// The current type hierarchy for opaque types is:
//  - atom
//    - integer
//      - natural_number

export const atom = makeOpaqueType(atomTypeSymbol, {
  isAssignableFromLiteralType: (_literalType: string) => true,
  upperBoundOfStuckType,
  nearestOpaqueAssignableFrom: () => optionAdt.makeSome(integer),
  nearestOpaqueAssignableTo: () => optionAdt.none,
})

export const integer = makeOpaqueType(integerTypeSymbol, {
  isAssignableFromLiteralType: literalType =>
    /^(?:0|-?[1-9][0-9]*)$/.test(literalType),
  upperBoundOfStuckType,
  nearestOpaqueAssignableFrom: () => optionAdt.makeSome(naturalNumber),
  nearestOpaqueAssignableTo: () => optionAdt.makeSome(atom),
})

export const naturalNumber = makeOpaqueType(naturalNumberTypeSymbol, {
  isAssignableFromLiteralType: literalType =>
    /^(?:0|[1-9][0-9]*)$/.test(literalType),
  upperBoundOfStuckType,
  nearestOpaqueAssignableFrom: () => optionAdt.none,
  nearestOpaqueAssignableTo: () => optionAdt.makeSome(integer),
})
