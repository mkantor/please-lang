import either from '@matt.kantor/either'
import { makeUnionExpression } from '../expressions/union-expression.js'
import { objectNodeFromOrderedEntries } from '../object-node.js'
import { types } from '../type-system.js'
import {
  makeFunctionType,
  makeTypeParameter,
  makeUnionType,
} from '../type-system/type-formats.js'
import {
  anyValue,
  functionParameter,
  nodeIsOptionLike,
  optionParameter,
} from './parameters.js'
import {
  emptyContextForStdlibApplications,
  preludeFunction,
} from './stdlib-utilities.js'

const A = makeTypeParameter('a', { assignableTo: types.something })
const B = makeTypeParameter('b', { assignableTo: types.something })

export const option = {
  type: preludeFunction(
    ['option', 'type'],
    [anyValue(A)],
    types.option(A),
    value =>
      either.makeRight(
        makeUnionExpression(
          objectNodeFromOrderedEntries([
            [
              '0',
              objectNodeFromOrderedEntries([
                ['tag', 'some'],
                ['value', value],
              ]),
            ],
            [
              '1',
              objectNodeFromOrderedEntries([
                ['tag', 'none'],
                ['value', objectNodeFromOrderedEntries([])],
              ]),
            ],
          ]),
        ),
      ),
  ),

  none: objectNodeFromOrderedEntries([
    ['tag', 'none'],
    ['value', objectNodeFromOrderedEntries([])],
  ]),

  make_some: preludeFunction(
    ['option', 'make_some'],
    [anyValue(A)],
    types.option(A),
    value =>
      either.makeRight(
        objectNodeFromOrderedEntries([
          ['tag', 'some'],
          ['value', value],
        ]),
      ),
  ),

  // (a ~> b) ~> option(a) ~> option(b)
  map: preludeFunction(
    ['option', 'map'],
    [
      functionParameter(makeFunctionType({ parameter: A, return: B })),
      optionParameter(A),
    ],
    types.option(B),
    transform =>
      either.makeRight(optionValue =>
        optionValue.tag === 'none' ?
          either.makeRight(optionValue)
        : either.map(
            transform(optionValue.value, emptyContextForStdlibApplications),
            transformedValue =>
              objectNodeFromOrderedEntries([
                ['tag', 'some'],
                ['value', transformedValue],
              ]),
          ),
      ),
  ),

  // (a ~> option(b)) ~> option(a) ~> option(b)
  flat_map: preludeFunction(
    ['option', 'flat_map'],
    [
      functionParameter(
        makeFunctionType({ parameter: A, return: types.option(B) }),
      ),
      optionParameter(A),
    ],
    types.option(B),
    transform =>
      either.makeRight(optionValue =>
        optionValue.tag === 'none' ?
          either.makeRight(optionValue)
        : either.flatMap(
            transform(optionValue.value, emptyContextForStdlibApplications),
            transformedValue =>
              nodeIsOptionLike(transformedValue) ?
                either.makeRight(transformedValue)
              : either.makeLeft({
                  kind: 'typeMismatch',
                  message: '`flat_map` function did not return an option',
                }),
          ),
      ),
  ),

  get_or_else: preludeFunction(
    ['option', 'get_or_else'],
    [anyValue(B), optionParameter(A)],
    makeUnionType([A, B]),
    fallback =>
      either.makeRight(optionValue =>
        either.makeRight(
          optionValue.tag === 'none' ? fallback : optionValue.value,
        ),
      ),
  ),

  is_some: preludeFunction(
    ['option', 'is_some'],
    [optionParameter(types.something)],
    types.boolean,
    optionValue => either.makeRight(String(optionValue.tag === 'some')),
  ),

  is_none: preludeFunction(
    ['option', 'is_none'],
    [optionParameter(types.something)],
    types.boolean,
    optionValue => either.makeRight(String(optionValue.tag === 'none')),
  ),
} as const
