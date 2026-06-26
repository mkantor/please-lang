import assert from 'node:assert'
import { execFile } from 'node:child_process'
import path from 'node:path'
import test, { suite } from 'node:test'

const pleasePath = path.join(import.meta.dirname, 'please.js')

type CommandResult = {
  readonly stdout: string
  readonly stderr: string
  readonly code: number
}

const runPlease = (
  input: string,
  commandLineArguments: readonly string[] = [],
): Promise<CommandResult> =>
  new Promise(resolve => {
    const child = execFile(
      'node',
      [pleasePath, ...commandLineArguments],
      (error, stdout, stderr) => {
        resolve({
          stdout,
          stderr,
          code: error === null ? 0 : Number(error.code ?? 1),
        })
      },
    )
    child.stdin?.end(input)
  })

suite('please CLI error reporting', () => {
  test('renders a framed diagnostic for a syntax error', async () => {
    const { stdout, stderr, code } = await runPlease('{ a: 1', ['--no-color'])
    assert.equal(code, 1)
    assert.equal(stdout, '')
    assert.equal(
      stderr,
      [
        'Error: expected `}`',
        '',
        '<stdin>:1:7',
        '  │',
        '1 │ { a: 1',
        '  │       ▔',
        '',
      ].join('\n'),
    )
  })

  test('frames a type mismatch error with an underline', async () => {
    const { stdout, stderr, code } = await runPlease('1 ~ :boolean.type', [
      '--no-color',
    ])
    assert.equal(code, 1)
    assert.equal(stdout, '')
    assert.match(stderr, /^Error: /)
    assert.ok(stderr.includes('\n<stdin>:1:1\n'))
    assert.ok(stderr.includes('\n1 │ 1 ~ :boolean.type\n'))
    assert.ok(stderr.includes('\n  │ ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔\n'))
  })

  test('underlines a sub-expression error on a later line', async () => {
    const source = '{\n  greeting: :nope\n  other: 2\n}'
    const { stdout, stderr, code } = await runPlease(source, ['--no-color'])
    assert.equal(code, 1)
    assert.equal(stdout, '')
    assert.match(stderr, /^Error: cannot find a value for `:nope`\n/)
    assert.ok(stderr.includes('\n<stdin>:2:13\n'))
    assert.ok(stderr.includes('\n2 │   greeting: :nope\n'))
    assert.ok(stderr.includes('\n  │             ▔▔▔▔▔\n'))
  })

  test('exits zero and writes output for a valid program', async () => {
    const { stdout, stderr, code } = await runPlease('1 + 1', ['--no-color'])
    assert.equal(code, 0)
    assert.equal(stderr, '')
    assert.equal(stdout.trim(), '2')
  })
})
