import either from '@matt.kantor/either'
import option from '@matt.kantor/option'
import assert from 'node:assert'
import test, { suite } from 'node:test'
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
import { globalFunctions } from './global-functions.js'
import { option as optionModule } from './option.js'
import { emptyContextForStdlibApplications } from './stdlib-utilities.js'

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
  const recordingFunction = makeFunctionNode(
    { parameter: types.something, return: types.something },
    () => either.makeRight(makeFunctionExpression('parameter', 'body')),
    option.none,
    (recordedArgument, contextOfRecordedApplication) => {
      contextSeenByRecordingFunction = contextOfRecordedApplication
      return either.makeRight(recordedArgument)
    },
  )
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
