import either, { type Either } from '@matt.kantor/either'
import option, { type Option } from '@matt.kantor/option'
import type { ElaborationError } from '../../errors.js'
import type { Atom } from '../../parsing.js'
import {
  applyKeyPathToSemanticGraph,
  getParameterName,
  ignoredKey,
  isAssignable,
  isExpression,
  isFunctionNode,
  lookup,
  readApplyExpression,
  readFunctionExpression,
  readIfExpression,
  readIndexExpression,
  readLookupExpression,
  readPanicExpression,
  readRuntimeExpression,
  readUnionExpression,
  type ExpressionContext,
  type FunctionParameterTypeInfo,
  type KeyPath,
  type SemanticGraph,
} from '../../semantics.js'
import { isKeywordExpressionWithArgument } from '../../semantics/expression.js'
import {
  getParameterTypeAnnotation,
  type FunctionExpression,
} from '../expressions/function-expression.js'
import {
  collectHoleTypeParameterIdentities,
  getHoleTypeParameter,
  readHoleExpression,
} from '../expressions/hole-expression.js'
import { genericizeFunctionParameterAnnotation } from './genericize-function-parameter.js'
import { typeFromSemanticGraph } from './literal-type.js'
import * as types from './prelude-types.js'
import {
  makeApplicationType,
  makeFunctionType,
  makeIndexedAccessType,
  makeObjectType,
  unionOfTypes,
  type Type,
} from './type-formats.js'
import {
  functionParameterKey,
  stringifyTypeKeyPathForEndUser,
  typeKeyPathFromObjectNode,
} from './type-key-path.js'
import {
  containedTypeParameters,
  typeParameterIdentitiesWithinType,
} from './type-parameter-analysis.js'
import {
  applicableFunctionSignatures,
  applyKeyPathToType,
  getTypesForTypeParameters,
  recursivelyInexact,
  supplyTypeArguments,
} from './type-substitution.js'

/**
 * Returns a `Map` of parameter names to their types for the function parameters
 * that are in scope for the given `context`'s `location`. Inner parameters
 * shadow outer ones with the same name.
 */
export const resolveParameterTypes = (
  context: ExpressionContext,
): ReadonlyMap<Atom, Type> =>
  resolveEnclosingFunctionParameters(context).reduce(
    (parameterTypes, { parameterName, parameterTypeInfo }) =>
      parameterTypes.has(parameterName) ? parameterTypes : (
        new Map([
          ...parameterTypes,
          [parameterName, parameterTypeInfo.parameterType],
        ])
      ),
    new Map<Atom, Type>(),
  )

/**
 * The identities of all type parameters which are rigid at the given
 * `context`'s `location` (e.g. those universally quantified by an enclosing
 * function). Applications occurring at this location mustn't instantiate them.
 */
export const rigidTypeParameterIdentities = (
  context: ExpressionContext,
): ReadonlySet<symbol> =>
  new Set(
    resolveEnclosingFunctionParameters(context).flatMap(
      ({ parameterTypeInfo }) => [
        ...parameterTypeInfo.typeParametersBoundByFunction,
      ],
    ),
  )

export const inferType = (
  node: SemanticGraph,
  context: ExpressionContext,
): Either<ElaborationError, Type> =>
  inferTypeImplementation(
    node,
    resolveParameterTypes(context),
    new Set(),
    context,
  )

