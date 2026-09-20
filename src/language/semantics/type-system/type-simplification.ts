import { simplifyUnionType } from './subtyping.js'
import { isCanonicalTopType, type Type } from './type-formats/type.js'

/**
 * Reduce a type to a semantically-equivalent simpler form.
 *
 * The top type is left alone: it is a union, but rebuilding it would lose the
 * identity marking it as the canonical one (`unionOfTypes` preserves it for the
 * same reason).
 */
export const simplifyType = (type: Type): Type =>
  type.kind === 'union' && !isCanonicalTopType(type) ?
    simplifyUnionType(type)
  : type
