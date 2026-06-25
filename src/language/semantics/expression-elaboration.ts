import either, { type Either } from '@matt.kantor/either'
import option from '@matt.kantor/option'
import { withPhantomData, type WithPhantomData } from '../../phantom-data.js'
import type { Writable } from '../../utility-types.js'
import type { ElaborationError, InvalidSyntaxTreeError } from '../errors.js'
import type {
  Atom,
  ExpressionSpansByLocation,
  Molecule,
  SyntaxTree,
} from '../parsing.js'
import {
  asSemanticGraph,
  stringifyKeyPathForInternalUse,
  type Type,
} from '../semantics.js'
import type { Span } from '../source-location.js'
import {
  isExpression,
  isKeywordExpressionWithArgument,
  type Expression,
} from './expression.js'
import type { KeyPath } from './key-path.js'
import { isKeyword, type Keyword } from './keyword.js'
import {
  objectNodeFromMolecule,
  objectNodeFromOrderedEntries,
  orderedKeys,
  withProperty,
  type ObjectNode,
} from './object-node.js'
import {
  containsAnyUnelaboratedNodes,
  extractStringValueIfPossible,
  serialize,
  updateValueAtKeyPathInSemanticGraph,
  type SemanticGraph,
} from './semantic-graph.js'
import type { TypeKeyPathStringifiedForInternalUse } from './type-system.js'

declare const _elaborated: unique symbol
type Elaborated = { readonly [_elaborated]: true }
export type ElaboratedSemanticGraph = WithPhantomData<SemanticGraph, Elaborated>

/**
 * The (possibly genericized) type of a function's parameter, plus the
 * identities of the type parameters introduced by that specific function's
 * signature. Such type parameters are "rigid" within the function's body (they
 * aren't instantiated by applications occurring there).
 */
export type FunctionParameterTypeInfo = {
  readonly parameterType: Type
  readonly typeParametersBoundByFunction: ReadonlySet<symbol>
}

export type ExpressionContext = {
  readonly keywordHandlers: KeywordHandlers
  readonly location: KeyPath
  readonly program: SemanticGraph
  readonly mutableInferenceCache: Map<
    TypeKeyPathStringifiedForInternalUse,
    Type
  >
  readonly mutableFunctionParameterCache: Map<
    TypeKeyPathStringifiedForInternalUse,
    FunctionParameterTypeInfo
  >
  /**
   * Source spans for the program being elaborated, keyed by stringified key
   * path (matching `location`). This is used to attach spans to errors. It's
   * absent when elaborating from a sourceless origin.
   */
  readonly sourceSpans?: ExpressionSpansByLocation | undefined
  /**
   * `location` is typically both the origin for `@lookup`s and the prefix for
   * cache keys, but a few inference sites run with `location` pointing at a
   * scope other than the node's true position (e.g. function parameter
   * annotations are looked up from the function's scope rather than the
   * annotation's). For those, `cacheKeyPrefixOverride` is used.
   *
   * When this is `undefined`, `location` is used for cache keys.
   */
  readonly cacheKeyPrefixOverride?: KeyPath | undefined
  /**
   * Marks a context originating outside the program (e.g. functions called from
   * higher-order standard library functions).
   */
  readonly isExternalToProgram?: true | undefined
  readonly skipReelaboration?: true | undefined
  /**
   * When set, `@panic` returns its (un-elaborated) expression instead of
   * aborting.
   */
  readonly panicsAreDeferred?: true | undefined
}

export type KeywordElaborationResult = Either<ElaborationError, SemanticGraph>

export type KeywordHandler = (
  expression: Expression,
  context: ExpressionContext,
) => KeywordElaborationResult

export type KeywordHandlers = Readonly<Record<Keyword, KeywordHandler>>

export const elaborate = (
  program: SyntaxTree,
  keywordHandlers: KeywordHandlers,
  spans?: ExpressionSpansByLocation,
): Either<ElaborationError, ElaboratedSemanticGraph> =>
  elaborateWithContext(program, {
    keywordHandlers,
    location: [],
    mutableInferenceCache: new Map(),
    mutableFunctionParameterCache: new Map(),
    program:
      typeof program === 'string' ? program : objectNodeFromMolecule(program),
    sourceSpans: spans,
  })

export const elaborateWithContext = (
  program: SyntaxTree,
  context: ExpressionContext,
): Either<ElaborationError, ElaboratedSemanticGraph> =>
  either.map(
    typeof program === 'string' ?
      handleAtomWhichMayNotBeAKeyword(program)
    : elaborateWithinMolecule(program, context),
    withPhantomData<Elaborated>(),
  )

