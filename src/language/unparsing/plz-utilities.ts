import either, { type Either, type Right } from '@matt.kantor/either'
import option, { type Option } from '@matt.kantor/option'
import parsing from '@matt.kantor/parsing'
import { styleText } from 'node:util'
import * as orderedRecord from '../../ordered-record.js'
import type { ElaborationError, UnserializableValueError } from '../errors.js'
import type { Atom, Molecule } from '../parsing.js'
import { unquotedAtomParser } from '../parsing/atom.js'
import {
  asSemanticGraph,
  getParameterName,
  getParameterTypeAnnotation,
  ignoredKey,
  isExpression,
  isSemanticGraph,
  makeIndexExpression,
  makeLookupExpression,
  objectNodeFromOrderedEntries,
  readApplyExpression,
  readFunctionExpression,
  readHoleExpression,
  readIndexExpression,
  readLookupExpression,
  readUnionExpression,
  serialize,
  types,
  type ApplyExpression,
  type Expression,
  type FunctionExpression,
  type HoleExpression,
  type IndexExpression,
  type LookupExpression,
  type ObjectNode,
  type SemanticGraph,
  type UnionExpression,
} from '../semantics.js'
import {
  readCheckExpression,
  type CheckExpression,
} from '../semantics/expressions/check-expression.js'
import { applyColor, keyColor, punctuation } from './unparsing-utilities.js'

export type SemanticContext = 'apply' | 'default'

type Context = {
  readonly unparseAtomOrMolecule: UnparseAtomOrMolecule
  readonly semanticContext: SemanticContext
}

export type UnparseAtomOrMolecule = (
  semanticContext: SemanticContext,
) => (value: Atom | Molecule) => Either<UnserializableValueError, string>

export const moleculeUnparser =
  (semanticContext: SemanticContext) =>
  (
    unparseAtomOrMolecule: UnparseAtomOrMolecule,
    unparseSugarFreeMolecule: (
      expression: Molecule,
      context: Context,
    ) => Either<UnserializableValueError, string>,
  ) => {
    const context: Context = { unparseAtomOrMolecule, semanticContext }
    const sugar = unparseSugaredExpression(context, unparseSugarFreeMolecule)
    return (value: Molecule): Either<UnserializableValueError, string> => {
      const keyword = option.match(orderedRecord.get(value, '0'), {
        none: () => undefined,
        some: keyword => keyword,
      })
      switch (keyword) {
        case '@apply':
          return sugar(value, readApplyExpression, unparseSugaredApply)
        case '@check':
          return sugar(value, readCheckExpression, unparseSugaredCheck)
        case '@function':
          return sugar(value, readFunctionExpression, unparseSugaredFunction)
        case '@hole':
          return sugar(value, readHoleExpression, unparseSugaredHole)
        case '@index':
          return sugar(value, readIndexExpression, unparseSugaredIndex)
        case '@lookup':
          return sugar(value, readLookupExpression, unparseSugaredLookup)
        case '@union':
          return sugar(value, readUnionExpression, unparseSugaredUnion)
        default: {
          const potentialKeywordExpression = asSemanticGraph(value)
          if (isExpression(potentialKeywordExpression)) {
            const result = unparseSugaredGeneralizedKeywordExpression(
              potentialKeywordExpression,
              context,
            )
            return either.flatMapLeft(result, _ =>
              unparseSugarFreeMolecule(value, context),
            )
          } else {
            return unparseSugarFreeMolecule(value, context)
          }
        }
      }
    }
  }

