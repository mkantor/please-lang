import either from '@matt.kantor/either'
import type { Parser } from '@matt.kantor/parsing'
import {
  stringifyKeyPathForInternalUse,
  type KeyPathStringifiedForInternalUse,
} from '../semantics.js'
import type { Span } from '../source-location.js'
import type { Atom } from './atom.js'
import type { Molecule } from './expression.js'

/**
 * Maps parsed expressions' key paths to their source spans.
 */
export type ExpressionSpansByLocation = ReadonlyMap<
  KeyPathStringifiedForInternalUse,
  Span
>

// Each parsed molecule's source span is stashed in here (by identity) while
// parsing. The `WeakMap` allows entries to be garbage-collected once their
// syntax tree is no longer needed.
const spanByMolecule = new WeakMap<Molecule, Span>()

/**
 * Wrap the given parser so every nesting level records the spans of produced
 * molecules as a side effect.
 */
export const recordExpressionSpan =
  (parser: Parser<Atom | Molecule>): Parser<Atom | Molecule> =>
  (input, offset = 0n) =>
    either.map(parser(input, offset), success => {
      // Atoms are strings and can't key a `WeakMap`; only molecules get spans.
      if (typeof success.output !== 'string') {
        // Side effect: keep track of the span.
        spanByMolecule.set(success.output, [
          Number(offset),
          Number(success.offset),
        ])
      }
      return success
    })

export const spansFromSyntaxTree = (
  tree: Atom | Molecule,
): ExpressionSpansByLocation => new Map(spanEntriesWithinSubtree(tree, []))

const spanEntriesWithinSubtree = (
  node: Atom | Molecule,
  keyPath: readonly Atom[],
): readonly (readonly [KeyPathStringifiedForInternalUse, Span])[] => {
  if (typeof node === 'string') {
    return []
  } else {
    const spanForThisMolecule = spanByMolecule.get(node)
    const entryForThisMolecule =
      spanForThisMolecule === undefined ? undefined : (
        ([
          stringifyKeyPathForInternalUse(keyPath),
          spanForThisMolecule,
        ] as const)
      )
    const entriesForChildren = node.entries.flatMap(([key, value]) =>
      spanEntriesWithinSubtree(value, [...keyPath, key]),
    )

    return entryForThisMolecule === undefined ? entriesForChildren : (
        [entryForThisMolecule, ...entriesForChildren]
      )
  }
}
