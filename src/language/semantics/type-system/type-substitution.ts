import either, { type Either } from '@matt.kantor/either'
import option, { type Option } from '@matt.kantor/option'
import type { Writable } from '../../../utility-types.js'
import type { FunctionNodeCallError } from '../function-node.js'
import { objectNodeFromOrderedEntries } from '../object-node.js'
import type { SemanticGraph } from '../semantic-graph.js'
import { nothing, something } from './prelude-types.js'
import { isAssignable } from './subtyping.js'
import {
  makeApplicationType,
  makeFunctionType,
  makeIndexedAccessType,
  makeIntrinsicApplicationType,
  makeObjectType,
  makeTypeParameter,
  makeUnionType,
  matchTypeFormat,
  unionOfTypes,
  type FunctionType,
  type ObjectType,
  type Type,
  type TypeParameter,
} from './type-formats.js'
import {
  atomKeyPathComponentFromType,
  functionParameterKey,
  functionReturnKey,
  nestedIndexedAccess,
  typeParameterAssignableToConstraintKey,
  type TypeKeyPath,
} from './type-key-path.js'
import {
  containedTypeParameters,
  typeParameterIdentitiesWithinType,
} from './type-parameter-analysis.js'

/**
 * Drill into `type` using the given `keyPath`, returning the bottom type
 * (`nothing`) whenever no match is found. A union can be drilled into only when
 * every member contains the key path; otherwise `nothing` is returned.
 */
export const applyKeyPathToType = (type: Type, keyPath: TypeKeyPath): Type => {
  const [firstKey, ...remainingKeyPath] = keyPath
  if (firstKey === undefined) {
    // If the key path is empty, this is the type we're looking for.
    return type
  } else if (typeof firstKey === 'object') {
    switch (firstKey.kind) {
      case 'parameter':
        // A type parameter key keeps the access stuck (it reduces once the key
        // is instantiated), but only when the path resolves for the parameter's
        // constraint. Without this guard an instantiation could access a
        // missing property.
        return (
            isNothing(
              applyKeyPathToType(type, [
                firstKey.constraint.assignableTo,
                ...remainingKeyPath,
              ]),
            )
          ) ?
            nothing
          : nestedIndexedAccess(type, [firstKey, ...remainingKeyPath])
      case 'union': {
        const resultsPerKeyPossibility = [...firstKey.members].map(
          firstKeyMember =>
            applyKeyPathToType(type, [firstKeyMember, ...remainingKeyPath]),
        )
        // The runtime key could be any member, so the every possible path must
        // be valid.
        return resultsPerKeyPossibility.some(isNothing) ? nothing : (
            unionOfTypes(resultsPerKeyPossibility)
          )
      }
    }
  } else {
    return matchTypeFormat<Type>(type, {
      application: applicationType => {
        // Indexing into a stuck application stays stuck, provided the key path
        // is valid for the application's upper bound. Otherwise the property
        // definitely doesn't exist.
        const typeAtKeyPathInUpperBound = applyKeyPathToType(
          replaceAllTypeParametersWithTheirConstraints(applicationType),
          keyPath,
        )
        return isNothing(typeAtKeyPathInUpperBound) ? nothing : (
            nestedIndexedAccess(applicationType, [
              firstKey,
              ...remainingKeyPath,
            ])
          )
      },
      intrinsicApplication: intrinsicApplicationType => {
        // As with `ApplicationType`s, indexing stays stuck while the key path
        // is valid for the upper bound. Otherwise the property doesn't exist.
        const typeAtKeyPathInUpperBound = applyKeyPathToType(
          replaceAllTypeParametersWithTheirConstraints(
            intrinsicApplicationType,
          ),
          keyPath,
        )
        return isNothing(typeAtKeyPathInUpperBound) ? nothing : (
            nestedIndexedAccess(intrinsicApplicationType, [
              firstKey,
              ...remainingKeyPath,
            ])
          )
      },
      function: type => {
        if (typeof firstKey === 'string') {
          // Functions do not have properties.
          return nothing
        } else {
          switch (firstKey) {
            case functionParameterKey:
              return makeFunctionType({
                parameter: applyKeyPathToType(
                  type.signature.parameter,
                  remainingKeyPath,
                ),
                return: type.signature.return,
              })
            case functionReturnKey:
              return makeFunctionType({
                parameter: type.signature.parameter,
                return: applyKeyPathToType(
                  type.signature.return,
                  remainingKeyPath,
                ),
              })
            case typeParameterAssignableToConstraintKey:
              // Functions aren't type parameters.
              return nothing
          }
        }
      },
      object: type => {
        if (typeof firstKey === 'string') {
          const child = type.children[firstKey]
          if (child === undefined) {
            return nothing
          } else {
            return applyKeyPathToType(child, remainingKeyPath)
          }
        } else {
          // Objects have properties, not parameters/returns/constraints/etc.
          return nothing
        }
      },
      indexedAccess: type =>
        applyKeyPathToType(type.object, [firstKey, ...remainingKeyPath]),
      opaque: _type => nothing,
      parameter: type => {
        if (typeof firstKey === 'string') {
          // Indexing into a type parameter yields a stuck (object-neutral)
          // indexed access, kept dependent on the parameter so it can be reduced
          // once the parameter is instantiated. This is only done when the key
          // path is valid for the parameter's constraint; otherwise the property
          // genuinely doesn't exist.
          const typeAtKeyPathInConstraint = applyKeyPathToType(
            type.constraint.assignableTo,
            keyPath,
          )
          return isNothing(typeAtKeyPathInConstraint) ? nothing : (
              nestedIndexedAccess(type, [firstKey, ...remainingKeyPath])
            )
        } else {
          switch (firstKey) {
            case typeParameterAssignableToConstraintKey:
              return makeTypeParameter(type.name, {
                assignableTo: applyKeyPathToType(
                  type.constraint.assignableTo,
                  remainingKeyPath,
                ),
              })
            case functionParameterKey:
            case functionReturnKey:
              // Type parameters aren't function types, and drilling into the
              // constraint would lose precision.
              return nothing
          }
        }
      },
      union: type => {
        const memberResults = [...type.members].map(member =>
          // Atoms have no properties.
          typeof member === 'string' ? nothing : (
            applyKeyPathToType(member, keyPath)
          ),
        )
        return memberResults.some(isNothing) ? nothing : (
            unionOfTypes(memberResults)
          )
      },
    })
  }
}