export const moleculeAsKeyValuePairStrings = (
  value: Molecule,
  { unparseAtomOrMolecule, semanticContext }: Context,
  options: { readonly ordinalKeys: 'omit' | 'preserve' },
): Either<UnserializableValueError, readonly string[]> => {
  const { colon, openGroupingParenthesis, closeGroupingParenthesis } =
    punctuation(styleText)
  const entries = value.entries

  const keyValuePairsAsStrings: string[] = []
  let ordinalPropertyKeyCounter = 0n
  for (const [propertyKey, propertyValue] of entries) {
    const valueAsStringResult =
      unparseAtomOrMolecule(semanticContext)(propertyValue)
    if (either.isLeft(valueAsStringResult)) {
      return valueAsStringResult
    }

    // Omit ordinal property keys:
    if (
      propertyKey === String(ordinalPropertyKeyCounter) &&
      options.ordinalKeys === 'omit'
    ) {
      keyValuePairsAsStrings.push(
        // If the property value is something like an anonymous function or an
        // infix operation then it needs parentheses when the key is omitted. We
        // can skip the parentheses when this is the only property.
        isNonCompactExpression(propertyValue) && entries.length !== 1 ?
          openGroupingParenthesis.concat(
            valueAsStringResult.value,
            closeGroupingParenthesis,
          )
        : valueAsStringResult.value,
      )
      ordinalPropertyKeyCounter += 1n
    } else {
      keyValuePairsAsStrings.push(
        styleText(
          keyColor,
          quoteAtomIfNecessary(propertyKey).concat(colon),
        ).concat(' ', valueAsStringResult.value),
      )
    }
  }
  return either.makeRight(keyValuePairsAsStrings)
}

export const unparseAtom = (atom: string): Right<string> =>
  either.makeRight(
    /^@[^@]/.test(atom) ?
      styleText(['bold', 'underline'], quoteAtomIfNecessary(atom))
    : quoteAtomIfNecessary(atom),
  )

export const quoteAtomIfNecessary = (value: string): string => {
  const { quote } = punctuation(styleText)
  if (requiresQuotation(value)) {
    return quote.concat(escapeStringContents(value), quote)
  } else {
    return value
  }
}

const requiresQuotation = (atom: string): boolean =>
  either.isLeft(parsing.parse(unquotedAtomParser, atom))

const quoteKeyPathComponentIfNecessary = (value: string): string => {
  const { quote } = punctuation(styleText)
  const unquotedAtomResult = parsing.parse(unquotedAtomParser, value)
  if (either.isLeft(unquotedAtomResult) || value.includes('.')) {
    return quote.concat(escapeStringContents(value), quote)
  } else {
    return value
  }
}

const serializeIfNeeded = (
  nodeOrMolecule: SemanticGraph | Molecule,
): Either<UnserializableValueError, Atom | Molecule> =>
  isSemanticGraph(nodeOrMolecule) ?
    serialize(nodeOrMolecule)
  : either.makeRight(nodeOrMolecule)

const escapeStringContents = (value: string) =>
  value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')

const unparseSugaredExpression =
  (
    context: Context,
    unparseSugarFreeMolecule: (
      expression: Molecule,
      context: Context,
    ) => Either<UnserializableValueError, string>,
  ) =>
  <
    SpecificExpression extends ObjectNode & {
      readonly 0: `@${string}`
      readonly 1?: {}
    },
  >(
    value: Molecule,
    readSpecificExpression: (
      node: SemanticGraph,
    ) => Either<ElaborationError, SpecificExpression>,
    unparseSpecificExpression: (
      expression: SpecificExpression,
      context: Context,
    ) => Either<UnserializableValueError, string>,
  ) =>
    either.match(readSpecificExpression(asSemanticGraph(value)), {
      left: _ => unparseSugarFreeMolecule(value, context),
      right: expression => unparseSpecificExpression(expression, context),
    })

