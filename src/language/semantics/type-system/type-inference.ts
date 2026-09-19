import either, { type Either } from '@matt.kantor/either'
import option, { type Option } from '@matt.kantor/option'
import type { ElaborationError } from '../../errors.js'
import type { Atom } from '../../parsing.js'
import {
  applyKeyPathToSemanticGraph,
  attachSpanIfAbsent,
  getParameterName,
  ignoredKey,
  isAssignable,
  isExpression,
  isFunctionNode,
  lookup,
  readApplyExpression,
  readCheckExpression,
  readFunctionExpression,
  readIfExpression,
  readIndexExpression,
  readLookupExpression,
  readPanicExpression,
  readRuntimeExpression,
  readTodoExpression,
  readUnionExpression,
  stringifyResolvedTypeForEndUser,
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
  getHoleConstraintSource,
  getHoleTypeParameter,
  readHoleExpression,
} from '../expressions/hole-expression.js'
import {
  readExcessClauses,
  readObjectTypeExpression,
} from '../expressions/object-type-expression.js'
import { isObjectNode, type ObjectNode } from '../object-node.js'
import { genericizeFunctionParameterAnnotation } from './genericize-function-parameter.js'
import {
  alsoAssuming,
  flatMapInferred,
  inferredValue,
  mapInferred,
  sequenceInferred,
  usingNoAssumptions,
  withoutAssumption,
  type InferenceResult,
} from './inference-result.js'
import { typeFromSemanticGraph } from './literal-type.js'
import * as types from './prelude-types.js'
import { effectiveExcessClauses, typesAreEquivalent } from './subtyping.js'
import { makeApplicationType } from './type-formats/application-type.js'
import { makeFunctionType } from './type-formats/function-type.js'
import { makeIndexedAccessType } from './type-formats/indexed-access-type.js'
import { makeIntrinsicApplicationType } from './type-formats/intrinsic-application-type.js'
import { matchTypeFormat } from './type-formats/match-type-format.js'
import { makeObjectType } from './type-formats/object-type.js'
import type { Type } from './type-formats/type.js'
import { isBottomType, isCanonicalTopType } from './type-formats/type.js'
import { makeUnionType, unionOfTypes } from './type-formats/union-type.js'
import {
  atomKeyPathComponentFromType,
  functionParameterKey,
  stringifyTypeKeyPathForEndUser,
  stringifyTypeKeyPathForInternalUse,
  type TypeKeyPath,
  type TypeKeyPathStringifiedForInternalUse as TypeKeyPathAsString,
} from './type-key-path.js'
import {
  containedTypeParameters,
  typeParameterIdentitiesWithinType,
} from './type-parameter-analysis.js'
import {
  applicableFunctionSignatures,
  applyKeyPathToType,
  getTypesForTypeParameters,
  replaceAllTypeParametersWithTheirConstraints,
  supplyTypeArguments,
} from './type-substitution.js'

/**
 * Returns a map of parameter names to their types for the function parameters
 * that are in scope for the given `context`'s `location`. Inner parameters
 * shadow outer ones with the same name.
 */
export const resolveParameterTypes = (
  context: ExpressionContext,
): Either<ElaborationError, ReadonlyMap<Atom, Type>> =>
  resolveParameterTypesAssuming(context, noTypeAssumptions)

/**
 * The identities of all type parameters which are rigid at the given
 * `context`'s `location` (e.g. those universally quantified by an enclosing
 * function). Applications occurring at this location mustn't instantiate them.
 */
export const rigidTypeParameterIdentities = (
  context: ExpressionContext,
): Either<ElaborationError, ReadonlySet<symbol>> =>
  either.map(
    resolveEnclosingFunctionParameters(context, noTypeAssumptions),
    enclosingParameters =>
      new Set(
        enclosingParameters.flatMap(({ parameterTypeInfo }) => [
          ...parameterTypeInfo.typeParametersBoundByFunction,
        ]),
      ),
  )

export const inferType = (
  node: SemanticGraph,
  context: ExpressionContext,
): Either<ElaborationError, Type> =>
  inferTypeAssuming(node, context, noTypeAssumptions)

/**
 * Like `inferType`, but for a `node` occurring in a type annotation (e.g. a
 * function parameter type or `@check` type). The denoted type is interpreted as
 * an open upper bound:
 * - An explicit `@object` expression is interpreted exactly as written.
 * - Each `@union` member is interpreted as if it were written bare in the
 *   same position (`inferTypeOfTypeAnnotation` distributes over union members).
 * - A plain object literal is open (allowing arbitrary excess properties), in
 *   contrast to value positions where inference gives closed object types.
 * - Anything indirect (lookups, indexed accesses, applications, …) is
 *   interpreted as its inferred type with every closed object widened to an
 *   open one; in particular an alias to an explicitly-closed `@object` is
 *   interpreted as open.
 */
