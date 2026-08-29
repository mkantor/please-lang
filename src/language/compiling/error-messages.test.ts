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
      '(x: { a: :Integer }) => :object.overlay(:x)({ b: true }) ~ { b: true }',
      '`{ b: :Something, a: (?"x.a": :Integer) }`',
    )
  })

  test('nested applications collapse rather than compounding', () => {
    assertMessageContains(
      '(f: :Atom ~> :Atom) => (x: :Atom) => :f(:f(:f(:f(:x)))) ~ :Nothing',
      'inferred to have type `(?"f.#return": :Atom)`',
    )
  })

  test('applications within a stuck projection are resolved', () => {
    assertMessageContains(
      '(f: :Atom ~> :Integer) => (b: :Boolean) => (x: :Atom) => @if { :b, then: :f(:x), else: true } ~ :Nothing',
      '`{ false: true, true: (?"f.#return": :Integer) }.((?b: false | true))`',
    )
  })

  test('applications within a stdlib return type are resolved', () => {
    assertMessageContains(
      '(f: :Atom ~> :Integer) => (x: :Atom) => :object.overlay({ a: :f(:x) })({ b: true }) ~ :Nothing',
      '`{| b: true, a: (?"f.#return": :Integer) |}`',
    )
  })
})

suite('the top type is reported as itself', () => {
  test('a union which contains it collapses to it', () => {
    assertMessageContains(
      '(k: :Atom) => (:object.lookup(:k)({ a: :Something, b: true }) ~ :Nothing)',
      'value: :Something',
    )
  })
})

suite('a not-yet-known type is distinguished from the top type', () => {
  test('a recursive definition reports the type it does not know', () => {
    assertMessageContains(
      '{ recurse: (k: :Atom) => (:object.lookup(:k)({ a: :recurse, b: true }) ~ :Nothing) }',
      'value: :Unresolved | true',
    )
  })
})

suite('type parameters survive in error messages', () => {
  test('a signature requiring two positions to agree keeps saying so', () => {
    assertMessageContains(
      '((f: ?a ~> :a) => :f)((x: :Integer) => true)',
      'parameter type `?a ~> :a`',
    )
  })

  test('a parameter shared between properties keeps its identity', () => {
    assertMessageContains(
      '(x: ?t) => { first: :x, second: :x } ~ { first: :Integer, second: :Atom }',
      'first: ?t, second: :t',
    )
  })

  test('an unannotated parameter is not reported as the top type', () => {
    assertMessageContains('a => :a ~ :Integer', 'have type `?a`')
  })
})
