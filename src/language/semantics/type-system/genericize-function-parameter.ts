import type { Atom } from '../../parsing.js'
import { makeFunctionType } from './type-formats/function-type.js'
import { matchTypeFormat } from './type-formats/match-type-format.js'
import { makeObjectType } from './type-formats/object-type.js'
import { makeTypeParameter } from './type-formats/type-parameter-type.js'
import type { Type } from './type-formats/type.js'
import {
  functionParameterKey,
  functionReturnKey,
  stringifyTypeKeyPathForEndUser,
  type TypeKeyPath,
} from './type-key-path.js'

export type GenericizedFunctionParameterAnnotation = {
  readonly type: Type
  readonly typeParametersBoundByFunction: ReadonlySet<symbol>
}

/**
 * Traverse a function parameter type annotation, replacing each opaque or union
 * leaf with a fresh `TypeParameter` constrained to the leaf. This is used to
 * make functions implicitly generic, even when annotated. For example:
 *
 * ```plz
 * ((x: { a: :integer.type }) => :x.a)({ a: 42 }) ~ 42
 * ```
 */
export const genericizeFunctionParameterAnnotation = (
  parameterName: Atom,
  annotationType: Type,
): GenericizedFunctionParameterAnnotation =>
  genericizeFunctionParameterAnnotationAtKeyPath(
    parameterName,
    annotationType,
    [],
    false,
  )

const genericizeFunctionParameterAnnotationAtKeyPath = (
  parameterName: Atom,
  type: Type,
  keyPath: TypeKeyPath,
  // If the annotation contains function types, their type parameters are rigid.
  isWithinNestedFunctionType: boolean,
): GenericizedFunctionParameterAnnotation =>
  matchTypeFormat(type, {
    function: type => {
      const parameter = genericizeFunctionParameterAnnotationAtKeyPath(
        parameterName,
        type.signature.parameter,
        [...keyPath, functionParameterKey],
        true,
      )
      const returnValue = genericizeFunctionParameterAnnotationAtKeyPath(
        parameterName,
        type.signature.return,
        [...keyPath, functionReturnKey],
        true,
      )
      return {
        type: makeFunctionType({
          parameter: parameter.type,
          return: returnValue.type,
        }),
        typeParametersBoundByFunction: new Set([
          ...parameter.typeParametersBoundByFunction,
          ...returnValue.typeParametersBoundByFunction,
        ]),
      }
    },
    object: type => {
      if (Object.keys(type.children).length === 0) {
        // Treat empty object types as leaves to make sure that functions like
        // `(a: :object.type) => :a` are genericized.
        return genericizeLeaf(
          parameterName,
          keyPath,
          isWithinNestedFunctionType,
        )(type)
      } else {
        const children = Object.entries(type.children).map(
          ([key, child]) =>
            [
              key,
              genericizeFunctionParameterAnnotationAtKeyPath(
                parameterName,
                child,
                [...keyPath, key],
                isWithinNestedFunctionType,
              ),
            ] as const,
        )
        return {
          type: makeObjectType(
            Object.fromEntries(
              children.map(([key, child]) => [key, child.type]),
            ),
            type.excess,
          ),
          typeParametersBoundByFunction: new Set(
            children.flatMap(([_key, child]) => [
              ...child.typeParametersBoundByFunction,
            ]),
          ),
        }
      }
    },
    opaque: genericizeLeaf(parameterName, keyPath, isWithinNestedFunctionType),
    parameter: doNotGenericizeLeaf,
    application: doNotGenericizeLeaf,
    indexedAccess: doNotGenericizeLeaf,
    intrinsicApplication: doNotGenericizeLeaf,
    union: genericizeLeaf(parameterName, keyPath, isWithinNestedFunctionType),
  })

const genericizeLeaf =
  (
    parameterName: Atom,
    keyPath: TypeKeyPath,
    isWithinNestedFunctionType: boolean,
  ) =>
  (leafType: Type): GenericizedFunctionParameterAnnotation => {
    const typeParameter = makeTypeParameter(
      synthesizeTypeParameterName(parameterName, keyPath),
      { assignableTo: leafType },
    )
    return {
      type: typeParameter,
      typeParametersBoundByFunction: new Set(
        isWithinNestedFunctionType ? [] : [typeParameter.identity],
      ),
    }
  }

const doNotGenericizeLeaf = (
  leafType: Type,
): GenericizedFunctionParameterAnnotation => ({
  type: leafType,
  typeParametersBoundByFunction: new Set(),
})

const synthesizeTypeParameterName = (
  parameterName: Atom,
  keyPath: TypeKeyPath,
): string => parameterName.concat(stringifyTypeKeyPathForEndUser(keyPath))