export const inferTypeOfTypeAnnotation = (
  node: SemanticGraph,
  context: ExpressionContext,
): Either<ElaborationError, Type> =>
  inferTypeOfTypeAnnotationAssuming(node, context, noTypeAssumptions)

/**
 * Turns an object like `{a,b,c}` into a `TypeKeyPath` like `['a','b','c']`.
 */
export const typeKeyPathFromObjectNode = (
  node: ObjectNode,
  context: ExpressionContext,
): Either<ElaborationError, TypeKeyPath> =>
  inferredValue(
    typeKeyPathFromObjectNodeImplementation(
      node,
      context,
      (component, componentContext) =>
        either.map(inferType(component, componentContext), usingNoAssumptions),
    ),
  )

const typeKeyPathFromObjectNodeImplementation = (
  node: ObjectNode,
  context: ExpressionContext,
  inferComponentType: (
    component: SemanticGraph,
    contextOfComponent: ExpressionContext,
  ) => InferenceResult<Type>,
): InferenceResult<TypeKeyPath> =>
  // Each sequentially-keyed property is either a literal atom or a dynamic key
  // whose type must be an atom or union of atoms.
  sequenceInferred(
    Object.entries(node).map(
      ([key, component]): InferenceResult<TypeKeyPath[number]> =>
        typeof component === 'string' ?
          either.makeRight(usingNoAssumptions(component))
        : flatMapInferred(
            inferComponentType(
              component,
              contextWithinExpression(context, [key]),
            ),
            componentType =>
              either.map(
                atomKeyPathComponentFromType(componentType),
                usingNoAssumptions,
              ),
          ),
    ),
  )

/**
 * Temporarily-assumed inference results while types are being derived.
 */
type TypeAssumptions = ReadonlyMap<TypeKeyPathAsString, Type>

const noTypeAssumptions: TypeAssumptions = new Map()

const inferenceCacheKey = (context: ExpressionContext): TypeKeyPathAsString =>
  stringifyTypeKeyPathForInternalUse(
    context.cacheKeyPrefixOverride ?? context.location,
  )

const cacheIfAssumptionFree = (
  result: InferenceResult<Type>,
  cache: ExpressionContext['mutableInferenceCache'],
  cacheKey: TypeKeyPathAsString,
): InferenceResult<Type> =>
  either.map(result, inferred => {
    if (inferred.assumptionsUsed.size === 0) {
      cache.set(cacheKey, inferred.value)
    }
    return inferred
  })

/**
 * Build context for a node at `subPath` within the expression `context` is for.
 *
 * Warning: Call sites are coupled to specific expression structures and
 * TypeScript won't warn you if things become mis-aligned. Pay special
 * attention whenever an expression shape is revised.
 */
const contextWithinExpression = (
  context: ExpressionContext,
  subPath: KeyPath,
): ExpressionContext => ({
  ...context,
  location: [...context.location, ...subPath],
  cacheKeyPrefixOverride:
    context.cacheKeyPrefixOverride === undefined ?
      undefined
    : [...context.cacheKeyPrefixOverride, ...subPath],
})

const resolveParameterTypesAssuming = (
  context: ExpressionContext,
  assumptions: TypeAssumptions,
): Either<ElaborationError, ReadonlyMap<Atom, Type>> =>
  either.map(
    resolveEnclosingFunctionParameters(context, assumptions),
    enclosingParameters =>
      enclosingParameters.reduce(
        (parameterTypes, { parameterName, parameterTypeInfo }) =>
          parameterTypes.has(parameterName) ? parameterTypes : (
            new Map([
              ...parameterTypes,
              [parameterName, parameterTypeInfo.parameterType],
            ])
          ),
        new Map<Atom, Type>(),
      ),
  )

const inferTypeAssuming = (
  node: SemanticGraph,
  context: ExpressionContext,
  assumptions: TypeAssumptions,
): Either<ElaborationError, Type> =>
  either.flatMap(
    resolveParameterTypesAssuming(context, assumptions),
    parameterTypes =>
      inferredValue(
        inferTypeImplementation(node, parameterTypes, assumptions, context),
      ),
  )

