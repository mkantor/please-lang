/**
 * An `end`-exclusive character offset range (i.e. `[start, end)`) into a source
 * string. A zero-width span (i.e. `start === end`) marks a single point.
 */
export type Span = readonly [start: number, end: number]

/** `line` and `column` are 1-based. */
export type LineAndColumn = {
  readonly line: number
  readonly column: number
}

/**
 * Everything needed to quote and point at a `Span` on a single source line.
 * `highlightLength` is the number of columns to underline, always at least 1
 * and clamped to the end of the line (spans that cross a newline are truncated
 * to their first line).
 */
export type SourceSnippet = LineAndColumn & {
  readonly lineText: string
  readonly highlightLength: number
}

export const lineAndColumnAtOffset = (
  source: string,
  offset: number,
): LineAndColumn => {
  const precedingText = source.slice(0, offset)
  const lineStartOffset = precedingText.lastIndexOf('\n') + 1
  return {
    line: precedingText.split('\n').length,
    column: offset - lineStartOffset + 1,
  }
}

export const offsetAtLineAndColumn = (
  source: string,
  { line, column }: LineAndColumn,
): number => {
  const lines = source.split('\n')
  const lineIndex = clamp(line, 1, lines.length) - 1
  const lineText = lines[lineIndex] ?? ''
  const lineStartOffset = lines
    .slice(0, lineIndex)
    .reduce((offset, precedingLine) => offset + precedingLine.length + 1, 0)
  return lineStartOffset + clamp(column, 1, lineText.length + 1) - 1
}

export const snippetAtSpan = (
  source: string,
  [start, end]: Span,
): SourceSnippet => {
  const { line, column } = lineAndColumnAtOffset(source, start)
  const lineStartOffset = start - (column - 1)
  const nextNewlineOffset = source.indexOf('\n', start)
  const lineEndOffset =
    nextNewlineOffset === -1 ? source.length : nextNewlineOffset
  return {
    line,
    column,
    lineText: source.slice(lineStartOffset, lineEndOffset),
    highlightLength: Math.max(1, Math.min(end, lineEndOffset) - start),
  }
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), maximum)
