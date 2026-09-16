import either from '@matt.kantor/either'
import type { Parser } from '@matt.kantor/parsing'

/**
 * Point back at the opening delimiter when quotes/parens/etc are unclosed.
 */
export const notingUnclosedDelimiter =
  (openingDelimiter: string, closingDelimiter: string) =>
  <Output>(parser: Parser<Output>): Parser<Output> => {
    const closingExpectation = `\`${closingDelimiter}\``
    const noteMessage = `unclosed \`${openingDelimiter}\``
    return (input, offset = 0n) =>
      either.mapLeft(parser(input, offset), error =>
        (
          error.expected.has(closingExpectation) &&
          input.startsWith(openingDelimiter, Number(offset))
        ) ?
          {
            ...error,
            notes: [...error.notes, { offset, message: noteMessage }],
          }
        : error,
      )
  }
