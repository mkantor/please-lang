import either, { type Either } from '@matt.kantor/either'
import option, { type Option } from '@matt.kantor/option'
import type { Configuration } from '../../../configuration.js'
import type {
  DependencyUnavailable,
  ElaborationError,
  Panic,
} from '../../../errors.js'
import type { Atom } from '../../../parsing.js'
import {
  asSemanticGraph,
  elaborateOperands,
  elaborateWithContext,
  getParameterName,
  getParameterTypeAnnotation,
  getTypesForTypeParameters,
  ignoredKey,
  inferType,
  makeFunctionNode,
  makeObjectNode,
  objectNodeFromOrderedEntries,
  readFunctionExpression,
  replaceAllTypeParametersWithTheirConstraints,
  serialize,
  stringifyKeyPathForInternalUse,
  types,
  updateValueAtKeyPathInSemanticGraph,
  withDynamicEvaluationState,
  type ApplicationChainEntry,
  type Expression,
  type ExpressionContext,
  type ExpressionWithElaboratedOperands,
  type FunctionExpression,
  type FunctionNode,
  type KeyPathStringifiedForInternalUse,
  type SemanticGraph,
  type Type,
} from '../../../semantics.js'
import {
  collectHolesByName,
  findDuplicateHoleNames,
  makeHoleExpressionWithExtantTypeParameter,
} from '../../../semantics/expressions/hole-expression.js'
import {
  stringifySemanticGraphForEndUser,
  typeSymbolToSemanticGraph,
} from '../../../semantics/semantic-graph.js'
import { makeTypeParameter } from '../../../semantics/type-system.js'

export const functionKeywordHandler = (
  expression: Expression,
  context: ExpressionContext,
): Either<ElaborationError, FunctionNode> =>
  either.flatMap(
    elaborateOperands(expression, functionOperandContext(context)),
    ({ expression, context: operandContext }) =>
      makeFunctionFromElaboratedExpression(expression, {
        // The original `context` is used here; `panicsAreDeferred` applies only
        // to the operands.
        ...context,
        program: operandContext.program,
      }),
  )

/**
 * The context in which a `@function`'s operands are eagerly elaborated (when
 * the body is elaborated at the definition site ahead of application).
 */
const functionOperandContext = (
  context: ExpressionContext,
): ExpressionContext => ({
  ...context,
  // `@panic`s inside functions shouldn't fire while elaborating the body, only
  // when the function is eventually called.
  panicsAreDeferred: true,
  // Function applications occurring within the body are speculative until this
  // function is applied.
  applicationsAreSpeculative: true,
})

const makeFunctionFromElaboratedExpression = (
  expression: ExpressionWithElaboratedOperands,
  context: ExpressionContext,
): Either<ElaborationError, FunctionNode> =>
  either.flatMap(readFunctionExpression(expression), functionExpression =>
    either.flatMap(checkForDuplicateHoles(functionExpression), _ =>
      either.flatMap(inferType(expression, context), inferredType => {
        if (inferredType.kind !== 'function') {
          return either.makeLeft({
            kind: 'bug',
            message:
              'inferred type of function expression was not a function type',
          })
        } else {
          return either.makeRight(
            makeFunctionNode(
              inferredType.signature,
              () => either.makeRight(functionExpression),
              option.makeSome(getParameterName(functionExpression)),
              (argument, applySiteContext) =>
                apply(functionExpression, inferredType.signature, argument, {
                  functionDefinitionContext: context,
                  applySiteContext,
                }),
            ),
          )
        }
      }),
    ),
  )

const checkForDuplicateHoles = (
  expression: FunctionExpression,
): Either<ElaborationError, undefined> =>
  option.match(getParameterTypeAnnotation(expression), {
    none: () => either.makeRight(undefined),
    some: annotation => {
      const duplicates = findDuplicateHoleNames(annotation)
      if (duplicates.size === 0) {
        return either.makeRight(undefined)
      } else {
        const [first] = duplicates

        // This is just for the error message and therefore doesn't need
        // constraints or anything (it's just to get syntax highlighting).
        const holeForDiagnostic = makeHoleExpressionWithExtantTypeParameter(
          first ?? ignoredKey,
          makeObjectNode({
            assignableTo: typeSymbolToSemanticGraph(types.somethingTypeSymbol),
          }),
          makeTypeParameter('a', { assignableTo: types.something }),
        )

        return either.makeLeft({
          kind: 'invalidExpression',
          message: `hole \`${stringifySemanticGraphForEndUser(holeForDiagnostic)}\` is declared more than once in the same scope`,
        })
      }
    },
  })

