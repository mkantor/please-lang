import either, { type Either } from '@matt.kantor/either'
import type { ElaborationError } from '../../errors.js'
import type { TypeKeyPathStringifiedForInternalUse } from './type-key-path.js'

/**
 * A small utility module to reduce boilerplate in type inference.
 */

/**
 * A value inferred under a set of assumed inferences. `value` is only
 * legitimate if the assumptions are.
 */
export type Inferred<Value> = {
  readonly value: Value
  readonly assumptionsUsed: ReadonlySet<TypeKeyPathStringifiedForInternalUse>
}

export type InferenceResult<Value> = Either<ElaborationError, Inferred<Value>>

export const usingNoAssumptions = <Value>(value: Value): Inferred<Value> => ({
  value,
  assumptionsUsed: new Set(),
})

export const alsoAssuming = <Value>(
  result: InferenceResult<Value>,
  assumptionsUsed: ReadonlySet<TypeKeyPathStringifiedForInternalUse>,
): InferenceResult<Value> =>
  either.map(result, inferred => ({
    value: inferred.value,
    assumptionsUsed: inferred.assumptionsUsed.union(assumptionsUsed),
  }))

export const withoutAssumption = <Value>(
  result: InferenceResult<Value>,
  definitionKeyPathAsString: TypeKeyPathStringifiedForInternalUse,
): InferenceResult<Value> =>
  either.map(result, inferred => ({
    value: inferred.value,
    assumptionsUsed: inferred.assumptionsUsed.difference(
      new Set([definitionKeyPathAsString]),
    ),
  }))

export const inferredValue = <Value>(
  result: InferenceResult<Value>,
): Either<ElaborationError, Value> => either.map(result, ({ value }) => value)

export const mapInferred = <Value, NewValue>(
  result: InferenceResult<Value>,
  transform: (value: Value) => NewValue,
): InferenceResult<NewValue> =>
  either.map(result, ({ value, assumptionsUsed }) => ({
    value: transform(value),
    assumptionsUsed,
  }))

export const flatMapInferred = <Value, NewValue>(
  result: InferenceResult<Value>,
  continuation: (value: Value) => InferenceResult<NewValue>,
): InferenceResult<NewValue> =>
  either.flatMap(result, ({ value, assumptionsUsed }) =>
    alsoAssuming(continuation(value), assumptionsUsed),
  )

export const sequenceInferred = <Value>(
  results: readonly InferenceResult<Value>[],
): InferenceResult<readonly Value[]> =>
  either.map(either.sequence(results), inferences => ({
    value: inferences.map(({ value }) => value),
    assumptionsUsed: new Set(
      inferences.flatMap(({ assumptionsUsed }) => [...assumptionsUsed]),
    ),
  }))
