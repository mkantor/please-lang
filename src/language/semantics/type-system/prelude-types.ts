import optionAdt from '@matt.kantor/option'
import {
  makeFunctionType,
  makeObjectType,
  makeOpaqueType,
  makeTypeParameter,
  makeUnionType,
  type FunctionType,
  type ObjectType,
  type Type,
  type UnionType,
} from './type-formats.js'
import { replaceAllTypeParametersWithTheirConstraints } from './type-substitution.js'

export const nothing = makeUnionType([]) // the bottom type

// `null` unfortunately can't be a variable name
export const nullType = makeUnionType(['null'])

export const boolean = makeUnionType(['false', 'true'])

// The current type hierarchy for opaque types is:
//  - atom
//    - integer
//      - natural_number

export const atomTypeSymbol = Symbol('atom')
export const atom = makeOpaqueType(atomTypeSymbol, {
  isAssignableFromLiteralType: (_literalType: string) => true,
  upperBoundOfStuckType: replaceAllTypeParametersWithTheirConstraints,
  nearestOpaqueAssignableFrom: () => optionAdt.makeSome(integer),
  nearestOpaqueAssignableTo: () => optionAdt.none,
})

export const integerTypeSymbol = Symbol('integer')
export const integer = makeOpaqueType(integerTypeSymbol, {
  isAssignableFromLiteralType: literalType =>
    /^(?:0|-?[1-9][0-9]*)$/.test(literalType),
  upperBoundOfStuckType: replaceAllTypeParametersWithTheirConstraints,
  nearestOpaqueAssignableFrom: () => optionAdt.makeSome(naturalNumber),
  nearestOpaqueAssignableTo: () => optionAdt.makeSome(atom),
})

export const naturalNumberTypeSymbol = Symbol('natural_number')
export const naturalNumber = makeOpaqueType(naturalNumberTypeSymbol, {
  isAssignableFromLiteralType: literalType =>
    /^(?:0|[1-9][0-9]*)$/.test(literalType),
  upperBoundOfStuckType: replaceAllTypeParametersWithTheirConstraints,
  nearestOpaqueAssignableFrom: () => optionAdt.none,
  nearestOpaqueAssignableTo: () => optionAdt.makeSome(integer),
})

// `functionType`, `object`, and `something` reference each other directly, so
// we need to do a dance. Note that many type traversals rely on reference
// equality of `something` to avoid infinite recursion/iteration.
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
export const functionType: FunctionType = {} as FunctionType
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
export const object: ObjectType = {} as ObjectType
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
export const something: UnionType = {} as UnionType // the top type
Object.assign(
  functionType,
  makeFunctionType({
    parameter: nothing,
    return: something,
  }) satisfies FunctionType,
)
Object.assign(
  object,
  makeObjectType({}, { excess: something }) satisfies ObjectType,
)
Object.assign(
  something,
  makeUnionType([functionType, atom, object]) satisfies UnionType,
)

// Despite not being opaque, `something` gets a type symbol to avoid
// complications in value space stemming from its circular definition.
export const somethingTypeSymbol = Symbol('something')

export const typesBySymbol = {
  [atomTypeSymbol]: atom,
  [integerTypeSymbol]: integer,
  [naturalNumberTypeSymbol]: naturalNumber,
  [somethingTypeSymbol]: something,
}

export const option = (value: Type) =>
  makeUnionType([
    makeObjectType(
      {
        tag: makeUnionType(['some']),
        value,
      },
      { excess: nothing },
    ),
    makeObjectType(
      {
        tag: makeUnionType(['none']),
        value: makeObjectType({}, { excess: nothing }),
      },
      { excess: nothing },
    ),
  ])

const A = makeTypeParameter('a', { assignableTo: something })

export const runtimeContext = makeObjectType(
  {
    arguments: makeObjectType(
      {
        lookup: makeFunctionType({ parameter: atom, return: option(atom) }),
      },
      { excess: nothing },
    ),
    environment: makeObjectType(
      {
        lookup: makeFunctionType({ parameter: atom, return: option(atom) }),
      },
      { excess: nothing },
    ),
    log: makeFunctionType({ parameter: A, return: A }),
    program: makeObjectType({ start_time: atom }, { excess: nothing }),
  },
  { excess: nothing },
)
