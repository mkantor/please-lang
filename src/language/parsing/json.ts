import { type Either } from '@matt.kantor/either'
import {
  anySingleCharacter,
  as,
  butNot,
  flatMap,
  lazy,
  literal,
  map,
  nothing,
  oneOf,
  parse,
  regularExpression,
  sequence,
  zeroOrMore,
  type InvalidInputError,
  type Parser,
} from '@matt.kantor/parsing'
import type { OrderedRecord } from '../../ordered-record.js'
import * as orderedRecord from '../../ordered-record.js'

/**
 * The shape produced by `parseJson`. Models a JSON value, but with objects
 * represented as `OrderedRecord`s, preserving the source order of their
 * properties (plain JavaScript objects sort integer-like keys first).
 */
export type ParsedJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly ParsedJsonValue[]
  | ParsedJsonRecord

// `interface` (not `type`) is used to avoid a circular reference error.
interface ParsedJsonRecord extends OrderedRecord<ParsedJsonValue> {}

const whitespace = regularExpression(/[ \t\n\r]+/)
const optionalWhitespace = oneOf([whitespace, nothing])

const optionallySurroundedByWhitespace = <Output>(
  parser: Parser<Output>,
): Parser<Output> =>
  map(
    sequence([optionalWhitespace, parser, optionalWhitespace]),
    ([_leadingWhitespace, value, _trailingWhitespace]) => value,
  )

const quote = literal('"')
const backslash = literal('\\')

const unicodeEscape: Parser<string> = map(
  sequence([backslash, literal('u'), regularExpression(/[0-9A-Fa-f]{4}/)]),
  ([_backslash, _u, hex]) => String.fromCharCode(parseInt(hex, 16)),
)
const simpleEscape: Parser<string> = map(
  sequence([
    backslash,
    oneOf([
      literal('"'),
      literal('\\'),
      literal('/'),
      as(literal('b'), '\b'),
      as(literal('f'), '\f'),
      as(literal('n'), '\n'),
      as(literal('r'), '\r'),
      as(literal('t'), '\t'),
    ]),
  ]),
  ([_backslash, unescaped]) => unescaped,
)

const stringCharacter: Parser<string> = oneOf([
  unicodeEscape,
  simpleEscape,
  butNot(
    anySingleCharacter,
    oneOf([quote, backslash]),
    'an unescaped `"` or `\\`',
  ),
])

// This is recursive: `jsonValue` references `jsonObject` and `jsonArray`, each
// of which references `jsonValue`.
const jsonValue: Parser<ParsedJsonValue> = lazy(() =>
  optionallySurroundedByWhitespace(
    oneOf([
      jsonString,
      jsonNumber,
      jsonBoolean,
      jsonNull,
      jsonObject,
      jsonArray,
    ]),
  ),
)

const jsonString: Parser<string> = map(
  sequence([quote, zeroOrMore(stringCharacter), quote]),
  ([_open, characters, _close]) => characters.join(''),
)

const jsonNumber: Parser<number> = map(
  regularExpression(/-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/),
  Number,
)

const jsonBoolean: Parser<boolean> = oneOf([
  as(literal('true'), true),
  as(literal('false'), false),
])

const jsonNull: Parser<null> = as(literal('null'), null)

const property: Parser<readonly [string, ParsedJsonValue]> = map(
  sequence([
    optionallySurroundedByWhitespace(jsonString),
    literal(':'),
    jsonValue,
  ]),
  ([key, _colon, value]) => [key, value],
)

const properties: Parser<readonly (readonly [string, ParsedJsonValue])[]> =
  flatMap(property, first =>
    map(
      zeroOrMore(
        map(
          sequence([literal(','), property]),
          ([_comma, property]) => property,
        ),
      ),
      rest => [first, ...rest],
    ),
  )

const jsonObject: Parser<ParsedJsonRecord> = map(
  sequence([
    literal('{'),
    oneOf([properties, as(nothing, [])]),
    optionallySurroundedByWhitespace(literal('}')),
  ]),
  ([_openBrace, properties, _closeBrace]) => orderedRecord.make(properties),
)

const elements: Parser<readonly ParsedJsonValue[]> = flatMap(jsonValue, first =>
  map(
    zeroOrMore(
      map(sequence([literal(','), jsonValue]), ([_comma, value]) => value),
    ),
    rest => [first, ...rest],
  ),
)

const jsonArray: Parser<readonly ParsedJsonValue[]> = map(
  sequence([
    literal('['),
    oneOf([elements, as(nothing, [])]),
    optionallySurroundedByWhitespace(literal(']')),
  ]),
  ([_openBracket, elements, _closeBracket]) => elements,
)

export const parseJson = (
  source: string,
): Either<InvalidInputError, ParsedJsonValue> => parse(jsonValue, source)
