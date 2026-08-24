import either, { type Either } from '@matt.kantor/either'
import parsing, {
  anySingleCharacter,
  oneOf,
  type Note,
  type Parser,
} from '@matt.kantor/parsing'
import type { ParseError, RelatedSpan } from '../errors.js'
import type { Span } from '../source-location.js'
import { unquotedAtomParser } from './atom.js'
import {
  closingBlockCommentDelimiter,
  closingBraceWithBar,
  functionArrow,
  openingBlockCommentDelimiter,
  openingBraceWithBar,
  signatureArrow,
  singleLineCommentDelimiter,
} from './literals.js'
import {
  spansFromSpannedTree,
  toSyntaxTree,
  type ExpressionSpans,
  type PropertyKeySpans,
  type SpannedTree,
} from './spans.js'
import { syntaxTreeParser, type SyntaxTree } from './syntax-tree.js'

const parseSpanned = (input: string): Either<ParseError, SpannedTree> =>
  either.mapLeft(
    parsing.parse(syntaxTreeParser, input),
    (error): ParseError => ({
      kind: 'badSyntax',
      message: error.message,
      span: spanOfOffendingToken(input, offsetWithinSource(error.offset)),
      relatedSpans: error.notes.map(relatedSpanFromNote(input)),
    }),
  )

export const parse = (input: string): Either<ParseError, SyntaxTree> =>
  either.map(parseSpanned(input), toSyntaxTree)

export type SyntaxTreeWithSpans = {
  readonly tree: SyntaxTree
  readonly spans: ExpressionSpans
  readonly propertyKeySpans: PropertyKeySpans
}

export const parseWithSpans = (
  input: string,
): Either<ParseError, SyntaxTreeWithSpans> =>
  either.map(parseSpanned(input), spanned => ({
    tree: toSyntaxTree(spanned),
    ...spansFromSpannedTree(spanned),
  }))

const multipleCharacterSigil: Parser<string> = oneOf([
  functionArrow,
  signatureArrow,
  openingBraceWithBar,
  closingBraceWithBar,
  singleLineCommentDelimiter,
  openingBlockCommentDelimiter,
  closingBlockCommentDelimiter,
])

/**
 * Whatever lexeme begins at a failure, longest form first. Parsers report a
 * single point, but underlining the whole token reads better.
 */
const offendingToken: Parser<string> = oneOf([
  unquotedAtomParser,
  multipleCharacterSigil,
  anySingleCharacter,
])

const spanOfOffendingToken = (input: string, offset: number): Span =>
  either.match(offendingToken(input, BigInt(offset)), {
    left: _ => [offset, offset],
    right: success => [offset, Number(success.offset)],
  })

const relatedSpanFromNote =
  (input: string) =>
  (note: Note): RelatedSpan => ({
    message: note.message,
    span: spanOfOffendingToken(input, offsetWithinSource(note.offset)),
  })

// Clamp defensively so a theoretical negative offset won't result in a
// malformed span indicator.
const offsetWithinSource = (offset: bigint): number =>
  Math.max(0, Number(offset))