const inferTypeOfTypeAnnotationAssuming = (
  node: SemanticGraph,
  context: ExpressionContext,
  assumptions: TypeAssumptions,
): Either<ElaborationError, Type> =>
  either.flatMap(
    resolveParameterTypesAssuming(context, assumptions),
    parameterTypes =>
      inferredValue(
        inferTypeOfTypeAnnotationImplementation(
          node,
          parameterTypes,
          assumptions,
          context,
        ),
      ),
  )

/**
 * A recursive definition's type can't be naively inferred from its body because
 * that'd never terminate. The type is therefore first derived assuming
 * `pending` for itself, which reveals whether it's recursive. If so, it's
 * re-derived assuming the bottom type, and again from whatever that produced,
 * repeated until the answer stabilizes.
 *
 * Assumed types are monomorphic (type parameters could leave the body stuck).
 */
const inferTypeOfDefinition = (
  definitionKeyPathAsString: TypeKeyPathAsString,
  definition: SemanticGraph,
  parameterTypes: ReadonlyMap<Atom, Type>,
  assumptions: TypeAssumptions,
  context: ExpressionContext,
): InferenceResult<Type> => {
  const inferAssuming = (assumption: Type): InferenceResult<Type> =>
    inferTypeImplementation(
      definition,
      parameterTypes,
      new Map([...assumptions, [definitionKeyPathAsString, assumption]]),
      context,
    )

  const withoutIteration = inferAssuming(types.pending)

  const iterate = (
    assumption: Type,
    round: number,
    assumptionsUsedSoFar: ReadonlySet<TypeKeyPathAsString>,
  ): InferenceResult<Type> => {
    const result = alsoAssuming(inferAssuming(assumption), assumptionsUsedSoFar)
    return either.match(result, {
      // Fall back to whatever the definition inferred to without iterating.
      left: _ => alsoAssuming(withoutIteration, new Set(assumptions.keys())),
      right: ({ value: type, assumptionsUsed }) => {
        const monomorphicType =
          replaceAllTypeParametersWithTheirConstraints(type)
        if (typesAreEquivalent(monomorphicType, assumption)) {
          return result
        } else if (round >= context.configuration.recursiveTypeIterationLimit) {
          // The limit was exceeded without stabilizing. Fall back to whatever
          // the definition inferred to without iterating.
          return alsoAssuming(withoutIteration, assumptionsUsed)
        } else {
          return iterate(monomorphicType, round + 1, assumptionsUsed)
        }
      },
    })
  }

  const derived = either.flatMap(withoutIteration, ({ assumptionsUsed }) =>
    assumptionsUsed.has(definitionKeyPathAsString) ?
      iterate(types.nothing, 1, assumptionsUsed)
    : withoutIteration,
  )

  // Once settled, the type no longer uses the definition's assumption.
  return cacheIfAssumptionFree(
    withoutAssumption(derived, definitionKeyPathAsString),
    context.mutableInferenceCache,
    inferenceCacheKey(context),
  )
}

