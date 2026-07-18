import either, { type Either } from '@matt.kantor/either'
import type { ElaborationError } from '../../../errors.js'
import {
  asSemanticGraph,
  containsAnyUnelaboratedNodes,
  elaborateWithContext,
  inferType,
  isAssignable,
  isExpression,
  isObjectNode,
  makeIfExpression,
  objectNodeFromOrderedEntries,
  orderedEntriesOfObjectNode,
  readIfExpression,
  serialize,
  stringifyTypeForEndUser,
  types,
  type Expression,
  type ExpressionContext,
  type KeyPath,
  type KeywordHandler,
  type SemanticGraph,
} from '../../../semantics.js'

export const ifKeywordHandler: KeywordHandler = (
  expression: Expression,
  context: ExpressionContext,
): Either<ElaborationError, SemanticGraph> =>
  either.flatMap(readIfExpression(expression), ifExpression => {
    // TODO: Make this less ad-hoc.
    if (!('1' in expression) || !isObjectNode(expression[1])) {
      throw new Error(
        '`@if` expression was invalid after being validated. This is a bug!',
      )
    }
    const subexpressionKeyPaths = {
      // Note: this must be kept in alignment with `readIfExpression`.
      condition: ['1', 'condition' in expression[1] ? 'condition' : '0'],
      then: ['1', 'then' in expression[1] ? 'then' : '1'],
      else: ['1', 'else' in expression[1] ? 'else' : '2'],
    }

    return either.flatMap(
      evaluateSubexpression(
        subexpressionKeyPaths.condition,
        context,
        ifExpression[1].condition,
      ),
      elaboratedCondition => {
        if (elaboratedCondition === 'true' || elaboratedCondition === 'false') {
          const branchKey = elaboratedCondition === 'true' ? 'then' : 'else'
          return either.map(
            evaluateSubexpression(
              subexpressionKeyPaths[branchKey],
              context,
              ifExpression[1][branchKey],
            ),
            asSemanticGraph,
          )
        } else {
          return either.flatMap(
            either.flatMap(
              inferType(elaboratedCondition, {
                ...context,
                location: [
                  ...context.location,
                  ...subexpressionKeyPaths.condition,
                ],
              }),
              conditionType =>
                (
                  isAssignable({
                    source: conditionType,
                    target: types.boolean,
                  })
                ) ?
                  either.makeRight(elaboratedCondition)
                : either.makeLeft({
                    kind: 'typeMismatch',
                    message: `\`@if\` condition was not assignable to \`${stringifyTypeForEndUser(types.boolean)}\` (it was \`${stringifyTypeForEndUser(conditionType)}\`)`,
                  }),
            ),
            condition => {
              if (containsAnyUnelaboratedNodes(condition)) {
                // The condition cannot yet be fully elaborated. Do a lightweight
                // pass through the branches to substitute `@lookup`s/`@index`es for
                // values as much as possible. This helps in tricky situations
                // where referenced properties that are higher up in the program
                // get erased before the `@if` can be fully elaborated.

                const doNotElaborate = either.makeRight
                const partiallyElaboratingContext: ExpressionContext = {
                  ...context,
                  keywordHandlers: {
                    '@lookup': context.keywordHandlers['@lookup'],
                    '@index': context.keywordHandlers['@index'],
                    '@check': context.keywordHandlers['@check'],
                    '@apply': analyzeButPreserveExpression(
                      context.keywordHandlers['@apply'],
                    ),
                    '@function': doNotElaborate,
                    '@hole': doNotElaborate,
                    '@if': doNotElaborate,
                    '@object': doNotElaborate,
                    '@panic': doNotElaborate,
                    '@runtime': doNotElaborate,
                    '@todo': doNotElaborate,
                    '@union': doNotElaborate,
                  },
                }

                const elaborateNestedIfLookups = (
                  branch: SemanticGraph,
                  branchLocation: KeyPath,
                ): Either<ElaborationError, SemanticGraph> =>
                  isExpression(branch) && branch['0'] === '@if' ?
                    ifKeywordHandler(branch, {
                      ...partiallyElaboratingContext,
                      location: branchLocation,
                    })
                  : isExpression(branch) && branch['0'] === '@function' ?
                    either.makeRight(branch)
                  : isObjectNode(branch) ?
                    either.map(
                      either.sequence(
                        orderedEntriesOfObjectNode(branch).map(([key, value]) =>
                          either.map(
                            elaborateNestedIfLookups(value, [
                              ...branchLocation,
                              key,
                            ]),
                            elaboratedValue => [key, elaboratedValue] as const,
                          ),
                        ),
                      ),
                      entries => objectNodeFromOrderedEntries(entries),
                    )
                  : either.makeRight(branch)

                const elaborateBranch = (
                  branchKey: 'then' | 'else',
                ): Either<ElaborationError, SemanticGraph> => {
                  const branchLocation = [
                    ...partiallyElaboratingContext.location,
                    ...subexpressionKeyPaths[branchKey],
                  ]
                  return either.flatMap(
                    either.map(
                      evaluateSubexpression(
                        subexpressionKeyPaths[branchKey],
                        partiallyElaboratingContext,
                        ifExpression[1][branchKey],
                      ),
                      asSemanticGraph,
                    ),
                    branch => elaborateNestedIfLookups(branch, branchLocation),
                  )
                }

                return either.map(
                  either.sequence([
                    elaborateBranch('then'),
                    elaborateBranch('else'),
                  ]),
                  ([elaboratedThen, elaboratedElse]) =>
                    makeIfExpression({
                      condition,
                      then: elaboratedThen,
                      else: elaboratedElse,
                    }),
                )
              } else {
                return either.makeLeft({
                  kind: 'invalidExpression',
                  message: 'condition was not boolean',
                })
              }
            },
          )
        }
      },
    )
  })

const evaluateSubexpression = (
  subKeyPath: KeyPath,
  context: ExpressionContext,
  subexpression: SemanticGraph,
) =>
  either.flatMap(serialize(subexpression), serializedSubexpression =>
    elaborateWithContext(serializedSubexpression, {
      ...context,
      location: [...context.location, ...subKeyPath],
    }),
  )

// Run a keyword handler for its static analysis, but preserve the original
// expression.
const analyzeButPreserveExpression =
  (handler: KeywordHandler): KeywordHandler =>
  (expression, context) =>
    either.match(handler(expression, context), {
      right: _ => either.makeRight(expression),
      left: error =>
        error.kind === 'typeMismatch' ?
          either.makeLeft(error)
        : either.makeRight(expression),
    })
