import either, { type Either } from '@matt.kantor/either'
import option, { type Option } from '@matt.kantor/option'
import type { ElaborationError } from '../../errors.js'
import type { Atom } from '../../parsing.js'
import type { ExpressionContext } from '../expression-elaboration.js'
import { isExpression, isKeywordExpressionWithArgument } from '../expression.js'
import {
  arrayToMolecule,
  type KeyPath,
  type NonEmptyKeyPath,
} from '../key-path.js'
import {
  makeObjectNode,
  objectNodeFromMolecule,
  type ObjectNode,
} from '../object-node.js'
import { prelude } from '../prelude.js'
import {
  applyKeyPathToSemanticGraph,
  stringifySemanticGraphForEndUser,
  type SemanticGraph,
} from '../semantic-graph.js'
import {
  ignoredKey,
  readArgumentsFromExpression,
  stringifyKeyForEndUser,
} from './expression-utilities.js'
import {
  getParameterName,
  getParameterTypeAnnotation,
  readFunctionExpression,
} from './function-expression.js'
import { collectHolesByName, type HoleExpression } from './hole-expression.js'
import { makeIndexExpression } from './index-expression.js'

export type LookupExpression = ObjectNode & {
  readonly 0: '@lookup'
  readonly 1: {
    readonly key: Atom
  }
}

export const readLookupExpression = (
  node: SemanticGraph,
): Either<ElaborationError, LookupExpression> =>
  isKeywordExpressionWithArgument('@lookup', node) ?
    either.flatMap(readArgumentsFromExpression(node, ['key']), ([key]) => {
      if (typeof key !== 'string') {
        return either.makeLeft({
          kind: 'invalidExpression',
          message: `lookup key must be an atom, got \`${stringifySemanticGraphForEndUser(
            key,
          )}\``,
        })
      } else {
        return either.makeRight(makeLookupExpression(key))
      }
    })
  : either.makeLeft({
      kind: 'invalidExpression',
      message: 'not a `@lookup` expression',
    })

export const makeLookupExpression = (key: Atom): LookupExpression =>
  makeObjectNode({
    0: '@lookup',
    1: makeObjectNode({ key }),
  })

export const keyPathToLookupExpression = (keyPath: NonEmptyKeyPath) => {
  const [initialKey, ...indexes] = keyPath
  const initialLookup = makeLookupExpression(initialKey)
  if (indexes.length === 0) {
    return initialLookup
  } else {
    return makeIndexExpression({
      object: initialLookup,
      query: objectNodeFromMolecule(arrayToMolecule(indexes)),
    })
  }
}

/**
 * Recursively search upwards in lexical scope for the given `key`.
 */
export const lookup = ({
  context,
  key,
  inlineSelfReferences,
  useSite,
}: {
  readonly context: ExpressionContext
  readonly key: Atom
  /**
   * Return the actual value even when the lookup is a recursive self-reference.
   * Type inference needs this to be `true` (for example).
   */
  readonly inlineSelfReferences?: true | undefined
  /**
   * State accumulated by the lexical walk, used to detect whether the lookup is
   * self-referential.
   */
  readonly useSite?: {
    readonly location: KeyPath
    readonly crossedFunctionBoundary: boolean
  }
}): Either<
  ElaborationError,
  Option<{
    readonly foundLocation: 'prelude' | KeyPath
    readonly foundValue: SemanticGraph
    readonly foundHole: Option<HoleExpression>
    /**
     * Whether the binding's value contains the `@function` the lookup occurs
     * within (i.e. the lookup is a recursive self-reference).
     */
    readonly foundIsSelfReference: boolean
  }>
