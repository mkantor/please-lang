import type { Atom } from '../../../parsing.js'
import { somethingTypeSymbol } from '../prelude-types.js'
import {
  makeFunctionType,
  type FunctionType,
} from '../type-formats/function-type.js'
import { makeObjectType, type ObjectType } from '../type-formats/object-type.js'
import { makeTypeParameter } from '../type-formats/type-parameter-type.js'
import type { Type } from '../type-formats/type.js'
import { makeUnionType, type UnionType } from '../type-formats/union-type.js'
import { atom } from './opaque-types.js'

export const nothing = makeUnionType([]) // the bottom type

// `null` unfortunately can't be a variable name
export const nullType = makeUnionType(['null'])

export const boolean = makeUnionType(['false', 'true'])

export const object: ObjectType = makeObjectType({})

// `functionType` and `something` reference each other directly, so we need to
// do a dance.
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
export const functionType = {} as FunctionType
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
export const something = {} as UnionType & {
  readonly identity: typeof somethingTypeSymbol
} // the top type
Object.assign(
  functionType,
  makeFunctionType({
    parameter: nothing,
    return: something,
  }) satisfies FunctionType,
)
Object.assign(
  something,
  makeUnionType([functionType, atom, object]) satisfies UnionType,
  { identity: somethingTypeSymbol },
)

const makeExactObjectType = <Children extends Readonly<Record<Atom, Type>>>(
  children: Children,
) => makeObjectType(children, [{ keys: atom, values: nothing }])

export const option = (value: Type) =>
  makeUnionType([
    makeExactObjectType({
      tag: makeUnionType(['some']),
      value,
    }),
    makeExactObjectType({
      tag: makeUnionType(['none']),
      value: makeExactObjectType({}),
    }),
  ])

const A = makeTypeParameter('a', { assignableTo: something })

export const runtimeContext = makeExactObjectType({
  arguments: makeExactObjectType({
    lookup: makeFunctionType({ parameter: atom, return: option(atom) }),
  }),
  environment: makeExactObjectType({
    lookup: makeFunctionType({ parameter: atom, return: option(atom) }),
  }),
  log: makeFunctionType({ parameter: A, return: A }),
  program: makeExactObjectType({ start_time: atom }),
})
