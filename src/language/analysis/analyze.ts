import either from '@matt.kantor/either'
import option, { type Option } from '@matt.kantor/option'
import { compileWithContext } from '../compiling.js'
import type { Configuration } from '../configuration.js'
import {
  parseWithSpans,
  type ExpressionSpans,
  type PropertyKeySpans,
  type SyntaxTree,
} from '../parsing.js'
import type { ExpressionContext } from '../semantics.js'
import { diagnosticFromError, type Diagnostic } from './diagnostics.js'

export type Analysis = {
  readonly diagnostics: readonly Diagnostic[]
  /** Absent when the source contained invalid syntax. */
  readonly parsed: Option<ParsedProgram>
}

export type ParsedProgram = {
  readonly tree: SyntaxTree
  readonly spans: ExpressionSpans
  readonly propertyKeySpans: PropertyKeySpans
  readonly context: ExpressionContext
}

/**
 * Analyze source code and report compilation errors.
 *
 * Compilation currently stops at the first error, so at most one `Diagnostic`
 * is produced (this is likely to change in the future).
 */
export const analyze =
  (configuration: Configuration) =>
  (source: string): Analysis =>
    either.match(parseWithSpans(source), {
      left: error => ({
        diagnostics: [diagnosticFromError(error)],
        parsed: option.none,
      }),
      right: ({ tree, spans, propertyKeySpans }) => {
        const { context, output } = compileWithContext(configuration)(
          tree,
          spans,
        )
        return {
          diagnostics: either.match(output, {
            left: error => [diagnosticFromError(error)],
            right: _ => [],
          }),
          parsed: option.makeSome({ tree, spans, propertyKeySpans, context }),
        }
      },
    })

export const diagnose =
  (configuration: Configuration) =>
  (source: string): readonly Diagnostic[] =>
    analyze(configuration)(source).diagnostics
