import either from '@matt.kantor/either'
import option from '@matt.kantor/option'
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
import {
  makeFunctionType,
  makeObjectType,
  makeTypeParameter,
} from '../type-system/type-formats.js'
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
      // TODO: Make this signature generic:
      //  - The first parameter's keys must cover the possible tag values in the
      //    second parameter.
      //  - The first parameter's property values must be functions accepting
      //    the corresponding variant of the second parameter as input.
      //  - The final return type should be a union or all the return types from
      //    the first parameter.
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
  ),
} as const
