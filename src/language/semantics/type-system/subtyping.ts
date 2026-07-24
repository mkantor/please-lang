import type { Option } from '@matt.kantor/option'
import option from '@matt.kantor/option'
import type { Atom } from '../../parsing.js'
import { atom, something } from './prelude-types.js'
import { matchTypeFormat } from './type-formats/match-type-format.js'
import {
  makeObjectType,
  type ExcessClause,
  type ObjectType,
} from './type-formats/object-type.js'
import { isTopType, type Type } from './type-formats/type.js'
import {
  makeUnionType,
  unionOfTypes,
  type UnionType,
} from './type-formats/union-type.js'
import { updateTypeAtKeyPathIfValid } from './type-key-path.js'
import {
  containedTypeParameters,
  findKeyPathsToTypeParameter,
} from './type-parameter-analysis.js'
import {
  getTypesForTypeParameters,
  replaceAllTypeParametersWithTheirConstraints,
  supplyTypeArgument,
  supplyTypeArguments,
  upperBoundOfStuckType,
} from './type-substitution.js'

export const isAssignable = ({
  source: rawSource,
  target: rawTarget,
}: {
  readonly source: Type | Atom
  readonly target: Type | Atom
}): boolean => {
  const source =
    typeof rawSource === 'string' ? makeUnionType([rawSource]) : rawSource
  const target =
    typeof rawTarget === 'string' ? makeUnionType([rawTarget]) : rawTarget

  return (
    source === target || // in this case there's no reason to spend time checking structural assignability
    (target.kind === 'intrinsicApplication' ?
      // An intrinsic application behaves as its (concrete) upper bound when
      // appearing as the target, mirroring the source case below. This ensures
      // structurally-equivalent-but-not-identical intrinsic applications are
      // mutually assignable.
      isAssignable({
        source,
        target: replaceAllTypeParametersWithTheirConstraints(target),
      })
    : matchTypeFormat(source, {
        application: source =>
          target.kind === 'application' ?
            // Two stuck applications are assignable when their functions and
            // arguments are mutually assignable.
            isAssignable({
              source: source.function,
              target: target.function,
            }) &&
            isAssignable({
              source: target.function,
              target: source.function,
            }) &&
            isAssignable({
              source: source.argument,
              target: target.argument,
            }) &&
            isAssignable({
              source: target.argument,
              target: source.argument,
            })
          : (
            // When the stuck application's signature is concrete, its return
            // type (with any contained type parameters bound from the argument
            // type) serves as an upper bound on what the application will
            // produce. This condition allows stuck applications be assigned to
            // (rigid) type parameters.
            source.function.kind === 'function' &&
            isAssignable({
              source: supplyTypeArguments(
                source.function.signature.return,
                getTypesForTypeParameters({
                  parameterType: source.function.signature.parameter,
                  argumentType: source.argument,
                }),
              ),
              target,
            })
          ) ?
            true
          : option.match(upperBoundOfStuckType(source), {
              none: _ => false,
              some: upperBound => isAssignable({ source: upperBound, target }),
            }),
        function: source =>
          matchTypeFormat(target, {
            function: target => {
              // Functions are contravariant in parameters, covariant in return
              // types.
              if (
                source.signature.parameter.kind === 'parameter' &&
                source.signature.return.kind === 'parameter' &&
                source.signature.parameter.identity ===
                  source.signature.return.identity
              ) {
                // The source is an identity function (`a => a`), which means
                // this much simpler check can be performed. This also allows
                // correctly handling the fact that `a => a` is assignable to a
                // type like `atom => atom`.
                return (
                  isAssignable({
                    source: target.signature.parameter,
                    target: target.signature.return,
                  }) &&
                  isAssignable({
                    source: target.signature.parameter,
                    target: source.signature.parameter.constraint.assignableTo,
                  })
                )
              } else {
                const sourceParameterTypeParameters = containedTypeParameters(
                  source.signature.parameter,
                )
                const targetParameterTypeParameters = containedTypeParameters(
                  target.signature.parameter,
                )

                // An example showing how this will be used: When checking
                // whether `{ a: (a <: atom) } => a` is assignable to `{ a: (b
                // <: "a") } => b`, the parameter types are compatible if `{ a:
                // (b <: "a") }` is assignable to `{ a: atom }` (it is).
                let sourceParameterWithTypeParametersReplacedByConstraints =
                  source.signature.parameter

                // An example showing how this will be used: When checking
                // whether `a => { a: a, b: atom }` is assignable to `(b <:
                // atom) => { a: b }`, the return types are compatible if `{ a:
                // b, b: atom }` is assignable to `{ a: b }` (it is).
                let sourceReturnWithTypeParametersReplacedByTargetTypeParameters =
                  source.signature.return

                for (const [
                  stringifiedKeyPath,
                  sourceTypeParametersAtThisKeyPath,
                ] of sourceParameterTypeParameters) {
                  for (const sourceTypeParameter of sourceTypeParametersAtThisKeyPath
                    .typeParameters.members) {
                    sourceParameterWithTypeParametersReplacedByConstraints =
                      supplyTypeArgument(
                        sourceParameterWithTypeParametersReplacedByConstraints,
                        sourceTypeParameter,
                        sourceTypeParameter.constraint.assignableTo,
                      )

                    const correspondingTargetTypeParameter =
                      targetParameterTypeParameters.get(stringifiedKeyPath)

                    if (correspondingTargetTypeParameter !== undefined) {
                      const locationsOfSourceTypeParameterInSourceReturn =
                        findKeyPathsToTypeParameter(
                          source.signature.return,
                          sourceTypeParameter,
                        )

                      for (const locationOfSourceTypeParameterInSourceReturn of locationsOfSourceTypeParameterInSourceReturn) {
                        sourceReturnWithTypeParametersReplacedByTargetTypeParameters =
                          updateTypeAtKeyPathIfValid(
                            sourceReturnWithTypeParametersReplacedByTargetTypeParameters,
                            locationOfSourceTypeParameterInSourceReturn,
                            typeAtKeyPath => {
                              if (
                                typeAtKeyPath.kind === 'parameter' &&
                                typeAtKeyPath.identity ===
                                  sourceTypeParameter.identity
                              ) {
                                return correspondingTargetTypeParameter.typeParameters
                              } else {
                                return typeAtKeyPath
                              }
                            },
                          )
                      }
                    }
                  }
                }

                return (
                  // Contravariant parameter check:
                  isAssignable({
                    source: target.signature.parameter,
                    target:
                      sourceParameterWithTypeParametersReplacedByConstraints,
                  }) &&
                  // Covariant return type check:
                  isAssignable({
                    source:
                      sourceReturnWithTypeParametersReplacedByTargetTypeParameters,
                    target: target.signature.return,
                  })
                )
              }
            },
            application: _target => false,
            indexedAccess: _target => false,
            intrinsicApplication: _target => {
              // This case is handled above.
              throw new Error(
                'Intrinsic application target should have already been handled. This is a bug!',
              )
            },
            object: _target => false, // functions are never assignable to objects
            opaque: target => target.isAssignableFrom(source),
            parameter: _target => false, // a function type is never directly assignable to a type parameter
            union: target => isNonUnionAssignableToUnion({ source, target }),
          }),
        indexedAccess: source =>
          option.match(upperBoundOfStuckType(source), {
            none: _ => false,
            some: upperBound => isAssignable({ source: upperBound, target }),
          }),
        intrinsicApplication: source =>
          option.match(upperBoundOfStuckType(source), {
            none: _ => false,
            some: upperBound => isAssignable({ source: upperBound, target }),
          }),
        object: source =>
          matchTypeFormat(target, {
            function: _target => false, // objects are never assignable to functions
            application: _target => false,
            indexedAccess: _target => false,
            intrinsicApplication: _target => {
              // This case is handled above.
              throw new Error(
                'Intrinsic application target should have already been handled. This is a bug!',
              )
            },
            object: target => {
              // Every property required by the target must be present and valid
              // in the source (recursively).
              const requiredPropertiesAreSatisfied = Object.entries(
                target.children,
              ).every(([key, targetChild]) => {
                const sourceChild = source.children[key]
                return (
                  sourceChild !== undefined &&
                  isAssignable({ source: sourceChild, target: targetChild })
                )
              })
              // Each source property beyond the target's children must fit
              // within the target's bound for its specific key.
              const unlistedSourceChildrenAreSatisfied = Object.entries(
                source.children,
              ).every(([key, sourceChild]) => {
                const targetBound = excessBoundForKey(key, target.excess)
                return (
                  target.children[key] !== undefined ||
                  isTopType(targetBound) ||
                  isAssignable({ source: sourceChild, target: targetBound })
                )
              })
              // Whatever the source's clauses admit must fit within the
              // target's clauses wherever they overlap. A pair of clauses
              // overlaps only if some key can inhabit both domains while
              // escaping all later domains. Clauses with no overlap are
              // irrelevant to subtyping.
              const sourceExcess = effectiveExcessClauses(source.excess)
              const targetExcess = effectiveExcessClauses(target.excess)
              const excessClausesAreSatisfied = sourceExcess.every(
                (sourceClause, sourceIndex) =>
                  targetExcess.every((targetClause, targetIndex) => {
                    const laterDomains = unionOfTypes([
                      ...sourceExcess
                        .slice(sourceIndex + 1)
                        .map(clause => clause.keys),
                      ...targetExcess
                        .slice(targetIndex + 1)
                        .map(clause => clause.keys),
                    ])
                    const pairIsUnreachable =
                      isAssignable({
                        source: sourceClause.keys,
                        target: laterDomains,
                      }) ||
                      isAssignable({
                        source: targetClause.keys,
                        target: laterDomains,
                      })
                    return (
                      pairIsUnreachable ||
                      isAssignable({
                        source: sourceClause.values,
                        target: targetClause.values,
                      })
                    )
                  }),
              )
              return (
                requiredPropertiesAreSatisfied &&
                unlistedSourceChildrenAreSatisfied &&
                excessClausesAreSatisfied
              )
            },
            opaque: target => target.isAssignableFrom(source),
            parameter: _target => false, // an object type is never directly assignable to a type parameter
            union: target => isNonUnionAssignableToUnion({ source, target }),
          }),
        opaque: source => source.isAssignableTo(target),
        parameter: source =>
          // A type parameter is only assignable to a type parameter if they are
          // identical. If the target is a union and the type parameter is a
          // member of that union (by identity), it's also assignable. Otherwise
          // the constraint must be assignable to the target.
          (target.kind === 'parameter' &&
            source.identity === target.identity) ||
          (target.kind === 'union' &&
            isNonUnionAssignableToUnion({ source, target })) ||
          isAssignable({
            source: source.constraint.assignableTo,
            target,
          }),
        union: source =>
          matchTypeFormat(target, {
            function: target => isUnionAssignableToNonUnion({ source, target }),
            application: target =>
              isUnionAssignableToNonUnion({ source, target }),
            indexedAccess: target =>
              isUnionAssignableToNonUnion({ source, target }),
            intrinsicApplication: target =>
              isUnionAssignableToNonUnion({ source, target }),
            object: target => isUnionAssignableToNonUnion({ source, target }),
            opaque: target => isUnionAssignableToNonUnion({ source, target }),
            parameter: target =>
              isUnionAssignableToNonUnion({ source, target }),
            union: target => {
              // Return true if every member of the source is assignable to some
              // member of the target.
              for (const sourceMember of source.members) {
                const sourceMemberIsAssignableToSomeMemberOfSupertype = (() => {
                  const preparedTarget = simplifyUnionType(target)
                  for (const targetMember of preparedTarget.members) {
                    if (sourceMember === targetMember) {
                      return true
                    } else if (typeof targetMember !== 'string') {
                      if (
                        isAssignable({
                          target: targetMember,
                          source:
                            typeof sourceMember !== 'string' ? sourceMember : (
                              makeUnionType([sourceMember])
                            ),
                        })
                      ) {
                        return true
                      }
                    }
                  }
                  // A type parameter member can be assignable to the target
                  // union while matching no single member, e.g. a parameter
                  // constrained to `something` is assignable to `something`
                  // even though `something` is itself a union.
                  return (
                    typeof sourceMember !== 'string' &&
                    sourceMember.kind === 'parameter' &&
                    isAssignable({ source: sourceMember, target })
                  )
                })()

                if (!sourceMemberIsAssignableToSomeMemberOfSupertype) {
                  return false
                }
              }
              return true
            },
          }),
      }))
  )
}