> => {
  const useSiteState = useSite ?? {
    location: context.location,
    crossedFunctionBoundary: false,
  }
  if (key === ignoredKey) {
    return either.makeLeft({
      kind: 'invalidExpression',
      message: `properties named \`${stringifyKeyForEndUser(key)}\` cannot be looked up`,
    })
  } else if (context.location.length === 0) {
    // Check the prelude.
    const valueFromPrelude = prelude[key]
    return valueFromPrelude === undefined ?
        either.makeRight(option.none)
      : either.makeRight(
          option.makeSome({
            foundLocation: 'prelude',
            foundValue: valueFromPrelude,
            foundHole: option.none,
            foundIsSelfReference: false,
          }),
        )
  } else {
    // Given the following program:
    // ```
    // {
    //  a1: …
    //  a2: {
    //    b1: …
    //    b2: … // we are here
    //  }
    // }
    // ```
    // If `context.location` is `['a2', 'b2']`, the current scope (containing
    // `b1`) is at `['a2']`, and the parent scope (containing `a1`) is at `[]`.
    const pathToCurrentScope = context.location.slice(0, -1)
    const pathToParentScope = pathToCurrentScope.slice(0, -1)

    // If parent is a keyword expression and the current scope's key is `1`, the
    // current scope is an expression argument.
    const expressionCurrentScopeIsArgumentOf = option.flatMap(
      option.filter(
        applyKeyPathToSemanticGraph(context.program, pathToParentScope),
        isExpression,
      ),
      parent =>
        pathToCurrentScope[pathToCurrentScope.length - 1] === '1' ?
          option.makeSome(parent)
        : option.none,
    )

    type LookupResult =
      | {
          readonly kind: 'found'
          readonly foundValue: SemanticGraph
          readonly foundLocation: KeyPath
          readonly foundHole: Option<HoleExpression>
          readonly foundIsSelfReference: boolean
        }
      | {
          readonly kind: 'notFound'
          readonly nextLocationToCheckFrom: KeyPath
          readonly exitedFunctionScope: boolean
        }

    const result: LookupResult = option.match(
      expressionCurrentScopeIsArgumentOf,
      {
        some: parentExpression => {
          const parentFunctionResult = readFunctionExpression(parentExpression)
          // If enclosed in a `@function` expression, allow looking up the
          // parameter plus `@hole`s introduced by parameter annotations.
          const matchedHole: Option<HoleExpression> =
            (
              either.isRight(parentFunctionResult) &&
              getParameterName(parentFunctionResult.value) !== key
            ) ?
              option.flatMap(
                getParameterTypeAnnotation(parentFunctionResult.value),
                annotation => {
                  const hole = collectHolesByName(annotation).get(key)
                  return hole === undefined ?
                      option.none
                    : option.makeSome(hole)
                },
              )
            : option.none
          const isParameterMatch =
            (either.isRight(parentFunctionResult) &&
              getParameterName(parentFunctionResult.value) === key) ||
            option.isSome(matchedHole)
          if (isParameterMatch) {
            // Keep an unelaborated `@lookup` around for resolution when the
            // `@function` is called.
            return {
              kind: 'found',
              foundValue: makeLookupExpression(key),
              foundLocation: [...pathToCurrentScope, key],
              foundHole: matchedHole,
              foundIsSelfReference: false,
            }
          } else {
            return {
              kind: 'notFound',
              // Skip a level; don't consider expression properties as potential
              // `@lookup` targets.
              nextLocationToCheckFrom: pathToParentScope,
              exitedFunctionScope: either.isRight(parentFunctionResult),
            }
          }
        },
        none: _ =>
          option.match(
            option.flatMap(
              applyKeyPathToSemanticGraph(context.program, pathToCurrentScope),
              currentScope => applyKeyPathToSemanticGraph(currentScope, [key]),
            ),
            {
              some: (foundValue): LookupResult => {
                const foundLocation = [...pathToCurrentScope, key]
                const foundIsSelfReference =
                  useSiteState.crossedFunctionBoundary &&
                  isProperPrefixOf({
                    potentialPrefix: foundLocation,
                    path: useSiteState.location,
                  })
                return foundIsSelfReference && inlineSelfReferences !== true ?
                    // The looked-up value is self-referential, so keep it
                    // unelaborated. This won't trip during application because
                    // `apply` splices in a separate binding for the function.
                    {
                      kind: 'found',
                      foundValue: makeLookupExpression(key),
                      foundLocation,
                      foundHole: option.none,
                      foundIsSelfReference,
                    }
                  : {
                      kind: 'found',
                      foundValue,
                      foundLocation,
                      foundHole: option.none,
                      foundIsSelfReference,
                    }
              },
              none: _ => ({
                kind: 'notFound',
                nextLocationToCheckFrom: pathToCurrentScope,
                exitedFunctionScope: false,
              }),
            },
          ),
      },
    )

    if (result.kind === 'found') {
      return either.makeRight(
        option.makeSome({
          foundValue: result.foundValue,
          foundLocation: result.foundLocation,
          foundHole: result.foundHole,
          foundIsSelfReference: result.foundIsSelfReference,
        }),
      )
    } else {
      // Try the parent scope.
      return lookup({
        key,
        context: {
          configuration: context.configuration,
          keywordHandlers: context.keywordHandlers,
          location: result.nextLocationToCheckFrom,
          program: context.program,
          mutableInferenceCache: context.mutableInferenceCache,
          mutableFunctionParameterCache: context.mutableFunctionParameterCache,
          applicationChain: context.applicationChain,
        },
        inlineSelfReferences,
        useSite: {
          location: useSiteState.location,
          crossedFunctionBoundary:
            useSiteState.crossedFunctionBoundary || result.exitedFunctionScope,
        },
      })
    }
  }
}

const isProperPrefixOf = ({
  potentialPrefix,
  path,
}: {
  readonly potentialPrefix: KeyPath
  readonly path: KeyPath
}) =>
  potentialPrefix.length < path.length &&
  potentialPrefix.every((prefixKey, index) => prefixKey === path[index])
