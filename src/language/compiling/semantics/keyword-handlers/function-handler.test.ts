import either from '@matt.kantor/either'
import option from '@matt.kantor/option'
import assert from 'node:assert'
import { testCases } from '../../../../test-utilities.test.js'
import {
  defaultConfiguration,
  type Configuration,
} from '../../../configuration.js'
import { parse } from '../../../parsing/parser.js'
import {
  applyKeyPathToSemanticGraph,
  containsAnyUnelaboratedNodes,
  elaborateWithContext,
  isFunctionNode,
  makeFunctionExpression,
  makeInitialElaborationContext,
  stringifyKeyPathForInternalUse,
  type ApplicationChainEntry,
} from '../../../semantics.js'
import { keywordHandlers } from '../keywords.js'
import { elaborationSuite } from '../test-utilities.test.js'

elaborationSuite('@function', [
  [
    { 0: '@function', 1: { 0: 'not a function' } },
    output => {
      assert(either.isLeft(output))
    },
  ],
  [
    { 0: '@function', 1: { 0: 'x', 1: { 0: '@lookup', 1: { 0: 'x' } } } },
    elaboratedFunction => {
      assert(!either.isLeft(elaboratedFunction))
      assert(isFunctionNode(elaboratedFunction.value))
      assert.deepEqual(
        elaboratedFunction.value.parameterName,
        option.makeSome('x'),
      )
      assert.deepEqual(
        elaboratedFunction.value.serialize(),
        either.makeRight({
          0: '@function',
          1: { parameter: 'x', body: { 0: '@lookup', 1: { key: 'x' } } },
        }),
      )
      assert.deepEqual(
        elaboratedFunction.value.signature.parameter.kind,
        'parameter',
      )
      assert.deepEqual(
        elaboratedFunction.value.signature.return,
        elaboratedFunction.value.signature.parameter,
      )
    },
  ],
  [
    {
      0: '@function',
      1: {
        0: { x: 'an arbitrary type' },
        1: { 0: '@lookup', 1: { 0: 'x' } },
      },
    },
    elaboratedFunction => {
      assert(!either.isLeft(elaboratedFunction))
      assert(isFunctionNode(elaboratedFunction.value))
      assert.deepEqual(
        elaboratedFunction.value.parameterName,
        option.makeSome('x'),
      )
      assert.deepEqual(
        elaboratedFunction.value.serialize(),
        either.makeRight({
          0: '@function',
          1: {
            parameter: { x: 'an arbitrary type' },
            body: { 0: '@lookup', 1: { key: 'x' } },
          },
        }),
      )
      const parameterType = elaboratedFunction.value.signature.parameter
      if (parameterType.kind !== 'parameter') {
        assert.fail(
          `expected a type parameter, but got a ${parameterType.kind} type`,
        )
      } else {
        assert.deepEqual(parameterType.name, 'x')
        const constraint = parameterType.constraint.assignableTo
        assert.deepEqual(constraint.kind, 'union')
        assert.deepEqual(
          constraint.kind === 'union' ? constraint.members : undefined,
          new Set(['an arbitrary type']),
        )
        assert.deepEqual(
          elaboratedFunction.value.signature.return,
          parameterType,
        )
      }
    },
  ],
  [
    {
      0: '@function',
      1: {
        parameter: '_',
        body: {
          0: '@apply',
          1: {
            function: {
              0: '@apply',
              1: {
                function: { 0: '@lookup', 1: { key: '+' } },
                argument: '1',
              },
            },
            argument: '2',
          },
        },
      },
    },
    elaboratedFunction => {
      assert(!either.isLeft(elaboratedFunction))
      assert(isFunctionNode(elaboratedFunction.value))
      assert.deepEqual(
        elaboratedFunction.value.serialize(),
        either.makeRight({ 0: '@function', 1: { parameter: '_', body: '3' } }),
      )
    },
  ],
])

const elaborateWithApplicationsInFlight = ({
  program,
  applicationChain,
  applicationsAreSpeculative,
  configuration,
}: {
  readonly program: string
  readonly description: string
  readonly applicationChain: readonly ApplicationChainEntry[]
  readonly applicationsAreSpeculative: boolean
  readonly configuration: Configuration
}) =>
  either.flatMap(parse(program), syntaxTree =>
    elaborateWithContext(syntaxTree, {
      ...makeInitialElaborationContext(
        configuration,
        syntaxTree,
        keywordHandlers,
      ),
      applicationChain,
      applicationsAreSpeculative: applicationsAreSpeculative || undefined,
    }),
  )

const programApplyingF = '{ f: (n: :Integer) => :n, main: :f(1) }'
const arbitraryFunctionExpression = makeFunctionExpression('_', '_')

/** Applications of functions other than the one under test. */
const applicationChainOfOtherFunctions: readonly ApplicationChainEntry[] =
  Array.from(
    { length: defaultConfiguration.speculativeApplicationDepthLimit },
    (_element, index) => ({
      locationKey: stringifyKeyPathForInternalUse([`otherFunction${index}`]),
      expression: arbitraryFunctionExpression,
      speculative: true,
    }),
  )

testCases(
  elaborateWithApplicationsInFlight,
  ({ program, description }) => `elaborating \`${program}\` ${description}`,
)('application limits with applications already in flight', [
  [
    {
      program: programApplyingF,
      description: 'with a speculative application of `f` already in flight',
      applicationChain: [
        {
          locationKey: stringifyKeyPathForInternalUse(['f']),
          expression: arbitraryFunctionExpression,
          speculative: true,
        },
      ],
      configuration: defaultConfiguration,
      applicationsAreSpeculative: true,
    },
    output => {
      // The application of `f` is deferred.
      assert(either.isRight(output))
      assert(containsAnyUnelaboratedNodes(output.value))
    },
  ],

  [
    {
      program: programApplyingF,
      description: 'with the speculation fuel spent',
      applicationChain: applicationChainOfOtherFunctions,
      configuration: defaultConfiguration,
      applicationsAreSpeculative: true,
    },
    output => {
      // The application of `f` is deferred.
      assert(either.isRight(output))
      assert(containsAnyUnelaboratedNodes(output.value))
    },
  ],

  [
    {
      program: programApplyingF,
      description:
        'with the speculation fuel spent but the application demanded',
      applicationChain: applicationChainOfOtherFunctions,
      configuration: defaultConfiguration,
      applicationsAreSpeculative: false,
    },
    output => {
      // The return value of `f` was demanded so it's not deferred.
      assert(either.isRight(output))
      assert(!containsAnyUnelaboratedNodes(output.value))
      assert.deepEqual(
        applyKeyPathToSemanticGraph(output.value, ['main']),
        option.makeSome('1'),
      )
    },
  ],

  [
    {
      program: '{ f: (n: :Integer) => :f(:n), main: :f(1) }',
      description: 'with a demanded budget of 3',
      applicationChain: [],
      configuration: {
        ...defaultConfiguration,
        demandedApplicationDepthLimit: 3,
      },
      applicationsAreSpeculative: false,
    },
    output => {
      // The return value of `f` was demanded, but we've hit the depth limit.
      assert(either.isLeft(output))
      assert.deepEqual(output.value.kind, 'panic')
      assert.match(
        output.value.message,
        /evaluation did not terminate: exceeded 3 /,
      )
    },
  ],
])
