import option from '@matt.kantor/option'
import assert from 'node:assert'
import test, { suite } from 'node:test'
import { defaultConfiguration } from '../configuration.js'
import { stringifyKeyPathForInternalUse } from '../semantics.js'
import { analyze } from './analyze.js'

const analyzeSource = analyze(defaultConfiguration)

suite('analyze', () => {
  test('a program which does not parse yields nothing to query', () => {
    assert.ok(option.isNone(analyzeSource('{ a: 1').parsed))
  })

  test('spans locate the analyzed source', () => {
    const analysis = analyzeSource('{ a: 1 }')
    assert.ok(option.isSome(analysis.parsed))
    assert.deepEqual(
      analysis.parsed.value.spans.get(stringifyKeyPathForInternalUse(['a'])),
      [5, 6],
    )
  })

  test('a program which fails to elaborate still yields a context', () => {
    const analysis = analyzeSource('{ a: 1 + 1, b: :nonexistent }')
    assert.equal(analysis.diagnostics.length, 1)
    assert.ok(option.isSome(analysis.parsed))
    assert.ok(analysis.parsed.value.context.mutableInferenceCache.size > 0)
  })
})
