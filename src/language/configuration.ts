/**
 * Options which affect how a program is elaborated and evaluated.
 */
export type Configuration = {
  /**
   * The speculation budget: how many speculative applications (those begun
   * while eagerly elaborating the body of a not-yet-applied `@function`) one
   * application chain may contain.
   *
   * Separate detection of self-referential functions usually stops speculation
   * early, so this only takes effect in situations which evade it (e.g.
   * functions re-minted from serialized copies).
   */
  readonly speculativeApplicationDepthLimit: number
  /**
   * The demanded budget: how deep the call stack may get when a return value is
   * actually demanded by the the program (it's not speculative). This is meant
   * to protect against unbounded recursion.
   *
   * Each in-flight application occupies many JavaScript stack frames, so this
   * must stay comfortably below the depth which overflows the JavaScript stack
   * to avoid ugly `RangeError` crashes. Future refactors/optimizations may
   * allow raising it.
   */
  readonly demandedApplicationDepthLimit: number
}

export const defaultConfiguration: Configuration = {
  speculativeApplicationDepthLimit: 8,
  demandedApplicationDepthLimit: 256,
}
