import either, { type Either } from '@matt.kantor/either'
import option from '@matt.kantor/option'
import { styleText } from 'node:util'
import { withPhantomData, type WithPhantomData } from '../../../phantom-data.js'
import type { ElaborationError, TypeMismatchError } from '../../errors.js'
import type { Atom } from '../../parsing.js'
import { quoteAtomIfNecessary } from '../../unparsing/plz-utilities.js'
import { keyColor, punctuation } from '../../unparsing/unparsing-utilities.js'
import type { ExpressionContext } from '../expression-elaboration.js'
import type { ObjectNode } from '../object-node.js'
import {
  stringifyTypeForEndUser,
  type SemanticGraph,
} from '../semantic-graph.js'
import { asUnionWithLiteralAtomMembers } from './subtyping.js'
import {
  makeFunctionType,
  makeIndexedAccessType,
  makeObjectType,
  makeTypeParameter,
  makeUnionType,
  matchTypeFormat,
  type IndexedAccessType,
  type Type,
  type TypeParameter,
  type UnionType,
} from './type-formats.js'

export const functionParameterKey = Symbol('functionParameter')
export const functionReturnKey = Symbol('functionReturn')
export const typeParameterAssignableToConstraintKey = Symbol(
  'typeParameterAssignableToConstraint',
)

type AtomKeyPathComponent =
  | Atom
  | (Omit<UnionType, 'members'> & { readonly members: ReadonlySet<Atom> })
  | (TypeParameter & {
      readonly constraint: { readonly assignableTo: AtomKeyPathComponent }
    })

export type TypeKeyPath = readonly (
  | AtomKeyPathComponent
  | typeof functionParameterKey
  | typeof functionReturnKey
  | typeof typeParameterAssignableToConstraintKey
)[]

declare const _isKeyPathStringifiedForInternalUse: unique symbol
type IsKeyPathStringifiedForInternalUse = {
  readonly [_isKeyPathStringifiedForInternalUse]: true
}
export type TypeKeyPathStringifiedForInternalUse = WithPhantomData<
  string,
  IsKeyPathStringifiedForInternalUse
>

export const typeKeyPathFromObjectNode = (
  node: ObjectNode,
  context: ExpressionContext,
  inferType: (
    specificKey: SemanticGraph,
    contextForSpecificKey: ExpressionContext,
  ) => Either<ElaborationError, Type>,
): Either<ElaborationError, TypeKeyPath> =>
  // Each sequentially-keyed property is either a literal atom or a dynamic key
  // whose type must be an atom or union of atoms.
  either.sequence(
    Object.entries(node).map(([key, component]) =>
      typeof component === 'string' ?
        either.makeRight(component)
      : either.flatMap(
          inferType(component, {
            ...context,
            location: [...context.location, key],
          }),
          atomKeyPathComponentFromType,
        ),
    ),
  )

/**
 * If the given `KeyPath` is not valid for the given `Type`, the given `Type` is
 * returned unchanged (and `operation` is never called).
 */
export const updateTypeAtKeyPathIfValid = (
  type: Type,
  keyPath: TypeKeyPath,
  // TODO: `operation` should be able to update `Atom`s.
  operation: (typeAtKeyPath: Exclude<Type, UnionType>) => Type,
): Type => {
  const [firstKey, ...remainingKeyPath] = keyPath
  if (firstKey === undefined) {
    // If the key path is empty, this is the type to operate on.
    if (type.kind === 'union') {
      return makeUnionType(
        [...type.members].flatMap(member => {
          if (typeof member === 'string') {
            return member
          } else {
            const result = operation(member)
            if (result.kind === 'union') {
              return [...result.members]
            } else {
              return [result]
            }
          }
        }),
      )
    } else {
      return operation(type)
    }
  } else {
    return matchTypeFormat<Type>(type, {
      function: type => {
        switch (firstKey) {
          case functionParameterKey:
            return makeFunctionType({
              parameter: updateTypeAtKeyPathIfValid(
                type.signature.parameter,
                remainingKeyPath,
                operation,
              ),
              return: type.signature.return,
            })
          case functionReturnKey:
            return makeFunctionType({
              return: updateTypeAtKeyPathIfValid(
                type.signature.return,
                remainingKeyPath,
                operation,
              ),
              parameter: type.signature.parameter,
            })
          default:
            return type
        }
      },
      application: type => type,
      indexedAccess: type => type,
      intrinsicApplication: type => type,
      object: type => {
        if (typeof firstKey === 'string') {
          const next = type.children[firstKey]
          if (next === undefined) {
            return type
          } else {
            return makeObjectType(
              {
                ...type.children,
                [firstKey]: updateTypeAtKeyPathIfValid(
                  next,
                  remainingKeyPath,
                  operation,
                ),
              },
              { exact: type.exact },
            )
          }
        } else {
          return type
        }
      },
      opaque: type => type,
      parameter: type => {
        switch (firstKey) {
          case typeParameterAssignableToConstraintKey:
            return makeTypeParameter(type.name, {
              assignableTo: updateTypeAtKeyPathIfValid(
                type.constraint.assignableTo,
                remainingKeyPath,
                operation,
              ),
            })
          default:
            return type
        }
      },
      union: type =>
        makeUnionType(
          [...type.members].flatMap(member => {
            if (typeof member === 'string') {
              // An atom can't satisfy a (non-empty) key path.
              return member
            } else {
              const manipulatedMember = updateTypeAtKeyPathIfValid(
                member,
                keyPath,
                operation,
              )
              if (manipulatedMember.kind === 'union') {
                return [...manipulatedMember.members]
              } else {
                return [manipulatedMember]
              }
            }
          }),
        ),
    })
  }
}

