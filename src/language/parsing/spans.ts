import either from '@matt.kantor/either'
import type { Parser } from '@matt.kantor/parsing'
import type { OrderedRecord } from '../../ordered-record.js'
import * as orderedRecord from '../../ordered-record.js'
import {
  stringifyKeyPathForInternalUse,
  type KeyPath,
  type KeyPathStringifiedForInternalUse,
} from '../semantics.js'
import type { Span } from '../source-location.js'
import type { Atom } from './atom.js'
import type { SyntaxTree } from './syntax-tree.js'

/**
 * Maps parsed expressions' key paths to their source spans.
 */
export type ExpressionSpansByLocation = ReadonlyMap<
  KeyPathStringifiedForInternalUse,
  Span
>

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
      output: {
        ...success.output,
        span: spanFromOffsets(offset, success.offset),
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
): SpannedMolecule => ({ span: undefined, value: orderedRecord.make(entries) })

/**
 * Drop spans from the syntax tree.
 */
export const toSyntaxTree = (node: SpannedTree): SyntaxTree =>
  typeof node.value === 'string' ?
    node.value
  : orderedRecord.mapValues(node.value, toSyntaxTree)

export const spansFromSpannedTree = (
  tree: SpannedTree,
): ExpressionSpansByLocation => new Map(spanEntries(tree, []))

const spanFromOffsets = (start: bigint, end: bigint): Span => [
  Number(start),
  Number(end),
]

// Recursively find all spans within the given `node`.
const spanEntries = (
  node: SpannedTree,
  keyPath: KeyPath,
): readonly (readonly [KeyPathStringifiedForInternalUse, Span])[] => {
  const descendantSpanEntries =
    typeof node.value === 'string' ?
      []
    : node.value.entries.flatMap(([key, value]) =>
        spanEntries(value, [...keyPath, key]),
      )
  return node.span === undefined ?
      descendantSpanEntries
    : [
        [stringifyKeyPathForInternalUse(keyPath), node.span],
        ...descendantSpanEntries,
      ]
}