const apply = (
  expression: FunctionExpression,
  signature: FunctionNode['signature'],
  argument: SemanticGraph,
  {
    functionDefinitionContext,
    applySiteContext,
  }: {
    readonly functionDefinitionContext: ExpressionContext
    readonly applySiteContext: ExpressionContext
  },
): ReturnType<FunctionNode> => {
  const ownKey =
    functionDefinitionContext.location[
      functionDefinitionContext.location.length - 1
    ]
  if (ownKey === undefined) {
    return either.makeLeft({
      kind: 'panic',
      message: 'function had no location',
    })
  } else {
    const definitionLocationKey = stringifyKeyPathForInternalUse(
      functionDefinitionContext.location,
    )
    const applicationIsSpeculative =
      applySiteContext.applicationsAreSpeculative === true
    return option.match(
      applicationLimitError({
        ownKey,
        expression,
        definitionLocationKey,
        configuration: functionDefinitionContext.configuration,
        applicationChain: applySiteContext.applicationChain,
        applicationIsSpeculative,
      }),
      {
        some: either.makeLeft,
        none: _ => {
          // Apply the function by splicing its argument (and everything else
          // its body may refer to) into the program, then re-elaborating the
          // body there.

          const parameterName = getParameterName(expression)
          const body = expression[1].body

          // TODO: Make this foolproof.
          const returnKey =
            parameterName === 'return' || ownKey === 'return' ?
              'return with a different key to avoid collision with a stupidly-named parameter'
            : 'return'

          // Put each `@hole` from the annotation into scope under its name so
          // the body can refer to it (e.g. `(first: ?a) => (second: :a) => …`).
          // When the argument can be used to pin down type parameters, re-mint
          // their `@hole`s with constraints specialized to this call site.
          // Holes can also remain generic, staying stuck until an enclosing
          // function is applied.
          const holeBindings: Iterable<readonly [string, SemanticGraph]> =
            option.match(getParameterTypeAnnotation(expression), {
              none: _ => [],
              some: annotation => {
                const typesForTypeParametersByName = either.match(
                  // Use the inferred argument type to pin down type parameters.
                  inferType(argument, {
                    ...applySiteContext,
                    location: [...applySiteContext.location, '1', 'argument'],
                  }),
                  {
                    left: _ => new Map<Atom, Type>(),
                    right: argumentType =>
                      new Map(
                        getTypesForTypeParameters({
                          parameterType: signature.parameter,
                          argumentType,
                        })
                          .entries()
                          .map(([typeParameter, specialization]) => [
                            typeParameter.name,
                            specialization,
                          ]),
                      ),
                  },
                )

                return collectHolesByName(annotation)
                  .entries()
                  .filter(
                    ([name, _hole]) =>
                      name !== parameterName &&
                      name !== ownKey &&
                      name !== returnKey &&
                      name !== ignoredKey,
                  )
                  .map(([name, hole]) => {
                    const typeForTypeParameter =
                      typesForTypeParametersByName.get(name)
                    if (typeForTypeParameter === undefined) {
                      return [name, hole]
                    } else {
                      return [
                        name,
                        makeHoleExpressionWithExtantTypeParameter(
                          name,
                          hole[1].constraint,
                          makeTypeParameter(name, {
                            assignableTo:
                              // `typeForTypeParameter` may still contain
                              // unsolved type parameters. If so, eliminate
                              // them. This is merely to simplify the type in
                              // diagnostics and doesn't affect semantics.
                              replaceAllTypeParametersWithTheirConstraints(
                                typeForTypeParameter,
                              ),
                          }),
                        ),
                      ]
                    }
                  })
              },
            })

          const result = either.flatMap(serialize(body), serializedBody =>
            either.flatMap(
              updateValueAtKeyPathInSemanticGraph(
                functionDefinitionContext.program,
                functionDefinitionContext.location,
                _ =>
                  objectNodeFromOrderedEntries([
                    // Include the function itself to allow recursion.
                    [
                      ownKey,
                      makeFunctionNode(
                        signature,
                        () => either.makeRight(expression),
                        option.makeSome(parameterName),
                        (argument, applySiteContextOfNestedApplication) =>
                          apply(expression, signature, argument, {
                            functionDefinitionContext,
                            applySiteContext: withDynamicEvaluationState(
                              applySiteContext,
                              applySiteContextOfNestedApplication,
                            ),
                          }),
                      ),
                    ],
                    // Put the argument in scope.
                    [parameterName, argument],
                    // Put any `@hole`s from the parameter annotation in scope
                    // so type parameters can be referenced.
                    ...holeBindings,
                    // Use the serialized form so the body in the program
                    // matches what gets re-elaborated.
                    [returnKey, asSemanticGraph(serializedBody)],
                  ]),
              ),
              updatedProgram =>
                elaborateWithContext(serializedBody, {
                  configuration: functionDefinitionContext.configuration,
                  keywordHandlers: functionDefinitionContext.keywordHandlers,
                  location: [...functionDefinitionContext.location, returnKey],
                  program: updatedProgram,
                  // Every application of this function re-elaborates the body
                  // at the same location but against a different spliced
                  // program, so cached inferences from other applications would
                  // be wrong here. Use fresh caches to keep each application's
                  // type information isolated.
                  mutableInferenceCache: new Map(),
                  mutableFunctionParameterCache: new Map(),
                  // The body is demanded by this application, so the
                  // speculative flag is deliberately not carried over and
                  // `applicationChain` records the application.
                  applicationChain: [
                    ...applySiteContext.applicationChain,
                    {
                      locationKey: definitionLocationKey,
                      expression,
                      speculative: applicationIsSpeculative,
                    },
                  ],
                }),
            ),
          )

          return either.mapLeft(result, error => ({
            kind: 'panic',
            message: error.message,
          }))
        },
      },
    )
  }
}

