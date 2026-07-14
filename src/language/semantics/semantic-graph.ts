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
  makeApplyExpression,
  makeFunctionExpression,
  makeIndexExpression,
  makeLookupExpression,
  makeUnionExpression,
  readFunctionExpression,
  type Type,
} from '../semantics.js'
import { inlinePlz, unparse, type Notation } from '../unparsing.js'
import { isExpression } from './expression.js'
import { makeHoleExpressionWithExtantTypeParameter } from './expressions/hole-expression.js'
import { serializeFunctionNode, type FunctionNode } from './function-node.js'
import { isSemanticGraph } from './is-semantic-graph.js'
import { stringifyKeyPathForEndUser, type KeyPath } from './key-path.js'
import { isExemptFromElaboration, isKeyword } from './keyword.js'
import {
  makeObjectNode,
  objectNodeFromMolecule,
  objectNodeFromOrderedEntries,
  serializeObjectNode,
  withProperty,
  type ObjectNode,
} from './object-node.js'
import { nodeTag } from './semantic-graph-node-tag.js'
import {
  functionParameterKey,
  functionReturnKey,
  isTopType,
  matchTypeFormat,
  typeParameterAssignableToConstraintKey,
  type TypeKeyPath,
} from './type-system.js'
import {
  atomTypeSymbol,
  integerTypeSymbol,
  naturalNumberTypeSymbol,
  somethingTypeSymbol,
} from './type-system/prelude-types.js'

export type TypeSymbol =
  | typeof atomTypeSymbol
  | typeof integerTypeSymbol
  | typeof naturalNumberTypeSymbol
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
  type: Type,
  alreadyIntroducedTypeParameterIdentities: Set<symbol>,
): SemanticGraph => {
  const recurseWithSameTypeParameters = (type: Type) =>
    typeToSemanticGraph(type, alreadyIntroducedTypeParameterIdentities)
  return matchTypeFormat(type, {
    application: type =>
      makeApplyExpression({
        function: recurseWithSameTypeParameters(type.function),
        argument: recurseWithSameTypeParameters(type.argument),
      }),
    function: type =>
      makeFunctionExpression(
        objectNodeFromOrderedEntries([
          [ignoredKey, recurseWithSameTypeParameters(type.signature.parameter)],
        ]),
        recurseWithSameTypeParameters(type.signature.return),
      ),
    indexedAccess: type =>
      makeIndexExpression({
        object: recurseWithSameTypeParameters(type.object),
        query: objectNodeFromOrderedEntries([
          ['0', recurseWithSameTypeParameters(type.key)],
        ]),
      }),
    object: type =>
      objectNodeFromOrderedEntries(
        Object.entries(type.children).map(([key, value]) => [
          key,
          recurseWithSameTypeParameters(value),
        ]),
      ),
    // A stuck intrinsic application is displayed as its (concrete) upper bound,
    // which is also how it behaves for assignability.
    intrinsicApplication: type =>
      recurseWithSameTypeParameters(
        type.computeUpperBound(type.parameterTypes),
      ),
    opaque: type => typeSymbolToSemanticGraph(type.symbol),
    parameter: type => {
      if (alreadyIntroducedTypeParameterIdentities.has(type.identity)) {
        return makeLookupExpression(type.name)
      } else {
        // Side effect: remember the type parameter. This is a direct mutation
        // because it needs to be visible to usages not in this call stack.
        alreadyIntroducedTypeParameterIdentities.add(type.identity)
        return makeHoleExpressionWithExtantTypeParameter(
          type.name,
          makeObjectNode({
            assignableTo: recurseWithSameTypeParameters(
              type.constraint.assignableTo,
            ),
          }),
          type,
        )
      }
    },
    union: type => {
      if (isTopType(type)) {
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
              [...type.members].map((member, index) => [
                String(index),
                typeof member === 'string' ? member : (
                  recurseWithSameTypeParameters(member)
                ),
              ]),
            ),
          )
        }
      }
    },
  })
}

export const stringifyTypeForEndUser = (type: Type): string =>
  stringifySemanticGraphForEndUser(typeToSemanticGraph(type, new Set()))

export const typeSymbolToSemanticGraph = (typeSymbol: TypeSymbol): ObjectNode =>
  makeIndexExpression({
    query: objectNodeFromOrderedEntries([['0', 'type']]),
    object: (() => {
      switch (typeSymbol) {
        case atomTypeSymbol:
          return makeLookupExpression('atom')
        case integerTypeSymbol:
          return makeLookupExpression('integer')
        case naturalNumberTypeSymbol:
          return makeLookupExpression('natural_number')
        case somethingTypeSymbol:
          return makeLookupExpression('something')
      }
    })(),
  })

const syntaxTreeToSemanticGraph = (
  syntaxTree: Atom | Molecule,
): ObjectNode | Atom =>
  typeof syntaxTree === 'string' ? syntaxTree : (
    objectNodeFromMolecule(syntaxTree)
  )
