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
  applyKeyPathToSemanticGraph,
  argumentWithOwnTypeParametersInstantiated,
  asSemanticGraph,
  containsAnyUnelaboratedNodes,
  elaborateOperands,
  elaborateWithContext,
  getParameterName,
  getParameterTypeAnnotation,
  getTypesForTypeParameters,
  ignoredKey,
  inferType,
  lookup,
  makeFunctionNodeFromDefinition,
  makeObjectNode,
  objectNodeFromOrderedEntries,
  programWithValueAtKeyPath,
  readFunctionExpression,
  readLookupExpression,
  replaceAllTypeParametersWithTheirConstraints,
  rigidTypeParameterIdentitiesOrAllWithin,
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
  type KeyPath,
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
    elaborateOperands(
      expression,
      functionOperandContext({
        ...context,
        // Lookups find parameters and recognize self-references through the
        // `@function` expressions around them, but upon re-elaboration the
        // program holds a `FunctionNode` here.
        program: programWithValueAtKeyPath(
          context.program,
          context.location,
          expression,
        ),
      }),
    ),
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
            makeFunctionNodeFromDefinition({
              signature: inferredType.signature,
              definition: { expression: functionExpression, context },
              call: (argument, applySiteContext) =>
                apply(functionExpression, inferredType.signature, argument, {
                  functionDefinitionContext: context,
                  applySiteContext,
                }),
            }),
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

          return either.flatMap(
            either.mapLeft(serialize(body), asPanic),
            serializedBody => {
              const serializedBodyAsSemanticGraph =
                asSemanticGraph(serializedBody)
              return either.flatMap(
                enclosingBindingsReferredToWithin(
                  serializedBodyAsSemanticGraph,
                  { ownKey, functionDefinitionContext },
                ),
                enclosingBindings => {
                  // TODO: Make this foolproof.
                  const returnKey =
                    (
                      parameterName === 'return' ||
                      ownKey === 'return' ||
                      enclosingBindings.some(([key]) => key === 'return')
                    ) ?
                      'return with a different key to avoid collision with a stupidly-named parameter'
                    : 'return'

                  const result = either.flatMap(
                    updateValueAtKeyPathInSemanticGraph(
                      functionDefinitionContext.program,
                      functionDefinitionContext.location,
                      _ =>
                        objectNodeFromOrderedEntries([
                          // Include the function itself to allow recursion.
                          [
                            ownKey,
                            makeFunctionNodeFromDefinition({
                              signature,
                              definition: {
                                expression,
                                context: functionDefinitionContext,
                              },
                              call: (
                                argument,
                                applySiteContextOfNestedApplication,
                              ) =>
                                apply(expression, signature, argument, {
                                  functionDefinitionContext,
                                  applySiteContext: withDynamicEvaluationState(
                                    applySiteContext,
                                    applySiteContextOfNestedApplication,
                                  ),
                                }),
                            }),
                          ],
                          // In the spliced program, these bindings' values
                          // would contain this object instead.
                          ...enclosingBindings,
                          // Put the argument in scope.
                          [parameterName, argument],
                          // Put any `@hole`s from the parameter annotation in
                          // scope so type parameters can be referenced.
                          ...holeBindingsOf(expression, {
                            signature,
                            argument,
                            applySiteContext,
                            keysInUse: [parameterName, ownKey, returnKey],
                          }),
                          // Use the serialized form so the body in the program
                          // matches what gets re-elaborated.
                          [returnKey, serializedBodyAsSemanticGraph],
                        ]),
                    ),
                    updatedProgram =>
                      elaborateWithContext(serializedBody, {
                        configuration: functionDefinitionContext.configuration,
                        keywordHandlers:
                          functionDefinitionContext.keywordHandlers,
                        location: [
                          ...functionDefinitionContext.location,
                          returnKey,
                        ],
                        program: updatedProgram,
                        // Every application of this function re-elaborates the
                        // body at the same location but against a different
                        // spliced program, so what other applications cached or
                        // recorded there would be wrong here. Use fresh maps to
                        // keep each application isolated.
                        mutableInferenceCache: new Map(),
                        mutableFunctionParameterCache: new Map(),
                        mutableBindingValues: new Map(),
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
                  )

                  // A result referring to an unfinished enclosing binding may
                  // contain calls back into this function, so the call waits
                  // for the binding.
                  return either.flatMap(
                    either.mapLeft(result, asPanic),
                    resultValue => {
                      const scopeLocation = functionDefinitionContext.location
                      const resultLocation = [...scopeLocation, returnKey]
                      const contextOfResult: ExpressionContext = {
                        ...functionDefinitionContext,
                        program: programWithValueAtKeyPath(
                          functionDefinitionContext.program,
                          scopeLocation,
                          objectNodeFromOrderedEntries([
                            ...enclosingBindings,
                            [returnKey, resultValue],
                          ]),
                        ),
                      }
                      const unfinishedBindingReferredTo =
                        enclosingBindings.find(
                          ([key, value]) =>
                            refersToBindingAt(
                              [...scopeLocation, key],
                              resultValue,
                              resultLocation,
                              contextOfResult,
                            ) && containsAnyUnelaboratedNodes(value),
                        )
                      return unfinishedBindingReferredTo === undefined ?
                          either.makeRight(resultValue)
                        : either.makeLeft({
                            kind: 'dependencyUnavailable',
                            message: `application of \`${ownKey}\` was deferred because its result refers to \`${unfinishedBindingReferredTo[0]}\`, which encloses it and is not fully elaborated`,
                          })
                    },
                  )
                },
              )
            },
          )
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

/**
 * The bindings enclosing a function's definition which `body` refers to, with
 * their latest, possibly unfinished, values. For example:
 * ```plz
 * {
 *   m: { f: (n: :Integer) => :m }
 * }
 * ```
 * For `f`'s body, that's `m`.
 *
 * A binding is excluded when a `@function` within it encloses this one. The
 * reference then stays a `@lookup`, and resolves when that function is applied.
 * For example:
 * ```plz
 * {
 *   f: (a: :Integer) => {
 *     g: (b: :Integer) => :f
 *     r: :g(1)
 *   }
 * }
 * ```
 * `r` becomes `:f`.
 */
const enclosingBindingsReferredToWithin = (
  body: SemanticGraph,
  {
    ownKey,
    functionDefinitionContext,
  }: {
    readonly ownKey: Atom
    readonly functionDefinitionContext: ExpressionContext
  },
): Either<
  DependencyUnavailable,
  readonly (readonly [Atom, SemanticGraph])[]
> => {
  const definitionLocation = functionDefinitionContext.location

  const ancestors = definitionLocation.slice(0, -1).map((key, index) => ({
    key,
    location: definitionLocation.slice(0, index + 1),
  }))

  const bodyLocation = [...definitionLocation, '1', 'body']

  // Nested functions are `FunctionNode`s in the program, but lookups find
  // parameters through `@function` expressions.
  const programWithSerializedBody = programWithValueAtKeyPath(
    functionDefinitionContext.program,
    bodyLocation,
    body,
  )

  const isFunctionExpressionAt = (location: KeyPath) =>
    option.match(
      applyKeyPathToSemanticGraph(functionDefinitionContext.program, location),
      {
        none: _ => false,
        some: node => either.isRight(readFunctionExpression(node)),
      },
    )

  return either.sequence(
    ancestors
      .filter(
        ({ location }, index) =>
          refersToBindingAt(location, body, bodyLocation, {
            ...functionDefinitionContext,
            program: programWithSerializedBody,
          }) &&
          !ancestors
            .slice(index)
            .some(ancestor => isFunctionExpressionAt(ancestor.location)),
      )
      .map(({ key, location }) => {
        const value = functionDefinitionContext.mutableBindingValues.get(
          stringifyKeyPathForInternalUse(location),
        )
        return value === undefined ?
            either.makeLeft({
              kind: 'dependencyUnavailable',
              message: `application of \`${ownKey}\` was deferred because \`${key}\`, which encloses it, has no value yet`,
            })
          : either.makeRight([key, value] as const)
      }),
  )
}

/**
 * Whether a `@lookup` within `node` finds the binding at `bindingLocation`.
 * `context.program` must hold `node` at `nodeLocation`.
 */
const refersToBindingAt = (
  bindingLocation: KeyPath,
  node: SemanticGraph,
  nodeLocation: KeyPath,
  context: ExpressionContext,
): boolean =>
  either.match(readLookupExpression(node), {
    left: _ =>
      typeof node === 'object' &&
      Object.entries(node).some(([childKey, child]) =>
        refersToBindingAt(
          bindingLocation,
          child,
          [...nodeLocation, childKey],
          context,
        ),
      ),
    // Each lookup is resolved from where it sits, since a parameter or property
    // around it may shadow the binding.
    right: lookupExpression =>
      lookupExpression[1].key === bindingLocation[bindingLocation.length - 1] &&
      either.match(
        lookup({
          key: lookupExpression[1].key,
          context: { ...context, location: nodeLocation },
        }),
        {
          left: _ => false,
          right: lookupResult =>
            option.match(lookupResult, {
              none: _ => false,
              some: ({ foundLocation }) =>
                foundLocation !== 'prelude' &&
                stringifyKeyPathForInternalUse(foundLocation) ===
                  stringifyKeyPathForInternalUse(bindingLocation),
            }),
        },
      ),
  })

/**
 * The `@hole`s from `expression`'s parameter annotation, keyed by name. They're
 * put in scope so the body can refer to them (e.g.
 * `(first: ?a) => (second: :a) => …`).
 * When the argument can be used to pin down type parameters, their `@hole`s are
 * re-minted with constraints specialized to this call site. Holes can also
 * remain generic, staying stuck until an enclosing function is applied.
 */
const holeBindingsOf = (
  expression: FunctionExpression,
  {
    signature,
    argument,
    applySiteContext,
    keysInUse,
  }: {
    readonly signature: FunctionNode['signature']
    readonly argument: SemanticGraph
    readonly applySiteContext: ExpressionContext
    readonly keysInUse: readonly Atom[]
  },
): Iterable<readonly [string, SemanticGraph]> =>
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
                argumentType: argumentWithOwnTypeParametersInstantiated({
                  argumentType,
                  parameterType: signature.parameter,
                  rigidTypeParameters: () =>
                    rigidTypeParameterIdentitiesOrAllWithin(
                      applySiteContext,
                      argumentType,
                    ),
                }),
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
          ([name, _hole]) => !keysInUse.includes(name) && name !== ignoredKey,
        )
        .map(([name, hole]) => {
          const typeForTypeParameter = typesForTypeParametersByName.get(name)
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
                    // `typeForTypeParameter` may still contain unsolved type
                    // parameters. If so, eliminate them. This is merely to
                    // simplify diagnostics; it doesn't affect semantics.
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

const asPanic = (error: { readonly message: string }): Panic => ({
  kind: 'panic',
  message: error.message,
})