export const replaceAllTypeParametersWithTheirConstraints = (
  type: Type,
): Type =>
  type.kind === 'intrinsicApplication' ?
    replaceAllTypeParametersWithTheirConstraints(
      type.computeUpperBound(type.parameterTypes),
    )
    // TODO: Specialize the below to only traverse `type` once.
  : containedTypeParameters(type)
      .values()
      .flatMap(({ typeParameters }) => typeParameters.members)
      .reduce<Type>(
        (partiallyAppliedType, typeParameter) =>
          supplyTypeArgument(
            partiallyAppliedType,
            typeParameter,
            typeParameter.constraint.assignableTo,
          ),
        type,
      )

/**
 * Finds concrete types for the `TypeParameter`s in `parameter` by locating the
 * corresponding position for each in `argument`.
 *
 * The types are not checked for consistency with each other, nor for
 * assignability to `argument`. Callers should use `supplyTypeArguments` to
 * create a concrete type and then perform any needed checks.
 */
export const getTypesForTypeParameters = ({
  parameterType,
  argumentType,
}: {
  readonly parameterType: Type
  readonly argumentType: Type
}): ReadonlyMap<TypeParameter, Type> => {
  // Avoid infinite recursion when we hit the top type.
  if (parameterType === something) {
    return new Map()
  } else if (argumentType.kind === 'intrinsicApplication') {
    return getTypesForTypeParameters({
      parameterType,
      argumentType: replaceAllTypeParametersWithTheirConstraints(argumentType),
    })
  } else {
    return matchTypeFormat(parameterType, {
      function: parameterType =>
        argumentType.kind === 'function' ?
          new Map([
            ...getTypesForTypeParameters({
              parameterType: parameterType.signature.return,
              argumentType: argumentType.signature.return,
            }),
            ...getTypesForTypeParameters({
              parameterType: parameterType.signature.parameter,
              argumentType: argumentType.signature.parameter,
            }),
          ])
        : new Map(),

      object: parameterType =>
        argumentType.kind === 'object' ?
          Object.entries(parameterType.children)
            .map(([key, childParameter]) => {
              const childArgument = argumentType.children[key]
              return childArgument === undefined ?
                  new Map<TypeParameter, Type>()
                : getTypesForTypeParameters({
                    parameterType: childParameter,
                    argumentType: childArgument,
                  })
            })
            .reduce(
              (types, typesFromChild) => new Map([...typesFromChild, ...types]),
              new Map<TypeParameter, Type>(),
            )
        : new Map(),

      opaque: _ => new Map(),

      // TODO: I don't think this case is solvable when the `IndexedAccessType`
      // is stuck on its key (e.g. `(?a: :b.:c)`), but when the key is concrete
      // I could perhaps use it to drill into the argument type. Is that sound?
      indexedAccess: _ => new Map(),

      // A application type in a function parameter is necessarily stuck on an
      // argument from an enclosing function that hasn't been applied, so no
      // bindings are inferred from it.
      application: _ => new Map(),

      // Likewise, a stuck intrinsic application yields no bindings.
      intrinsicApplication: _ => new Map(),

      parameter: parameterType =>
        (
          isAssignable({
            source: argumentType,
            target: replaceAllTypeParametersWithTheirConstraints(
              parameterType.constraint.assignableTo,
            ),
          })
        ) ?
          new Map([[parameterType, argumentType]])
        : new Map(),

      union: parameterType => {
        const argumentCandidates = [
          argumentType,
          ...(argumentType.kind === 'union' ?
            // These additional candidates enable alignment between parameter
            // unions and argument unions. For example, given a `parameterType`
            // of `(A <: atom) | object` and an `argumentType` of `atom |
            // object`, `A` should be inferred as `atom`.
            [...argumentType.members].flatMap((member): readonly Type[] =>
              typeof member === 'string' ? [makeUnionType([member])] : [member],
            )
          : []),
        ] as const
        return [...parameterType.members]
          .flatMap(parameterMember =>
            typeof parameterMember === 'string' ?
              []
            : argumentCandidates
                .filter(candidate =>
                  isAssignable({
                    source: candidate,
                    target:
                      replaceAllTypeParametersWithTheirConstraints(
                        parameterMember,
                      ),
                  }),
                )
                .flatMap(candidate => [
                  ...getTypesForTypeParameters({
                    parameterType: parameterMember,
                    argumentType: candidate,
                  }),
                ]),
          )
          .reduce(
            (types, [parameter, type]) =>
              types.has(parameter) ? types : (
                new Map([...types, [parameter, type]])
              ),
            new Map<TypeParameter, Type>(),
          )
      },
    })
  }
}

