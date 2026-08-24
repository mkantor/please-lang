import { styleText } from 'node:util'
import type { RelatedSpan } from '../errors.js'
import { snippetAtSpan, type Span } from '../source-location.js'

export type FormattableError = {
  readonly message: string
  readonly span?: Span | undefined
  readonly relatedSpans?: readonly RelatedSpan[] | undefined
}

/**
 * Render an error for a human reading in a terminal. When both `source` and a
 * `span` are available the `Error: <message>` header is followed by a framed,
 * underline-annotated source snippet; otherwise just the header is returned.
 * Any `relatedSpans` follow as further frames.
 */
export const formatError = (
  error: FormattableError,
  context: {
    readonly filename: string
    readonly source?: string
  },
): string => {
  const errorLabel = styleText(['red', 'bold', 'underline'], 'Error')
  const styledMessage = `${styleText('bold', ':')} ${error.message}`
  const header = `${errorLabel}${styledMessage}`
  const source = context.source
  return source === undefined || error.span === undefined ?
      header
    : [
        `${header}\n\n${renderFrame(source, error.span, context.filename)}`,
        ...(error.relatedSpans ?? []).map(
          related =>
            `${styleText('bold', 'note')}${styleText('bold', ':')} ${related.message}\n${renderFrame(source, related.span, context.filename)}`,
        ),
      ].join('\n\n')
}

const renderFrame = (source: string, span: Span, filename: string): string => {
  const { line, column, lineText, highlightLength } = snippetAtSpan(
    source,
    span,
  )
  const gutter = (text: string): string => styleText(['gray', 'bold'], text)
  const padding = ' '.repeat(String(line).length)
  const location = styleText(
    'gray',
    `${styleText('bold', filename)}${styleText('dim', ':')}${line}${styleText('dim', ':')}${column}`,
  )
  const underlineIndent = ' '.repeat(column - 1)
  const underlines = styleText(['red', 'bold'], '▔'.repeat(highlightLength))
  const verticalBar = styleText('dim', '│')
  return [
    location,
    gutter(`${padding} ${verticalBar}`),
    `${gutter(`${line} ${verticalBar}`)} ${lineText}`,
    `${gutter(`${padding} ${verticalBar}`)} ${underlineIndent}${underlines}`,
  ].join('\n')
}
