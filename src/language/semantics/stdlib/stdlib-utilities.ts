import either, { type Either } from '@matt.kantor/either'
import option from '@matt.kantor/option'
import type { Bug, UnserializableValueError } from '../../errors.js'
import type { Atom } from '../../parsing.js'
import {
  keyPathToLookupExpression,
  makeApplyExpression,
  objectNodeFromOrderedEntries,
  type ExpressionContext,
} from '../../semantics.js'
import {
  makeFunctionNode,
  type FunctionNode,
  type FunctionNodeCallError,
  type FunctionNodeCallSignature,
} from '../function-node.js'
import type { NonEmptyKeyPath } from '../key-path.js'
import type { ObjectNode } from '../object-node.js'
import { nodeTag } from '../semantic-graph-node-tag.js'
import {
  containsAnyUnelaboratedNodes,
  stringifySemanticGraphForEndUser,
  stringifyTypeForEndUser,
  type SemanticGraph,
} from '../semantic-graph.js'
import {
  makeFunctionType,
  makeIntrinsicApplicationType,
  makeTypeParameter,
  type FunctionType,
  type Type,
} from '../type-system.js'
import { typeFromSemanticGraph } from '../type-system/literal-type.js'
import { isAssignable } from '../type-system/subtyping.js'
import { containedTypeParameters } from '../type-system/type-parameter-analysis.js'
import {
  getTypesForTypeParameters,
  replaceAllTypeParametersWithTheirConstraints,
  supplyTypeArguments,
} from '../type-system/type-substitution.js'
import type {
  AnyParameter,
  NonEmptyParameters,
  Parameter,
} from './parameters.js'

const handleUnavailableDependencies =
  (f: FunctionNodeCallSignature) =>
  (argument: SemanticGraph): ReturnType<FunctionNodeCallSignature> => {
    if (containsAnyUnelaboratedNodes(argument)) {
      return either.makeLeft({
        kind: 'dependencyUnavailable',
        message: 'one or more dependencies are unavailable',
      })
    } else {
      return f(argument, emptyContextForStdlibApplications)
    }
  }

/**
 * Validate an `argument` against the parameter type of a `functionNode`'s
 * signature, then apply it if valid. Applications occurring from the standard
 * library don't get the normal `@apply` static analysis, so use this instead.
 */
export const applyValidatingParameterType = (
  functionNode: FunctionNode,
  argument: SemanticGraph,
): Either<FunctionNodeCallError, SemanticGraph> =>
  either.flatMap(
    typeFromSemanticGraph(argument, { objectsAreExact: true }),
    argumentType => {
      // Values are never directly assignable to (rigid) type parameters, so
      // validate against the parameter's bound instead.
      const parameterBound = replaceAllTypeParametersWithTheirConstraints(
        functionNode.signature.parameter,
      )
      return isAssignable({ source: argumentType, target: parameterBound }) ?
          functionNode(argument, emptyContextForStdlibApplications)
        : either.makeLeft({
            kind: 'typeMismatch',
            message: `the value \`${stringifySemanticGraphForEndUser(
              argument,
            )}\` is not assignable to the function's parameter type \`${stringifyTypeForEndUser(parameterBound)}\``,
          })
    },
  )

/**
 * Use with function calls from the standard library (which conceptually occur
 * "outside your program" and don't have a meaningful `ExpressionContext`).
 */
export const emptyContextForStdlibApplications: ExpressionContext = {
  keywordHandlers: {
    '@apply': either.makeRight,
    '@check': either.makeRight,
    '@function': either.makeRight,
    '@hole': either.makeRight,
    '@if': either.makeRight,
    '@index': either.makeRight,
    '@lookup': either.makeRight,
    '@object': either.makeRight,
    '@panic': either.makeRight,
    '@runtime': either.makeRight,
    '@todo': either.makeRight,
    '@union': either.makeRight,
  },
  location: [],
  program: objectNodeFromOrderedEntries([]),
  mutableInferenceCache: new Map(),
  mutableFunctionParameterCache: new Map(),
  isExternalToProgram: true,
}

export type PreludeFunctionBody<Parameters extends readonly AnyParameter[]> =
  Parameters extends (
    readonly [
      Parameter<infer Value>,
      ...infer RemainingParameters extends readonly AnyParameter[],
    ]
  ) ?
    (
      value: Value,
    ) => Either<
      FunctionNodeCallError,
      RemainingParameters extends readonly [] ? SemanticGraph
      : PreludeFunctionBody<RemainingParameters>
    >
  : never

/**
 * Build a standard library `FunctionNode` from typed parameter descriptors, a
 * return type, and a curried body with one fallible stage per parameter. Each
 * stage runs as its argument arrives, so partial applications precompute.
 */
