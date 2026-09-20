import either, { type Either } from '@matt.kantor/either'
import option, { type Option } from '@matt.kantor/option'
import * as orderedRecord from '../../ordered-record.js'
import { withPhantomData, type WithPhantomData } from '../../phantom-data.js'
import type { InvalidExpressionError } from '../errors.js'
import type { Atom, Molecule } from '../parsing.js'
import { inlinePlz, unparse } from '../unparsing.js'
import type { ObjectNode } from './object-node.js'
import { stringifySemanticGraphForEndUser } from './semantic-graph.js'

export type KeyPath = readonly Atom[]
export type NonEmptyKeyPath = readonly [Atom, ...KeyPath]

declare const _isKeyPathStringifiedForInternalUse: unique symbol
type IsKeyPathStringifiedForInternalUse = {
  readonly [_isKeyPathStringifiedForInternalUse]: true
}
export type KeyPathStringifiedForInternalUse = WithPhantomData<
  string,
  IsKeyPathStringifiedForInternalUse
>

export const stringifyKeyPathForEndUser = (keyPath: KeyPath): string =>
  either.match(unparse(arrayToMolecule(keyPath), inlinePlz), {
    right: stringifiedOutput => stringifiedOutput,
    left: error => `(unserializable key path: ${error.message})`,
  })

export const stringifyKeyPathForInternalUse = (
  keyPath: KeyPath,
): KeyPathStringifiedForInternalUse =>
  withPhantomData<IsKeyPathStringifiedForInternalUse>()(JSON.stringify(keyPath))

/** The inverse of `stringifyKeyPathForInternalUse`. */
export const keyPathFromInternalUse = (
  stringifiedKeyPath: KeyPathStringifiedForInternalUse,
): Option<KeyPath> => {
  const parsed: unknown = JSON.parse(stringifiedKeyPath)
  return isKeyPath(parsed) ? option.makeSome(parsed) : option.none
}

export const arrayToMolecule = (
  keyPath: readonly (Molecule | Atom)[],
): Molecule =>
  orderedRecord.make(keyPath.map((key, index) => [String(index), key]))

export const keyPathFromObjectNode = (
  node: ObjectNode,
): Either<InvalidExpressionError, KeyPath> => {
  const relativePath: string[] = []
  let queryIndex = 0
  // Consume numeric indexes ("0", "1", …) until exhausted, validating that each
  // is an atom.
  let key = node[queryIndex]
  while (key !== undefined) {
    if (typeof key !== 'string') {
      return either.makeLeft({
        kind: 'invalidExpression',
        message: `expected a key path composed of sequential atoms, got \`${stringifySemanticGraphForEndUser(node)}\``,
      })
    } else {
      relativePath.push(key)
    }
    queryIndex++
    key = node[queryIndex]
  }
  return either.makeRight(relativePath)
}

const isKeyPath = (value: unknown): value is KeyPath =>
  Array.isArray(value) && value.every(key => typeof key === 'string')