const inferTypeImplementation = (
  node: SemanticGraph,
  parameterTypes: ReadonlyMap<Atom, Type>,
  assumptions: TypeAssumptions,
  context: ExpressionContext,
): InferenceResult<Type> => {
  const cacheKey = inferenceCacheKey(context)
  const cached = context.mutableInferenceCache.get(cacheKey)
  if (cached !== undefined) {
    return either.makeRight(usingNoAssumptions(cached))
  }

  const cacheOnSuccess = (
    result: InferenceResult<Type>,
  ): InferenceResult<Type> =>
    cacheIfAssumptionFree(result, context.mutableInferenceCache, cacheKey)

  const descendantContext = (subPath: KeyPath): ExpressionContext =>
    contextWithinExpression(context, subPath)

  if (
    typeof node === 'string' ||
    typeof node === 'symbol' ||
    typeof node === 'function'
  ) {
    return cacheOnSuccess(
      either.map(
        typeFromSemanticGraph(node, { objectsAreExact: false }),
        usingNoAssumptions,
      ),
    )
  }

  // @function: infer parameter type from context (or an explicit annotation)
  // and return type from the body.
  const functionExpressionResult = readFunctionExpression(node)
  if (either.isRight(functionExpressionResult)) {
    return cacheOnSuccess(
      either.flatMap(
        getFunctionParameterType(
          functionExpressionResult.value,
          context,
          assumptions,
        ),
        parameterTypeInfo =>
          mapInferred(
            inferTypeImplementation(
              functionExpressionResult.value[1].body,
              new Map([
                ...parameterTypes,
                [
                  getParameterName(functionExpressionResult.value),
                  parameterTypeInfo.parameterType,
                ],
              ]),
              assumptions,
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
      return cacheOnSuccess(either.makeRight(usingNoAssumptions(paramType)))
    } else {
      const lookupResult = lookup({ key, context, inlineSelfReferences: true })
      if (either.isRight(lookupResult) && option.isSome(lookupResult.value)) {
        const { foundValue, foundLocation, foundHole, foundIsSelfReference } =
          lookupResult.value.value
        // Prelude values exist outside the program, so use an artificial key.
        // `@` can't be a real key (it'd be escaped as `@@`), so this can't
        // collide with an actual location.
        const definitionKeyPath =
          foundLocation === 'prelude' ? ['@', key] : foundLocation
        const definitionKeyPathAsString =
          stringifyTypeKeyPathForInternalUse(definitionKeyPath)
        const assumption = assumptions.get(definitionKeyPathAsString)
        if (assumption !== undefined) {
          // Inference has re-entered a definition it's already deriving, so
          // its type is still an assumption.
          return either.makeRight({
            value: assumption,
            assumptionsUsed: new Set([definitionKeyPathAsString]),
          })
        } else {
          const innerResult = option.match(foundHole, {
            some: holeExpression =>
              // The hole lives in an enclosing parameter annotation. Infer it
              // here so its constraint is resolved in the current scope. The
              // result is the hole's type, which is the same as this
              // `@lookup`'s type, so caching both under this location is
              // consistent.
              withoutAssumption(
                inferTypeImplementation(
                  holeExpression,
                  parameterTypes,
                  new Map([
                    ...assumptions,
                    [definitionKeyPathAsString, types.pending],
                  ]),
                  context,
                ),
                definitionKeyPathAsString,
              ),
            none: _ =>
              // The looked-up value was not a hole. Infer its type, using
              // `inferTypeOfDefinition` to handle recursive situations.
              inferTypeOfDefinition(
                definitionKeyPathAsString,
                foundValue,
                parameterTypes,
                assumptions,
                foundLocation === 'prelude' ?
                  { ...context, cacheKeyPrefixOverride: definitionKeyPath }
                : {
                    ...context,
                    location: definitionKeyPath,
                    cacheKeyPrefixOverride: undefined,
                  },
              ),
          })
          const resultWithMonomorphicSelfReference = mapInferred(
            innerResult,
            inferredType =>
              foundIsSelfReference ?
                replaceAllTypeParametersWithTheirConstraints(inferredType)
              : inferredType,
          )
          return cacheOnSuccess(resultWithMonomorphicSelfReference)
        }
      } else {
        // Fall back to the top type.
        return either.makeRight(usingNoAssumptions(types.something))
      }
    }
  }

  // @index: infer object type, look up appropriate type by key path.
  const indexExpressionResult = readIndexExpression(node)
  if (either.isRight(indexExpressionResult)) {
    const query = indexExpressionResult.value[1].query
    return cacheOnSuccess(
      flatMapInferred(
        inferTypeImplementation(
          indexExpressionResult.value[1].object,
          parameterTypes,
          assumptions,
          descendantContext(['1', 'object']),
        ),
        objectType =>
          flatMapInferred(
            typeKeyPathFromObjectNodeImplementation(
              query,
              descendantContext(['1', 'query']),
              (component, contextOfComponent) =>
                inferTypeImplementation(
                  component,
                  parameterTypes,
                  assumptions,
                  contextOfComponent,
                ),
            ),
            keyPath =>
              option.match(applyKeyPathToType(objectType, keyPath), {
                none: _ =>
                  either.makeLeft({
                    kind: 'typeMismatch',
                    message: `property \`${stringifyTypeKeyPathForEndUser(
                      keyPath,
                    )}\` does not exist on type \`${stringifyResolvedTypeForEndUser(
                      objectType,
                    )}\``,
                  }),
                some: indexedType =>
                  either.makeRight(usingNoAssumptions(indexedType)),
              }),
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
          assumptions,
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
      assumptions,
      descendantContext(['1', 'function']),
    )
    if (either.isRight(inferredFunctionType)) {
      const {
        value: appliedFunctionType,
        assumptionsUsed: assumptionsUsedByFunction,
      } = inferredFunctionType.value

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
            assumptions,
            descendantContext(['1', 'argument']),
          )
          if (either.isRight(argumentTypeResult)) {
            const {
              value: argumentType,
              assumptionsUsed: assumptionsUsedByArgument,
            } = argumentTypeResult.value
            // Supply type arguments to the return type based on the inferred
            // argument type.
            const typeArguments = getTypesForTypeParameters({
              parameterType: combinedParameterType,
              argumentType,
            })
            const eagerReturnType = supplyTypeArguments(
              combinedReturnType,
              typeArguments,
            )
            const boundTypeParameters = new Set(
              typeArguments.keys().map(typeParameter => typeParameter.identity),
            )
            const typeParametersWithinEnclosingParameterTypes = new Set(
              parameterTypes
                .values()
                .flatMap(enclosingParameterType =>
                  typeParameterIdentitiesWithinType(enclosingParameterType),
                ),
            )
            const typeParametersMentionedInThisSignature =
              typeParameterIdentitiesWithinType(appliedFunctionType)
            // Parameters this application is stuck on: those mentioned in the
            // applied function's type whose concrete types only arrive when an
            // enclosing function is applied.
            const parametersStuckOn = new Set(
              typeParametersMentionedInThisSignature
                .values()
                .filter(identity =>
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
              typeParameterIdentitiesWithinType(eagerReturnType)
                .values()
                .some(
                  identity =>
                    typeParametersMentionedInThisSignature.has(identity) &&
                    typeParametersWithinEnclosingParameterTypes.has(identity) &&
                    !boundTypeParameters.has(identity),
                )
            return cacheOnSuccess(
              either.makeRight({
                value:
                  applicationIsStuck ?
                    makeApplicationType(
                      appliedFunctionType,
                      argumentType,
                      parametersStuckOn,
                    )
                  : eagerReturnType,
                assumptionsUsed: assumptionsUsedByFunction.union(
                  assumptionsUsedByArgument,
                ),
              }),
            )
          } else {
            // Could not infer the argument type. We don't know why it failed,
            // so pessimistically consider all assumptions used.
            return cacheOnSuccess(
              either.makeRight({
                value: combinedReturnType,
                assumptionsUsed: new Set(assumptions.keys()),
              }),
            )
          }
        },
        none: _ =>
          either.makeRight({
            value:
              isBottomType(appliedFunctionType) ?
                types.nothing
              : types.something,
            assumptionsUsed: assumptionsUsedByFunction,
          }),
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
        assumptions,
        descendantContext(['1', 'then']),
      )
    const inferElse = () =>
      inferTypeImplementation(
        otherwise,
        parameterTypes,
        assumptions,
        descendantContext(['1', 'else']),
      )

    return cacheOnSuccess(
      flatMapInferred(
        inferTypeImplementation(
          condition,
          parameterTypes,
          assumptions,
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
            return flatMapInferred(inferThen(), thenType =>
              mapInferred(inferElse(), elseType =>
                makeIndexedAccessType(
                  makeObjectType({ false: elseType, true: thenType }),
                  conditionType,
                ),
              ),
            )
          } else {
            return flatMapInferred(inferThen(), thenType =>
              mapInferred(inferElse(), elseType =>
                unionOfTypes([thenType, elseType]),
              ),
            )
          }
        },
      ),
    )
  }

  // @check: elaborates to its `value` (or a type error).
  const checkExpressionResult = readCheckExpression(node)
  if (either.isRight(checkExpressionResult)) {
    return cacheOnSuccess(
      inferTypeImplementation(
        checkExpressionResult.value[1].value,
        parameterTypes,
        assumptions,
        descendantContext(['1', 'value']),
      ),
    )
  }

  // @todo: elaborates to an empty object.
  const todoExpressionResult = readTodoExpression(node)
  if (either.isRight(todoExpressionResult)) {
    return cacheOnSuccess(
      either.makeRight(
        usingNoAssumptions(
          makeObjectType({}, [{ keys: types.atom, values: types.nothing }]),
        ),
      ),
    )
  }

  // @panic: infer the bottom type.
  const panicExpressionResult = readPanicExpression(node)
  if (either.isRight(panicExpressionResult)) {
    return cacheOnSuccess(either.makeRight(usingNoAssumptions(types.nothing)))
  }

  // @union: infer each member as a type and combine them into a (flat) union.
  const unionExpressionResult = readUnionExpression(node)
  if (either.isRight(unionExpressionResult)) {
    return cacheOnSuccess(
      mapInferred(
        sequenceInferred(
          Object.entries(unionExpressionResult.value[1]).map(([key, member]) =>
            inferTypeImplementation(
              member,
              parameterTypes,
              assumptions,
              descendantContext(['1', key]),
            ),
          ),
        ),
        unionOfTypes,
      ),
    )
  }

  // @object: an explicit object type.
  const objectTypeExpressionResult = readObjectTypeExpression(node)
  if (either.isRight(objectTypeExpressionResult)) {
    const objectTypeExpression = objectTypeExpressionResult.value
    const { properties } = objectTypeExpression[1]
    const inferExcessClauseKeys = (keys: SemanticGraph, index: number) =>
      flatMapInferred(
        inferTypeOfTypeAnnotationImplementation(
          keys,
          parameterTypes,
          assumptions,
          descendantContext(['1', 'excess', String(index), '0']),
        ),
        (keysType): InferenceResult<Type> =>
          // Keys must be concrete atom subtypes.
          containedTypeParameters(keysType).size > 0 ?
            either.makeLeft({
              kind: 'invalidExpression',
              message:
                '`@object` excess clause keys must not reference type parameters',
            })
          : !isAssignable({ source: keysType, target: types.atom }) ?
            either.makeLeft({
              kind: 'typeMismatch',
              message: `\`@object\` excess clause keys must be an atom subtype, but \`${stringifyResolvedTypeForEndUser(
                keysType,
              )}\` is not assignable to \`${stringifyResolvedTypeForEndUser(
                types.atom,
              )}\``,
            })
          : either.makeRight(usingNoAssumptions(keysType)),
      )
    return cacheOnSuccess(
      either.flatMap(readExcessClauses(objectTypeExpression), clauses =>
        flatMapInferred(
          sequenceInferred(
            Object.entries(properties).map(([key, propertyValue]) =>
              mapInferred(
                inferTypeOfTypeAnnotationImplementation(
                  propertyValue,
                  parameterTypes,
                  assumptions,
                  descendantContext(['1', 'properties', key]),
                ),
                propertyType => [key, propertyType],
              ),
            ),
          ),
          children =>
            mapInferred(
              sequenceInferred(
                clauses.map((clause, index) =>
                  flatMapInferred(
                    inferExcessClauseKeys(clause[0], index),
                    keys =>
                      mapInferred(
                        inferTypeOfTypeAnnotationImplementation(
                          clause[1],
                          parameterTypes,
                          assumptions,
                          descendantContext([
                            '1',
                            'excess',
                            String(index),
                            '1',
                          ]),
                        ),
                        values => ({ keys, values }),
                      ),
                  ),
                ),
              ),
              refinementClauses =>
                makeObjectType(Object.fromEntries(children), refinementClauses),
            ),
        ),
      ),
    )
  }

  // @hole: a hole denotes its type parameter. Unless its constraint is already
  // sourced from the carried type parameter, resolve it here.
  const holeExpressionResult = readHoleExpression(node)
  if (either.isRight(holeExpressionResult)) {
    const holeExpression = holeExpressionResult.value
    const parameter = getHoleTypeParameter(holeExpression)

    switch (getHoleConstraintSource(holeExpression)) {
      case 'expression':
        return cacheOnSuccess(
          mapInferred(
            // Constraints are type annotations (upper bounds).
            inferTypeOfTypeAnnotationImplementation(
              holeExpression[1].constraint.assignableTo,
              parameterTypes,
              assumptions,
              descendantContext(['1', 'constraint', 'assignableTo']),
            ),
            resolvedConstraint => ({
              ...parameter,
              constraint: { assignableTo: resolvedConstraint },
            }),
          ),
        )
      case 'typeParameter':
        // The stashed parameter's constraint was already resolved, so trust it.
        return cacheOnSuccess(either.makeRight(usingNoAssumptions(parameter)))
    }
  }

  // Non-specific default case for object nodes: recurse into properties and
  // infer their types, then create an `ObjectType`.
  return cacheOnSuccess(
    mapInferred(
      sequenceInferred(
        Object.entries(node).map(([key, value]) =>
          mapInferred(
            inferTypeImplementation(
              value,
              parameterTypes,
              assumptions,
              descendantContext([key]),
            ),
            childType => [key, childType],
          ),
        ),
      ),
      entries =>
        makeObjectType(
          Object.fromEntries(entries),
          // Expressions will have different keys after elaboration, otherwise
          // this is a literal object where all properties are known.
          isExpression(node) ?
            []
          : [{ keys: types.atom, values: types.nothing }],
        ),
    ),
  )
}

/** @see `inferTypeOfTypeAnnotation` for the rules applied here. */
const inferTypeOfTypeAnnotationImplementation = (
  node: SemanticGraph,
  parameterTypes: ReadonlyMap<Atom, Type>,
  assumptions: TypeAssumptions,
  context: ExpressionContext,
): InferenceResult<Type> => {
  const isPlainObjectLiteral = isObjectNode(node) && !isExpression(node)
  const descendantContext = (subPath: KeyPath): ExpressionContext =>
    contextWithinExpression(context, subPath)
  const unionExpressionResult = readUnionExpression(node)
  if (either.isRight(readObjectTypeExpression(node))) {
    // `@object` operands are type positions; `inferTypeImplementation`
    // interprets the whole subtree as written.
    return inferTypeImplementation(node, parameterTypes, assumptions, context)
  } else if (either.isRight(unionExpressionResult)) {
    // Distribute over union members.
    return mapInferred(
      sequenceInferred(
        Object.entries(unionExpressionResult.value[1]).map(([key, member]) =>
          inferTypeOfTypeAnnotationImplementation(
            member,
            parameterTypes,
            assumptions,
            descendantContext(['1', key]),
          ),
        ),
      ),
      unionOfTypes,
    )
  } else if (isPlainObjectLiteral) {
    return mapInferred(
      sequenceInferred(
        Object.entries(node).map(([key, propertyValue]) =>
          mapInferred(
            inferTypeOfTypeAnnotationImplementation(
              propertyValue,
              parameterTypes,
              assumptions,
              descendantContext([key]),
            ),
            propertyType => [key, propertyType],
          ),
        ),
      ),
      entries => makeObjectType(Object.fromEntries(entries)),
    )
  } else {
    return mapInferred(
      inferTypeImplementation(node, parameterTypes, assumptions, context),
      recursivelyOpenObjectTypes,
    )
  }
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
  assumptions: TypeAssumptions,
): Either<ElaborationError, FunctionParameterTypeInfo> => {
  // `genericizeFunctionParameterAnnotation` mints fresh type parameters, but
  // type parameters are identified by an internal `symbol`. To keep identities
  // consistent, cache parameter types here.
  const parameterCacheKey = stringifyTypeKeyPathForInternalUse([
    ...(contextOfFunction.cacheKeyPrefixOverride ?? contextOfFunction.location),
    functionParameterKey,
  ])
  const cachedParameterTypeInfo =
    contextOfFunction.isExternalToProgram === true ?
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
            // `location` stays anchored at the function while cache keys are
            // rooted at the annotation's true position.
            inferTypeOfTypeAnnotationAssuming(
              annotation,
              {
                ...contextOfFunction,
                cacheKeyPrefixOverride: [
                  ...(contextOfFunction.cacheKeyPrefixOverride ??
                    contextOfFunction.location),
                  '1',
                  'parameter',
                  getParameterName(expression),
                ],
              },
              assumptions,
            ),
            annotationType => {
              const parameterName = getParameterName(expression)
              // `_` (`ignoredKey`) is the name for an ignored parameter (and is
              // what the parser emits for `~>` syntax sugar). Genericization is
              // skipped in this case so `a ~> b` and `(_: a) => b` can be used
              // to describe concrete function types rather than generic ones.
              if (parameterName === ignoredKey) {
                return {
                  // The annotation was already interpreted as an upper bound by
                  // `inferTypeOfTypeAnnotation`.
                  parameterType: annotationType,
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
                  configuration: contextOfFunction.configuration,
                  program: contextOfFunction.program,
                  keywordHandlers: contextOfFunction.keywordHandlers,
                  location: contextOfFunction.location.slice(0, -2),
                  cacheKeyPrefixOverride:
                    contextOfFunction.cacheKeyPrefixOverride === undefined ?
                      undefined
                    : contextOfFunction.cacheKeyPrefixOverride.slice(0, -2),
                  mutableInferenceCache:
                    contextOfFunction.mutableInferenceCache,
                  mutableFunctionParameterCache:
                    contextOfFunction.mutableFunctionParameterCache,
                  isExternalToProgram: contextOfFunction.isExternalToProgram,
                  applicationChain: contextOfFunction.applicationChain,
                }
                const contextuallyAppliedFunctionType = inferTypeAssuming(
                  applyExpressionResult.value[1].function,
                  {
                    ...contextOfEnclosingExpression,
                    location: [
                      ...contextOfEnclosingExpression.location,
                      '1',
                      'function',
                    ],
                    cacheKeyPrefixOverride:
                      (
                        contextOfEnclosingExpression.cacheKeyPrefixOverride ===
                        undefined
                      ) ?
                        undefined
                      : [
                          ...contextOfEnclosingExpression.cacheKeyPrefixOverride,
                          '1',
                          'function',
                        ],
                  },
                  assumptions,
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
                    parameterType: recursivelyOpenObjectTypes(
                      borrowedParameterType,
                    ),
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
        if (contextOfFunction.isExternalToProgram !== true) {
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
  assumptions: TypeAssumptions,
): Either<ElaborationError, readonly EnclosingFunctionParameter[]> => {
  const collectFromLocation = (
    currentLocation: KeyPath,
  ): Either<ElaborationError, readonly EnclosingFunctionParameter[]> => {
    if (currentLocation.length < 2) {
      return either.makeRight([])
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

      const parametersFromThisLevel: Either<
        ElaborationError,
        readonly EnclosingFunctionParameter[]
      > = option.match(enclosingFunction, {
        none: _ => either.makeRight([]),
        some: functionExpression => {
          const parameterName = getParameterName(functionExpression)
          return isInsideOwnAnnotation ?
              either.makeRight([])
            : either.map(
                either.mapLeft(
                  getFunctionParameterType(
                    functionExpression,
                    {
                      configuration: context.configuration,
                      keywordHandlers: context.keywordHandlers,
                      program: context.program,
                      location: enclosingFunctionLocation,
                      mutableInferenceCache: context.mutableInferenceCache,
                      mutableFunctionParameterCache:
                        context.mutableFunctionParameterCache,
                      applicationChain: context.applicationChain,
                    },
                    assumptions,
                  ),
                  // The annotation is at fault, not whatever is being inferred
                  // at `context.location`.
                  attachSpanIfAbsent({
                    ...context,
                    location: [
                      ...enclosingFunctionLocation,
                      '1',
                      'parameter',
                      parameterName,
                    ],
                  }),
                ),
                parameterTypeInfo => [{ parameterName, parameterTypeInfo }],
              )
        },
      })

      return either.flatMap(parametersFromThisLevel, parameters =>
        either.map(
          collectFromLocation(currentLocation.slice(0, -1)),
          enclosingParameters => [...parameters, ...enclosingParameters],
        ),
      )
    }
  }
  return collectFromLocation(context.location)
}

/**
 * Recursively widen every closed object type (one whose excess clauses have
 * bottom-typed `values`) to an open one. Other excess bounds are preserved as
 * written.
 *
 * Type parameters are kept by reference (their identities matter), so their
 * constraints are not adjusted here; make sure constraints are inexact while
 * creating type parameters instead.
 */
const recursivelyOpenObjectTypes = (type: Type): Type =>
  // Avoid infinite recursion when we hit the top type.
  isCanonicalTopType(type) ? type : (
    matchTypeFormat<Type>(type, {
      application: type =>
        makeApplicationType(
          recursivelyOpenObjectTypes(type.function),
          recursivelyOpenObjectTypes(type.argument),
          type.parametersStuckOn,
        ),
      function: type =>
        makeFunctionType({
          parameter: recursivelyOpenObjectTypes(type.signature.parameter),
          return: recursivelyOpenObjectTypes(type.signature.return),
        }),
      indexedAccess: type =>
        makeIndexedAccessType(
          recursivelyOpenObjectTypes(type.object),
          recursivelyOpenObjectTypes(type.key),
        ),
      intrinsicApplication: type =>
        makeIntrinsicApplicationType(
          type.parameterTypes.map(recursivelyOpenObjectTypes),
          type.reduce,
          parameterTypes =>
            recursivelyOpenObjectTypes(type.computeUpperBound(parameterTypes)),
        ),
      object: type =>
        makeObjectType(
          Object.fromEntries(
            Object.entries(type.children).map(([key, child]) => [
              key,
              recursivelyOpenObjectTypes(child),
            ]),
          ),
          (
            effectiveExcessClauses(type.excess).every(clause =>
              isBottomType(clause.values),
            )
          ) ?
            []
          : type.excess,
        ),
      opaque: type => type,
      parameter: type => type,
      union: type =>
        makeUnionType(
          [...type.members].flatMap(member => {
            if (typeof member === 'string') {
              return [member]
            } else {
              const strippedMember = recursivelyOpenObjectTypes(member)
              return strippedMember.kind === 'union' ?
                  [...strippedMember.members]
                : [strippedMember]
            }
          }),
        ),
    })
  )
