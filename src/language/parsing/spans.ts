import either from '@matt.kantor/either'
import type { Parser } from '@matt.kantor/parsing'
import type { OrderedRecord } from '../../ordered-record.js'
import * as orderedRecord from '../../ordered-record.js'
import { withPhantomData, type WithPhantomData } from '../../phantom-data.js'
import {
  stringifyKeyPathForInternalUse,
  type KeyPath,
  type KeyPathStringifiedForInternalUse,
} from '../semantics.js'
import type { Span } from '../source-location.js'
import type { Atom } from './atom.js'
import type { SyntaxTree } from './syntax-tree.js'

declare const _isExpressionSpans: unique symbol
type IsExpressionSpans = {
  readonly [_isExpressionSpans]: true
}

/**
 * Maps parsed expressions' key paths to their source spans.
 */
export type ExpressionSpans = WithPhantomData<
  ReadonlyMap<KeyPathStringifiedForInternalUse, Span>,
  IsExpressionSpans
>

declare const _isPropertyKeySpans: unique symbol
type IsPropertyKeySpans = {
  readonly [_isPropertyKeySpans]: true
}

/**
 * Maps parsed properties' key paths to the spans of the keys.
 */
export type PropertyKeySpans = WithPhantomData<
  ReadonlyMap<KeyPathStringifiedForInternalUse, Span>,
  IsPropertyKeySpans
>

export type SourceSpans = {
  readonly spans: ExpressionSpans
  readonly propertyKeySpans: PropertyKeySpans
}

/**
 * A parse tree in which every node carries its source span. `span` is the
 * region a node covers, or `undefined` for synthetic nodes introduced by
 * desugaring.
 */
export type SpannedAtom = {
  readonly span: Span | undefined
  readonly value: Atom
}
export type SpannedMolecule = {
  readonly span: Span | undefined
  readonly value: OrderedRecord<SpannedTree>
  readonly keySpans: ReadonlyMap<Atom, Span>
}
export type SpannedTree = SpannedAtom | SpannedMolecule

/**
 * Wrap a leaf atom parser so each parsed atom records its exact source span.
 */
export const spannedAtom =
  (parser: Parser<Atom>): Parser<SpannedAtom> =>
  (input, offset = 0n) =>
    either.map(parser(input, offset), success => ({
      offset: success.offset,
      furthestFailure: success.furthestFailure,
      output: {
        span: spanFromOffsets(offset, success.offset),
        value: success.output,
      },
    }))

/**
 * Override the produced node's span with the source region it consumed. Used at
 * the expression-nesting sites to capture leading sigils (`:`, `@`) and
 * delimiters (`{}`, `()`) that a node's children don't cover.
 */
export const recordSpan =
  (parser: Parser<SpannedTree>): Parser<SpannedTree> =>
  (input, offset = 0n) =>
    either.map(parser(input, offset), success => ({
      offset: success.offset,
      furthestFailure: success.furthestFailure,
      output: {
        ...success.output,
        span: spanFromOffsets(offset, success.offset),
      },
    }))

/**
 * Like `recordSpan`, but for a node built around one which was already parsed
 * (e.g. the `@check` which `a ~ b` builds around `a`). The produced node spans
 * from where `initialNode` began through the end of what `parser` consumed.
 */
export const recordSpanExtending =
  (initialNode: SpannedTree) =>
  (parser: Parser<SpannedTree>): Parser<SpannedTree> =>
  (input, offset = 0n) =>
    either.map(parser(input, offset), success => ({
      offset: success.offset,
      furthestFailure: success.furthestFailure,
      output:
        initialNode.span === undefined ?
          success.output
        : {
            ...success.output,
            span: spanEndingAt(initialNode.span, success.offset),
          },
    }))

/**
 * Build a synthetic atom node (no source span of its own).
 */
export const syntheticAtom = (value: Atom): SpannedAtom => ({
  span: undefined,
  value,
})

/**
 * Build a synthetic molecule node (no source span of its own).
 */
export const syntheticMolecule = (
  entries: Iterable<readonly [string, SpannedTree]>,
): SpannedMolecule => ({
  span: undefined,
  value: orderedRecord.make(entries),
  keySpans: emptyKeySpans,
})

export const moleculeWithSpannedKeys = (
  entries: readonly (readonly [SpannedAtom, SpannedTree])[],
): SpannedMolecule => {
  // A key's last occurrence determines its value (see `orderedRecord.make`).
  const spansOfLastOccurrences = new Map(
    entries.map(([key]) => [key.value, key.span]),
  )
  return {
    span: undefined,
    value: orderedRecord.make(
      entries.map(([key, value]) => [key.value, value]),
    ),
    keySpans: new Map(
      [...spansOfLastOccurrences].flatMap(
        ([key, span]): readonly (readonly [Atom, Span])[] =>
          span === undefined ? [] : [[key, span]],
      ),
    ),
  }
}

/**
 * Drop spans from the syntax tree.
 */
export const toSyntaxTree = (node: SpannedTree): SyntaxTree =>
  isSpannedMolecule(node) ?
    orderedRecord.mapValues(node.value, toSyntaxTree)
  : node.value

const asExpressionSpans = withPhantomData<IsExpressionSpans>()
const asPropertyKeySpans = withPhantomData<IsPropertyKeySpans>()

export const spansFromSpannedTree = (tree: SpannedTree): SourceSpans => ({
  spans: asExpressionSpans(new Map(spanEntries(tree, []))),
  propertyKeySpans: asPropertyKeySpans(
    new Map(propertyKeySpanEntries(tree, [])),
  ),
})

export const emptyExpressionSpans: ExpressionSpans = asExpressionSpans(
  new Map(),
)

/** Shared because the parser builds tons of synthetic molecules. */
const emptyKeySpans: ReadonlyMap<Atom, Span> = new Map()

const spanFromOffsets = (start: bigint, end: bigint): Span => [
  Number(start),
  Number(end),
]

const spanEndingAt = (span: Span, end: bigint): Span => [span[0], Number(end)]

const isSpannedMolecule = (node: SpannedTree): node is SpannedMolecule =>
  typeof node.value !== 'string'

type SpanEntry = readonly [KeyPathStringifiedForInternalUse, Span]

// Recursively find all spans within the given `node`.
const spanEntries = (
  node: SpannedTree,
  keyPath: KeyPath,
): readonly SpanEntry[] => {
  const descendantSpanEntries =
    isSpannedMolecule(node) ?
      node.value.entries.flatMap(([key, value]) =>
        spanEntries(value, [...keyPath, key]),
      )
    : []
  return node.span === undefined ?
      descendantSpanEntries
    : [
        [stringifyKeyPathForInternalUse(keyPath), node.span],
        ...descendantSpanEntries,
      ]
}

// Recursively find the spans of all written property keys within `node`.
const propertyKeySpanEntries = (
  node: SpannedTree,
  keyPath: KeyPath,
): readonly SpanEntry[] =>
  isSpannedMolecule(node) ?
    node.value.entries.flatMap(([key, value]) => {
      const keyPathOfProperty = [...keyPath, key]
      const keySpan = node.keySpans.get(key)
      const ownEntries: readonly SpanEntry[] =
        keySpan === undefined ?
          []
        : [[stringifyKeyPathForInternalUse(keyPathOfProperty), keySpan]]
      return [
        ...ownEntries,
        ...propertyKeySpanEntries(value, keyPathOfProperty),
      ]
    })
  : []
