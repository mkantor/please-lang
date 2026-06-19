import either, { type Either } from '@matt.kantor/either'
import option from '@matt.kantor/option'
import {
  keyPathToLookupExpression,
  makeApplyExpression,
  objectNodeFromOrderedEntries,
  type ExpressionContext,
} from '../../semantics.js'
import {
  makeFunctionNode,
  type FunctionNodeCallError,
  type FunctionNodeCallSignature,
} from '../function-node.js'
import { type NonEmptyKeyPath } from '../key-path.js'
import {
  containsAnyUnelaboratedNodes,
  type SemanticGraph,
} from '../semantic-graph.js'
import { typeFromSemanticGraph } from '../type-system/literal-type.js'
import {
  makeFunctionType,
  makeIntrinsicApplicationType,
  makeTypeParameter,
  type FunctionType,
  type Type,
} from '../type-system/type-formats.js'
import { containedTypeParameters } from '../type-system/type-parameter-analysis.js'
import {
  getTypesForTypeParameters,
  supplyTypeArguments,
} from '../type-system/type-substitution.js'

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
 * Use with calls of user-defined functions from the standard library (which
 * conceptually occur from "outside your program" and therefore do not have a
 * meaningful `ExpressionContext`).
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
    '@panic': either.makeRight,
    '@runtime': either.makeRight,
    '@todo': either.makeRight,
    '@union': either.makeRight,
  },
  location: [],
  program: objectNodeFromOrderedEntries([]),
  mutableInferenceCache: new Map(),
  mutableFunctionParameterCache: new Map(),
  locationDoesNotCorrespondWithTruePosition: true,
}

export const serializeOnceAppliedFunction =
  (keyPath: NonEmptyKeyPath, argument: SemanticGraph) => () =>
    either.makeRight(
      makeApplyExpression({
        function: keyPathToLookupExpression(keyPath),
        argument,
      }),
    )

export const serializeTwiceAppliedFunction =
  (
    keyPath: NonEmptyKeyPath,
    argument1: SemanticGraph,
    argument2: SemanticGraph,
  ) =>
  () =>
    either.makeRight(
      makeApplyExpression({
        function: makeApplyExpression({
          function: keyPathToLookupExpression(keyPath),
          argument: argument1,
        }),
        argument: argument2,
      }),
    )

export const preludeFunctionArity1 = (
  keyPath: NonEmptyKeyPath,
  signature: FunctionType['signature'],
  f: FunctionNodeCallSignature,
  computeRefinedReturnType?: (argumentTypes: readonly Type[]) => Type,
) =>
  makeFunctionNode(
    liftIntrinsicSignature(
      signature,
      intrinsicApplicationTypeReducerArity1(f),
      computeRefinedReturnType,
    ),
    () => either.makeRight(keyPathToLookupExpression(keyPath)),
    option.none,
    handleUnavailableDependencies(f),
  )

export const preludeFunctionArity2 = (
  keyPath: NonEmptyKeyPath,
  signature: {
    readonly parameter: Type
    readonly return: FunctionType
  },
  f: (
    argument1: SemanticGraph,
  ) => Either<FunctionNodeCallError, FunctionNodeCallSignature>,
  computeRefinedReturnType?: (argumentTypes: readonly Type[]) => Type,
) => {
  const liftedSignature = liftIntrinsicSignature(
    signature,
    intrinsicApplicationTypeReducerArity2(f),
    computeRefinedReturnType,
  )
  return makeFunctionNode(
    liftedSignature,
    () => either.makeRight(keyPathToLookupExpression(keyPath)),
    option.none,
    handleUnavailableDependencies(argument1 =>
      either.flatMap(
        refineReturnedFunctionType(
          liftedSignature.parameter,
          liftedSignature.return,
          argument1,
        ),
        refinedReturn =>
          either.map(f(argument1), f1 =>
            makeFunctionNode(
              refinedReturn.signature,
              serializeOnceAppliedFunction(keyPath, argument1),
              option.none,
              handleUnavailableDependencies(f1),
            ),
          ),
      ),
    ),
  )
}

