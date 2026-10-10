import either from '@matt.kantor/either'
import { withDynamicEvaluationState } from '../expression-elaboration.js'
import { makeUnionExpression } from '../expressions/union-expression.js'
import { objectNodeFromOrderedEntries } from '../object-node.js'
import {
  makeFunctionType,
  makeTypeParameter,
  makeUnionType,
  types,
} from '../type-system.js'
import {
  anyValue,
  functionParameter,
  named,
  nodeIsOptionLike,
  parameterTypeParameter,
  optionParameter,
} from './parameters.js'
import {
  emptyContextForStdlibApplications,
  preludeFunction,
} from './stdlib-utilities.js'

const typeValue = parameterTypeParameter('value')

const makeSomeValue = parameterTypeParameter('value')

const mapValue = makeTypeParameter('value', { assignableTo: types.something })
const mapResult = makeTypeParameter('result', { assignableTo: types.something })

const flatMapValue = makeTypeParameter('value', {
  assignableTo: types.something,
})
const flatMapResult = makeTypeParameter('result', {
  assignableTo: types.something,
})

const getOrElseFallback = parameterTypeParameter('fallback')
const getOrElseValue = makeTypeParameter('value', {
  assignableTo: types.something,
})

export const option = {
  type: preludeFunction(
    ['option', 'type'],
    [named('value', anyValue(typeValue))],
    types.option(typeValue),
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
            ['1', objectNodeFromOrderedEntries([['tag', 'none']])],
          ]),
        ),
      ),
  ),

  none: objectNodeFromOrderedEntries([['tag', 'none']]),

  make_some: preludeFunction(
    ['option', 'make_some'],
    [named('value', anyValue(makeSomeValue))],
    types.option(makeSomeValue),
    value =>
      either.makeRight(
        objectNodeFromOrderedEntries([
          ['tag', 'some'],
          ['value', value],
        ]),
      ),
  ),

  // (?value ~> ?result) ~> :Option(:value) ~> :Option(:result)
  map: preludeFunction(
    ['option', 'map'],
    [
      named(
        'transform',
        functionParameter(
          makeFunctionType({ parameter: mapValue, return: mapResult }),
        ),
      ),
      named('subject', optionParameter(mapValue)),
    ],
    types.option(mapResult),
    transform =>
      either.makeRight((optionValue, contextOfApplication) =>
        optionValue.tag === 'none' ?
          either.makeRight(optionValue)
        : either.map(
            transform(
              optionValue.value,
              withDynamicEvaluationState(
                emptyContextForStdlibApplications,
                contextOfApplication,
              ),
            ),
            transformedValue =>
              objectNodeFromOrderedEntries([
                ['tag', 'some'],
                ['value', transformedValue],
              ]),
          ),
      ),
  ),

  // (?value ~> :Option(?result)) ~> :Option(:value) ~> :Option(:result)
  flat_map: preludeFunction(
    ['option', 'flat_map'],
    [
      named(
        'transform',
        functionParameter(
          makeFunctionType({
            parameter: flatMapValue,
            return: types.option(flatMapResult),
          }),
        ),
      ),
      named('subject', optionParameter(flatMapValue)),
    ],
    types.option(flatMapResult),
    transform =>
      either.makeRight((optionValue, contextOfApplication) =>
        optionValue.tag === 'none' ?
          either.makeRight(optionValue)
        : either.flatMap(
            transform(
              optionValue.value,
              withDynamicEvaluationState(
                emptyContextForStdlibApplications,
                contextOfApplication,
              ),
            ),
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
    [
      named('fallback', anyValue(getOrElseFallback)),
      named('subject', optionParameter(getOrElseValue)),
    ],
    makeUnionType([getOrElseValue, getOrElseFallback]),
    fallback =>
      either.makeRight(optionValue =>
        either.makeRight(
          optionValue.tag === 'none' ? fallback : optionValue.value,
        ),
      ),
  ),

  is_some: preludeFunction(
    ['option', 'is_some'],
    [named('subject', optionParameter(types.something))],
    types.boolean,
    optionValue => either.makeRight(String(optionValue.tag === 'some')),
  ),

  is_none: preludeFunction(
    ['option', 'is_none'],
    [named('subject', optionParameter(types.something))],
    types.boolean,
    optionValue => either.makeRight(String(optionValue.tag === 'none')),
  ),
} as const
