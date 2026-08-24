export type { Atom } from './parsing/atom.js'
export type { Molecule } from './parsing/expression.js'
export { parseJson } from './parsing/json.js'
export {
  parse,
  parseWithSpans,
  type SyntaxTreeWithSpans,
} from './parsing/parser.js'
export { emptyExpressionSpans } from './parsing/spans.js'
export type { ExpressionSpans, PropertyKeySpans } from './parsing/spans.js'
export type { SyntaxTree } from './parsing/syntax-tree.js'
