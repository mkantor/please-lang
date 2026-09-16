import { map, oneOf, sequence, type Parser } from '@matt.kantor/parsing'
import { notingUnclosedDelimiter } from './delimiters.js'
import { closingParenthesis, openingParenthesis } from './literals.js'
import { optionalTrivia } from './trivia.js'

const optionallySurroundedBy = <Output>(
  parser1: Parser<unknown>,
  theParser: Parser<Output>,
  parser2: Parser<unknown>,
): Parser<Output> =>
  oneOf([
    theParser,
    map(sequence([parser1, theParser, parser2]), ([_1, output, _2]) => output),
  ])

export const optionallySurroundedByParentheses = <Output>(
  theParser: Parser<Output>,
): Parser<Output> =>
  optionallySurroundedBy(
    sequence([openingParenthesis, optionalTrivia]),
    theParser,
    sequence([optionalTrivia, closingParenthesis]),
  )

export const surroundedByParentheses = <Output>(
  theParser: Parser<Output>,
): Parser<Output> =>
  notingUnclosedParenthesis(
    map(
      sequence([
        openingParenthesis,
        optionalTrivia,
        theParser,
        optionalTrivia,
        closingParenthesis,
      ]),
      ([_openParenthesis, _trivia1, output, _trivia2, _closeParenthesis]) =>
        output,
    ),
  )

const notingUnclosedParenthesis = notingUnclosedDelimiter('(', ')')