export const preludeFunction = <const Parameters extends NonEmptyParameters>(
  keyPath: NonEmptyKeyPath,
  parameters: Parameters,
  returnType: Type,
  body: PreludeFunctionBody<Parameters>,
  computeRefinedReturnType?: (argumentTypes: readonly Type[]) => Type,
): FunctionNode => {
  const definition = {
    keyPath,
    functionName: keyPath[keyPath.length - 1] ?? keyPath[0],
    parameters,
    body,
  }
  const liftedSignature = liftIntrinsicSignature(
    signatureFromParameters(parameters, returnType),
    argumentValues =>
      either.flatMap(applyBody(definition)(argumentValues), resultValue =>
        typeFromSemanticGraph(resultValue, { objectsAreExact: true }),
      ),
    computeRefinedReturnType,
  )
  return makeFunctionNode(
    liftedSignature,
    () => either.makeRight(keyPathToLookupExpression(keyPath)),
    option.none,
    handleUnavailableDependencies(
      acceptArgument(definition)({
        remainingParameters: parameters,
        argumentsSoFar: [],
        signature: liftedSignature,
        stage: definition.body,
      }),
    ),
  )
}

type BodyStage = (
  value: SemanticGraph,
) => Either<FunctionNodeCallError, SemanticGraph | BodyStage>

type PreludeFunctionDefinition = {
  readonly keyPath: NonEmptyKeyPath
  readonly functionName: Atom
  readonly parameters: NonEmptyParameters
  readonly body: BodyStage
}

const signatureFromParameters = (
  parameters: NonEmptyParameters,
  returnType: Type,
): FunctionType['signature'] => {
  const [firstParameter, ...restParameters] = parameters
  return {
    parameter: firstParameter.type,
    return: restParameters.reduceRight(
      (returnSoFar, parameter) =>
        makeFunctionType({ parameter: parameter.type, return: returnSoFar }),
      returnType,
    ),
  }
}

const asNextStage = (
  result: SemanticGraph | BodyStage,
): Either<Bug, BodyStage> =>
  typeof result === 'function' && !(nodeTag in result) ?
    either.makeRight(result)
  : either.makeLeft({
      kind: 'bug',
      message:
        'a standard library function produced a final result while parameters remained',
    })

const asFinalResult = (
  result: SemanticGraph | BodyStage,
): Either<Bug, SemanticGraph> =>
  typeof result === 'function' && !(nodeTag in result) ?
    either.makeLeft({
      kind: 'bug',
      message:
        'a standard library function produced another function after its last parameter',
    })
  : either.makeRight(result)

// Applies every stage at once, on behalf of intrinsic type reduction.
const applyBody =
  (definition: PreludeFunctionDefinition) =>
  (
    argumentValues: readonly SemanticGraph[],
  ): Either<FunctionNodeCallError, SemanticGraph> =>
    either.flatMap(
      definition.parameters.reduce<
        Either<FunctionNodeCallError, SemanticGraph | BodyStage>
      >(
        (resultSoFar, parameter, index) =>
          either.flatMap(resultSoFar, result =>
            either.flatMap(asNextStage(result), stage => {
              const argumentValue = argumentValues[index]
              return argumentValue === undefined ?
                  either.makeLeft({
                    kind: 'bug',
                    message: "argument list didn't contain enough arguments",
                  })
                : either.flatMap(
                    parseArgument(
                      definition.functionName,
                      parameter,
                      argumentValue,
                    ),
                    stage,
                  )
            }),
          ),
        either.makeRight(definition.body),
      ),
      asFinalResult,
    )

const parseArgument = (
  functionName: Atom,
  parameter: AnyParameter,
  argument: SemanticGraph,
): Either<FunctionNodeCallError, SemanticGraph> =>
  option.match(parameter.asExpected(argument), {
    none: _ =>
      either.makeLeft({
        kind: 'typeMismatch',
        message: `\`${functionName}\` expected ${parameter.expected}`,
      }),
    some: either.makeRight,
  })

type PartialApplicationState = {
  readonly remainingParameters: readonly AnyParameter[]
  // Arguments accepted so far, kept for serializing partial applications.
  readonly argumentsSoFar: readonly SemanticGraph[]
  // The signature of the function which will receive the next argument.
  readonly signature: FunctionType['signature']
  // The body stage which will receive the next argument.
  readonly stage: BodyStage
}

/**
 * Accept a single argument of a (possibly partially-applied) standard library
 * function, validating it and running the pending body stage to produce either
 * the next partial application (with a refined signature) or the final result.
 */
const acceptArgument =
  (definition: PreludeFunctionDefinition) =>
  (state: PartialApplicationState) =>
  (argument: SemanticGraph): Either<FunctionNodeCallError, SemanticGraph> => {
    const [parameter, ...restParameters] = state.remainingParameters
    if (parameter === undefined) {
      return either.makeLeft({
        kind: 'bug',
        message:
          'a standard library function was applied with no parameters remaining',
      })
    } else {
      return either.flatMap(
        parseArgument(definition.functionName, parameter, argument),
        validArgument =>
          either.flatMap(state.stage(validArgument), stageResult => {
            const argumentsSoFar: readonly SemanticGraph[] = [
              ...state.argumentsSoFar,
              validArgument,
            ]
            return restParameters.length === 0 ?
                asFinalResult(stageResult)
              : either.flatMap(asNextStage(stageResult), nextStage =>
                  either.map(
                    refineReturnedFunctionType(
                      state.signature.parameter,
                      state.signature.return,
                      argument,
                    ),
                    refinedReturn =>
                      makeFunctionNode(
                        refinedReturn.signature,
                        serializeAppliedFunction(
                          definition.keyPath,
                          argumentsSoFar,
                        ),
                        option.none,
                        handleUnavailableDependencies(
                          acceptArgument(definition)({
                            remainingParameters: restParameters,
                            argumentsSoFar,
                            signature: refinedReturn.signature,
                            stage: nextStage,
                          }),
                        ),
                      ),
                  ),
                )
          }),
      )
    }
  }

