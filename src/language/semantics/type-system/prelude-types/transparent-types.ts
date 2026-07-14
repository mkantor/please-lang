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
