import either from '@matt.kantor/either'
import option from '@matt.kantor/option'
import assert from 'node:assert'
import test, { suite } from 'node:test'
import {
  parseAndCompileAndRun,
  testCases,
} from '../../../test-utilities.test.js'
import {
  isFunctionNode,
  makeFunctionExpression,
  makeFunctionNode,
  objectNodeFromOrderedEntries,
  stringifyKeyPathForInternalUse,
  types,
  type ApplicationChainEntry,
  type ExpressionContext,
  type FunctionNode,
  type SemanticGraph,
} from '../../semantics.js'
import { makeTypeParameter } from '../type-system.js'
import { globalFunctions } from './global-functions.js'
import { option as optionModule } from './option.js'
import { anyValue } from './parameters.js'
import {
  emptyContextForStdlibApplications,
  preludeFunction,
} from './stdlib-utilities.js'

const applicationChain: readonly ApplicationChainEntry[] = [
  {
    locationKey: stringifyKeyPathForInternalUse(['someFunction']),
    expression: makeFunctionExpression('parameter', 'body'),
    speculative: false,
  },
]

const contextOfApplication: ExpressionContext = {
  ...emptyContextForStdlibApplications,
  applicationChain,
  applicationsAreSpeculative: true,
}

const someOption = objectNodeFromOrderedEntries([
  ['tag', 'some'],
  ['value', 'a value'],
])

/**
 * Apply a standard library function to a first argument built around a function
 * which records the context it is applied with, then apply the result to
 * `secondArgument` (the application whose context should reach the recorder).
 */
const contextSeenByAppliedFunction = (
  hostFunction: FunctionNode,
  firstArgument: (recordingFunction: FunctionNode) => SemanticGraph,
  secondArgument: SemanticGraph,
): ExpressionContext | undefined => {
  let contextSeenByRecordingFunction: ExpressionContext | undefined = undefined
  const recordingFunction = makeFunctionNode({
    signature: { parameter: types.something, return: types.something },
    serialize: () =>
      either.makeRight(makeFunctionExpression('parameter', 'body')),
    parameterName: option.none,
    call: (recordedArgument, contextOfRecordedApplication) => {
      contextSeenByRecordingFunction = contextOfRecordedApplication
      return either.makeRight(recordedArgument)
    },
  })
  const result = either.flatMap(
    hostFunction(
      firstArgument(recordingFunction),
      emptyContextForStdlibApplications,
    ),
    partiallyAppliedHostFunction =>
      isFunctionNode(partiallyAppliedHostFunction) ?
        partiallyAppliedHostFunction(secondArgument, contextOfApplication)
      : either.makeLeft({
          kind: 'panic',
          message: 'expected a partially-applied function',
        }),
  )
  assert(either.isRight(result), 'the host function should have been applied')
  return contextSeenByRecordingFunction
}

// Standard library functions which apply user-supplied functions forward the
// caller's evaluation state so guards against unbounded recursion can see
// through the stdlib application.
suite('evaluation state across host-driven applications', _ => {
  test("`option.map` applies its transform with the caller's state", _ => {
    const contextSeenByTransform = contextSeenByAppliedFunction(
      optionModule.map,
      recordingFunction => recordingFunction,
      someOption,
    )
    assert.deepEqual(contextSeenByTransform?.applicationChain, applicationChain)
    assert.deepEqual(contextSeenByTransform?.applicationsAreSpeculative, true)
  })

  test("`match` applies the selected case with the caller's state", _ => {
    const contextSeenByCase = contextSeenByAppliedFunction(
      globalFunctions.match,
      recordingFunction =>
        objectNodeFromOrderedEntries([['some', recordingFunction]]),
      someOption,
    )
    assert.deepEqual(contextSeenByCase?.applicationChain, applicationChain)
    assert.deepEqual(contextSeenByCase?.applicationsAreSpeculative, true)
  })
})

test('a computed parameter bound forces lifting', _ => {
  const first = makeTypeParameter('a', { assignableTo: types.something })
  const { signature } = preludeFunction(
    ['test_function'],
    [
      anyValue(first),
      {
        ...anyValue(types.something),
        type: ([preceding]) => preceding ?? types.something,
      },
    ],
    first,
    _firstArgument =>
      either.makeRight(secondArgument => either.makeRight(secondArgument)),
  )
  assert(signature.return.kind === 'function')
  const secondMintedParameter = signature.return.signature.parameter
  assert(secondMintedParameter.kind === 'parameter')
  assert.equal(
    secondMintedParameter.constraint.assignableTo,
    signature.parameter,
  )
})

const compileAndRun = testCases(
  parseAndCompileAndRun,
  input => `running \`${input}\``,
)

compileAndRun('recursion through host-implemented functions', [
  [
    `{
      f: (n: :Integer) =>
        :option.make_some(42) option.map ((m: :Integer) => :f(:m))
      main: :f(0)
    }.main`,
    output => {
      assert(either.isLeft(output))
      assert('kind' in output.value)
      assert.deepEqual(output.value.kind, 'panic')
      assert.match(output.value.message, /evaluation did not terminate/)
    },
  ],

  [
    `{
      f: (n: :Integer) => :option.make_some(42) match {
        some: (m: :Integer) => :f(:m)
        none: _ => 0
      }
      main: :f(0)
    }.main`,
    output => {
      assert(either.isLeft(output))
      assert('kind' in output.value)
      assert.deepEqual(output.value.kind, 'panic')
      assert.match(output.value.message, /evaluation did not terminate/)
    },
  ],

  [
    `{
      f: (n: :Integer) =>
        :option.make_some(42) option.map ((m: :Integer) => :f(:m))
    }`,
    output => {
      assert(either.isRight(output))
    },
  ],
])