const inferTypeImplementation = (
  node: SemanticGraph,
  parameterTypes: ReadonlyMap<Atom, Type>,
  lookingUpKeys: ReadonlySet<Atom>,
  context: ExpressionContext,
): Either<ElaborationError, Type> => {
  const cacheKey = stringifyTypeKeyPathForEndUser(context.location)
  const cached = context.mutableInferenceCache.get(cacheKey)
  if (cached !== undefined) {
    return either.makeRight(cached)
  }

  const cacheOnSuccess = (
    result: Either<ElaborationError, Type>,
  ): Either<ElaborationError, Type> =>
    either.map(result, type => {
      context.mutableInferenceCache.set(cacheKey, type)
      return type
    })

  /**
   * Build context for a descendant node by appending `subPath` to
   * `context.location`.
   *
   * Warning: Call sites are coupled to specific expression structures and
   * TypeScript won't warn you if things become mis-aligned. Pay special
   * attention whenever an expression shape is revised.
   */
  const descendantContext = (subPath: KeyPath): ExpressionContext => ({
    ...context,
    location: [...context.location, ...subPath],
  })

  if (
    typeof node === 'string' ||
    typeof node === 'symbol' ||
    typeof node === 'function'
  ) {
    return cacheOnSuccess(
      typeFromSemanticGraph(node, { objectsAreExact: false }),
    )
  }

  // @function: infer parameter type from context (or an explicit annotation)
  // and return type from the body.
  const functionExpressionResult = readFunctionExpression(node)
  if (either.isRight(functionExpressionResult)) {
    return cacheOnSuccess(
      either.flatMap(
        getFunctionParameterType(functionExpressionResult.value, context),
        parameterTypeInfo =>
          either.map(
            inferTypeImplementation(
              functionExpressionResult.value[1].body,
              new Map([
                ...parameterTypes,
                [
                  getParameterName(functionExpressionResult.value),
                  parameterTypeInfo.parameterType,
                ],
              ]),
              lookingUpKeys,
              descendantContext(['1', 'body']),
            ),
            returnType =>
              makeFunctionType({
                parameter: parameterTypeInfo.parameterType,
                return: returnType,
              }),
          ),
      ),
    )
  }

  // @lookup: check if it directly refers to a function parameter. If so, use
  // the parameter's type. Otherwise, resolve the @lookup, then recur.
  const lookupExpressionResult = readLookupExpression(node)
  if (either.isRight(lookupExpressionResult)) {
    const key = lookupExpressionResult.value[1].key
    const paramType = parameterTypes.get(key)
    if (paramType !== undefined) {
      return cacheOnSuccess(either.makeRight(paramType))
    } else if (!lookingUpKeys.has(key)) {
      const lookupResult = lookup({ key, context })
      if (either.isRight(lookupResult) && option.isSome(lookupResult.value)) {
        const { foundValue, foundLocation, typeParameterOfFoundHole } =
          lookupResult.value.value
        const innerResult = option.match(typeParameterOfFoundHole, {
          some: either.makeRight,
          none: _ =>
            inferTypeImplementation(
              foundValue,
              parameterTypes,
              new Set([...lookingUpKeys, key]),
              foundLocation === 'prelude' ?
                {
                  ...context,
                  // We don't have a way to key the cache for inferences from
                  // the prelude. Use a fresh cache so as not to pollute the
                  // shared one.
                  mutableInferenceCache: new Map(),
                  locationDoesNotCorrespondWithTruePosition: true,
                }
              : {
                  ...context,
                  location: foundLocation,
                },
            ),
        })
        return cacheOnSuccess(innerResult)
      } else {
        // Fall back to the top type.
        return either.makeRight(types.something)
      }
    } else {
      // Fall back to the top type.
      return either.makeRight(types.something)
    }
  }

  // @index: infer object type, look up appropriate type by key path.
  const indexExpressionResult = readIndexExpression(node)
  if (either.isRight(indexExpressionResult)) {
    const query = indexExpressionResult.value[1].query
    return cacheOnSuccess(
      either.flatMap(
        inferTypeImplementation(
          indexExpressionResult.value[1].object,
          parameterTypes,
          lookingUpKeys,
          descendantContext(['1', 'object']),
        ),
        objectType =>
          either.map(
            typeKeyPathFromObjectNode(
              query,
              descendantContext(['1', 'query']),
              (node, context) =>
                inferTypeImplementation(
                  node,
                  parameterTypes,
                  lookingUpKeys,
                  context,
                ),
            ),
            keyPath => applyKeyPathToType(objectType, keyPath),
          ),
      ),
    )
  }

  // @runtime: infer return type of the contained function.
  const runtimeExpressionResult = readRuntimeExpression(node)
  if (either.isRight(runtimeExpressionResult)) {
    const runtimeFunction = runtimeExpressionResult.value[1].function
    const functionExpressionResult =
      isFunctionNode(runtimeFunction) ?
        either.flatMap(runtimeFunction.serialize(), readFunctionExpression)
      : readFunctionExpression(runtimeFunction)
    if (either.isRight(functionExpressionResult)) {
      return cacheOnSuccess(
        inferTypeImplementation(
          functionExpressionResult.value[1].body,
          new Map([
            ...parameterTypes,
            [
              getParameterName(functionExpressionResult.value),
              types.runtimeContext,
            ],
          ]),
          lookingUpKeys,
          descendantContext(['1', 'function', '1', 'body']),
        ),
      )
    } else {
      return either.makeLeft({
        kind: 'invalidExpression',
        message: '@runtime function was not a function',
      })
    }
  }

  // @apply: infer the return type from the function being applied.
  const applyExpressionResult = readApplyExpression(node)
  if (either.isRight(applyExpressionResult)) {
    const inferredFunctionType = inferTypeImplementation(
      applyExpressionResult.value[1].function,
      parameterTypes,
      lookingUpKeys,
      descendantContext(['1', 'function']),
    )
    if (either.isRight(inferredFunctionType)) {
      const appliedFunctionType = inferredFunctionType.value

      return option.match(applicableFunctionSignatures(appliedFunctionType), {
        some: signatures => {
          const {
            parameter: combinedParameterType,
            return: combinedReturnType,
          } =
            signatures.length === 1 && signatures[0] !== undefined ?
              signatures[0]
            : {
                parameter: unionOfTypes(
                  signatures.map(signature => signature.parameter),
                ),
                return: unionOfTypes(
                  signatures.map(signature => signature.return),
                ),
              }

          const argumentTypeResult = inferTypeImplementation(
            applyExpressionResult.value[1].argument,
            parameterTypes,
            lookingUpKeys,
            descendantContext(['1', 'argument']),
          )
          if (either.isRight(argumentTypeResult)) {
            // Supply type arguments to the return type based on the inferred
            // argument type.
            const typeArguments = getTypesForTypeParameters({
              parameterType: combinedParameterType,
              argumentType: argumentTypeResult.value,
            })
            const eagerReturnType = supplyTypeArguments(
              combinedReturnType,
              typeArguments,
            )
            const boundTypeParameters = new Set(
              [...typeArguments.keys()].map(
                typeParameter => typeParameter.identity,
              ),
            )
            const typeParametersWithinEnclosingParameterTypes = new Set(
              [...parameterTypes.values()].flatMap(enclosingParameterType => [
                ...typeParameterIdentitiesWithinType(enclosingParameterType),
              ]),
            )
            const typeParametersMentionedInThisSignature =
              typeParameterIdentitiesWithinType(appliedFunctionType)
            // Parameters this application is stuck on: those mentioned in the
            // applied function's type whose concrete types only arrive when an
            // enclosing function is applied.
            const parametersStuckOn = new Set(
              [...typeParametersMentionedInThisSignature].filter(identity =>
                typeParametersWithinEnclosingParameterTypes.has(identity),
              ),
            )
            const applicationIsStuck =
              // When the applied function is directly typed as a non-concrete
              // function (it's a bare type parameter or a stuck indexed
              // access/application), an eager return type would lose track of
              // which concrete function is supplied, so the application should
              // stay stuck until requisite type parameters are instantiated.
              appliedFunctionType.kind === 'parameter' ||
              appliedFunctionType.kind === 'indexedAccess' ||
              appliedFunctionType.kind === 'application' ||
              // Also keep the application stuck if a free type parameter (e.g.
              // from an enclosing function's signature) would escape into the
              // return value. The type parameter must be mentioned in the
              // applied function's own type and mustn't have been instantiated
              // by its argument. Such an application can only be reduced once
              // the enclosing function is applied.
              [...typeParameterIdentitiesWithinType(eagerReturnType)].some(
                identity =>
                  typeParametersMentionedInThisSignature.has(identity) &&
                  typeParametersWithinEnclosingParameterTypes.has(identity) &&
                  !boundTypeParameters.has(identity),
              )
            return cacheOnSuccess(
              either.makeRight(
                applicationIsStuck ?
                  makeApplicationType(
                    appliedFunctionType,
                    argumentTypeResult.value,
                    parametersStuckOn,
                  )
                : eagerReturnType,
              ),
            )
          } else {
            return cacheOnSuccess(either.makeRight(combinedReturnType))
          }
        },
        none: _ => either.makeRight(types.something),
      })
    }
  }

  // @if: narrow to the chosen branch when the condition is statically known
  // to be `true` or `false`; otherwise return a union of the branch types.
  const ifExpressionResult = readIfExpression(node)
  if (either.isRight(ifExpressionResult)) {
    const { condition, then, else: otherwise } = ifExpressionResult.value[1]

    const inferThen = () =>
      inferTypeImplementation(
        then,
        parameterTypes,
        lookingUpKeys,
        descendantContext(['1', 'then']),
      )
    const inferElse = () =>
      inferTypeImplementation(
        otherwise,
        parameterTypes,
        lookingUpKeys,
        descendantContext(['1', 'else']),
      )

    return cacheOnSuccess(
      either.flatMap(
        inferTypeImplementation(
          condition,
          parameterTypes,
          lookingUpKeys,
          descendantContext(['1', 'condition']),
        ),
        conditionType => {
          if (isAssignable({ source: conditionType, target: 'true' })) {
            return inferThen()
          } else if (isAssignable({ source: conditionType, target: 'false' })) {
            return inferElse()
          } else if (containedTypeParameters(conditionType).size > 0) {
            // The condition depends on a type parameter, so keep the choice
            // unresolved as an indexed access into a boolean-keyed object.
            // This expression:
            // ```
            // @if { :a, b, c }
            // ```
            // Is equivalent type-wise to this expression:
            // ```
            // { true: b, false: c }.:a
            // ```
            return either.flatMap(inferThen(), thenType =>
              either.map(inferElse(), elseType =>
                makeIndexedAccessType(
                  makeObjectType({ false: elseType, true: thenType }),
                  conditionType,
                ),
              ),
            )
          } else {
            return either.flatMap(inferThen(), thenType =>
              either.map(inferElse(), elseType =>
                unionOfTypes([thenType, elseType]),
              ),
            )
          }
        },
      ),
    )
  }

  // @panic: infer the bottom type.
  const panicExpressionResult = readPanicExpression(node)
  if (either.isRight(panicExpressionResult)) {
    return cacheOnSuccess(either.makeRight(types.nothing))
  }

  // @union: infer each member as a type and combine them into a (flat) union.
  const unionExpressionResult = readUnionExpression(node)
  if (either.isRight(unionExpressionResult)) {
    return cacheOnSuccess(
      either.map(
        either.sequence(
          Object.entries(unionExpressionResult.value[1]).map(([key, member]) =>
            inferTypeImplementation(
              member,
              parameterTypes,
              lookingUpKeys,
              descendantContext(['1', key]),
            ),
          ),
        ),
        unionOfTypes,
      ),
    )
  }

  // @hole: a hole denotes its type parameter.
  const holeExpressionResult = readHoleExpression(node)
  if (either.isRight(holeExpressionResult)) {
    return cacheOnSuccess(
      either.makeRight(getHoleTypeParameter(holeExpressionResult.value)),
    )
  }

  // Non-specific default case for object nodes: recurse into properties and
  // infer their types, then create an `ObjectType`.
  return cacheOnSuccess(
    either.map(
      either.sequence(
        Object.entries(node).map(([key, value]) =>
          either.map(
            inferTypeImplementation(
              value,
              parameterTypes,
              lookingUpKeys,
              descendantContext([key]),
            ),
            childType => [key, childType],
          ),
        ),
      ),
      entries =>
        makeObjectType(Object.fromEntries(entries), {
          // Expressions will have different keys after elaboration, otherwise
          // this is a literal object where all properties are known.
          exact: !isExpression(node),
        }),
    ),
  )
}

