import either, { type Either } from '@matt.kantor/either'
import option, { type Option } from '@matt.kantor/option'
import type { ElaborationError } from '../../../errors.js'
import {
  applicableFunctionSignatures,
  containedTypeParameters,
  containsAnyUnelaboratedNodes,
  getTypesForTypeParameters,
  inferType,
  isAssignable,
  isFunctionNode,
  readApplyExpression,
  rigidTypeParameterIdentities,
  stringifyTypeForEndUser,
  supplyTypeArgument,
  supplyTypeArguments,
  typeParameterAssignableToConstraintKey,
  typeParameterIdentitiesWithinType,
  type Expression,
  type ExpressionContext,
  type KeywordHandler,
  type SemanticGraph,
  type Type,
  type TypeParameter,
  type UnionType,
} from '../../../semantics.js'

const checkArgumentType = (
  argumentType: Type,
  parameterType: Type,
  rigidTypeParameters: ReadonlySet<symbol>,
): Either<ElaborationError, undefined> => {
  // Instantiate the applied function's own ("flexible") type parameters from
  // the argument before the assignability check. Type parameters bound by
  // enclosing not-yet-applied functions are "rigid" (their types are decided
  // when those functions are eventually applied, not by this argument).
  const typeArguments = getTypesForTypeParameters({
    parameterType,
    argumentType,
  })
  const flexibleTypeArguments = new Map(
    typeArguments
      .entries()
      .filter(
        ([typeParameter]) => !rigidTypeParameters.has(typeParameter.identity),
      ),
  )
  const instantiatedParameterType = supplyTypeArguments(
    parameterType,
    flexibleTypeArguments,
  )
  return (
      isAssignable({ source: argumentType, target: instantiatedParameterType })
    ) ?
      either.makeRight(undefined)
    : either.makeLeft({
        kind: 'typeMismatch',
        message: `argument with type \`${stringifyTypeForEndUser(argumentType)}\` is not assignable to the parameter type \`${stringifyTypeForEndUser(parameterType)}\``,
      })
}

/**
 * A "correlated scrutinee" is a type parameter that the given `functionType` is
 * stuck on, whose constraint is a union, and which `argumentType` also
 * mentions. The function and argument are *correlated*. For example, given this
 * function:
 *
 * ```plz
 * (object: {
 *   a: :integer.type
 *   f: :integer.type ~> :something.type
 * } | {
 *   a: :boolean.type
 *   f: :boolean.type ~> :something.type
 * }) => :object.f(:object.a)
 * ```
 *
 * `:object.f(:object.a)` is a correlated application. Static analysis must
 * prove that this expression is valid for every individual member of `object`'s
 * union type, and `CorrelatedScrutinee` is an intermediate concept used during
 * that analysis.
 */
const correlatedScrutinee = (
  functionType: Type,
  argumentType: Type,
): Option<CorrelatedScrutinee> => {
  const argumentParameterIdentities =
    typeParameterIdentitiesWithinType(argumentType)
  const [scrutinee] = containedTypeParameters(functionType)
    .values()
    .filter(
      ({ keyPath }) =>
        !keyPath.includes(typeParameterAssignableToConstraintKey),
    )
    .flatMap(({ typeParameters }) => typeParameters.members)
    .flatMap(typeParameter => {
      const constraint = typeParameter.constraint.assignableTo
      return (
          constraint.kind === 'union' &&
            argumentParameterIdentities.has(typeParameter.identity) &&
            constraint.members
              .values()
              .some(member => typeof member !== 'string')
        ) ?
          [{ parameter: typeParameter, constraint: constraint }]
        : []
    })
  return scrutinee === undefined ? option.none : option.makeSome(scrutinee)
}
type CorrelatedScrutinee = {
  readonly parameter: TypeParameter
  readonly constraint: UnionType
}

/**
 * Check that applying `functionType` to `argumentType` is valid.
 *
 * When the function and argument are correlated through a union-constrained
 * type parameter (and the function's type is stuck, not just a plain
 * `FunctionType` or union thereof), the check is distributed over that union's
 * members so the correlation is respected (see `correlatedScrutinee`'s docblock
 * for an example).
 *
 * Otherwise the argument is checked against the (possibly-union-typed) function
 * directly.
 */
const checkApplication = (
  argument: SemanticGraph,
  functionType: Type,
  argumentType: Type,
  rigidTypeParameters: ReadonlySet<symbol>,
): Either<ElaborationError, undefined> =>
  option.match(applicableFunctionSignatures(functionType), {
    none: _ =>
      either.makeLeft({
        kind: 'invalidExpression',
        message: `only functions can be applied, but got a \`${stringifyTypeForEndUser(functionType)}\``,
      }),
    some: signatures => {
      const analysisResults = option.match(
        functionType.kind === 'function' ?
          option.none
        : correlatedScrutinee(functionType, argumentType),
        {
          none: _ =>
            signatures.map(signature =>
              checkArgumentType(
                argumentType,
                signature.parameter,
                rigidTypeParameters,
              ),
            ),
          some: ({ parameter, constraint }) =>
            [...constraint.members].flatMap(member =>
              typeof member === 'string' ?
                []
              : [
                  checkApplication(
                    argument,
                    supplyTypeArgument(functionType, parameter, member),
                    supplyTypeArgument(argumentType, parameter, member),
                    rigidTypeParameters,
                  ),
                ],
            ),
        },
      )
      return either.map(either.sequence(analysisResults), _ => undefined)
    },
  })

export const applyKeywordHandler: KeywordHandler = (
  expression: Expression,
  context: ExpressionContext,
): Either<ElaborationError, SemanticGraph> =>
  either.flatMap(
    readApplyExpression(expression),
    (applyExpression): Either<ElaborationError, SemanticGraph> => {
      const functionToApply = applyExpression[1].function
      const argument = applyExpression[1].argument

      const argumentTypeCheck = either.flatMap(
        inferType(functionToApply, {
          ...context,
          location: [...context.location, '1', 'function'],
        }),
        functionType =>
          either.flatMap(
            inferType(argument, {
              ...context,
              location: [...context.location, '1', 'argument'],
            }),
            argumentType =>
              checkApplication(
                argument,
                functionType,
                argumentType,
                rigidTypeParameterIdentities(context),
              ),
          ),
      )

      return either.flatMap(
        argumentTypeCheck,
        (): Either<ElaborationError, SemanticGraph> => {
          if (containsAnyUnelaboratedNodes(argument)) {
            // The argument isn't ready, so keep the @apply unelaborated.
            return either.makeRight(applyExpression)
          } else if (isFunctionNode(functionToApply)) {
            const result = functionToApply(argument, context)
            if (either.isLeft(result)) {
              if (result.value.kind === 'dependencyUnavailable') {
                // Keep the @apply unelaborated.
                return either.makeRight(applyExpression)
              } else {
                return either.makeLeft(result.value)
              }
            } else {
              return result
            }
          } else if (containsAnyUnelaboratedNodes(functionToApply)) {
            // The function isn't ready, so keep the @apply unelaborated.
            return either.makeRight(applyExpression)
          } else {
            return either.makeLeft({
              kind: 'invalidExpression',
              message: 'only functions can be applied',
            })
          }
        },
      )
    },
  )
