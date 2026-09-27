import either, { type Either } from '@matt.kantor/either'
import option, { type Option } from '@matt.kantor/option'
import { withPhantomData, type WithPhantomData } from '../../phantom-data.js'
import type {
  InvalidExpressionError,
  UnserializableValueError,
} from '../errors.js'
import type { Atom, Molecule, SyntaxTree } from '../parsing.js'
import {
  ignoredKey,
  keyPathToLookupExpression,
  makeApplyExpression,
  makeCheckExpression,
  makeFunctionExpression,
  makeIfExpression,
  makeIndexExpression,
  makeLookupExpression,
  makeUnionExpression,
  readFunctionExpression,
  readUnionExpression,
  type Type,
  type TypeParameter,
} from '../semantics.js'
import { inlinePlz, unparse, type Notation } from '../unparsing.js'
import { isExpression } from './expression.js'
import { makeHoleExpressionWithExtantTypeParameter } from './expressions/hole-expression.js'
import { makeObjectTypeExpression } from './expressions/object-type-expression.js'
import { serializeFunctionNode, type FunctionNode } from './function-node.js'
import { isSemanticGraph } from './is-semantic-graph.js'
import { stringifyKeyPathForEndUser, type KeyPath } from './key-path.js'
import { isExemptFromElaboration, isKeyword } from './keyword.js'
import {
  makeObjectNode,
  objectNodeFromMolecule,
  objectNodeFromOrderedEntries,
  orderedEntriesOfObjectNode,
  serializeObjectNode,
  withProperty,
  type ObjectNode,
} from './object-node.js'
import { nodeTag } from './semantic-graph-node-tag.js'
import {
  canonicalSpellingOf,
  containedTypeParameters,
  functionParameterKey,
  functionReturnKey,
  isCanonicalTopType,
  matchTypeFormat,
  simplifyType,
  typeParameterAssignableToConstraintKey,
  typeParameterIdentitiesWithinFunctionParameters,
  typeParameterIdentitiesWithinType,
  types,
  withStuckApplicationsResolved,
  type FunctionType,
  type IndexedAccessType,
  type TypeKeyPath,
} from './type-system.js'
import {
  atomTypeSymbol,
  integerTypeSymbol,
  naturalNumberTypeSymbol,
  pendingTypeSymbol,
  somethingTypeSymbol,
} from './type-system/prelude-types.js'

export type TypeSymbol =
  | typeof atomTypeSymbol
  | typeof integerTypeSymbol
  | typeof naturalNumberTypeSymbol
  | typeof pendingTypeSymbol
  | typeof somethingTypeSymbol

export type SemanticGraph = Atom | TypeSymbol | FunctionNode | ObjectNode

export const applyKeyPathToSemanticGraph = (
  node: SemanticGraph,
  keyPath: KeyPath,
): Option<SemanticGraph> => {
  const [firstKey, ...remainingKeyPath] = keyPath
  if (firstKey === undefined) {
    return option.makeSome(node)
  } else {
    return matchSemanticGraph(node, {
      atom: _ => option.none,
      function: _ => option.none,
      typeSymbol: _ => option.none,
      object: graph => {
        const next = graph[firstKey]
        if (next === undefined) {
          return option.none
        } else {
          return applyKeyPathToSemanticGraph(
            isSemanticGraph(next) ? next : syntaxTreeToSemanticGraph(next),
            remainingKeyPath,
          )
        }
      },
    })
  }
}

