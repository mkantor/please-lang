import {
  type Parser,
  anySingleCharacter,
  as,
  butNot,
  hidden,
  labeled,
  literal,
  map,
  oneOf,
  oneOrMore,
  sequence,
  zeroOrMore,
} from '@matt.kantor/parsing'
import { notingUnclosedDelimiter } from './delimiters.js'
import {
  atSign,
  backslash,
  closingBlockCommentDelimiter,
  closingBrace,
  closingBracket,
  closingParenthesis,
  colon,
  comma,
  escapedBackslash,
  escapedQuote,
  functionArrow,
  openingBlockCommentDelimiter,
  openingBrace,
  openingBracket,
  openingParenthesis,
  questionMark,
  quote,
  signatureArrow,
  singleLineCommentDelimiter,
  tilde,
  unionBar,
} from './literals.js'
import { optionallySurroundedByParentheses } from './parentheses.js'
import { whitespace } from './trivia.js'

export type Atom = string

// The TextMate grammar mirrors this as `atomCharactersRequiringQuotation`;
// tests check that the two agree.
const atomComponentsRequiringQuotation = [
  functionArrow,
  signatureArrow,
  atSign,
  backslash,
  closingBlockCommentDelimiter,
  closingBrace,
  closingBracket,
  closingParenthesis,
  colon,
  comma,
  openingBlockCommentDelimiter,
  openingBrace,
  openingBracket,
  openingParenthesis,
  questionMark,
  quote,
  singleLineCommentDelimiter,
  tilde,
  unionBar,
  whitespace,

  // Reserved for future use:
  literal('='),
  literal('#'),
  literal(';'),
] as const

// This is less than ideal, but I want to allow these standard library functions
// as infix operators without quotation, despite containing `|` which normally
// requires quotation.
const completeAtomsExemptedFromQuotationRequirements = [
  literal('|>'),
  literal('<|'), // Not in use by the standard library, but allowed for symmetry.
  literal('||'),
] as const

export const atomWithAdditionalQuotationRequirements = (
  additionalQuoteRequiringComponent: Parser<unknown>,
) =>
  optionallySurroundedByParentheses(
    labeled(
      oneOf([
        ...completeAtomsExemptedFromQuotationRequirements,
        map(
          oneOrMore(
            butNot(
              anySingleCharacter,
              oneOf([
                ...atomComponentsRequiringQuotation,
                additionalQuoteRequiringComponent,
              ]),
              'a character sequence requiring quotation',
            ),
          ),
          characters => characters.join(''),
        ),
        quotedAtomParser,
      ]),
      'an atom',
    ),
  )

export const unquotedAtomParser = labeled(
  map(
    oneOrMore(
      butNot(
        anySingleCharacter,
        oneOf(atomComponentsRequiringQuotation),
        'a character sequence requiring quotation',
      ),
    ),
    characters => characters.join(''),
  ),
  'an atom',
)

const quotedAtomParser = notingUnclosedDelimiter(
  '"',
  '"',
)(
  map(
    sequence([
      quote,
      map(
        hidden(
          zeroOrMore(
            oneOf([
              // `"` and `\` need to be escaped
              butNot(
                anySingleCharacter,
                oneOf([quote, backslash]),
                '`"` or `\\`',
              ),
              as(escapedQuote, '"'),
              as(escapedBackslash, '\\'),
            ]),
          ),
        ),
        output => output.join(''),
      ),
      quote,
    ]),
    ([_1, contents, _2]) => contents,
  ),
)

export const atom: Parser<Atom> = optionallySurroundedByParentheses(
  labeled(
    oneOf([
      ...completeAtomsExemptedFromQuotationRequirements,
      unquotedAtomParser,
      quotedAtomParser,
    ]),
    'an atom',
  ),
)
