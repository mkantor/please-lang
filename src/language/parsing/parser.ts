import either, { type Either } from '@matt.kantor/either'
import parsing from '@matt.kantor/parsing'
import type { ParseError } from '../errors.js'
import {
  spansFromSpannedTree,
  toSyntaxTree,
  type ExpressionSpansByLocation,
  type SpannedTree,
} from './spans.js'
import { syntaxTreeParser, type SyntaxTree } from './syntax-tree.js'

const parseSpanned = (input: string): Either<ParseError, SpannedTree> =>
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

export const parse = (input: string): Either<ParseError, SyntaxTree> =>
  either.map(parseSpanned(input), toSyntaxTree)

export type SyntaxTreeWithSpans = {
  readonly tree: SyntaxTree
  readonly spans: ExpressionSpansByLocation
}

export const parseWithSpans = (
  input: string,
): Either<ParseError, SyntaxTreeWithSpans> =>
  either.map(parseSpanned(input), spanned => ({
    tree: toSyntaxTree(spanned),
    spans: spansFromSpannedTree(spanned),
  }))
