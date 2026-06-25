import { map, sequence, type Parser } from '@matt.kantor/parsing'
import type { Atom } from './atom.js'
import { expression, type Molecule } from './expression.js'
import type { SpannedTree } from './spans.js'
import { optionalTrivia } from './trivia.js'

export type SyntaxTree = Atom | Molecule

export const syntaxTreeParser: Parser<SpannedTree> = map(
  sequence([optionalTrivia, expression, optionalTrivia]),
  ([_leadingTrivia, syntaxTree, _trailingTrivia]) => syntaxTree,
)