export const stringifyTypeKeyPathForEndUser = (
  keyPath: TypeKeyPath,
): string => {
  const { dot } = punctuation(styleText)
  return styleText(
    keyColor,
    keyPath.reduce(
      (stringifiedTypeKeyPath: string, key) =>
        stringifiedTypeKeyPath.concat(
          dot,
          stringifyKeyPathComponentForEndUser(key),
        ),
      '',
    ),
  )
}

export const stringifyTypeKeyPathForInternalUse = (
  keyPath: TypeKeyPath,
): TypeKeyPathStringifiedForInternalUse =>
  withPhantomData<IsKeyPathStringifiedForInternalUse>()(
    JSON.stringify(
      keyPath.map(component =>
        typeof component === 'symbol' ?
          stringifyTypeKeyPathSymbol(component)
        : component,
      ),
    ),
  )

export const atomKeyPathComponentFromType = (
  type: Type,
): Either<TypeMismatchError, AtomKeyPathComponent> =>
  matchTypeFormat<Either<TypeMismatchError, AtomKeyPathComponent>>(type, {
    application: _ =>
      either.makeLeft({
        kind: 'typeMismatch',
        message: `${type.kind} types are not valid key path components`,
      }),
    function: _ =>
      either.makeLeft({
        kind: 'typeMismatch',
        message: `${type.kind} types are not valid key path components`,
      }),
    indexedAccess: _ =>
      either.makeLeft({
        kind: 'typeMismatch',
        message: `${type.kind} types are not valid key path components`,
      }),
    intrinsicApplication: _ =>
      either.makeLeft({
        kind: 'typeMismatch',
        message: `${type.kind} types are not valid key path components`,
      }),
    object: _ =>
      either.makeLeft({
        kind: 'typeMismatch',
        message: `${type.kind} types are not valid key path components`,
      }),
    opaque: _ =>
      either.makeLeft({
        kind: 'typeMismatch',
        message: `${type.kind} types are not valid key path components`,
      }),
    parameter: type => {
      switch (type.constraint.assignableTo.kind) {
        case 'application':
        case 'function':
        case 'indexedAccess':
        case 'intrinsicApplication':
        case 'object':
        case 'opaque':
          return either.makeLeft({
            kind: 'typeMismatch',
            message: `type parameters constrained to ${type.constraint.assignableTo.kind} types aren't valid key path components`,
          })
        case 'union':
        case 'parameter':
          return either.map(
            atomKeyPathComponentFromType(type.constraint.assignableTo),
            validAssignableTo => ({
              ...type,
              constraint: {
                ...type.constraint,
                assignableTo:
                  typeof validAssignableTo === 'string' ?
                    makeUnionType([validAssignableTo])
                  : validAssignableTo,
              },
            }),
          )
      }
    },
    union: type => {
      const [firstAtom, ...remainingAtoms] = type.members
      return (
        firstAtom === undefined ?
          either.makeLeft({
            kind: 'typeMismatch',
            message: `union types are only valid key path components if they are non-empty`,
          })
        : remainingAtoms.length === 0 && typeof firstAtom === 'string' ?
          // Unwrap single-member unions.
          either.makeRight(firstAtom)
        : option.match(asUnionWithLiteralAtomMembers(type), {
            none: _ =>
              either.makeLeft({
                kind: 'typeMismatch',
                message: `union types are only valid key path components when all their members are literal atoms`,
              }),
            some: either.makeRight,
          })
      )
    },
  })

const indexedAccessFromTypeKeyPathEntry = (
  object: Type,
  key: TypeKeyPath[number],
): IndexedAccessType => {
  if (typeof key === 'symbol') {
    // TODO: Seems like this should either be allowed
    // (`IndexedAccessType['key']` could be typed as `TypeKeyPath[number]`?) or
    // handled better (this function could return an `Either`).
    throw new Error(
      'Type key path contained a symbol following a parameter. This is a bug!',
    )
  } else {
    return makeIndexedAccessType(
      object,
      typeof key === 'string' ? makeUnionType([key]) : key,
    )
  }
}

/**
 * Build a left-nested `IndexedAccessType` projecting `keyPath` out of `object`.
 */
export const nestedIndexedAccess = (
  object: Type,
  keyPath: readonly [TypeKeyPath[number], ...TypeKeyPath],
): IndexedAccessType => {
  const [firstKey, ...remainingKeyPath] = keyPath
  const firstIndexedAccess = indexedAccessFromTypeKeyPathEntry(object, firstKey)
  return remainingKeyPath.reduce(
    indexedAccessFromTypeKeyPathEntry,
    firstIndexedAccess,
  )
}

export const stringifyTypeKeyPathSymbol = (
  symbol: Extract<TypeKeyPath[number], symbol>,
): string => {
  switch (symbol) {
    // TODO: Consider surfacing this in plz syntax (allowing programmatic
    // access of un-elaborated function parameters/returns and type parameter
    // constraints).
    case functionParameterKey:
      return '#parameter'
    case functionReturnKey:
      return '#return'
    case typeParameterAssignableToConstraintKey:
      return '#constraint'
  }
}

const stringifyKeyPathComponentForEndUser = (
  component: TypeKeyPath[number],
): string => {
  if (typeof component === 'string') {
    return quoteAtomIfNecessary(component)
  } else if (typeof component === 'object') {
    const { openGroupingParenthesis, closeGroupingParenthesis } =
      punctuation(styleText)
    switch (component.kind) {
      case 'parameter':
        return stringifyKeyPathComponentForEndUser(
          component.constraint.assignableTo,
        )
      case 'union':
        return openGroupingParenthesis.concat(
          stringifyTypeForEndUser(component),
          closeGroupingParenthesis,
        )
    }
  } else {
    return stringifyTypeKeyPathSymbol(component)
  }
}