export const applyTypeKeyPathToSemanticGraph = (
  node: SemanticGraph,
  keyPath: TypeKeyPath,
): Option<SemanticGraph> => {
  const [firstKey, ...remainingKeyPath] = keyPath
  if (firstKey === undefined) {
    // If the key path is empty, this is the node we're looking for.
    return option.makeSome(node)
  } else if (typeof firstKey === 'object') {
    switch (firstKey.kind) {
      case 'parameter':
        // Use the constraint.
        // TODO: Make sure this is actually sound. It's currently not exposed
        // because the `@index` handler bails early on unelaborated queries.
        return applyTypeKeyPathToSemanticGraph(node, [
          firstKey.constraint.assignableTo,
          ...remainingKeyPath,
        ])
      case 'union':
        return option.map(
          option.sequence([
            ...firstKey.members
              .values()
              .map(firstKeyMember =>
                applyTypeKeyPathToSemanticGraph(node, [
                  firstKeyMember,
                  ...remainingKeyPath,
                ]),
              ),
          ]),
          foundNodes =>
            makeUnionExpression(
              objectNodeFromOrderedEntries(
                foundNodes.map((node, index) => [String(index), node]),
              ),
            ),
        )
    }
  } else {
    return matchSemanticGraph(node, {
      // If it's an `Atom` or `TypeSymbol` but we have a non-empty path, we
      // whiffed.
      atom: _ => option.none,
      typeSymbol: _ => option.none,

      function: node => {
        if (
          firstKey === functionParameterKey ||
          firstKey === functionReturnKey
        ) {
          return either.match(
            either.flatMap(node.serialize(), readFunctionExpression),
            {
              left: _ => option.none,
              right: serializedFunction => {
                // TODO: Determine whether this is useful, expunge if not.
                switch (firstKey) {
                  case functionParameterKey:
                    return option.makeSome(serializedFunction[1].parameter)
                  case functionReturnKey:
                    return option.makeSome(serializedFunction[1].body)
                }
              },
            },
          )
        } else {
          return option.none
        }
      },

      object: node => {
        if (typeof firstKey === 'string') {
          // Exhaustiveness checks:
          firstKey satisfies string
          node satisfies ObjectNode

          const next = node[firstKey]
          if (next === undefined) {
            return option.none
          } else {
            return applyTypeKeyPathToSemanticGraph(
              isSemanticGraph(next) ? next : syntaxTreeToSemanticGraph(next),
              remainingKeyPath,
            )
          }
        } else {
          switch (firstKey) {
            // None of the following can be applied to object nodes:
            case functionParameterKey:
            case functionReturnKey:
            case typeParameterAssignableToConstraintKey:
              return option.none
          }
        }
      },
    })
  }
}

export const containsAnyUnelaboratedNodes = (node: SemanticGraph): boolean => {
  if (
    isExpression(node) &&
    isKeyword(node[0]) &&
    !isExemptFromElaboration(node[0])
  ) {
    return true
  } else if (typeof node === 'object') {
    for (const propertyValue of Object.values(node)) {
      if (containsAnyUnelaboratedNodes(propertyValue)) {
        return true
      }
    }
    return false
  } else {
    return false
  }
}

export const extractStringValueIfPossible = (
  node: SemanticGraph | Molecule,
) => {
  if (typeof node === 'string') {
    return option.makeSome(node)
  } else {
    return option.none
  }
}

const makePropertyNotFoundError = (
  keyPath: KeyPath,
): InvalidExpressionError => ({
  kind: 'invalidExpression',
  message: `property \`${stringifyKeyPathForEndUser(keyPath)}\` not found`,
})

export const updateValueAtKeyPathInSemanticGraph = (
  node: SemanticGraph,
  keyPath: KeyPath,
  operation: (valueAtKeyPath: SemanticGraph) => SemanticGraph,
): Either<InvalidExpressionError, SemanticGraph> => {
  const [firstKey, ...remainingKeyPath] = keyPath
  if (firstKey === undefined) {
    // If the key path is empty, this is the value to operate on.
    return either.makeRight(operation(node))
  } else {
    return matchSemanticGraph(node, {
      atom: _ => either.makeLeft(makePropertyNotFoundError(keyPath)),
      function: _ => either.makeLeft(makePropertyNotFoundError(keyPath)),
      typeSymbol: _ => either.makeLeft(makePropertyNotFoundError(keyPath)),
      object: node => {
        const next = node[firstKey]
        if (next === undefined) {
          return either.makeLeft(makePropertyNotFoundError(keyPath))
        } else {
          return either.map(
            updateValueAtKeyPathInSemanticGraph(
              isSemanticGraph(next) ? next : syntaxTreeToSemanticGraph(next),
              remainingKeyPath,
              operation,
            ),
            updatedNode => withProperty(node, firstKey, updatedNode),
          )
        }
      },
    })
  }
}

