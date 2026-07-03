import type { KeywordHandlers } from '../../semantics.js'
import { applyKeywordHandler } from './keyword-handlers/apply-handler.js'
import { checkKeywordHandler } from './keyword-handlers/check-handler.js'
import { functionKeywordHandler } from './keyword-handlers/function-handler.js'
import { holeKeywordHandler } from './keyword-handlers/hole-handler.js'
import { ifKeywordHandler } from './keyword-handlers/if-handler.js'
import { indexKeywordHandler } from './keyword-handlers/index-handler.js'
import { lookupKeywordHandler } from './keyword-handlers/lookup-handler.js'
import { panicKeywordHandler } from './keyword-handlers/panic-handler.js'
import { runtimeKeywordHandler } from './keyword-handlers/runtime-handler.js'
import { todoKeywordHandler } from './keyword-handlers/todo-handler.js'
import { unionKeywordHandler } from './keyword-handlers/union-handler.js'

export const keywordHandlers: KeywordHandlers = {
  /**
   * Calls the given function with a given argument.
   */
  '@apply': applyKeywordHandler,

  /**
   * Checks whether a given value is assignable to a given type.
   */
  '@check': checkKeywordHandler,

  /**
   * Creates a function.
   */
  '@function': functionKeywordHandler,

  /**
   * Introduces a type parameter.
   */
  '@hole': holeKeywordHandler,

  /**
   * Conditionally evaluates one of two expressions based on a boolean value.
   */
  '@if': ifKeywordHandler,

  /**
   * Returns the value of a property within an object.
   */
  '@index': indexKeywordHandler,

  /**
   * Gets the value of a property with the given key (using lexical scoping).
   */
  '@lookup': lookupKeywordHandler,

  /**
   * Immediately terminates the process when evaluated.
   */
  '@panic': panicKeywordHandler,

  /**
   * Defers evaluation until runtime.
   */
  '@runtime': runtimeKeywordHandler,

  /**
   * Ignores all properties and evaluates to an empty object.
   */
  '@todo': todoKeywordHandler,

  /**
   * Creates a type union.
   */
  '@union': unionKeywordHandler,
}