const elaborateWithinMolecule = (
  molecule: Molecule,
  context: ExpressionContext,
): Either<ElaborationError, SemanticGraph> => {
  const moleculeAsSemanticGraph = asSemanticGraph(molecule)

  // `@if` needs to be eagerly expanded to avoid evaluating the falsy branch.
  // TODO: Handle keywords in a generalized way, without hardcoding specific
  // keywords here.
  if (
    isExpression(moleculeAsSemanticGraph) &&
    moleculeAsSemanticGraph['0'] === '@if'
  ) {
    const expandedResult = either.flatMap(
      handleObjectNodeWhichMayBeAExpression(moleculeAsSemanticGraph, context),
      serialize,
    )
    return either.map(expandedResult, asSemanticGraph)
  } else {
    const childrenContext: ExpressionContext =
      isKeywordExpressionWithArgument('@function', moleculeAsSemanticGraph) ?
        {
          ...context,
          // `@panic`s inside functions shouldn't fire while elaborating the
          // body, only when the function is eventually called.
          panicsAreDeferred: true,
        }
      : context
    const possibleExpressionAsObjectNode: Writable<ObjectNode> =
      objectNodeFromOrderedEntries([])

    // Used to initialize the resulting `ObjectNode`'s `orderedKeys` sidecar.
    const orderedKeysAccumulator: Atom[] = []

    let updatedProgram = context.program
    const keysNeedingReelaboration = new Set<Atom>()
    let moleculeIsKeywordExpression = false

    for (const [key, value] of molecule.entries) {
      const keyUpdateResult = handleAtomWhichMayNotBeAKeyword(key)
      if (either.isLeft(keyUpdateResult)) {
        // Immediately bail on error.
        return keyUpdateResult
      } else {
        const updatedKey = keyUpdateResult.value
        if (typeof value === 'string') {
          if (!(updatedKey in possibleExpressionAsObjectNode)) {
            orderedKeysAccumulator.push(updatedKey)
          }
          possibleExpressionAsObjectNode[updatedKey] = value
          if (key === '0' && isKeyword(value)) {
            moleculeIsKeywordExpression = true
          }
        } else {
          const elaborationResult = elaborateWithinMolecule(value, {
            ...childrenContext,
            location: [...context.location, key],
            program: updatedProgram,
            skipReelaboration:
              context.skipReelaboration || moleculeIsKeywordExpression ?
                true
              : undefined,
          })
          if (either.isLeft(elaborationResult)) {
            // Immediately bail on error.
            return elaborationResult
          }

          const programUpdateResult = updateValueAtKeyPathInSemanticGraph(
            updatedProgram,
            [...context.location, key],
            _ => elaborationResult.value,
          )
          if (either.isRight(programUpdateResult)) {
            updatedProgram = programUpdateResult.value
          }
          if (!(updatedKey in possibleExpressionAsObjectNode)) {
            orderedKeysAccumulator.push(updatedKey)
          }
          possibleExpressionAsObjectNode[updatedKey] = elaborationResult.value
          if (
            typeof elaborationResult.value !== 'string' &&
            containsAnyUnelaboratedNodes(elaborationResult.value)
          ) {
            keysNeedingReelaboration.add(updatedKey)
          }
        }
      }
    }
    possibleExpressionAsObjectNode[orderedKeys] = orderedKeysAccumulator

    const {
      0: _possibleKeywordAsNode,
      ...propertiesInNeedOfFinalizationAsNodes
    } = possibleExpressionAsObjectNode

    // At this point `possibleExpressionAsObjectNode` may still have raw escape
    // sequences at the top level (whether it is an expression or not).
    for (const [key, value] of Object.entries(
      propertiesInNeedOfFinalizationAsNodes,
    )) {
      const cannotBeKeyword = extractStringValueIfPossible(value)
      if (!option.isNone(cannotBeKeyword)) {
        const valueUpdateResult = handleAtomWhichMayNotBeAKeyword(
          cannotBeKeyword.value,
        )
        if (either.isLeft(valueUpdateResult)) {
          // Immediately bail on error.
          return valueUpdateResult
        } else {
          const updatedValue = valueUpdateResult.value
          possibleExpressionAsObjectNode[key] = updatedValue
        }
      }
    }

    // Re-elaborate nodes which are still not fully-elaborated now that sibling
    // properties have been processed. This resolves forward references where a
    // `@lookup` is elaborated before its target (e.g. in a program like
    // `{ a: :b, b: :identity(42) }`, the `:b` lookup originally resolved to the
    // raw `:identity` application rather than its return value.
    //
    // Re-elaboration repeats until a fixed point is reached where no progress
    // is made (a chain of forward references may require multiple passes, and
    // cycles like `{ a: :a }` simply don't make progress). Only properties
    // whose elaboration produced unelaborated nodes are re-elaborated.
    //
    // The nested `elaborateWithContext` call uses `skipReelaboration` to
    // prevent cascading: without it, each re-elaborated subtree would run
    // its own re-elaboration loops, causing exponential blowup in recursive
    // programs.
    //
    // TODO: Consider less-imperative/more-functional approaches for this (and
    // also for elaboration as a whole).
    if (!context.skipReelaboration && !moleculeIsKeywordExpression) {
      let madeProgress = true
      while (madeProgress && keysNeedingReelaboration.size > 0) {
        madeProgress = false
        for (const key of keysNeedingReelaboration) {
          const value = possibleExpressionAsObjectNode[key]
          if (value === undefined) {
            keysNeedingReelaboration.delete(key)
            continue
          }
          const serialized = serialize(value)
          if (either.isLeft(serialized)) {
            continue
          }
          const reelaborationResult = elaborateWithContext(serialized.value, {
            ...childrenContext,
            location: [...context.location, key],
            program: updatedProgram,
            skipReelaboration: true,
          })
          if (
            either.isLeft(reelaborationResult) ||
            containsAnyUnelaboratedNodes(reelaborationResult.value)
          ) {
            continue
          }
          possibleExpressionAsObjectNode[key] = reelaborationResult.value
          const programUpdateResult = updateValueAtKeyPathInSemanticGraph(
            updatedProgram,
            [...context.location, key],
            _ => reelaborationResult.value,
          )
          if (either.isRight(programUpdateResult)) {
            updatedProgram = programUpdateResult.value
          }
          keysNeedingReelaboration.delete(key)
          madeProgress = true
        }
      }
    }

    const possibleKeyword = possibleExpressionAsObjectNode['0']
    if (possibleKeyword === undefined) {
      // The input didn't have a `0` property, so it's not an expression.
      return either.makeRight(possibleExpressionAsObjectNode)
    } else {
      return option.match(extractStringValueIfPossible(possibleKeyword), {
        none: () => {
          // The `0` property was not a string, so it's not an expression.
          return either.makeRight(possibleExpressionAsObjectNode)
        },
        some: possibleKeywordAsString =>
          handleObjectNodeWhichMayBeAExpression(
            {
              ...possibleExpressionAsObjectNode,
              0: possibleKeywordAsString,
            },
            {
              ...childrenContext,
              program: updatedProgram,
              location: context.location,
            },
          ),
      })
    }
  }
}