/**
 * If `type` can be applied as a function, returns its signatures. Multiple
 * signatures may be returned if `type` is a union or a type parameter
 * constrained to a union. Returns `none` for anything that isn't applicable as
 * a function.
 */
export const applicableFunctionSignatures = (
  type: Type,
): Option<readonly FunctionType['signature'][]> =>
  matchTypeFormat(type, {
    function: type => option.makeSome([type.signature]),
    parameter: type =>
      applicableFunctionSignatures(type.constraint.assignableTo),
    union: type =>
      type.members.size === 0 ?
        option.none
      : // Prettier goes a little crazy here. This seems to be fixed in the
        // `next` branch (currently 2be16eca1).
        // TODO: Try un-ignoring this after the next Prettier release.
        // prettier-ignore
        type.members.values().reduce<
          Option<readonly FunctionType['signature'][]>
        >(
          (accumulated, member) =>
            option.flatMap(accumulated, signaturesSoFar =>
              typeof member === 'string' ?
                option.none
              : option.map(
                  applicableFunctionSignatures(member),
                  memberSignatures => [...signaturesSoFar, ...memberSignatures],
                ),
            ),
          option.makeSome([]),
        ),
    // A stuck application/indexed access is applicable when its upper bound is.
    application: type =>
      applicableFunctionSignatures(
        replaceAllTypeParametersWithTheirConstraints(type),
      ),
    indexedAccess: type =>
      applicableFunctionSignatures(
        replaceAllTypeParametersWithTheirConstraints(type),
      ),
    intrinsicApplication: type =>
      applicableFunctionSignatures(
        replaceAllTypeParametersWithTheirConstraints(type),
      ),
    object: _ => option.none,
    opaque: _ => option.none,
  })

/**
 * Apply a function-like type to an argument type, returning the union of its
 * signatures' return types (with type parameters bound from the argument), or
 * `none` when `functionLikeType` isn't applicable as a function.
 */
export const applyTypeToArgumentType = (
  functionLikeType: Type,
  argumentType: Type,
): Option<Type> =>
  option.map(applicableFunctionSignatures(functionLikeType), signatures =>
    unionOfTypes(
      signatures.map(signature =>
        supplyTypeArguments(
          signature.return,
          getTypesForTypeParameters({
            parameterType: signature.parameter,
            argumentType,
          }),
        ),
      ),
    ),
  )

/**
 * Attempt to reduce a (possibly stuck) application of `functionType(argument)`.
 * While the function still contains any of the `parametersStuckOn` (type
 * parameters an enclosing function will instantiate), the application stays
 * stuck. Once they're all gone the function is applied: any of its own type
 * parameters are bound from the argument, and type parameters appearing only in
 * the return legitimately remain.
 */
