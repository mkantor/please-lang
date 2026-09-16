import either, { type Either } from '@matt.kantor/either'
import type { Configuration } from '../configuration.js'
import type { CompilationError } from '../errors.js'
import type { ExpressionSpans, SyntaxTree } from '../parsing.js'
import {
  elaborateWithContext,
  makeInitialElaborationContext,
  serialize,
  type ExpressionContext,
  type Output,
} from '../semantics.js'
import { keywordHandlers } from './semantics/keywords.js'

export type CompilationWithContext = {
  readonly context: ExpressionContext
  readonly output: Either<CompilationError, Output>
}

export const compileWithContext =
  (configuration: Configuration) =>
  (syntaxTree: SyntaxTree, spans: ExpressionSpans): CompilationWithContext => {
    const context = makeInitialElaborationContext(
      configuration,
      syntaxTree,
      keywordHandlers,
      spans,
    )
    return {
      context,
      output: either.flatMap(
        elaborateWithContext(syntaxTree, context),
        serialize,
      ),
    }
  }

export const compile =
  (configuration: Configuration) =>
  (
    syntaxTree: SyntaxTree,
    spans: ExpressionSpans,
  ): Either<CompilationError, Output> =>
    compileWithContext(configuration)(syntaxTree, spans).output
