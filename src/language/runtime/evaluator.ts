import either, { type Either } from '@matt.kantor/either'
import type { Configuration } from '../configuration.js'
import type { RuntimeError } from '../errors.js'
import type { SyntaxTree } from '../parsing.js'
import { elaborate, serialize, type Output } from '../semantics.js'
import { keywordHandlers } from './keywords.js'

export const evaluate =
  (configuration: Configuration) =>
  (syntaxTree: SyntaxTree): Either<RuntimeError, Output> => {
    const semanticGraphResult = elaborate(configuration)(
      syntaxTree,
      keywordHandlers,
    )
    return either.flatMap(semanticGraphResult, serialize)
  }