const isNonUnionAssignableToUnion = ({
  source,
  target,
}: {
  readonly source: Exclude<Type, UnionType>
  readonly target: UnionType
}): boolean => {
  if (source.kind === 'opaque') {
    return source.isAssignableTo(target)
  } else {
    // The strategy for this case is to check whether any of the target's
    // members are assignable to the source type. However this alone is not
    // sufficient—for example `{ a: 'a' | 'b' }` should be assignable to `{ a:
    // 'a' } | { a: 'b' }` even though `{ a: 'a' | 'b' }` is not directly
    // assignable to `{ a: 'a' }` nor `{ a: 'b' }`. To make things work the
    // target type is first converted into a standard form (e.g. `{ a: 'a' } | {
    // a: 'b' }` is translated into `{ a: 'a' | 'b' }`.

    const preparedTarget = simplifyUnionType(target)

    for (const type of preparedTarget.members) {
      if (typeof type !== 'string' && isAssignable({ target: type, source })) {
        return true
      }
    }
    return false
  }
}

const isUnionAssignableToNonUnion = ({
  source,
  target,
}: {
  readonly source: UnionType
  readonly target: Exclude<Type, UnionType>
}): boolean => {
  if (target.kind === 'opaque') {
    return target.isAssignableFrom(source)
  } else {
    // Return true if every member of the source is assignable to the target.
    for (const sourceMember of source.members) {
      // Atoms cannot be subtypes of objects, functions, or type parameters.
      if (typeof sourceMember === 'string') {
        return false
      }
      if (
        !isAssignable({
          target,
          source: sourceMember,
        })
      ) {
        return false
      }
    }
    return true
  }
}

