import either, { type Either } from '@matt.kantor/either'
import option from '@matt.kantor/option'
import type { ElaborationError } from '../../../errors.js'
import type { Atom } from '../../../parsing.js'
import {
  asSemanticGraph,
  elaborateWithContext,
  getParameterName,
  getParameterTypeAnnotation,
  getTypesForTypeParameters,
  ignoredKey,
  inferType,
  makeFunctionNode,
  objectNodeFromOrderedEntries,
  readFunctionExpression,
  replaceAllTypeParametersWithTheirConstraints,
  serialize,
  updateValueAtKeyPathInSemanticGraph,
  type Expression,
  type ExpressionContext,
  type FunctionExpression,
  type FunctionNode,
  type KeywordHandler,
  type SemanticGraph,
  type Type,
} from '../../../semantics.js'
import {
  collectHolesByName,
  findDuplicateHoleNames,
  makeHoleExpressionWithExtantTypeParameter,
} from '../../../semantics/expressions/hole-expression.js'
import { makeTypeParameter } from '../../../semantics/type-system/type-formats.js'

export const functionKeywordHandler: KeywordHandler = (
  expression: Expression,
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
        return either.makeLeft({
          kind: 'invalidExpression',
          message: `hole \`?${first ?? ''}\` is declared more than once in the same scope`,
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
  const parameterName = getParameterName(expression)
  const body = expression[1].body

  const ownKey =
    functionDefinitionContext.location[
      functionDefinitionContext.location.length - 1
    ]
  if (ownKey === undefined) {
    return either.makeLeft({
      kind: 'panic',
      message: 'function had no location',
    })
  }

  // TODO: Make this foolproof.
  const returnKey =
    parameterName === 'return' || ownKey === 'return' ?
      'return with a different key to avoid collision with a stupidly-named parameter'
    : 'return'

  // Put each `@hole` from the annotation into scope under its name so the body
  // can refer to it (e.g. `(first: ?a) => (second: :a) => …`). When the
  // argument can be used to pin down type parameters, re-mint their `@hole`s
  // with constraints specialized to this call site. Holes can also remain
  // generic, staying stuck until an enclosing function is applied.
  const holeBindings: readonly (readonly [string, SemanticGraph])[] =
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
                [
                  ...getTypesForTypeParameters({
                    parameterType: signature.parameter,
                    argumentType,
                  }),
                ].map(([typeParameter, specialization]) => [
                  typeParameter.name,
                  specialization,
                ]),
              ),
          },
        )

        return [...collectHolesByName(annotation)]
          .filter(
            ([name, _hole]) =>
              name !== parameterName &&
              name !== ownKey &&
              name !== returnKey &&
              name !== ignoredKey,
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
                      // simplify the type in diagnostics and doesn't affect
                      // semantics.
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
                argument =>
                  apply(expression, signature, argument, {
                    functionDefinitionContext,
                    applySiteContext,
                  }),
              ),
            ],
            // Put the argument in scope.
            [parameterName, argument],
            // Put any `@hole`s from the parameter annotation in scope so type
            // parameters can be referenced.
            ...holeBindings,
            // Use the serialized form so the body in the program matches what
            // gets re-elaborated.
            [returnKey, asSemanticGraph(serializedBody)],
          ]),
      ),
      updatedProgram =>
        elaborateWithContext(serializedBody, {
          keywordHandlers: functionDefinitionContext.keywordHandlers,
          location: [...functionDefinitionContext.location, returnKey],
          program: updatedProgram,
          // Every application of this function re-elaborates the body at the
          // same location but against a different spliced program, so cached
          // inferences from other applications would be wrong here. Use fresh
          // caches to keep each application's type information isolated.
          mutableInferenceCache: new Map(),
          mutableFunctionParameterCache: new Map(),
        }),
    ),
  )

  return either.mapLeft(result, error => ({
    kind: 'panic',
    message: error.message,
  }))
}