/**
 * Functions are implicitly generic.
 *
 * With no explicit parameter annotation, an attempt is made to infer a type
 * from the context. If that fails, a new type parameter (constrained to the top
 * type) is created for the function parameter.
 *
 * If there is an annotation, it's used to create one or more type parameters
 * with constraints derived from the annotation (see
 * `genericizeFunctionParameterAnnotation` for specifics).
 */
const getFunctionParameterType = (
  expression: FunctionExpression,
  contextOfFunction: ExpressionContext,
): Either<ElaborationError, FunctionParameterTypeInfo> => {
  // `genericizeFunctionParameterAnnotation` mints fresh type parameters, but
  // type parameters are identified by an internal `symbol`. To keep identities
  // consistent, cache parameter types here.
  const parameterCacheKey = stringifyTypeKeyPathForEndUser([
    ...contextOfFunction.location,
    functionParameterKey,
  ])
  const cachedParameterTypeInfo =
    contextOfFunction.locationDoesNotCorrespondWithTruePosition === true ?
      undefined
    : contextOfFunction.mutableFunctionParameterCache.get(parameterCacheKey)
  if (cachedParameterTypeInfo !== undefined) {
    return either.makeRight(cachedParameterTypeInfo)
  } else {
    return either.map(
      option.match(getParameterTypeAnnotation(expression), {
        some: annotation =>
          either.map(
            // Type annotation lookups happen from the function's scope rather
            // than their own location (a property within the `@function`), so
            // location-keyed caching is disabled for this inference.
            // TODO: Consider separating out the cache key prefix from the
            // `context.location` somehow so that I can say "lookups start from
            // X, cache key paths are rooted at Y".
            inferType(annotation, {
              ...contextOfFunction,
              mutableInferenceCache: new Map(),
              locationDoesNotCorrespondWithTruePosition: true,
            }),
            annotationType => {
              const parameterName = getParameterName(expression)
              // `_` (`ignoredKey`) is the name for an ignored parameter (and is
              // what the parser emits for `~>` syntax sugar). Genericization is
              // skipped in this case so `a ~> b` and `(_: a) => b` can be used
              // to describe concrete function types rather than generic ones.
              if (parameterName === ignoredKey) {
                return {
                  // Function parameter types are always inexact.
                  parameterType: recursivelyInexact(annotationType),
                  typeParametersBoundByFunction: new Set<symbol>(),
                }
              } else {
                const genericized = genericizeFunctionParameterAnnotation(
                  parameterName,
                  annotationType,
                )
                return {
                  parameterType: genericized.type,
                  typeParametersBoundByFunction: new Set([
                    ...genericized.typeParametersBoundByFunction,
                    ...collectHoleTypeParameterIdentities(annotation),
                  ]),
                }
              }
            },
          ),
        none: _ => {
          const contextualParameterTypeInfo = option.flatMap(
            enclosingExpressionFromPropertyOfExpressionArgument(
              contextOfFunction,
            ),
            (enclosingExpression): Option<FunctionParameterTypeInfo> => {
              if (
                isKeywordExpressionWithArgument('@runtime', enclosingExpression)
              ) {
                return option.makeSome({
                  parameterType: types.runtimeContext,
                  typeParametersBoundByFunction: new Set(),
                })
              }

              const positionInEnclosingExpression =
                contextOfFunction.location[
                  contextOfFunction.location.length - 1
                ]
              const applyExpressionResult =
                readApplyExpression(enclosingExpression)
              if (
                either.isRight(applyExpressionResult) &&
                positionInEnclosingExpression === 'argument'
              ) {
                const contextOfEnclosingExpression: ExpressionContext = {
                  program: contextOfFunction.program,
                  keywordHandlers: contextOfFunction.keywordHandlers,
                  location: contextOfFunction.location.slice(0, -2),
                  mutableInferenceCache:
                    contextOfFunction.mutableInferenceCache,
                  mutableFunctionParameterCache:
                    contextOfFunction.mutableFunctionParameterCache,
                  locationDoesNotCorrespondWithTruePosition:
                    contextOfFunction.locationDoesNotCorrespondWithTruePosition,
                }
                const contextuallyAppliedFunctionType = inferType(
                  applyExpressionResult.value[1].function,
                  {
                    ...contextOfEnclosingExpression,
                    location: [
                      ...contextOfEnclosingExpression.location,
                      '1',
                      'function',
                    ],
                  },
                )

                // If the applied function's signature is `(a ~> b) ~> c`, the
                // function passed to it should have its parameter typed as `a`.
                if (
                  either.isRight(contextuallyAppliedFunctionType) &&
                  contextuallyAppliedFunctionType.value.kind === 'function' &&
                  contextuallyAppliedFunctionType.value.signature.parameter
                    .kind === 'function'
                ) {
                  const borrowedParameterType =
                    contextuallyAppliedFunctionType.value.signature.parameter
                      .signature.parameter
                  return option.makeSome({
                    // Function parameter types are always inexact.
                    parameterType: recursivelyInexact(borrowedParameterType),
                    typeParametersBoundByFunction:
                      typeParameterIdentitiesWithinType(borrowedParameterType),
                  })
                }
              }

              return option.none
            },
          )

          return option.match(contextualParameterTypeInfo, {
            some: either.makeRight,
            none: _ => {
              const genericized = genericizeFunctionParameterAnnotation(
                getParameterName(expression),
                types.something,
              )
              return either.makeRight({
                parameterType: genericized.type,
                typeParametersBoundByFunction:
                  genericized.typeParametersBoundByFunction,
              })
            },
          })
        },
      }),
      parameterTypeInfo => {
        if (
          contextOfFunction.locationDoesNotCorrespondWithTruePosition !== true
        ) {
          // Side effect: cache the parameter type so its type-parameter
          // identities remain stable.
          contextOfFunction.mutableFunctionParameterCache.set(
            parameterCacheKey,
            parameterTypeInfo,
          )
        }
        return parameterTypeInfo
      },
    )
  }
}