const handleObjectNodeWhichMayBeAExpression = (
  node: ObjectNode & { readonly 0: Atom },
  context: ExpressionContext,
): Either<ElaborationError, SemanticGraph> => {
  const possibleKeyword = node[0]
  return attachSpanIfAbsent(
    isKeyword(possibleKeyword) ?
      context.keywordHandlers[possibleKeyword](
        withProperty(node, '0', possibleKeyword),
        context,
      )
    : /^@[^@]/.test(possibleKeyword) ?
      either.makeLeft({
        kind: 'unknownKeyword',
        message: `unknown keyword: \`${possibleKeyword}\``,
      })
    : either.makeRight(
        withProperty(node, '0', unescapeKeywordSigil(possibleKeyword)),
      ),
    context,
  )
}

/**
 * Attach the current location's source span to a freshly-produced error,
 * leaving any already-attached (deeper, more specific) span untouched so the
 * innermost one wins.
 */
export const attachSpanIfAbsent = <Value>(
  result: Either<ElaborationError, Value>,
  context: ExpressionContext,
): Either<ElaborationError, Value> =>
  either.mapLeft(result, error => {
    if (error.span !== undefined) {
      return error
    } else {
      const span = spanForLocation(context.sourceSpans, context.location)
      if (span === undefined) {
        return error
      } else {
        return { ...error, span }
      }
    }
  })

/**
 * Resolve a location to its source span, walking up to the nearest enclosing
 * expression when the exact node has no recorded span.
 */
const spanForLocation = (
  spans: ExpressionSpansByLocation | undefined,
  location: KeyPath,
): Span | undefined =>
  spans === undefined ? undefined : (
    (spans.get(stringifyKeyPathForInternalUse(location)) ??
    (location.length === 0 ?
      undefined
    : spanForLocation(spans, location.slice(0, -1))))
  )

const handleAtomWhichMayNotBeAKeyword = (
  atom: Atom,
): Either<InvalidSyntaxTreeError, Atom> => {
  if (/^@[^@]/.test(atom)) {
    return either.makeLeft({
      kind: 'invalidSyntaxTree',
      message: `keywords cannot be used here: ${atom}`,
    })
  } else {
    return either.makeRight(unescapeKeywordSigil(atom))
  }
}

const unescapeKeywordSigil = (value: string) =>
  value.startsWith('@@') ? value.substring(1) : value