const serializeAppliedFunction =
  (keyPath: NonEmptyKeyPath, argumentsSoFar: readonly SemanticGraph[]) =>
  (): Either<UnserializableValueError, ObjectNode> =>
    either.makeRight(
      argumentsSoFar.reduce<ObjectNode>(
        (functionSoFar, argument) =>
          makeApplyExpression({ function: functionSoFar, argument }),
        keyPathToLookupExpression(keyPath),
      ),
    )

const synthesizeTypeParameterName = (index: number) => {
  if (index < 0 || !Number.isInteger(index)) {
    throw new Error('Index was negative or non-integral. This is a bug!')
  } else {
    const wraparoundCount = Math.floor(index / 26)
    const suffix = wraparoundCount === 0 ? '' : String(wraparoundCount)
    return String.fromCharCode((index % 26) + 97).concat(suffix)
  }
}

type SignatureParts = {
  // The constraint at each curried parameter position, in application order.
  readonly parameterConstraints: readonly Type[]
  // The innermost (non-function) return type.
  readonly finalReturn: Type
}

const signatureParts = (
  signature: FunctionType['signature'],
): SignatureParts => {
  const prependParameter = (
    parameter: Type,
    { parameterConstraints, finalReturn }: SignatureParts,
  ): SignatureParts => ({
    parameterConstraints: [parameter, ...parameterConstraints],
    finalReturn,
  })
  const partsFromReturn = (returnType: Type): SignatureParts =>
    returnType.kind === 'function' ?
      prependParameter(
        returnType.signature.parameter,
        partsFromReturn(returnType.signature.return),
      )
    : { parameterConstraints: [], finalReturn: returnType }
  return prependParameter(
    signature.parameter,
    partsFromReturn(signature.return),
  )
}

/**
 * Lift a standard library function's signature to be generic over its
 * parameters and return an `IntrinsicApplicationType`. This lets the type
 * system compute precise return types from singleton argument types via
 * `reduce` (which should apply the function itself).
 *
 * Functions whose return already contains a type parameter (e.g. `identity`)
 * don't need extra precision, so their signature is left unchanged.
 */
const liftIntrinsicSignature = (
  signature: FunctionType['signature'],
  reduce: (
    argumentValues: readonly SemanticGraph[],
  ) => Either<FunctionNodeCallError, Type>,
  // An optional argument-type-sensitive upper bound for the stuck application.
  // Defaults to the function's (concrete) declared return type.
  computeRefinedReturnType?: (argumentTypes: readonly Type[]) => Type,
): FunctionType['signature'] => {
  if (containedTypeParameters(makeFunctionType(signature)).size > 0) {
    return signature
  } else {
    const { parameterConstraints, finalReturn } = signatureParts(signature)
    // Make signatures implicitly generic, just like userland functions.
    const parameterTypes = parameterConstraints.map((constraint, index) =>
      makeTypeParameter(synthesizeTypeParameterName(index), {
        assignableTo: constraint,
      }),
    )
    const liftedFunctionType = parameterTypes.reduceRight<Type>(
      (returnSoFar, parameter) =>
        makeFunctionType({ parameter, return: returnSoFar }),
      makeIntrinsicApplicationType(
        parameterTypes,
        reduce,
        computeRefinedReturnType ?? (() => finalReturn),
      ),
    )
    return liftedFunctionType.kind === 'function' ?
        liftedFunctionType.signature
      : signature
  }
}

/**
 * Substitute type parameters using an argument's type into the returned
 * function type of a higher-order function. Without this, each partial
 * application would carry the outermost static signature, leaving type
 * parameters uninstantiated.
 */
const refineReturnedFunctionType = (
  parameterType: Type,
  returnedType: Type,
  argument: SemanticGraph,
): Either<FunctionNodeCallError, FunctionType> =>
  either.flatMap(
    typeFromSemanticGraph(argument, { objectsAreExact: true }),
    argumentType => {
      const refinedReturnType = supplyTypeArguments(
        returnedType,
        getTypesForTypeParameters({
          parameterType,
          argumentType,
        }),
      )
      return refinedReturnType.kind === 'function' ?
          either.makeRight(refinedReturnType)
        : either.makeLeft({
            kind: 'bug',
            message: `supplying type arguments to a standard library function somehow transformed it into a ${refinedReturnType.kind} type`,
          })
    },
  )