/**
 * Returns a narrowed version of the `UnionType` if all of its members are
 * literal atom types.
 */
export const asUnionWithLiteralAtomMembers = (
  type: UnionType,
): Option<
  Omit<UnionType, 'members'> & { readonly members: ReadonlySet<Atom> }
> => {
  const simplifiedType = simplifyUnionType(type)

  const atomMembers = [
    ...simplifiedType.members
      .values()
      .filter(member => typeof member === 'string'),
  ]

  const isAtomUnion = atomMembers.length === simplifiedType.members.size

  return !isAtomUnion ?
      option.none
    : option.makeSome(makeUnionType(atomMembers))
}

/**
 * The bound an object type places on the value of the given property when it
 * isn't among the type's required children.
 */
export const excessBoundForKey = (
  key: Atom,
  excess: ObjectType['excess'],
): Type =>
  excess.findLast(clause =>
    isAssignable({ source: makeUnionType([key]), target: clause.keys }),
  )?.values ?? something

/**
 * Whether every possible key inhabits some explicit clause's `keys`.
 */
export const excessClausesAreTotal = (
  excess: readonly ExcessClause[],
): boolean =>
  excess.some(clause => clause.keys === atom) || // fast path
  isAssignable({
    source: atom,
    target: unionOfTypes(excess.map(clause => clause.keys)),
  })

