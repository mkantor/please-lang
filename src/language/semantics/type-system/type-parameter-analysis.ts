import { simplifyUnionType } from './subtyping.js'
import { matchTypeFormat } from './type-formats/match-type-format.js'
import { type TypeParameter } from './type-formats/type-parameter-type.js'
import { isCanonicalTopType, type Type } from './type-formats/type.js'
import { makeUnionType, type UnionType } from './type-formats/union-type.js'
import {
  functionParameterKey,
  functionReturnKey,
  stringifyTypeKeyPathForInternalUse,
  typeParameterAssignableToConstraintKey,
  type TypeKeyPath,
  type TypeKeyPathStringifiedForInternalUse,
} from './type-key-path.js'

type UnionOfTypeParameters = Omit<UnionType, 'members'> & {
  readonly members: ReadonlySet<TypeParameter>
}
export type TypeParametersByKeyPath = Map<
  TypeKeyPathStringifiedForInternalUse,
  {
    readonly keyPath: TypeKeyPath
    readonly typeParameters: UnionOfTypeParameters
  }
>

export const containedTypeParameters = (type: Type): TypeParametersByKeyPath =>
  containedTypeParametersImplementation(type, [])

const containedTypeParametersImplementation = (
  type: Type,
  root: TypeKeyPath,
): TypeParametersByKeyPath => {
  // Avoid infinite recursion when we hit the top type.
  if (isCanonicalTopType(type)) {
    return new Map()
  } else {
    return matchTypeFormat<TypeParametersByKeyPath>(type, {
      function: ({ signature }) =>
        mergeTypeParametersByKeyPath(
          containedTypeParametersImplementation(signature.parameter, [
            ...root,
            functionParameterKey,
          ]),
          containedTypeParametersImplementation(signature.return, [
            ...root,
            functionReturnKey,
          ]),
        ),
      object: type =>
        [
          ...Object.entries(type.children).map(([key, child]) =>
            containedTypeParametersImplementation(child, [...root, key]),
          ),
          // Excess clauses may also contain type parameters (which need to be
          // visible here for stuckness detection). There's no way to talk about
          // them in `TypeKeyPath`, so they're currently (imprecisely) reported
          // at the object's own key path.
          // TODO: Should there be a `TypeKeyPath` symbol to allow addressing
          // excess clauses explicitly?
          ...type.excess.flatMap(clause => [
            containedTypeParametersImplementation(clause.keys, root),
            containedTypeParametersImplementation(clause.values, root),
          ]),
        ].reduce(mergeTypeParametersByKeyPath, new Map()),
      application: type =>
        mergeTypeParametersByKeyPath(
          containedTypeParametersImplementation(type.function, root),
          containedTypeParametersImplementation(type.argument, root),
        ),
      indexedAccess: type =>
        mergeTypeParametersByKeyPath(
          containedTypeParametersImplementation(type.object, root),
          containedTypeParametersImplementation(type.key, root),
        ),
      intrinsicApplication: type =>
        [...type.parameterTypes, type.computeUpperBound(type.parameterTypes)]
          .map(type => containedTypeParametersImplementation(type, root))
          .reduce(mergeTypeParametersByKeyPath, new Map()),
      opaque: _ => new Map(),
      parameter: type =>
        mergeTypeParametersByKeyPath(
          containedTypeParametersImplementation(type.constraint.assignableTo, [
            ...root,
            typeParameterAssignableToConstraintKey,
          ]),
          new Map([
            [
              stringifyTypeKeyPathForInternalUse(root),
              {
                keyPath: root,
                typeParameters: makeUnionType([type]),
              },
            ],
          ]),
        ),
      union: ({ members }) =>
        members
          .values()
          .map(member =>
            typeof member === 'string' ?
              new Map()
            : containedTypeParametersImplementation(member, root),
          )
          .reduce(mergeTypeParametersByKeyPath, new Map()),
    })
  }
}

/**
 * Identities of all type parameters within function parameters in `type`.
 */
export const typeParameterIdentitiesWithinFunctionParameters = (
  type: Type,
): ReadonlySet<symbol> =>
  new Set(
    containedTypeParameters(type)
      .values()
      .filter(({ keyPath }) => keyPath.includes(functionParameterKey))
      .flatMap(({ typeParameters }) =>
        typeParameters.members.values().map(({ identity }) => identity),
      ),
  )

export const typeParameterIdentitiesWithinType = (
  type: Type,
): ReadonlySet<symbol> =>
  new Set(
    containedTypeParameters(type)
      .values()
      .flatMap(({ typeParameters }) =>
        typeParameters.members
          .values()
          .map(typeParameter => typeParameter.identity),
      ),
  )

const mergeTypeParametersByKeyPath = (
  a: TypeParametersByKeyPath,
  b: TypeParametersByKeyPath,
): TypeParametersByKeyPath => {
  const result: TypeParametersByKeyPath = new Map()
  // Merge entries present in `a` with any corresponding entry in `b`.
  for (const [key, { keyPath, typeParameters }] of a) {
    const valueFromB = b.get(key)
    if (valueFromB === undefined) {
      result.set(key, { keyPath, typeParameters })
    } else {
      // Merge all type(s) at this key path into a (simplified) union.
      const supposedTypeParametersAsArray = [
        ...simplifyUnionType(
          makeUnionType([
            ...typeParameters.members,
            ...valueFromB.typeParameters.members,
          ]),
        ).members,
      ]
      if (
        !supposedTypeParametersAsArray.every(
          supposedTypeParameter =>
            typeof supposedTypeParameter !== 'string' &&
            supposedTypeParameter.kind == 'parameter',
        )
      ) {
        throw new Error(
          'Union type member was unexpectedly not a type parameter. This is a bug!',
        )
      }

      result.set(key, {
        keyPath,
        typeParameters: makeUnionType(supposedTypeParametersAsArray),
      })
    }
  }
  // Add any leftovers present in `b`.
  for (const [key, value] of b) {
    if (!result.has(key)) {
      result.set(key, value)
    }
  }
  return result
}