const unparseSugaredApply = (
  expression: ApplyExpression,
  { unparseAtomOrMolecule, semanticContext }: Context,
) => {
  const {
    openGroupingParenthesis,
    closeGroupingParenthesis,
    openApplyParenthesis,
    closeApplyParenthesis,
  } = punctuation(styleText)

  const infixSugaredApply = either.flatMap(
    readInfixOperation(expression),
    ({ operand1, operatorLookupKey, operatorIndexExpression, operand2 }) => {
      // Infix syntax is probably appropriate.
      const unparsedOperand1 = either.map(
        either.flatMap(
          serializeIfNeeded(operand1),
          unparseAtomOrMolecule(semanticContext),
        ),
        unparsedOperand1 =>
          isTightlyBoundNonCompactExpression(operand1) ?
            openGroupingParenthesis.concat(
              unparsedOperand1,
              closeGroupingParenthesis,
            )
          : unparsedOperand1,
      )
      const unparsedOperand2 = either.map(
        either.flatMap(
          serializeIfNeeded(operand2),
          unparseAtomOrMolecule(semanticContext),
        ),
        unparsedOperand2 =>
          isNonCompactExpression(operand2) ?
            openGroupingParenthesis.concat(
              unparsedOperand2,
              closeGroupingParenthesis,
            )
          : unparsedOperand2,
      )

      // Operators omit the leading `:`, but otherwise look like lookups
      // (possibly followed by indexes).
      const unparsedOperator = styleText(applyColor, operatorLookupKey).concat(
        option.match(operatorIndexExpression, {
          some: operatorIndexExpression =>
            either.unwrapOrElse(
              unparseKeyPathOfSugaredIndex(operatorIndexExpression[1].query, {
                unparseAtomOrMolecule,
                semanticContext: 'apply',
              }),
              _ => '',
            ),
          none: _ => '',
        }),
      )

      return either.flatMap(unparsedOperand1, unparsedOperand1 =>
        either.map(unparsedOperand2, unparsedOperand2 =>
          unparsedOperand1.concat(' ', unparsedOperator, ' ', unparsedOperand2),
        ),
      )
    },
  )

  return either.flatMapLeft(infixSugaredApply, _ => {
    // Fall back to non-infix syntax.
    const unparsedFunction = either.map(
      either.flatMap(
        serializeIfNeeded(expression[1].function),
        unparseAtomOrMolecule('apply'),
      ),
      unparsedFunction =>
        isNonCompactExpression(expression[1].function) ?
          // It's an immediately-applied anonymous function.
          openGroupingParenthesis.concat(
            unparsedFunction,
            closeGroupingParenthesis,
          )
        : unparsedFunction,
    )
    const unparsedArgument = either.flatMap(
      serializeIfNeeded(expression[1].argument),
      unparseAtomOrMolecule(semanticContext),
    )
    return either.flatMap(unparsedFunction, unparsedFunction =>
      either.map(unparsedArgument, unparsedArgument =>
        unparsedFunction.concat(
          openApplyParenthesis,
          unparsedArgument,
          closeApplyParenthesis,
        ),
      ),
    )
  })
}

// `type ~> body` is sugar for `(_: type) => body`, so it applies when the
// parameter is the ignored name `_` and it has an explicit type annotation
// which isn't the top type (in which case `_ => body` is preferred).
const signatureSugarTypeAnnotation = (
  expression: FunctionExpression,
): Option<SemanticGraph> =>
  getParameterName(expression) !== ignoredKey ?
    option.none
  : option.flatMap(getParameterTypeAnnotation(expression), typeAnnotation =>
      isTopType(typeAnnotation) ? option.none : option.makeSome(typeAnnotation),
    )

