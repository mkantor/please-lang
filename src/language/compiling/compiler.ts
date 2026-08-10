import either, { type Either } from '@matt.kantor/either'
import type { Configuration } from '../configuration.js'
import type { CompilationError } from '../errors.js'
import type { ExpressionSpansByLocation, SyntaxTree } from '../parsing.js'
import { elaborate, serialize, type Output } from '../semantics.js'
import { keywordHandlers } from './semantics/keywords.js'

export const compile =
  (configuration: Configuration) =>
  (
    syntaxTree: SyntaxTree,
    spans: ExpressionSpansByLocation,
  ): Either<CompilationError, Output> => {
    const semanticGraphResult = elaborate(configuration)(
      syntaxTree,
      keywordHandlers,
      spans,
    )
    return either.flatMap(semanticGraphResult, serialize)
  }
