import { stripVTControlCharacters } from 'node:util'
import type { CompilationError, ParseError, RelatedSpan } from '../errors.js'
import type { Span } from '../source-location.js'

export type DiagnosticSeverity = 'error' | 'warning' | 'information' | 'hint'

export type Diagnostic = {
  readonly severity: DiagnosticSeverity
  readonly code: (ParseError | CompilationError)['kind']
  readonly message: string
  readonly span: Span
  readonly relatedSpans: readonly RelatedSpan[]
}

export const diagnosticFromError = (
  error: ParseError | CompilationError,
): Diagnostic => ({
  severity: 'error',
  code: error.kind,
  // Messages may contain ANSI escape sequences.
  message: stripVTControlCharacters(error.message),
  span: error.span ?? [0, 0],
  relatedSpans: relatedSpansOf(error),
})

const relatedSpansOf = (
  error: ParseError | CompilationError,
): readonly RelatedSpan[] =>
  error.kind !== 'badSyntax' ?
    []
  : error.relatedSpans.map(related => ({
      message: stripVTControlCharacters(related.message),
      span: related.span,
    }))