const unparseSugaredFunction = (
  expression: FunctionExpression,
  context: Context,
): Either<UnserializableValueError, string> => {
  const {
    openGroupingParenthesis,
    closeGroupingParenthesis,
    functionArrow,
    signatureArrow,
  } = punctuation(styleText)
  return option.match(signatureSugarTypeAnnotation(expression), {
    some: typeAnnotation =>
      // Unparse using `~>` notation.
      either.flatMap(
        either.flatMap(
          serializeIfNeeded(typeAnnotation),
          context.unparseAtomOrMolecule('default'),
        ),
        typeAnnotationAsString => {
          const possiblyParenthesizedTypeAnnotation =
            isNonCompactExpression(typeAnnotation) ?
              openGroupingParenthesis.concat(
                typeAnnotationAsString,
                closeGroupingParenthesis,
              )
            : typeAnnotationAsString
          return either.map(
            either.flatMap(
              serializeIfNeeded(expression[1].body),
              context.unparseAtomOrMolecule('default'),
            ),
            bodyAsString =>
              [
                possiblyParenthesizedTypeAnnotation,
                signatureArrow,
                bodyAsString,
              ].join(' '),
          )
        },
      ),
    none: _ =>
      // Unparse using `=>` notation.
      either.flatMap(
        unparseSugaredFunctionParameter(expression, context),
        parameterAsString =>
          either.flatMap(
            serializeIfNeeded(expression[1].body),
            serializedBody =>
              either.map(
                context.unparseAtomOrMolecule('default')(serializedBody),
                bodyAsString =>
                  [parameterAsString, functionArrow, bodyAsString].join(' '),
              ),
          ),
      ),
  })
}

const unparseSugaredFunctionParameter = (
  expression: FunctionExpression,
  { unparseAtomOrMolecule }: Context,
): Either<UnserializableValueError, string> => {
  const parameterName = styleText(keyColor, getParameterName(expression))
  return option.match(getParameterTypeAnnotation(expression), {
    none: () => either.makeRight(parameterName),
    some: typeAnnotation =>
      either.flatMap(
        serializeIfNeeded(typeAnnotation),
        serializedTypeAnnotation =>
          either.map(
            unparseAtomOrMolecule('default')(serializedTypeAnnotation),
            typeAnnotationAsString => {
              const {
                openGroupingParenthesis,
                closeGroupingParenthesis,
                typeAnnotationColon,
              } = punctuation(styleText)
              return openGroupingParenthesis.concat(
                parameterName,
                typeAnnotationColon,
                ' ',
                typeAnnotationAsString,
                closeGroupingParenthesis,
              )
            },
          ),
      ),
  })
}

const unparseSugaredIndex = (
  expression: IndexExpression,
  { unparseAtomOrMolecule, semanticContext }: Context,
) => {
  const objectUnparseResult = either.flatMap(
    serializeIfNeeded(expression[1].object),
    unparseAtomOrMolecule(semanticContext),
  )
  return either.flatMap(objectUnparseResult, unparsedObject =>
    either.map(
      unparseKeyPathOfSugaredIndex(expression[1].query, {
        unparseAtomOrMolecule,
        semanticContext,
      }),
      unparsedKeyPath => unparsedObject.concat(unparsedKeyPath),
    ),
  )
}

const unparseKeyPathOfSugaredIndex = (
  query: ObjectNode,
  { unparseAtomOrMolecule, semanticContext }: Context,
): Either<UnserializableValueError, string> => {
  const { dot, colon, openGroupingParenthesis, closeGroupingParenthesis } =
    punctuation(styleText)
  const componentResults = Object.entries(query).map(
    ([key, value], index): Either<UnserializableValueError, string> =>
      // Keys must be sequential ("0", "1", …) to use the dotted sugar.
      key !== String(index) ?
        either.makeLeft({
          kind: 'unserializableValue',
          message: 'invalid key path',
        })
        // A literal atom uses `.a`.
      : typeof value === 'string' ?
        either.makeRight(quoteKeyPathComponentIfNecessary(value))
      : either.match(readLookupExpression(value), {
          // A `@lookup` uses `.:key`.
          right: lookup =>
            either.makeRight(
              colon.concat(quoteKeyPathComponentIfNecessary(lookup[1].key)),
            ),
          // Any other expression uses `.(…)`.
          left: _ =>
            either.map(
              either.flatMap(
                serializeIfNeeded(value),
                unparseAtomOrMolecule('default'),
              ),
              unparsedExpression =>
                openGroupingParenthesis.concat(
                  unparsedExpression,
                  closeGroupingParenthesis,
                ),
            ),
        }),
  )

  return either.map(either.sequence(componentResults), components =>
    styleText(
      semanticContext === 'apply' ? applyColor : keyColor,
      dot.concat(components.join(dot)),
    ),
  )
}