export const preludeFunctionArity3 = (
  keyPath: NonEmptyKeyPath,
  signature: {
    readonly parameter: Type
    readonly return: FunctionType & {
      readonly signature: {
        readonly parameter: Type
        readonly return: FunctionType
      }
    }
  },
  f: (
    argument1: SemanticGraph,
  ) => Either<
    FunctionNodeCallError,
    (
      argument2: SemanticGraph,
    ) => Either<FunctionNodeCallError, FunctionNodeCallSignature>
  >,
  computeRefinedReturnType?: (argumentTypes: readonly Type[]) => Type,
) => {
  const liftedSignature = liftIntrinsicSignature(
    signature,
    intrinsicApplicationTypeReducerArity3(f),
    computeRefinedReturnType,
  )
  return makeFunctionNode(
    liftedSignature,
    () => either.makeRight(keyPathToLookupExpression(keyPath)),
    option.none,
    handleUnavailableDependencies(argument1 =>
      either.flatMap(
        refineReturnedFunctionType(
          liftedSignature.parameter,
          liftedSignature.return,
          argument1,
        ),
        refinedReturn1 =>
          either.map(f(argument1), f1 =>
            makeFunctionNode(
              refinedReturn1.signature,
              serializeOnceAppliedFunction(keyPath, argument1),
              option.none,
              handleUnavailableDependencies(argument2 =>
                either.flatMap(
                  refinedReturn1.signature.return.kind === 'function' ?
                    refineReturnedFunctionType(
                      refinedReturn1.signature.parameter,
                      refinedReturn1.signature.return,
                      argument2,
                    )
                  : either.makeLeft({
                      kind: 'bug',
                      message: `supplying type arguments in an arity-3 standard library function somehow transformed its first return type into a ${refinedReturn1.signature.return.kind} type (it should be a function type)`,
                    }),
                  refinedReturn2 =>
                    either.map(f1(argument2), f2 =>
                      makeFunctionNode(
                        refinedReturn2.signature,
                        serializeTwiceAppliedFunction(
                          keyPath,
                          argument1,
                          argument2,
                        ),
                        option.none,
                        handleUnavailableDependencies(f2),
                      ),
                    ),
                ),
              ),
            ),
          ),
      ),
    ),
  )
}

const synthesizeTypeParameterName = (index: number) => {
  if (index < 0 || !Number.isInteger(index)) {
    throw new Error('Index was negative or non-integral. This is a bug!')
  } else {
    const wraparoundCount = Math.floor(index / 26)
    const suffix = wraparoundCount === 0 ? '' : String(wraparoundCount)
    return String.fromCharCode((index % 26) + 97).concat(suffix)
  }
}

// The reducers below apply an intrinsic function (`f`) to concrete argument
// values, lifting the result back to a type. This lets
// `IntrinsicApplicationType`s reduce via the same code that evaluates values.
// Returned object types are exact because they describe actual values produced
// by `f`.

const intrinsicApplicationTypeReducerArity1 =
  (f: FunctionNodeCallSignature) =>
  (
    argumentValues: readonly SemanticGraph[],
  ): Either<FunctionNodeCallError, Type> => {
    const [argument] = argumentValues
    return argument === undefined ?
        either.makeLeft({
          kind: 'bug',
          message: "argument list didn't contain enough arguments",
        })
      : either.flatMap(
          f(argument, emptyContextForStdlibApplications),
          resultValue =>
            typeFromSemanticGraph(resultValue, {
              objectsAreExact: true,
            }),
        )
  }

const intrinsicApplicationTypeReducerArity2 =
  (
    f: (
      argument1: SemanticGraph,
    ) => Either<FunctionNodeCallError, FunctionNodeCallSignature>,
  ) =>
  (
    argumentValues: readonly SemanticGraph[],
  ): Either<FunctionNodeCallError, Type> => {
    const [argument1, argument2] = argumentValues
    return argument1 === undefined || argument2 === undefined ?
        either.makeLeft({
          kind: 'bug',
          message: "argument list didn't contain enough arguments",
        })
      : either.flatMap(
          either.flatMap(f(argument1), f1 =>
            f1(argument2, emptyContextForStdlibApplications),
          ),
          resultValue =>
            typeFromSemanticGraph(resultValue, {
              objectsAreExact: true,
            }),
        )
  }

const intrinsicApplicationTypeReducerArity3 =
  (
    f: (
      argument1: SemanticGraph,
    ) => Either<
      FunctionNodeCallError,
      (
        argument2: SemanticGraph,
      ) => Either<FunctionNodeCallError, FunctionNodeCallSignature>
    >,
  ) =>
  (
    argumentValues: readonly SemanticGraph[],
  ): Either<FunctionNodeCallError, Type> => {
    const [argument1, argument2, argument3] = argumentValues
    return (
        argument1 === undefined ||
          argument2 === undefined ||
          argument3 === undefined
      ) ?
        either.makeLeft({
          kind: 'bug',
          message: "argument list didn't contain enough arguments",
        })
      : either.flatMap(
          either.flatMap(f(argument1), f1 =>
            either.flatMap(f1(argument2), f2 =>
              f2(argument3, emptyContextForStdlibApplications),
            ),
          ),
          resultValue =>
            typeFromSemanticGraph(resultValue, {
              objectsAreExact: true,
            }),
        )
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
