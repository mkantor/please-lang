import {
  anySingleCharacter,
  butNot,
  hidden,
  lookaheadNot,
  nothing,
  oneOf,
  oneOrMore,
  regularExpression,
  sequence,
  zeroOrMore,
} from '@matt.kantor/parsing'
import { notingUnclosedDelimiter } from './delimiters.js'
import {
  asterisk,
  closingBlockCommentDelimiter,
  newline,
  openingBlockCommentDelimiter,
  singleLineCommentDelimiter,
  slash,
} from './literals.js'

const blockComment = notingUnclosedDelimiter(
  '/*',
  '*/',
)(
  sequence([
    openingBlockCommentDelimiter,
    hidden(
      zeroOrMore(
        oneOf([
          butNot(anySingleCharacter, asterisk, '*'),
          lookaheadNot(asterisk, slash, '/'),
        ]),
      ),
    ),
    closingBlockCommentDelimiter,
  ]),
)

const singleLineComment = sequence([
  singleLineCommentDelimiter,
  hidden(zeroOrMore(butNot(anySingleCharacter, newline, 'newline'))),
])

export const whitespace = regularExpression(/\s+/)
export const whitespaceExceptNewlines = regularExpression(/[^\S\n]+/)

// Hide trivia from error messages ("whitespace could have gone here" is
// uninteresting).
export const trivia = hidden(
  oneOrMore(oneOf([whitespace, singleLineComment, blockComment])),
)

export const optionalTrivia = oneOf([trivia, nothing])

export const triviaExceptNewlines = hidden(
  oneOrMore(oneOf([whitespaceExceptNewlines, singleLineComment, blockComment])),
)