const unparseSugaredLookup = (
  expression: LookupExpression,
  { semanticContext }: Context,
) =>
  either.makeRight(
    styleText(
      semanticContext === 'apply' ? applyColor : keyColor,
      punctuation(styleText).colon.concat(
        quoteKeyPathComponentIfNecessary(expression[1].key),
      ),
    ),
  )

const isTopType = (value: SemanticGraph): boolean =>
  value === types.somethingTypeSymbol ||
  either.match(
    either.flatMap(readIndexExpression(value), ({ 1: { object, query } }) =>
      query[0] === 'type' && Object.keys(query).length === 1 ?
        readLookupExpression(object)
      : either.makeLeft(undefined),
    ),
    {
      right: lookupExpression => lookupExpression[1].key === 'something',
      left: _ => false,
    },
  )

const unparseSugaredHole = (
  expression: HoleExpression,
  { unparseAtomOrMolecule }: Context,
) => {
  const {
    openGroupingParenthesis,
    closeGroupingParenthesis,
    typeAnnotationColon,
  } = punctuation(styleText)
  const { name, constraint } = expression[1]
  const holeNameWithSigil = styleText(
    keyColor,
    name === ignoredKey ? '?' : (
      '?'.concat(quoteKeyPathComponentIfNecessary(name))
    ),
  )
  if (isTopType(constraint.assignableTo)) {
    // Omit the constraint if it's the top type.
    return either.makeRight(holeNameWithSigil)
  } else {
    return either.map(
      either.flatMap(
        serializeIfNeeded(constraint.assignableTo),
        unparseAtomOrMolecule('default'),
      ),
      constraintAsString =>
        openGroupingParenthesis.concat(
          holeNameWithSigil,
          typeAnnotationColon,
          ' ',
          constraintAsString,
          closeGroupingParenthesis,
        ),
    )
  }
}

const unparseSugaredCheck = (
  expression: CheckExpression,
  { unparseAtomOrMolecule }: Context,
) => {
  const { openGroupingParenthesis, closeGroupingParenthesis, tilde } =
    punctuation(styleText)
  return either.flatMap(
    either.map(
      either.flatMap(
        serializeIfNeeded(expression[1].value),
        unparseAtomOrMolecule('default'),
      ),
      valueAsString =>
        isNonCompactExpression(expression[1].value) ?
          openGroupingParenthesis.concat(
            valueAsString,
            closeGroupingParenthesis,
          )
        : valueAsString,
    ),
    valueAsString =>
      either.map(
        either.flatMap(
          serializeIfNeeded(expression[1].type),
          unparseAtomOrMolecule('default'),
        ),
        typeAsString => {
          const possiblyParenthesizedType =
            isNonCompactExpression(expression[1].type) ?
              openGroupingParenthesis.concat(
                typeAsString,
                closeGroupingParenthesis,
              )
            : typeAsString
          return [valueAsString, tilde, possiblyParenthesizedType].join(' ')
        },
      ),
  )
}

const unparseSugaredUnion = (
  expression: UnionExpression,
  { unparseAtomOrMolecule, semanticContext }: Context,
) => {
  const { openGroupingParenthesis, closeGroupingParenthesis, unionBar } =
    punctuation(styleText)

  const members = Object.values(expression[1])

  if (members.length === 0) {
    return unparseSugaredIndex(getBottomTypeAsSemanticGraph(), {
      unparseAtomOrMolecule,
      semanticContext,
    })
  } else {
    // Unparse each member, adding parentheses when needed.
    return members.reduce(
      (unparsedUnion: Either<UnserializableValueError, string>, member) =>
        either.flatMap(unparsedUnion, unionAsString =>
          either.map(
            either.flatMap(
              serializeIfNeeded(member),
              unparseAtomOrMolecule(semanticContext),
            ),
            memberAsString => {
              const possiblyParenthesizedMember =
                isNonCompactExpression(member) ?
                  openGroupingParenthesis.concat(
                    memberAsString,
                    closeGroupingParenthesis,
                  )
                : memberAsString

              return unionAsString === '' ?
                  possiblyParenthesizedMember
                : unionAsString.concat(
                    ' ',
                    unionBar,
                    ' ',
                    possiblyParenthesizedMember,
                  )
            },
          ),
        ),
      either.makeRight(''),
    )
  }
}