const enclosingExpressionFromPropertyOfExpressionArgument = ({
  program,
  location,
}: {
  readonly program: SemanticGraph
  readonly location: KeyPath
}): Option<SemanticGraph> => {
  if (location.length < 2) {
    return option.none
  } else {
    const pathToPossibleExpression = location.slice(0, -2)
    return option.filter(
      applyKeyPathToSemanticGraph(program, pathToPossibleExpression),
      isExpression,
    )
  }
}

type EnclosingFunctionParameter = {
  readonly parameterName: Atom
  readonly parameterTypeInfo: FunctionParameterTypeInfo
}

/**
 * Walks upwards from the given `context`'s `location` towards the program root,
 * collecting parameters of enclosing functions (innermost first), including
 * functions whose parameter names are shadowed.
 */
const resolveEnclosingFunctionParameters = (
  context: ExpressionContext,
): readonly EnclosingFunctionParameter[] => {
  const collectFromLocation = (
    currentLocation: KeyPath,
  ): readonly EnclosingFunctionParameter[] => {
    if (currentLocation.length < 2) {
      return []
    } else {
      const enclosingFunction = option.flatMap(
        enclosingExpressionFromPropertyOfExpressionArgument({
          program: context.program,
          location: currentLocation,
        }),
        expression =>
          either.match(readFunctionExpression(expression), {
            left: _ => option.none,
            right: option.makeSome,
          }),
      )

      const enclosingFunctionLocation = currentLocation.slice(0, -2)
      // Skip the function whose parameter annotation we're inside. Computing
      // its parameter type requires this very inference (and would infinitely
      // recurse without this guard).
      const isInsideOwnAnnotation =
        context.location[enclosingFunctionLocation.length] === '1' &&
        context.location[enclosingFunctionLocation.length + 1] === 'parameter'

      const parametersFromThisLevel = option.match(enclosingFunction, {
        none: _ => [],
        some: functionExpression => {
          if (isInsideOwnAnnotation) {
            return []
          } else {
            const parameterTypeInfoResult = getFunctionParameterType(
              functionExpression,
              {
                keywordHandlers: context.keywordHandlers,
                program: context.program,
                location: enclosingFunctionLocation,
                mutableInferenceCache: context.mutableInferenceCache,
                mutableFunctionParameterCache:
                  context.mutableFunctionParameterCache,
              },
            )

            if (either.isLeft(parameterTypeInfoResult)) {
              throw new Error(
                'Cannot determine parameter type of function. This is a bug!',
                { cause: parameterTypeInfoResult.value },
              )
            } else {
              return [
                {
                  parameterName: getParameterName(functionExpression),
                  parameterTypeInfo: parameterTypeInfoResult.value,
                },
              ]
            }
          }
        },
      })

      return [
        ...parametersFromThisLevel,
        ...collectFromLocation(currentLocation.slice(0, -1)),
      ]
    }
  }
  return collectFromLocation(context.location)
}