const reduceApplication = (
  functionType: Type,
  argumentType: Type,
  parametersStuckOn: ReadonlySet<symbol>,
): Type => {
  const stillStuckOnParameter = typeParameterIdentitiesWithinType(functionType)
    .values()
    .some(identity => parametersStuckOn.has(identity))
  return !stillStuckOnParameter && functionType.kind === 'function' ?
      supplyTypeArguments(
        functionType.signature.return,
        getTypesForTypeParameters({
          parameterType: functionType.signature.parameter,
          argumentType: argumentType,
        }),
      )
    : makeApplicationType(functionType, argumentType, parametersStuckOn)
}

const cartesianProduct = <Element>(lists: readonly (readonly Element[])[]) =>
  lists.reduce<readonly (readonly Element[])[]>(
    (tuples, list) =>
      tuples.flatMap(tuple => list.map(value => [...tuple, value])),
    [[]],
  )

/**
 * Enumerate every value inhabiting the given finitely-sized `type`, or return
 * `none` if `type` has infinite inhabitants. Literal atom types, exact object
 * types whose property types are enumerable, and unions of enumerable types are
 * enumerable.
 */
export const enumerateInhabitants = (
  type: Type,
): Option<readonly SemanticGraph[]> =>
  // Avoid infinite recursion when we hit the top type.
  type === something ?
    option.none
  : matchTypeFormat(type, {
      application: _ => option.none,
      function: _ => option.none,
      indexedAccess: _ => option.none,
      intrinsicApplication: _ => option.none,
      opaque: _ => option.none,
      parameter: _ => option.none,
      object: type =>
        !type.exact ?
          option.none
        : option.map(
            option.sequence(
              Object.entries(type.children).map(([key, child]) =>
                option.map(enumerateInhabitants(child), childInhabitants =>
                  childInhabitants.map(
                    childInhabitant => [key, childInhabitant] as const,
                  ),
                ),
              ),
            ),
            entryPossibilitiesPerProperty =>
              cartesianProduct(entryPossibilitiesPerProperty).map(
                objectNodeFromOrderedEntries,
              ),
          ),
      union: type =>
        option.map(
          option.sequence([
            ...type.members
              .values()
              .map(member =>
                typeof member === 'string' ?
                  option.makeSome([member])
                : enumerateInhabitants(member),
              ),
          ]),
          inhabitantsPerMember => inhabitantsPerMember.flat(),
        ),
    })

export const isSingletonType = (type: Type): boolean =>
  option.match(enumerateInhabitants(type), {
    none: _ => false,
    some: inhabitants => inhabitants.length === 1,
  })

/**
 * Attempt to reduce a (possibly stuck) intrinsic application.
 */
const reduceIntrinsicApplication = (
  parameterTypes: readonly Type[],
  reduce: (
    argumentValues: readonly SemanticGraph[],
  ) => Either<FunctionNodeCallError, Type>,
  computeUpperBound: (parameterTypes: readonly Type[]) => Type,
): Type => {
  const argumentPossibilities = parameterTypes.map(enumerateInhabitants)
  const stuck = makeIntrinsicApplicationType(
    parameterTypes,
    reduce,
    computeUpperBound,
  )
  return option.match(option.sequence(argumentPossibilities), {
    none: _ => stuck,
    some: argumentPossibilities =>
      either.match(
        either.sequence(cartesianProduct(argumentPossibilities).map(reduce)),
        {
          left: _ => stuck,
          right: unionOfTypes,
        },
      ),
  })
}

/**
 * Substitute the given `typeParameter` with the given `typeArgument` within
 * `type`, recursively visiting object properties, union members, etc.
 *
 * Note that this function does *not* check whether `typeArgument` is compatible
 * with the constraints of `typeParameter`.
 */