export const matchSemanticGraph = <Result>(
  semanticGraph: SemanticGraph,
  cases: {
    atom: (node: Atom) => Result
    function: (node: FunctionNode) => Result
    object: (node: ObjectNode) => Result
    typeSymbol: (node: TypeSymbol) => Result
  },
): Result => {
  if (typeof semanticGraph === 'string') {
    return cases.atom(semanticGraph)
  } else if (typeof semanticGraph === 'symbol') {
    return cases.typeSymbol(semanticGraph)
  } else {
    switch (semanticGraph[nodeTag]) {
      case 'function':
        return cases[semanticGraph[nodeTag]](semanticGraph)
      case 'object':
        return cases[semanticGraph[nodeTag]](semanticGraph)
    }
  }
}

declare const _serialized: unique symbol
type Serialized = { readonly [_serialized]: true }
export type Output = WithPhantomData<Atom | Molecule, Serialized>

export const serialize = (
  node: SemanticGraph,
): Either<UnserializableValueError, Output> =>
  either.map(
    matchSemanticGraph(node, {
      atom: (node): Either<UnserializableValueError, Atom | Molecule> =>
        either.makeRight(node),
      function: node => serializeFunctionNode(node),
      object: node => serializeObjectNode(node),
      typeSymbol: node => serialize(typeSymbolToSemanticGraph(node)),
    }),
    withPhantomData<Serialized>(),
  )

export const stringifySyntaxTreeForEndUser = (
  tree: SyntaxTree,
  notation: Notation = inlinePlz,
): string =>
  either.unwrapOrElse(
    unparse(tree, notation),
    error => `(unserializable value: ${error.message})`,
  )

export const stringifySemanticGraphForEndUser = (
  graph: SemanticGraph,
  notation: Notation = inlinePlz,
): string =>
  either.unwrapOrElse(
    either.map(serialize(graph), syntaxTree =>
      stringifySyntaxTreeForEndUser(syntaxTree, notation),
    ),
    error => `(unserializable value: ${error.message})`,
  )

export const typeToSemanticGraph = (
  unsimplifiedType: Type,
  options: TypeRenderingOptions = {},
): SemanticGraph => {
  const type = simplifyType(unsimplifiedType)
  const typeParametersWithinFunctionParameters =
    typeParameterIdentitiesWithinFunctionParameters(type)
  const typeParametersInScope = options.typeParametersInScope ?? new Set()
  const introducibleTypeParameterIdentities =
    options.typeParametersInScope === undefined ?
      option.none
    : option.makeSome(
        typeParametersWithinFunctionParameters.difference(
          typeParametersInScope,
        ),
      )
  const typeParameterIdentitiesReferredTo =
    options.unreferencedTypeParametersAsConstraints === true ?
      option.makeSome(
        typeParameterIdentitiesReferredToWhenRendering(
          type,
          introducibleTypeParameterIdentities,
        ).union(
          typeParametersWithinFunctionParameters.intersection(
            typeParametersInScope,
          ),
        ),
      )
    : option.none
  return typeToSemanticGraphImplementation(type, {
    alreadyIntroducedTypeParameterIdentities: new Set(),
    typeParameterNames: new Map(),
    reservedNames: namesOfTypeParametersBoundOutside(
      type,
      introducibleTypeParameterIdentities,
      typeParameterIdentitiesReferredTo,
    ),
    introducibleTypeParameterIdentities,
    typeParameterIdentitiesReferredTo,
    rememberReferenceToTypeParameter: _ => undefined,
    withinConditional: false,
    typeParameterIdentitiesBoundByEnclosingFunctionTypes: new Set(),
  })
}

/**
 * Type parameters in `type` which are referred to after their introduction,
 * e.g. the `:b` in `(a: ?b) => :b`.
 */
const typeParameterIdentitiesReferredToWhenRendering = (
  type: Type,
  introducibleTypeParameterIdentities: Option<ReadonlySet<symbol>>,
): ReadonlySet<symbol> => {
  const referredTo = new Set<symbol>()
  typeToSemanticGraphImplementation(type, {
    alreadyIntroducedTypeParameterIdentities: new Set(),
    typeParameterNames: new Map(),
    reservedNames: new Set(),
    introducibleTypeParameterIdentities,
    typeParameterIdentitiesReferredTo: option.none,
    rememberReferenceToTypeParameter: identity => referredTo.add(identity),
    withinConditional: false,
    typeParameterIdentitiesBoundByEnclosingFunctionTypes: new Set(),
  })
  return referredTo
}