/**
 * Make an excess clause list total by prepending an open base clause when
 * necessary, which is often more convenient to work with.
 */
export const effectiveExcessClauses = (
  excess: readonly ExcessClause[],
): readonly ExcessClause[] =>
  excessClausesAreTotal(excess) ? excess : (
    [{ keys: atom, values: something }, ...excess]
  )

/**
 * Removes redundancies and otherwise attempts to reduce the number of members
 * in a union while preserving the semantics of the given `UnionType`.
 *
 * For example, `{ a: 'a' | 'b' } | { a: 'b' } | { a: 'c' } | atom | 'a'` is
 * simplified to `{ a: 'a' | 'b' | 'c' } | atom`.
 */
export const simplifyUnionType = (typeToSimplify: UnionType): UnionType => {
  const members = [...typeToSimplify.members]

  // Object types with a single key are mergeable with other object types
  // containing the same single key (as long as their excess bounds agree).
  // For example `{ a: 'a' } | { a: 'b' }` can become `{ a: 'a' | 'b' }`.
  //
  // TODO: Handle cases where there is more than one key but property types
  // are compatible. For example `{ a: 'a', b: 'b' } | { a: 'b', b: 'b' }`
  // can become `{ a: 'a' | 'b', b: 'b' }`.
  const isObjectType = (member: Atom | Exclude<Type, UnionType>) =>
    typeof member !== 'string' && member.kind === 'object'
  const isMergeable = (member: ObjectType) =>
    Object.keys(member.children).length === 1

  const typesAreEquivalent = (first: Type, second: Type): boolean =>
    isAssignable({ source: first, target: second }) &&
    isAssignable({ source: second, target: first })

  const excessBoundsAgree = (
    first: ObjectType['excess'],
    second: ObjectType['excess'],
  ): boolean => {
    const effectiveFirst = effectiveExcessClauses(first)
    const effectiveSecond = effectiveExcessClauses(second)
    return (
      effectiveFirst.length === effectiveSecond.length &&
      effectiveFirst.every((firstClause, index) => {
        const secondClause = effectiveSecond[index]
        return (
          secondClause !== undefined &&
          typesAreEquivalent(firstClause.keys, secondClause.keys) &&
          typesAreEquivalent(firstClause.values, secondClause.values)
        )
      })
    )
  }

  type MergeGroup = {
    readonly key: string
    readonly excess: ObjectType['excess']
    readonly typesToMerge: readonly ObjectType[]
  }

  const mergeGroups = members
    .filter(isObjectType)
    .filter(isMergeable)
    .reduce<readonly MergeGroup[]>((groups, objectType) => {
      const [key] = Object.keys(objectType.children)
      const groupIndex =
        key === undefined ? -1 : (
          groups.findIndex(
            group =>
              group.key === key &&
              excessBoundsAgree(group.excess, objectType.excess),
          )
        )
      return (
        key === undefined ? groups
        : groupIndex === -1 ?
          [
            ...groups,
            { key, excess: objectType.excess, typesToMerge: [objectType] },
          ]
        : groups.map((group, index) =>
            index === groupIndex ?
              { ...group, typesToMerge: [...group.typesToMerge, objectType] }
            : group,
          )
      )
    }, [])

  // Merge each group into a single object type whose sole required property is
  // the union of every group member's sole property type.
  const mergedObjectTypes = mergeGroups.map(({ key, excess, typesToMerge }) => {
    const typesForTheProperty = typesToMerge.flatMap(objectType => {
      const propertyType = objectType.children[key]
      return (
        propertyType === undefined ? []
        : propertyType.kind === 'union' ?
          [...propertyType.members] // flatten any existing unions in property types
        : [propertyType]
      )
    })
    return makeObjectType(
      {
        [key]: excludeRedundantUnionTypeMembers(
          makeUnionType(typesForTheProperty),
        ),
      },
      excess,
    )
  })

  return excludeRedundantUnionTypeMembers(
    makeUnionType([
      ...members.filter(
        member => !isObjectType(member) || !isMergeable(member),
      ),
      ...mergedObjectTypes,
    ]),
  )
}

const excludeRedundantUnionTypeMembers = (type: UnionType) => {
  const membersAsArray = [...type.members]
  return makeUnionType(
    membersAsArray.filter(
      (possiblyRedundantMember, index) =>
        // If `possiblyRedundantMember` is assignable to any other member,
        // filter it out.
        !membersAsArray.some(
          (otherMember, otherIndex) =>
            index !== otherIndex &&
            isAssignable({
              source: possiblyRedundantMember,
              target: otherMember,
            }) &&
            // If the members are mutually-assignable, only omit the latter one.
            (!isAssignable({
              source: otherMember,
              target: possiblyRedundantMember,
            }) ||
              index > otherIndex),
        ),
    ),
  )
}
