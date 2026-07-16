import either from '@matt.kantor/either'
import option, { type Option } from '@matt.kantor/option'
import type { Atom } from '../../parsing.js'
import { isFunctionNode } from '../function-node.js'
import { lookupPropertyOfObjectNode } from '../object-node.js'
import {
  stringifySemanticGraphForEndUser,
  stringifyTypeForEndUser,
} from '../semantic-graph.js'
import {
  isAssignable,
  makeFunctionType,
  makeTypeParameter,
  matchTypeFormat,
  types,
  unionOfTypes,
  type Type,
} from '../type-system.js'
import { typeFromSemanticGraph } from '../type-system/literal-type.js'
import { asUnionWithLiteralAtomMembers } from '../type-system/subtyping.js'
import {
  applyKeyPathToType,
  applyTypeToArgumentType,
} from '../type-system/type-substitution.js'
import {
  anyValue,
  functionParameter,
  objectParameter,
  taggedParameter,
} from './parameters.js'
import {
  applyValidatingParameterType,
  emptyContextForStdlibApplications,
  preludeFunction,
} from './stdlib-utilities.js'

const A = makeTypeParameter('a', { assignableTo: types.something })
const B = makeTypeParameter('b', { assignableTo: types.something })
const C = makeTypeParameter('c', { assignableTo: types.something })

/**
 * Computes the upper bound of `match`'s return type, which is the union of each
 * reachable case's return type.
 */
const computeMatchReturnType = (parameterTypes: readonly Type[]): Type => {
  const [casesType, matcheeType] = parameterTypes
  if (casesType === undefined || matcheeType === undefined) {
    throw new Error(
      '`match` function did not receive two arguments. This is a bug!',
    )
  } else {
    // For every statically-known tag of the matchee, look up the case for that
    // tag and apply its type to the matchee's `value` type.
    return option.match(
      option.flatMap(enumerateTaggedVariants(matcheeType), variants =>
        option.sequence(
          variants.map(({ tag, value }) =>
            option.flatMap(applyKeyPathToType(casesType, [tag]), caseType =>
              applyTypeToArgumentType(caseType, value),
            ),
          ),
        ),
      ),
      {
        none: _ =>
          // TODO: Ideally this would be impossible, but `match` needs a fancier
          // signature to make that happen.
          types.something,
        some: unionOfTypes,
      },
    )
  }
}

export const globalFunctions = {
  identity: preludeFunction(['identity'], [anyValue(A)], A, either.makeRight),

  // a ~> ((a ~> b) ~> b)
  apply: preludeFunction(
    ['apply'],
    [
      anyValue(A),
      functionParameter(makeFunctionType({ parameter: A, return: B })),
    ],
    B,
    argument =>
      either.makeRight(functionToApply =>
        functionToApply(argument, emptyContextForStdlibApplications),
      ),
  ),

  // a ~> something ~> a
  // terminates with a `typeMismatch` error the value doesn't typecheck
  assume: preludeFunction(
    ['assume'],
    [anyValue(A), anyValue(types.something)],
    A,
    type =>
      either.makeRight(value =>
        either.flatMap(
          typeFromSemanticGraph(value, { objectsAreExact: true }),
          valueAsType =>
            either.flatMap(
              typeFromSemanticGraph(type, { objectsAreExact: false }),
              typeAsType =>
                isAssignable({ source: valueAsType, target: typeAsType }) ?
                  either.makeRight(value)
                : either.makeLeft({
                    kind: 'typeMismatch',
                    message: `the value \`${stringifySemanticGraphForEndUser(
                      value,
                    )}\` is not assignable to the type \`${stringifyTypeForEndUser(typeAsType)}\``,
                  }),
            ),
        ),
      ),
  ),

  // (b ~> c) ~> (a ~> b) ~> (a ~> c)
  flow: preludeFunction(
    ['flow'],
    [
      functionParameter(makeFunctionType({ parameter: B, return: C })),
      functionParameter(makeFunctionType({ parameter: A, return: B })),
      anyValue(A),
    ],
    C,
    secondFunction =>
      either.makeRight(firstFunction =>
        either.makeRight(firstArgument =>
          either.flatMap(
            firstFunction(firstArgument, emptyContextForStdlibApplications),
            secondArgument =>
              secondFunction(secondArgument, emptyContextForStdlibApplications),
          ),
        ),
      ),
  ),

  // TODO: Tighten this up, rejecting:
  //  - Non-exhaustive cases.
  //  - Case functions with incorrect parameter types.
  match: preludeFunction(
    ['match'],
    [objectParameter, taggedParameter],
    types.something,
    cases =>
      either.makeRight(argument =>
        option.match(lookupPropertyOfObjectNode(argument.tag, cases), {
          none: _ =>
            either.makeLeft({
              kind: 'panic',
              message: `case for tag '${argument.tag}' was not defined`,
            }),
          some: relevantCase =>
            isFunctionNode(relevantCase) ?
              applyValidatingParameterType(relevantCase, argument.value)
            : either.makeRight(relevantCase),
        }),
      ),
    computeMatchReturnType,
  ),
} as const

const enumerateTaggedVariants = (
  type: Type,
): Option<
  readonly {
    readonly tag: Atom
    readonly value: Type
  }[]
> =>
  matchTypeFormat(type, {
    union: type =>
      option.map(
        option.sequence([
          ...type.members
            .values()
            .map(member =>
              typeof member === 'string' ?
                option.none
              : enumerateTaggedVariants(member),
            ),
        ]),
        variantsPerMember => variantsPerMember.flat(),
      ),
    object: type => {
      const tagType = type.children['tag']
      const valueType = type.children['value']
      return (
          tagType === undefined ||
            valueType === undefined ||
            tagType.kind !== 'union'
        ) ?
          option.none
        : option.map(asUnionWithLiteralAtomMembers(tagType), tags => [
            ...tags.members.values().map(tag => ({ tag, value: valueType })),
          ])
    },
    application: _ => option.none,
    function: _ => option.none,
    indexedAccess: _ => option.none,
    intrinsicApplication: _ => option.none,
    opaque: _ => option.none,
    parameter: _ => option.none,
  })
