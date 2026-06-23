import either, { type Either } from '@matt.kantor/either'
import parsing from '@matt.kantor/parsing'
import type { ParseError } from '../errors.js'
import { type SyntaxTree, syntaxTreeParser } from './syntax-tree.js'

export const parse = (input: string): Either<ParseError, SyntaxTree> =>
  either.mapLeft(
    parsing.parse(syntaxTreeParser, input),
    (error): ParseError => {
      // Clamp defensively so a theoretical negative offset won't result in a
      // malformed span indicator.
      const offset = Math.max(0, Number(error.offset))
      return {
        kind: 'badSyntax',
        message: error.message,
        // Parsers currently always report a single failure point.
        span: [offset, offset],
      }
    },
  )
