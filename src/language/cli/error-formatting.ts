import { styleText } from 'node:util'
import { snippetAtSpan, type Span } from '../source-location.js'

export type DiagnosticError = {
  readonly message: string
  readonly span?: Span | undefined
}

/**
 * Render an error as a friendly diagnostic. When both `source` and a `span`
 * are available the `Error: <message>` header is followed by a framed,
 * underline-annotated source snippet; otherwise just the header is returned.
 */
export const formatError = (
  error: DiagnosticError,
  context: {
    readonly filename: string
    readonly source?: string
  },
): string => {
  const errorLabel = styleText(['red', 'bold', 'underline'], 'Error')
  const styledMessage = `${styleText('bold', ':')} ${error.message}`
  const header = `${errorLabel}${styledMessage}`
  return context.source === undefined || error.span === undefined ?
      header
    : `${header}\n\n${renderFrame(context.source, error.span, context.filename)}`
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