const unparseSugaredGeneralizedKeywordExpression = (
  expression: Expression,
  { unparseAtomOrMolecule, semanticContext }: Context,
) => {
  if (
    // Not every valid keyword expression can be expressed with the generalized
    // sugar, e.g. if there are any additional properties besides the keyword
    // and its argument, or if the keyword requires quotation (which won't be
    // the case for any built-in keywords, but maybe eventually users will be
    // able to create custom keywords).
    requiresQuotation(expression['0'].substring(1)) ||
    Object.keys(expression).some(key => key !== '0' && key !== '1')
  ) {
    return either.makeLeft({
      kind: 'unserializableValue',
      message:
        'expression cannot be faithfully represented using generalized keyword expression sugar',
    })
  } else {
    const unparsedKeyword = styleText(['bold', 'underline'], expression['0'])
    if ('1' in expression) {
      return either.map(
        either.flatMap(serializeIfNeeded(expression['1']), expressionArgument =>
          unparseAtomOrMolecule(semanticContext)(
            // If there's only a single property in the argument, unparse it
            // with an implicit key (e.g. `@runtime { a => b }` rather than
            // `@runtime { function: a => b }`).
            (
              typeof expressionArgument !== 'string' &&
                orderedRecord.size(expressionArgument) === 1
            ) ?
              orderedRecord.mapKeys(expressionArgument, _ => '0')
            : expressionArgument,
          ),
        ),
        unparsedArgument => unparsedKeyword.concat(' ', unparsedArgument),
      )
    } else {
      return either.makeRight(unparsedKeyword)
    }
  }
}

/**
 * An apply should be written in infix notation if it is immediately applied
 * again to another operand and the function is a resolved via a lookup (it's
 * not anonymous).
 */
const readInfixOperation = (expression: ApplyExpression) =>
  either.flatMap(readApplyExpression(expression[1].function), innerApply => {
    // Support indexed lookups and bare lookups.
    const optionalOperatorIndexExpression = either.match(
      readIndexExpression(innerApply[1].function),
      {
        left: _ => option.none,
        right: option.makeSome,
      },
    )
    const lookupExpression = option.match(optionalOperatorIndexExpression, {
      none: _ => innerApply[1].function,
      some: operatorIndexExpression => operatorIndexExpression[1].object,
    })

    return either.map(
      readLookupExpression(lookupExpression),
      lookupExpression =>
        ({
          operand1: expression[1].argument,
          operatorLookupKey: lookupExpression[1].key,
          operatorIndexExpression: optionalOperatorIndexExpression,
          operand2: innerApply[1].argument,
        }) as const,
    )
  })

const isTightlyBoundNonCompactExpression = (
  expression: SemanticGraph | Molecule,
) =>
  either.isRight(readCheckExpression(asSemanticGraph(expression))) ||
  either.isRight(readFunctionExpression(asSemanticGraph(expression)))

const isNonCompactExpression = (expression: SemanticGraph | Molecule) =>
  isTightlyBoundNonCompactExpression(expression) ||
  either.match(readUnionExpression(asSemanticGraph(expression)), {
    // Empty unions render as `:nothing.type`.
    right: unionExpression => Object.values(unionExpression[1]).length !== 0,
    left: _ => false,
  }) ||
  either.isRight(
    either.flatMap(
      readApplyExpression(asSemanticGraph(expression)),
      readInfixOperation,
    ),
  )

const getBottomTypeAsSemanticGraph = () =>
  makeIndexExpression({
    object: makeLookupExpression('nothing'),
    query: objectNodeFromOrderedEntries([['0', 'type']]),
  })
