import { something } from './prelude-types.js'
import { simplifyUnionType } from './subtyping.js'
import {
  makeUnionType,
  matchTypeFormat,
  type Type,
  type TypeParameter,
  type UnionType,
} from './type-formats.js'
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
  if (type === something) {
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
        Object.entries(type.children)
          .map(([key, child]) =>
            containedTypeParametersImplementation(child, [...root, key]),
          )
          .reduce(mergeTypeParametersByKeyPath, new Map()),
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

export const findKeyPathsToTypeParameter = (
  type: Type,
  typeParameterToFind: TypeParameter,
): Set<TypeKeyPath> =>
  findKeyPathsToTypeParameterImplementation(type, typeParameterToFind, [])

const findKeyPathsToTypeParameterImplementation = (
  type: Type,
  typeParameterToFind: TypeParameter,
  root: TypeKeyPath,
): Set<TypeKeyPath> => {
  // Avoid infinite recursion when we hit the top type.
  if (type === something) {
    return new Set()
  } else {
    return matchTypeFormat(type, {
      function: ({ signature }) =>
        new Set([
          ...findKeyPathsToTypeParameterImplementation(
            signature.parameter,
            typeParameterToFind,
            [...root, functionParameterKey],
          ),
          ...findKeyPathsToTypeParameterImplementation(
            signature.return,
            typeParameterToFind,
            [...root, functionReturnKey],
          ),
        ]),
      object: type =>
        Object.entries(type.children)
          .map(([key, child]) =>
            findKeyPathsToTypeParameterImplementation(
              child,
              typeParameterToFind,
              [...root, key],
            ),
          )
          .reduce(
            (accumulator, paths) => new Set([...accumulator, ...paths]),
            new Set(),
          ),
      application: type =>
        new Set([
          ...findKeyPathsToTypeParameterImplementation(
            type.function,
            typeParameterToFind,
            root,
          ),
          ...findKeyPathsToTypeParameterImplementation(
            type.argument,
            typeParameterToFind,
            root,
          ),
        ]),
      indexedAccess: type =>
        new Set([
          ...findKeyPathsToTypeParameterImplementation(
            type.object,
            typeParameterToFind,
            root,
          ),
          ...findKeyPathsToTypeParameterImplementation(
            type.key,
            typeParameterToFind,
            root,
          ),
        ]),
      intrinsicApplication: type =>
        new Set(
          [
            ...type.parameterTypes,
            type.computeUpperBound(type.parameterTypes),
          ].flatMap(type => [
            ...findKeyPathsToTypeParameterImplementation(
              type,
              typeParameterToFind,
              root,
            ),
          ]),
        ),
      opaque: _ => new Set(),
      parameter: type =>
        new Set([
          ...findKeyPathsToTypeParameterImplementation(
            type.constraint.assignableTo,
            typeParameterToFind,
            [...root, typeParameterAssignableToConstraintKey],
          ),
          ...(type.identity === typeParameterToFind.identity ? [root] : []),
        ]),
      union: ({ members }) =>
        members
          .values()
          .map(
            (member): Set<TypeKeyPath> =>
              typeof member === 'string' ?
                new Set()
              : findKeyPathsToTypeParameterImplementation(
                  member,
                  typeParameterToFind,
                  root,
                ),
          )
          .reduce(
            (accumulator, paths) => new Set([...accumulator, ...paths]),
            new Set(),
          ),
    })
  }
}

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
