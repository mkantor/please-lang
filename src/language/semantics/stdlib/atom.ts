import either from '@matt.kantor/either'
import {
  objectNodeFromOrderedEntries,
  orderedEntriesOfObjectNode,
} from '../object-node.js'
import { types } from '../type-system.js'
import { anyValue, atomParameter, objectParameter } from './parameters.js'
import { computeFromReturnType } from './return-type-refiners.js'
import { preludeFunction } from './stdlib-utilities.js'

export const atom = {
  type: types.atom.symbol,

  append: preludeFunction(
    ['atom', 'append'],
    [atomParameter, atomParameter],
    types.atom,
    atomToAppend =>
      either.makeRight(atomToAppendTo =>
        either.makeRight(atomToAppendTo + atomToAppend),
      ),
  ),

  // Note that this is simple string equality; e.g. `:atom.equals(1)(01)`
  // is `false`. For this reason it should not be aliased as a global `==`
  // operator or similar as its behavior may not be what users expect for all
  // types of values.
  equals: preludeFunction(
    ['atom', 'equals'],
    [atomParameter, atomParameter],
    types.boolean,
    atom2 =>
      either.makeRight(atom1 => either.makeRight(String(atom1 === atom2))),
  ),

  from: preludeFunction(
    ['atom', 'from'],
    [anyValue(types.something)],
    types.option(types.atom),
    argument =>
      either.makeRight(
        typeof argument === 'string' ?
          objectNodeFromOrderedEntries([
            ['tag', 'some'],
            ['value', argument],
          ])
        : objectNodeFromOrderedEntries([
            ['tag', 'none'],
            ['value', objectNodeFromOrderedEntries([])],
          ]),
      ),
    computeFromReturnType(types.atom),
  ),

  prepend: preludeFunction(
    ['atom', 'prepend'],
    [atomParameter, atomParameter],
    types.atom,
    atomToPrepend =>
      either.makeRight(atomToPrependTo =>
        either.makeRight(atomToPrepend + atomToPrependTo),
      ),
  ),

  length: preludeFunction(
    ['atom', 'length'],
    [atomParameter],
    types.naturalNumber,
    // Count codepoints rather than JavaScript's internal UTF-16 units.
    subject => either.makeRight(String(Array.from(subject).length)),
  ),

  contains: preludeFunction(
    ['atom', 'contains'],
    [atomParameter, atomParameter],
    types.boolean,
    needle =>
      either.makeRight(haystack =>
        either.makeRight(String(haystack.includes(needle))),
      ),
  ),

  starts_with: preludeFunction(
    ['atom', 'starts_with'],
    [atomParameter, atomParameter],
    types.boolean,
    prefix =>
      either.makeRight(subject =>
        either.makeRight(String(subject.startsWith(prefix))),
      ),
  ),

  ends_with: preludeFunction(
    ['atom', 'ends_with'],
    [atomParameter, atomParameter],
    types.boolean,
    suffix =>
      either.makeRight(subject =>
        either.makeRight(String(subject.endsWith(suffix))),
      ),
  ),

  join: preludeFunction(
    ['atom', 'join'],
    [atomParameter, objectParameter],
    types.atom,
    separator =>
      either.makeRight(list =>
        either.map(
          either.sequence(
            orderedEntriesOfObjectNode(list).map(([_key, value]) =>
              typeof value === 'string' ?
                either.makeRight(value)
              : either.makeLeft({
                  kind: 'typeMismatch',
                  message: '`join` expected every value to be an atom',
                }),
            ),
          ),
          values => values.join(separator),
        ),
      ),
  ),

  split: preludeFunction(
    ['atom', 'split'],
    [atomParameter, atomParameter],
    types.object,
    separator =>
      either.makeRight(subject =>
        either.makeRight(
          objectNodeFromOrderedEntries(
            subject
              .split(separator)
              .map((part, index) => [String(index), part]),
          ),
        ),
      ),
  ),
} as const