/**
 * The names a rendering of `type` uses to refer to type parameters bound
 * outside it.
 */
const namesOfTypeParametersBoundOutside = (
  type: Type,
  introducibleTypeParameterIdentities: Option<ReadonlySet<symbol>>,
  typeParameterIdentitiesReferredTo: Option<ReadonlySet<symbol>>,
): ReadonlySet<Atom> =>
  option.match(introducibleTypeParameterIdentities, {
    none: _ => new Set(),
    some: introducibleIdentities =>
      new Set(
        containedTypeParameters(type)
          .values()
          .flatMap(({ typeParameters }) => typeParameters.members)
          .filter(
            typeParameter =>
              !introducibleIdentities.has(typeParameter.identity) &&
              option.match(typeParameterIdentitiesReferredTo, {
                none: _ => true,
                some: referredTo => referredTo.has(typeParameter.identity),
              }),
          )
          .map(typeParameter =>
            option.match(typeParameter.valueKeyPath, {
              none: _ => typeParameter.name,
              some: ([rootKey]) => rootKey,
            }),
          ),
      ),
  })

/**
 * `name` if it isn't in use, otherwise `name2`, `name3`, etc.
 */
const firstUnusedName = (
  name: Atom,
  namesInUse: ReadonlySet<Atom>,
  suffix = 1,
): Atom => {
  const candidate = suffix === 1 ? name : `${name}${suffix}`
  return namesInUse.has(candidate) ?
      firstUnusedName(name, namesInUse, suffix + 1)
    : candidate
}

type TypeParameterRenderingState = {
  /**
   * Type parameters introduced so far. Mutable because it has to be visible to
   * occurrences elsewhere in the type.
   */
  readonly alreadyIntroducedTypeParameterIdentities: Set<symbol>
  /**
   * Names for type parameters that differ from those of the other type
   * parameters in scope even when the type parameters' own names don't. Mutable
   * for the same reason as `alreadyIntroducedTypeParameterIdentities`.
   */
  readonly typeParameterNames: Map<symbol, Atom>
  /**
   * Names introduced type parameters mustn't be written with, because the
   * rendered type uses them to refer to something else.
   */
  readonly reservedNames: ReadonlySet<Atom>
  /**
   * When present, only these type parameters are "introduced" in the rendered
   * type (displayed with their constraint); others are rendered as references.
   * When `none`, all parameters are introduced at their first occurrence.
   */
  readonly introducibleTypeParameterIdentities: Option<ReadonlySet<symbol>>
  /**
   * When present, all type parameters except these are written as concrete
   * types (their constraints).
   */
  readonly typeParameterIdentitiesReferredTo: Option<ReadonlySet<symbol>>
  /**
   * Called with a type parameter's identity for each occurrence that's a bare
   * reference (like the `:a` in `(?a: :Integer) ~> :a`).
   */
  readonly rememberReferenceToTypeParameter: (identity: symbol) => void
  /**
   * Whether the type is in an `@if`.
   */
  readonly withinConditional: boolean
  /**
   * Type parameters that enclosing function types bind. Nested function types
   * don't bind these again, because calling the enclosing function fixes them.
   */
  readonly typeParameterIdentitiesBoundByEnclosingFunctionTypes: ReadonlySet<symbol>
}

