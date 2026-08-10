import either, { type Either } from '@matt.kantor/either'
import { withPhantomData } from '../../../phantom-data.js'
import { testCases, toSyntaxTree } from '../../../test-utilities.test.js'
import type { JsonValue } from '../../../utility-types.js'
import { defaultConfiguration } from '../../configuration.js'
import type { ElaborationError } from '../../errors.js'
import {
  elaborate,
  objectNodeFromMolecule,
  type ElaboratedSemanticGraph,
} from '../../semantics.js'
import { keywordHandlers } from './keywords.js'

export const elaborationSuite = testCases(
  (input: JsonValue) =>
    elaborate(defaultConfiguration)(toSyntaxTree(input), keywordHandlers),
  input => `elaborating \`${JSON.stringify(input)}\``,
)

export const success = (
  expectedOutput: JsonValue,
): Either<ElaborationError, ElaboratedSemanticGraph> => {
  const canonicalized = toSyntaxTree(expectedOutput)
  return either.makeRight(
    withPhantomData<never>()(
      typeof canonicalized === 'string' ? canonicalized : (
        objectNodeFromMolecule(canonicalized)
      ),
    ),
  )
}
