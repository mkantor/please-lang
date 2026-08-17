import either from '@matt.kantor/either'
import assert from 'node:assert'
import test, { suite } from 'node:test'
import { compileWithoutSpans } from '../../test-utilities.test.js'
import { parse } from '../parsing/parser.js'

const compileErrorMessage = (source: string): string => {
  const parsed = parse(source)
  if (either.isLeft(parsed)) {
    throw new Error(`unexpected parse error: ${parsed.value.message}`)
  } else {
    const result = compileWithoutSpans(parsed.value)
    if (either.isRight(result)) {
      throw new Error('expected a compilation error but compilation succeeded')
    } else {
      return result.value.message
    }
  }
}

const assertMessageContains = (source: string, expected: string): void => {
  const message = compileErrorMessage(source)
  assert(
    message.includes(expected),
    `expected the error for \`${source}\` to mention \`${expected}\`, but it was:\n${message}`,
  )
}

suite('stuck applications are resolved in error messages', () => {
  test('a partially applied prelude function reports what it produces', () => {
    assertMessageContains(
      '(x: { a: :integer.type }) => :object.overlay(:x)({ b: true }) ~ { b: true }',
      '`{ b: :something.type, a: (?"x.a": :integer.type) }`',
    )
  })

  test('nested applications collapse rather than compounding', () => {
    assertMessageContains(
      '(f: :atom.type ~> :atom.type) => (x: :atom.type) => :f(:f(:f(:f(:x)))) ~ :nothing.type',
      'inferred to have type `(?"f.#return": :atom.type)`',
    )
  })

  test('applications within a stuck projection are resolved', () => {
    assertMessageContains(
      '(f: :atom.type ~> :integer.type) => (b: :boolean.type) => (x: :atom.type) => @if { :b, then: :f(:x), else: true } ~ :nothing.type',
      '`{ false: true, true: (?"f.#return": :integer.type) }.((?b: false | true))`',
    )
  })

  test('applications within a stdlib return type are resolved', () => {
    assertMessageContains(
      '(f: :atom.type ~> :integer.type) => (x: :atom.type) => :object.overlay({ a: :f(:x) })({ b: true }) ~ :nothing.type',
      '`{ [:atom.type]: :nothing.type, b: true, a: (?"f.#return": :integer.type) }`',
    )
  })
})

suite('the top type is reported as itself', () => {
  test('a union which contains it collapses to it', () => {
    assertMessageContains(
      '{ recurse: (k: :atom.type) => (:object.lookup(:k)({ a: :recurse, b: true }) ~ :nothing.type) }',
      'value: :something.type',
    )
  })
})

suite('type parameters survive in error messages', () => {
  test('a signature requiring two positions to agree keeps saying so', () => {
    assertMessageContains(
      '((f: ?a ~> :a) => :f)((x: :integer.type) => true)',
      'parameter type `?a ~> :a`',
    )
  })

  test('a parameter shared between properties keeps its identity', () => {
    assertMessageContains(
      '(x: ?t) => { first: :x, second: :x } ~ { first: :integer.type, second: :atom.type }',
      'first: ?t, second: :t',
    )
  })

  test('an unannotated parameter is not reported as the top type', () => {
    assertMessageContains('a => :a ~ :integer.type', 'have type `?a`')
  })
})