const typeToSemanticGraphImplementation = (
  unsimplifiedType: Type,
  state: TypeParameterRenderingState,
): SemanticGraph => {
  const type = simplifyType(unsimplifiedType)
  const {
    alreadyIntroducedTypeParameterIdentities,
    typeParameterNames,
    reservedNames,
    introducibleTypeParameterIdentities,
    typeParameterIdentitiesReferredTo,
    rememberReferenceToTypeParameter,
    withinConditional,
    typeParameterIdentitiesBoundByEnclosingFunctionTypes,
  } = state

  const recurseWithSameTypeParameters = (type: Type) =>
    typeToSemanticGraphImplementation(type, state)

  /**
   * A function type binds the type parameters its parameter mentions (unless an
   * enclosing function type already does). For example, when two functions
   * share a type parameter (as standard library functions can), each introduces
   * its own `?a` rather than the second referring to the first's.
   */
  const functionTypeWithItsOwnIntroductions = (
    type: FunctionType,
  ): SemanticGraph => {
    const mentionedByParameter = typeParameterIdentitiesWithinType(
      type.signature.parameter,
    )
    const boundHere = option
      .match(introducibleTypeParameterIdentities, {
        none: _ => mentionedByParameter,
        some: introducibleIdentities =>
          mentionedByParameter.intersection(introducibleIdentities),
      })
      .difference(typeParameterIdentitiesBoundByEnclosingFunctionTypes)
    const introducedOutside = boundHere.intersection(
      alreadyIntroducedTypeParameterIdentities,
    )
    const stateWithinFunctionType = {
      ...state,
      typeParameterIdentitiesBoundByEnclosingFunctionTypes:
        typeParameterIdentitiesBoundByEnclosingFunctionTypes.union(boundHere),
    }
    // Side effect: scope introductions to this function type. Ones made outside
    // it are set aside while it's rendered and restored afterwards, and ones
    // made within it are forgotten.
    boundHere.forEach(identity =>
      alreadyIntroducedTypeParameterIdentities.delete(identity),
    )
    const rendered = makeFunctionExpression(
      objectNodeFromOrderedEntries([
        [
          ignoredKey,
          typeToSemanticGraphImplementation(
            type.signature.parameter,
            stateWithinFunctionType,
          ),
        ],
      ]),
      typeToSemanticGraphImplementation(
        type.signature.return,
        stateWithinFunctionType,
      ),
    )
    boundHere.forEach(identity =>
      alreadyIntroducedTypeParameterIdentities.delete(identity),
    )
    introducedOutside.forEach(identity =>
      alreadyIntroducedTypeParameterIdentities.add(identity),
    )
    return rendered
  }

  const recurseWithinConditional = (type: Type) =>
    typeToSemanticGraphImplementation(type, {
      ...state,
      withinConditional: true,
    })

  const isBoundOutsideType = (typeParameter: TypeParameter): boolean =>
    option.match(introducibleTypeParameterIdentities, {
      none: _ => false,
      some: identities => !identities.has(typeParameter.identity),
    })

  const constraintIsNotWorthStating = (typeParameter: TypeParameter): boolean =>
    withinConditional ||
    isCanonicalTopType(typeParameter.constraint.assignableTo)

  const isReferredTo = (typeParameter: TypeParameter): boolean =>
    option.match(typeParameterIdentitiesReferredTo, {
      none: _ => true,
      some: identities => identities.has(typeParameter.identity),
    })

  const nameOfIntroducedTypeParameter = (
    typeParameter: TypeParameter,
  ): Atom => {
    const existingName = typeParameterNames.get(typeParameter.identity)
    if (existingName !== undefined) {
      return existingName
    } else {
      // Only type parameters introduced so far and still in scope (e.g. not
      // those of a sibling function type) could be confused with this one.
      const name = firstUnusedName(
        typeParameter.name,
        new Set([
          ...reservedNames,
          ...alreadyIntroducedTypeParameterIdentities
            .values()
            .flatMap(identity => {
              const nameInScope = typeParameterNames.get(identity)
              return nameInScope === undefined ? [] : [nameInScope]
            }),
        ]),
      )
      // Side effect: remember the name, so occurrences of the same type
      // parameter use it.
      typeParameterNames.set(typeParameter.identity, name)
      return name
    }
  }

  /**
   * A stuck application is typically shown as its upper bound. `@if` conditions
   * are an exception because reducing them (usually to `false | true`) obscures
   * what the conditional depends on.
   */
  const conditionAsWritten = (condition: Type): SemanticGraph =>
    condition.kind === 'intrinsicApplication' ?
      option.match(condition.functionKeyPath, {
        none: _ => recurseWithinConditional(condition),
        some: functionKeyPath =>
          condition.parameterTypes.reduce<SemanticGraph>(
            (partiallyApplied, parameterType) =>
              makeApplyExpression({
                function: partiallyApplied,
                argument: recurseWithinConditional(parameterType),
              }),
            keyPathToLookupExpression(functionKeyPath),
          ),
      })
    : recurseWithinConditional(condition)

  return option.match(canonicalSpellingOf(type), {
    none: _ =>
      matchTypeFormat(type, {
        application: type =>
          makeApplyExpression({
            function: recurseWithSameTypeParameters(type.function),
            argument: recurseWithSameTypeParameters(type.argument),
          }),
        function: functionTypeWithItsOwnIntroductions,
        indexedAccess: type =>
          option.match(conditionalBranches(type), {
            // Convert conditional indexed access types to `@if` expressions.
            some: branches =>
              makeIfExpression({
                condition: conditionAsWritten(type.key),
                then: recurseWithinConditional(branches.then),
                else: recurseWithinConditional(branches.else),
              }),
            none: _ =>
              makeIndexExpression({
                object: recurseWithSameTypeParameters(type.object),
                query: objectNodeFromOrderedEntries([
                  ['0', recurseWithSameTypeParameters(type.key)],
                ]),
              }),
          }),
        object: type => {
          const properties = objectNodeFromOrderedEntries(
            Object.entries(type.children).map(([key, value]) => [
              key,
              recurseWithSameTypeParameters(value),
            ]),
          )
          // Open objects become plain literals; excess bounds are written as
          // `@object` expressions.
          const [firstClause, ...remainingClauses] = type.excess
          const isOpen =
            firstClause === undefined ||
            (remainingClauses.length === 0 &&
              firstClause.keys === types.atom &&
              isCanonicalTopType(firstClause.values))
          return isOpen ? properties : (
              makeObjectTypeExpression(
                properties,
                objectNodeFromOrderedEntries(
                  type.excess.map((clause, index) => [
                    String(index),
                    objectNodeFromOrderedEntries([
                      ['0', recurseWithSameTypeParameters(clause.keys)],
                      ['1', recurseWithSameTypeParameters(clause.values)],
                    ]),
                  ]),
                ),
              )
            )
        },
        // A stuck intrinsic application is displayed as its (concrete) upper bound,
        // which is also how it behaves for assignability.
        intrinsicApplication: type =>
          recurseWithSameTypeParameters(
            type.computeUpperBound(type.parameterTypes),
          ),
        opaque: type => typeSymbolToSemanticGraph(type.symbol),
        parameter: type => {
          if (
            alreadyIntroducedTypeParameterIdentities.has(type.identity) ||
            (isBoundOutsideType(type) && constraintIsNotWorthStating(type))
          ) {
            rememberReferenceToTypeParameter(type.identity)
            return isBoundOutsideType(type) ?
                referenceToTypeParameterBoundOutsideType(type)
              : makeLookupExpression(nameOfIntroducedTypeParameter(type))
          } else if (!isReferredTo(type)) {
            // Type parameters occurring only once are shown as their constraints.
            return recurseWithSameTypeParameters(type.constraint.assignableTo)
          } else {
            // Side effect: remember the type parameter. This is a direct mutation
            // because it needs to be visible to usages not in this call stack.
            alreadyIntroducedTypeParameterIdentities.add(type.identity)
            if (isBoundOutsideType(type)) {
              return makeCheckExpression({
                value: referenceToTypeParameterBoundOutsideType(type),
                type: recurseWithSameTypeParameters(
                  type.constraint.assignableTo,
                ),
              })
            } else {
              const name = nameOfIntroducedTypeParameter(type)
              return makeHoleExpressionWithExtantTypeParameter(
                name,
                makeObjectNode({
                  assignableTo: recurseWithSameTypeParameters(
                    type.constraint.assignableTo,
                  ),
                }),
                type,
              )
            }
          }
        },
        union: type => {
          if (isCanonicalTopType(type)) {
            return typeSymbolToSemanticGraph(somethingTypeSymbol)
          } else {
            const [firstMember, ...remainingMembers] = type.members
            if (firstMember !== undefined && remainingMembers.length === 0) {
              // Unwrap singleton unions.
              return typeof firstMember === 'string' ? firstMember : (
                  recurseWithSameTypeParameters(firstMember)
                )
            } else {
              return makeUnionExpression(
                objectNodeFromOrderedEntries(
                  [...type.members]
                    .flatMap(member =>
                      membersOfRenderedType(
                        typeof member === 'string' ? member : (
                          recurseWithSameTypeParameters(member)
                        ),
                      ),
                    )
                    .map((renderedMember, index) => [
                      String(index),
                      renderedMember,
                    ]),
                ),
              )
            }
          }
        },
      }),
    some: ({ name, typeArguments }) =>
      typeArguments.reduce<SemanticGraph>(
        (partiallyApplied, typeArgument) =>
          makeApplyExpression({
            function: partiallyApplied,
            argument: recurseWithSameTypeParameters(typeArgument),
          }),
        makeLookupExpression(name),
      ),
  })
}