export const supplyTypeArgument = (
  type: Type,
  typeParameter: TypeParameter,
  typeArgument: Type,
): Type => {
  // Avoid infinite recursion when we hit the top type.
  if (type === something) {
    return type
  } else {
    return matchTypeFormat(type, {
      function: type =>
        makeFunctionType({
          parameter: supplyTypeArgument(
            type.signature.parameter,
            typeParameter,
            typeArgument,
          ),
          return: supplyTypeArgument(
            type.signature.return,
            typeParameter,
            typeArgument,
          ),
        }),
      object: type => {
        const substitutedChildren: Writable<ObjectType['children']> = {}
        for (const [key, child] of Object.entries(type.children)) {
          substitutedChildren[key] = supplyTypeArgument(
            child,
            typeParameter,
            typeArgument,
          )
        }
        return makeObjectType(substitutedChildren, { exact: type.exact })
      },
      application: type =>
        reduceApplication(
          supplyTypeArgument(type.function, typeParameter, typeArgument),
          supplyTypeArgument(type.argument, typeParameter, typeArgument),
          type.parametersStuckOn,
        ),
      intrinsicApplication: type =>
        reduceIntrinsicApplication(
          type.parameterTypes.map(parameterType =>
            supplyTypeArgument(parameterType, typeParameter, typeArgument),
          ),
          type.reduce,
          type.computeUpperBound,
        ),
      indexedAccess: type => {
        const substitutedKey = supplyTypeArgument(
          type.key,
          typeParameter,
          typeArgument,
        )
        // A stuck intrinsic application used as a key (e.g. an `atom.equals`
        // application) is reduced to its upper bound so indexing can proceed
        // (e.g. `{ false: …, true: … }[boolean]`).
        const keyForIndexing =
          substitutedKey.kind === 'intrinsicApplication' ?
            replaceAllTypeParametersWithTheirConstraints(substitutedKey)
          : substitutedKey
        return either.match(atomKeyPathComponentFromType(keyForIndexing), {
          left: _ =>
            // TODO: Should this trigger an error?
            nothing,
          right: key =>
            applyKeyPathToType(
              supplyTypeArgument(type.object, typeParameter, typeArgument),
              [key],
            ),
        })
      },
      opaque: type => type,
      parameter: type =>
        type.identity === typeParameter.identity ? typeArgument : type,
      union: type =>
        makeUnionType(
          [...type.members].flatMap(member => {
            if (typeof member === 'string') {
              return member
            } else {
              const substitutedMember = supplyTypeArgument(
                member,
                typeParameter,
                typeArgument,
              )
              return substitutedMember.kind === 'union' ?
                  [...substitutedMember.members]
                : [substitutedMember]
            }
          }),
        ),
    })
  }
}

/** @see `supplyTypeArgument` */
// TODO: If this becomes a performance bottleneck it could be specialized to
// only match the format of `type` once.
export const supplyTypeArguments = (
  type: Type,
  typeArguments: ReadonlyMap<TypeParameter, Type>,
): Type =>
  typeArguments
    .entries()
    .reduce(
      (partiallyAppliedType, [typeParameter, typeArgument]) =>
        supplyTypeArgument(partiallyAppliedType, typeParameter, typeArgument),
      type,
    )

/**
 * Recursively clear `exact` from every object type within `type`. Used when a
 * type is adopted from a user-written type position (e.g. parameter type
 * annotations), where subtyping means wider values may inhabit it.
 *
 * Type parameters are kept by reference (their identities matter), so their
 * constraints are not adjusted here; make sure constraints are inexact while
 * creating type parameters instead.
 */
export const recursivelyInexact = (type: Type): Type =>
  // Avoid infinite recursion when we hit the top type.
  type === something ? type : (
    matchTypeFormat<Type>(type, {
      application: type =>
        makeApplicationType(
          recursivelyInexact(type.function),
          recursivelyInexact(type.argument),
          type.parametersStuckOn,
        ),
      function: type =>
        makeFunctionType({
          parameter: recursivelyInexact(type.signature.parameter),
          return: recursivelyInexact(type.signature.return),
        }),
      indexedAccess: type =>
        makeIndexedAccessType(
          recursivelyInexact(type.object),
          recursivelyInexact(type.key),
        ),
      intrinsicApplication: type =>
        makeIntrinsicApplicationType(
          type.parameterTypes.map(recursivelyInexact),
          type.reduce,
          parameterTypes =>
            recursivelyInexact(type.computeUpperBound(parameterTypes)),
        ),
      object: type =>
        makeObjectType(
          Object.fromEntries(
            Object.entries(type.children).map(([key, child]) => [
              key,
              recursivelyInexact(child),
            ]),
          ),
          { exact: false },
        ),
      opaque: type => type,
      parameter: type => type,
      union: type =>
        makeUnionType(
          [...type.members].flatMap(member => {
            if (typeof member === 'string') {
              return [member]
            } else {
              const strippedMember = recursivelyInexact(member)
              return strippedMember.kind === 'union' ?
                  [...strippedMember.members]
                : [strippedMember]
            }
          }),
        ),
    })
  )

const isNothing = (type: Type) =>
  type.kind === 'union' && type.members.size === 0