/**
 * Decide whether this application may proceed, given the applications already
 * in flight.
 */
const applicationLimitError = ({
  ownKey,
  expression,
  definitionLocationKey,
  configuration,
  applicationChain,
  applicationIsSpeculative,
}: {
  readonly ownKey: Atom
  readonly expression: FunctionExpression
  readonly definitionLocationKey: KeyPathStringifiedForInternalUse
  readonly configuration: Configuration
  readonly applicationChain: readonly ApplicationChainEntry[]
  readonly applicationIsSpeculative: boolean
}): Option<DependencyUnavailable | Panic> => {
  const chainAlreadyContainsThisFunction = applicationChain.some(
    chainEntry =>
      chainEntry.expression === expression ||
      chainEntry.locationKey === definitionLocationKey,
  )
  const speculativeApplicationCount = applicationChain.filter(
    chainEntry => chainEntry.speculative,
  ).length

  if (applicationIsSpeculative && chainAlreadyContainsThisFunction) {
    // Re-entrancy deferral: reducing a speculative application of a function
    // which is already in flight could continue forever.
    return option.makeSome({
      kind: 'dependencyUnavailable',
      message: `application of \`${ownKey}\` was deferred while elaborating an unapplied function body because of recursion`,
    })
  } else if (
    applicationIsSpeculative &&
    speculativeApplicationCount >=
      configuration.speculativeApplicationDepthLimit
  ) {
    // Out of speculative application fuel.
    return option.makeSome({
      kind: 'dependencyUnavailable',
      message: `application of \`${ownKey}\` was deferred while elaborating an unapplied function body because it did not fully reduce in ${configuration.speculativeApplicationDepthLimit} steps`,
    })
  } else if (
    applicationChain.length >= configuration.demandedApplicationDepthLimit
  ) {
    // Out of demanded budget. Deferral isn't an option (something demanded this
    // result), so the program is at fault.
    return option.makeSome({
      kind: 'panic',
      message: `evaluation did not terminate: exceeded ${configuration.demandedApplicationDepthLimit} nested function applications (possible unbounded recursion involving \`${ownKey}\`)`,
    })
  } else {
    return option.none
  }
}