// These options primarily exist to tune how types are rendered in tooltips vs
// error messages.
export type TypeRenderingOptions = {
  /**
   * The type parameters in scope where the type is shown. When present, a type
   * parameter is introduced (`(?a: constraint)`) only if it isn't in scope;
   * others are written as references (`:a`). When absent, all type parameters
   * are introduced at first occurrence.
   */
  readonly typeParametersInScope?: ReadonlySet<symbol>
  /**
   * Write type parameters occurring exactly once as their constraints, e.g.
   * `(?a: :Integer) ~> :Integer` is `:Integer ~> :Integer`.
   */
  readonly unreferencedTypeParametersAsConstraints?: boolean
}

const membersOfRenderedType = (
  renderedType: SemanticGraph,
): readonly SemanticGraph[] => {
  const nestedMembers = either.match(readUnionExpression(renderedType), {
    left: _ => [],
    right: unionExpression =>
      orderedEntriesOfObjectNode(unionExpression[1]).map(
        ([_key, member]) => member,
      ),
  })
  return nestedMembers.length === 0 ? [renderedType] : nestedMembers
}

export const stringifyTypeForEndUser = (
  type: Type,
  notation: Notation = inlinePlz,
  options: TypeRenderingOptions = {},
): string =>
  stringifySemanticGraphForEndUser(typeToSemanticGraph(type, options), notation)

