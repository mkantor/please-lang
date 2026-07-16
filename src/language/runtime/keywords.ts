import either from '@matt.kantor/either'
import option, { type Option } from '@matt.kantor/option'
import { parseArgs } from 'node:util'
import type { RemoveIndexSignatures } from '../../utility-types.js'
import { writeOutput } from '../cli/output.js'
import { keywordHandlers as compilerKeywordHandlers } from '../compiling.js'
import {
  isFunctionNode,
  keyPathToLookupExpression,
  makeFunctionNode,
  makeObjectNode,
  readRuntimeExpression,
  serialize,
  types,
  type FunctionNode,
  type KeywordHandlers,
  type ObjectNode,
  type Type,
} from '../semantics.js'
import type { NonEmptyKeyPath } from '../semantics/key-path.js'
import {
  makeTypeParameter,
  type FunctionType,
  type ObjectType,
  type OpaqueType,
  type UnionType,
} from '../semantics/type-system.js'
import { prettyJson } from '../unparsing.js'

const serializeFunction =
  (runtimeFunctionParameterName: Option<string>) =>
  (keyPath: NonEmptyKeyPath) => {
    const serialize = either.map(
      option.match(runtimeFunctionParameterName, {
        none: _ =>
          either.makeLeft({
            kind: 'unserializableValue',
            message: 'the runtime function cannot be serialized',
          }),
        some: either.makeRight,
      }),
      parameterName => keyPathToLookupExpression([parameterName, ...keyPath]),
    )
    return () => serialize
  }

const A = makeTypeParameter('a', { assignableTo: types.something })

const runtimeContext = (runtimeFunctionParameterName: Option<string>) => {
  const serializeRuntimeContextFunction = serializeFunction(
    runtimeFunctionParameterName,
  )
  return makeObjectNode({
    arguments: makeObjectNode({
      lookup: makeFunctionNode(
        {
          parameter: types.atom,
          return: types.option(types.atom),
        },
        serializeRuntimeContextFunction(['arguments', 'lookup']),
        option.none,
        key => {
          if (typeof key !== 'string') {
            return either.makeLeft({
              kind: 'panic',
              message: 'key was not an atom',
            })
          } else {
            const { values: argumentValues } = parseArgs({
              args: process.argv,
              strict: false,
              options: {
                [key]: { type: 'string' },
              },
            })
            const argument = argumentValues[key]
            if (typeof argument !== 'string') {
              return either.makeRight(
                makeObjectNode({
                  tag: 'none',
                  value: makeObjectNode({}),
                }),
              )
            } else {
              return either.makeRight(
                makeObjectNode({
                  tag: 'some',
                  value: argument,
                }),
              )
            }
          }
        },
      ),
    }),
    environment: makeObjectNode({
      lookup: makeFunctionNode(
        {
          parameter: types.atom,
          return: types.option(types.atom),
        },
        serializeRuntimeContextFunction(['environment', 'lookup']),
        option.none,
        key => {
          if (typeof key !== 'string') {
            return either.makeLeft({
              kind: 'panic',
              message: 'key was not an atom',
            })
          } else {
            const environmentVariable = process.env[key]
            if (environmentVariable === undefined) {
              return either.makeRight(
                makeObjectNode({
                  tag: 'none',
                  value: makeObjectNode({}),
                }),
              )
            } else {
              return either.makeRight(
                makeObjectNode({
                  tag: 'some',
                  value: environmentVariable,
                }),
              )
            }
          }
        },
      ),
    }),
    log: makeFunctionNode(
      {
        parameter: A,
        return: A,
      },
      serializeRuntimeContextFunction(['log']),
      option.none,
      output => {
        const serializationResult = serialize(output)
        if (either.isLeft(serializationResult)) {
          return either.makeLeft({
            kind: 'panic',
            message: serializationResult.value.message,
          })
        } else {
          writeOutput(process.stderr, prettyJson, serializationResult.value)
          return either.makeRight(output)
        }
      },
    ),
    program: makeObjectNode({
      start_time: new Date().toISOString(),
    }),
  }) satisfies RuntimeContext
}

export const keywordHandlers: KeywordHandlers = {
  ...compilerKeywordHandlers,
  /**
   * Evaluates the given function, passing runtime context captured in `world`.
   */
  '@runtime': (expression, expressionContext) =>
    either.flatMap(
      readRuntimeExpression(expression),
      ({ 1: { function: runtimeFunction } }) => {
        if (!isFunctionNode(runtimeFunction)) {
          return either.makeLeft({
            kind: 'panic',
            message:
              'a function must be provided via the property `function` or `0`',
          })
        } else {
          const result = runtimeFunction(
            runtimeContext(runtimeFunction.parameterName),
            expressionContext,
          )
          return either.mapLeft(result, error => ({
            // The runtime function panicked or had an unavailable dependency
            // (which results in a panic anyway in this context).
            kind: 'panic',
            message: error.message,
          }))
        }
      },
    ),
}

type TypeToNode<T extends Type> =
  T extends FunctionType ? FunctionNode & { readonly signature: T['signature'] }
  : T extends ObjectType ?
    RemoveIndexSignatures<
      ObjectNode & {
        readonly [K in keyof T['children']]: TypeToNode<T['children'][K]>
      }
    >
  : T extends UnionType & { members: Set<infer Member> } ? Member
  : T extends OpaqueType ?
    string // All opaque types are atoms.
  : never // TODO: Consider supporting other type formats.

type RuntimeContext = TypeToNode<typeof types.runtimeContext>
