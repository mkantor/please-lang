import either from '@matt.kantor/either'
import option, { type Option } from '@matt.kantor/option'
import type { Atom } from '../../parsing.js'
import { isFunctionNode } from '../function-node.js'
import { isSemanticGraph } from '../is-semantic-graph.js'
import {
  isObjectNode,
  lookupPropertyOfObjectNode,
  type ObjectNode,
} from '../object-node.js'
import {
  stringifySemanticGraphForEndUser,
  stringifyTypeForEndUser,
  type SemanticGraph,
} from '../semantic-graph.js'
import { isAssignable, types } from '../type-system.js'
import { typeFromSemanticGraph } from '../type-system/literal-type.js'
import { asUnionWithLiteralAtomMembers } from '../type-system/subtyping.js'
import {
  makeFunctionType,
  makeObjectType,
  makeTypeParameter,
  matchTypeFormat,
  unionOfTypes,
  type Type,
} from '../type-system/type-formats.js'
import {
  applyKeyPathToType,
  applyTypeToArgumentType,
} from '../type-system/type-substitution.js'
import {
  emptyContextForStdlibApplications,
  preludeFunctionArity1,
  preludeFunctionArity2,
  preludeFunctionArity3,
} from './stdlib-utilities.js'

const A = makeTypeParameter('a', { assignableTo: types.something })
const B = makeTypeParameter('b', { assignableTo: types.something })
const C = makeTypeParameter('c', { assignableTo: types.something })

type TaggedNode = ObjectNode & {
  readonly tag: Atom
  readonly value: SemanticGraph
}
const nodeIsTagged = (node: SemanticGraph): node is TaggedNode =>
  isObjectNode(node) &&
  node['tag'] !== undefined &&
  (typeof node['tag'] === 'string' ||
    (isSemanticGraph(node['tag']) && typeof node['tag'] === 'string')) &&
  node['value'] !== undefined

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
          variants.map(({ tag, value }) => {
            const caseType = applyKeyPathToType(casesType, [tag])
            return caseType.kind === 'union' && caseType.members.size === 0 ?
                option.none
              : applyTypeToArgumentType(caseType, value)
          }),
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
  identity: preludeFunctionArity1(
    ['identity'],
    { parameter: A, return: A },
    either.makeRight,
  ),

  // a ~> ((a ~> b) ~> b)
  apply: preludeFunctionArity2(
    ['apply'],
    {
      parameter: A,
      return: makeFunctionType({
        parameter: makeFunctionType({ parameter: A, return: B }),
        return: B,
      }),
    },
    argument =>
      either.makeRight(functionToApply => {
        if (!isFunctionNode(functionToApply)) {
          return either.makeLeft({
            kind: 'typeMismatch',
            message: '`apply` expected a function',
          })
        } else {
          return functionToApply(argument, emptyContextForStdlibApplications)
        }
      }),
  ),

  // a ~> something ~> a
  // terminates with a `typeMismatch` error the value doesn't typecheck
  assume: preludeFunctionArity2(
    ['assume'],
    {
      parameter: A,
      return: makeFunctionType({
        parameter: types.something,
        return: A,
      }),
    },
    type =>
      either.makeRight(value =>
        either.flatMap(
          typeFromSemanticGraph(value, { objectsAreExact: true }),
          valueAsType =>
            either.flatMap(
              typeFromSemanticGraph(type, { objectsAreExact: false }),
              typeAsType => {
                if (
                  isAssignable({
                    source: valueAsType,
                    target: typeAsType,
                  })
                ) {
                  return either.makeRight(value)
                } else {
                  return either.makeLeft({
                    kind: 'typeMismatch',
                    message: `the value \`${stringifySemanticGraphForEndUser(
                      value,
                    )}\` is not assignable to the type \`${stringifyTypeForEndUser(typeAsType)}\``,
                  })
                }
              },
            ),
        ),
      ),
  ),

  // (b ~> c) ~> (a ~> b) ~> (a ~> c)
  flow: preludeFunctionArity3(
    ['flow'],
    {
      parameter: makeFunctionType({
        parameter: B,
        return: C,
      }),
      return: makeFunctionType({
        parameter: makeFunctionType({
          parameter: A,
          return: B,
        }),
        return: makeFunctionType({
          parameter: A,
          return: C,
        }),
      }),
    },
    secondFunction => {
      if (!isFunctionNode(secondFunction)) {
        return either.makeLeft({
          kind: 'typeMismatch',
          message: '`flow` expected a function',
        })
      } else {
        return either.makeRight(firstFunction => {
          if (!isFunctionNode(firstFunction)) {
            return either.makeLeft({
              kind: 'typeMismatch',
              message: '`flow` expected a function',
            })
          } else {
            return either.makeRight(firstArgument =>
              either.flatMap(
                firstFunction(firstArgument, emptyContextForStdlibApplications),
                secondArgument =>
                  secondFunction(
                    secondArgument,
                    emptyContextForStdlibApplications,
                  ),
              ),
            )
          }
        })
      }
    },
  ),

  match: preludeFunctionArity2(
    ['match'],
    {
      // TODO: Tighten this up, rejecting:
      //  - Non-exhaustive cases.
      //  - Case functions with incorrect parameter types.
      parameter: types.object,
      return: makeFunctionType({
        parameter: makeObjectType({
          tag: types.atom,
          value: types.something,
        }),
        return: types.something,
      }),
    },
    cases => {
      if (!isObjectNode(cases)) {
        return either.makeLeft({
          kind: 'typeMismatch',
          message: '`match` cases must be an object',
        })
      } else {
        return either.makeRight(argument => {
          if (!nodeIsTagged(argument)) {
            return either.makeLeft({
              kind: 'typeMismatch',
              message: '`match` argument was not tagged',
            })
          } else {
            const relevantCase = lookupPropertyOfObjectNode(argument.tag, cases)
            if (option.isNone(relevantCase)) {
              return either.makeLeft({
                kind: 'panic',
                message: `case for tag '${argument.tag}' was not defined`,
              })
            } else {
              return !isFunctionNode(relevantCase.value) ?
                  either.makeRight(relevantCase.value)
                : relevantCase.value(
                    argument.value,
                    emptyContextForStdlibApplications,
                  )
            }
          }
        })
      }
    },
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
        option.sequence(
          [...type.members].map(member =>
            typeof member === 'string' ?
              option.none
            : enumerateTaggedVariants(member),
          ),
        ),
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
        : option.map(asUnionWithLiteralAtomMembers(tagType), tags =>
            [...tags.members].map(tag => ({ tag, value: valueType })),
          )
    },
    application: _ => option.none,
    function: _ => option.none,
    indexedAccess: _ => option.none,
    intrinsicApplication: _ => option.none,
    opaque: _ => option.none,
    parameter: _ => option.none,
  })