/**
 * Like `stringifyTypeForEndUser`, but stuck applications are first replaced with
 * what they would produce if they were reduced now.
 */
export const stringifyResolvedTypeForEndUser = (
  type: Type,
  notation: Notation = inlinePlz,
  options: TypeRenderingOptions = {},
): string =>
  stringifyTypeForEndUser(
    withStuckApplicationsResolved(type),
    notation,
    options,
  )

export const typeSymbolToSemanticGraph = (typeSymbol: TypeSymbol): ObjectNode =>
  makeLookupExpression(
    (() => {
      switch (typeSymbol) {
        case atomTypeSymbol:
          return 'Atom'
        case integerTypeSymbol:
          return 'Integer'
        case naturalNumberTypeSymbol:
          return 'NaturalNumber'
        case pendingTypeSymbol:
          // There isn't actually a user-facing thing named `:Unresolved`.
          // TODO: Maybe there should be? Or alternatively this could return a
          // special internal value that serialization knows to emit as a
          // non-utterable expression (e.g. `#Unresolved` without quotes).
          return 'Unresolved'
        case somethingTypeSymbol:
          return 'Something'
      }
    })(),
  )

const referenceToTypeParameterBoundOutsideType = (
  typeParameter: TypeParameter,
): SemanticGraph =>
  // Type parameters that are reachable via a key path (e.g. `:x.a` in the body
  // of `(x: { a: :Atom, b: :Atom }) => …` are printed as index expressions.
  option.match(typeParameter.valueKeyPath, {
    none: _ => makeLookupExpression(typeParameter.name),
    some: keyPathToLookupExpression,
  })

/**
 * Returns a `some` of the conditional branches when the type is `@if`-like
 * (it's an indexed access type with `true` and `false` properties).
 */
const conditionalBranches = (
  type: IndexedAccessType,
): Option<{ readonly then: Type; readonly else: Type }> => {
  if (type.object.kind !== 'object') {
    return option.none
  } else {
    const thenBranch = type.object.children['true']
    const elseBranch = type.object.children['false']
    return (
        thenBranch === undefined ||
          elseBranch === undefined ||
          Object.keys(type.object.children).length !== 2
      ) ?
        option.none
      : option.makeSome({ then: thenBranch, else: elseBranch })
  }
}

const syntaxTreeToSemanticGraph = (
  syntaxTree: Atom | Molecule,
): ObjectNode | Atom =>
  typeof syntaxTree === 'string' ? syntaxTree : (
    objectNodeFromMolecule(syntaxTree)
  )
