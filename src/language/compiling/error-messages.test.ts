import either from '@matt.kantor/either'
import assert from 'node:assert'
import test, { suite } from 'node:test'
import { stripVTControlCharacters } from 'node:util'
import {
  compileWithoutSpans,
  withEnvironmentVariables,
} from '../../test-utilities.test.js'
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
  const message = stripVTControlCharacters(compileErrorMessage(source))
  assert(
    message.includes(expected),
    `expected the error for \`${source}\` to mention \`${expected}\`, but it was:\n${message}`,
  )
}

suite('stuck applications are resolved in error messages', () => {
  test('a partially applied prelude function reports what it produces', () => {
    assertMessageContains(
      '(x: { a: :Integer }) => :object.overlay(:x)({ b: true }) ~ { b: true }',
      'inferred to have type `{ b: :Something, a: (?"x.a": :Integer) }`',
    )
  })

  test('nested applications collapse rather than compounding', () => {
    assertMessageContains(
      '(f: :Atom ~> :Atom) => (x: :Atom) => :f(:f(:f(:f(:x)))) ~ :Nothing',
      'inferred to have type `(?"f.#return": :Atom)`',
    )
  })

  test('applications within an unresolved conditional are resolved', () => {
    assertMessageContains(
      '(f: :Atom ~> :Integer) => (b: :Boolean) => (x: :Atom) => @if { :b, then: :f(:x), else: true } ~ :Nothing',
      'then: (?"f.#return": :Integer)',
    )
  })

  test('applications within a stdlib return type are resolved', () => {
    assertMessageContains(
      '(f: :Atom ~> :Integer) => (x: :Atom) => :object.overlay({ a: :f(:x) })({ b: true }) ~ :Nothing',
      'inferred to have type `{| b: true, a: (?"f.#return": :Integer) |}`',
    )
  })
})

suite('unresolved conditionals are reported as `@if`s', () => {
  test('`@if`-shaped types are reported with `@if` syntax', () => {
    assertMessageContains(
      '(b: :Boolean) => @if { :b, then: yes, else: no } ~ :Nothing',
      'inferred to have type `@if { condition: (?b: :Boolean), then: yes, else: no }`',
    )
  })

  test('conditional indexed access is equivalent to `@if`', () => {
    // TODO: Is this confusing? I can imagine machinery that decides how to
    // display types based on the original syntax tree (rather than just the
    // type itself), but is it worth the effort/complexity?
    assertMessageContains(
      '(b: :Boolean) => { true: yes, false: no }.:b ~ :Nothing',
      'inferred to have type `@if { condition: (?b: :Boolean), then: yes, else: no }`',
    )
  })

  test('an indexed access with more than two branches does not become an `@if`', () => {
    assertMessageContains(
      '(k: false | true | maybe) => { true: 1, false: 2, maybe: 3 }.:k ~ :Nothing',
      'inferred to have type `{| true: 1, false: 2, maybe: 3 |}.((?k: false | true | maybe))`',
    )
  })

  test('a computed condition does not reduce to its type', () => {
    // Displaying `condition: false | true` would make it look like the whole
    // type should just reduce to `yes | no`, but that'd erase useful detail.
    assertMessageContains(
      '(b: :NaturalNumber) => @if { :b integer.equals 0, then: yes, else: no } ~ :Nothing',
      'inferred to have type `@if { condition: (?b: :NaturalNumber) integer.equals 0, then: yes, else: no }`',
    )
  })

  test('a stuck application in a branch reduces', () => {
    assertMessageContains(
      '(b: :NaturalNumber) => @if { :b integer.equals 0, then: :b integer.add 1, else: 0 } ~ :Nothing',
      'inferred to have type `@if { condition: (?b: :NaturalNumber) integer.equals 0, then: :NaturalNumber, else: 0 }`',
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

  test('a synthesized name is not quoted when output is colorized', () => {
    withEnvironmentVariables({ FORCE_COLOR: '3', NO_COLOR: undefined }, () => {
      assertMessageContains('a => :a ~ :Integer', 'have type `?a`')
      assertMessageContains(
        '(f: :Atom ~> :Atom) => :f ~ :Integer',
        'inferred to have type `(?"f.#parameter": :Atom) ~> (?"f.#return": :Atom)`',
      )
    })
  })
})
