import either, { type Either } from '@matt.kantor/either'
import option, { type Option } from '@matt.kantor/option'
import { stripVTControlCharacters } from 'node:util'
import {
  applicableFunctionSignatures,
  applyKeyPathToSemanticGraph,
  applyKeyPathToType,
  getTypesForFlexibleTypeParameters,
  inferType,
  inferTypeOfTypeAnnotation,
  isObjectNode,
  keyPathFromInternalUse,
  makeFunctionType,
  objectNodeFromOrderedEntries,
  orderedEntriesOfObjectNode,
  readApplyExpression,
  readCheckExpression,
  readFunctionExpression,
  readHoleExpression,
  readIndexExpression,
  readLookupExpression,
  readObjectTypeExpression,
  rigidTypeParameterIdentities,
  stringifyResolvedTypeForEndUser,
  supplyTypeArguments,
  typeKeyPathFromObjectNode,
  type ExpressionContext,
  type FunctionType,
  type KeyPath,
  type SemanticGraph,
  type Type,
  type TypeRenderingOptions,
} from '../semantics.js'
import type { Span } from '../source-location.js'
import { inlinePlz, prettyPlz, type Notation } from '../unparsing.js'
import type { ParsedProgram } from './analyze.js'

const maximumSingleLineTypeWidth = 80

export type Hover = {
  readonly span: Span // The span that was pointed at.
  readonly type: string
}

export const hoverAt = (
  program: ParsedProgram,
  offset: number,
): Option<Hover> =>
  option.flatMap(hoverTargetAt(program, offset), target =>
    option.map(typeOfTarget(program, target), type => {
      const typeParametersInScope = typeParametersInScopeAt(
        program,
        target.keyPath,
      )
      return {
        span: target.span,
        type: renderType(
          option.match(
            typeAtApplication(program, target, type, typeParametersInScope),
            {
              none: _ => type,
              some: instantiatedType => instantiatedType,
            },
          ),
          typeParametersInScope,
        ),
      }
    }),
  )

type HoverTarget = {
  readonly span: Span // The span that was pointed at.
  readonly keyPath: KeyPath // From the program root.
  readonly role: TargetRole
}

type TargetRole =
  /**
   * The name operand of a `@lookup`/`@hole` (`a` in `:a`, `t` in `?t`).
   */
  | {
      readonly kind: 'nameOperand'
      readonly expression: KeyPath
    }
  /**
   * A query component of an `@index` expression (`b` in `x.b.c`).
   */
  | {
      readonly kind: 'queryComponent'
      readonly expression: KeyPath
      readonly componentIndex: number
    }
  /**
   * An unannotated function parameter's name (`a` in `a => …`).
   */
  | {
      readonly kind: 'parameterName'
      readonly functionExpression: KeyPath
    }
  /**
   * Anything else.
   */
  | { readonly kind: 'other' }

const hoverTargetAt = (
  program: ParsedProgram,
  offset: number,
): Option<HoverTarget> =>
  option.map(locationAtOffset(program, offset), ({ keyPath, span }) => ({
    span,
    keyPath,
    role: roleAt(program, keyPath),
  }))

const renderType = (
  type: Type,
  typeParametersInScope: ReadonlySet<symbol>,
): string => {
  const options: TypeRenderingOptions = {
    typeParametersInScope,
    unreferencedTypeParametersAsConstraints: true,
  }
  const inline = stripVTControlCharacters(
    stringifyResolvedTypeForEndUser(type, inlinePlz, options),
  )
  return inline.length <= maximumSingleLineTypeWidth ?
      inline
    : stripVTControlCharacters(
        stringifyResolvedTypeForEndUser(type, multipleLineNotation, options),
      )
}

const multipleLineNotation: Notation = { ...prettyPlz, suffix: '' }

/**
 * The target's type as instantiated by the arguments it's applied to. For
 * example, `+` in `1 + 2` is `2 ~> 1 ~> 3`.
 */
const typeAtApplication = (
  program: ParsedProgram,
  target: HoverTarget,
  functionType: Type,
  typeParametersInScope: ReadonlySet<symbol>,
): Option<Type> =>
  option.flatMap(appliedExpressionAt(program, target), functionExpression =>
    option.flatMap(
      option.sequence(
        argumentsOf(program, functionExpression).map(argument =>
          inferredTypeAt(program, argument),
        ),
      ),
      argumentTypes =>
        instantiatedFunctionType(
          functionType,
          argumentTypes,
          typeParametersInScope,
        ),
    ),
  )

/**
 * The target's expression, if it could be applied.
 */
const appliedExpressionAt = (
  program: ParsedProgram,
  { keyPath, role }: HoverTarget,
): Option<KeyPath> => {
  switch (role.kind) {
    case 'nameOperand':
      return option.makeSome(role.expression)
    case 'queryComponent':
      return option.flatMap(
        nodeAt(program, [...role.expression, '1', 'query']),
        query =>
          (
            isObjectNode(query) &&
            Object.keys(query).length === role.componentIndex + 1
          ) ?
            option.makeSome(role.expression)
          : option.none,
      )
    case 'other':
      return option.makeSome(keyPath)
    case 'parameterName':
      return option.none
  }
}

/**
 * The arguments the function at `functionExpression` is applied to where it's
 * written, innermost first: `:f(1)(2)` applies `f` to `1`, then the result to
 * `2`.
 */
const argumentsOf = (
  program: ParsedProgram,
  functionExpression: KeyPath,
): readonly KeyPath[] => {
  const applyExpression = functionExpression.slice(0, -2)
  const [operandsKey, operandKey] = functionExpression.slice(-2)
  return (
      operandsKey === '1' &&
        operandKey === 'function' &&
        isExpressionAt(program, applyExpression, readApplyExpression)
    ) ?
      [
        [...applyExpression, '1', 'argument'],
        ...argumentsOf(program, applyExpression),
      ]
    : []
}

/**
 * `functionType` as instantiated by successive arguments of the given types.
 */
const instantiatedFunctionType = (
  functionType: Type,
  argumentTypes: readonly Type[],
  rigidTypeParameters: ReadonlySet<symbol>,
): Option<Type> => {
  const [argumentType, ...remainingArgumentTypes] = argumentTypes
  return argumentType === undefined ?
      option.makeSome(functionType)
    : option.flatMap(soleSignature(functionType), signature => {
        const typeArguments = getTypesForFlexibleTypeParameters({
          parameterType: signature.parameter,
          argumentType,
          rigidTypeParameters,
        })
        return option.map(
          instantiatedFunctionType(
            supplyTypeArguments(signature.return, typeArguments),
            remainingArgumentTypes,
            rigidTypeParameters,
          ),
          instantiatedReturnType =>
            makeFunctionType({
              parameter: supplyTypeArguments(
                signature.parameter,
                typeArguments,
              ),
              return: instantiatedReturnType,
            }),
        )
      })
}

const soleSignature = (type: Type): Option<FunctionType['signature']> =>
  option.flatMap(applicableFunctionSignatures(type), signatures => {
    const [signature, ...additionalSignatures] = signatures
    return signature === undefined || additionalSignatures.length > 0 ?
        option.none
      : option.makeSome(signature)
  })

const typeParametersInScopeAt = (
  program: ParsedProgram,
  keyPath: KeyPath,
): ReadonlySet<symbol> =>
  either.unwrapOrElse(
    rigidTypeParameterIdentities({ ...program.context, location: keyPath }),
    _ => new Set(),
  )

type Location = {
  readonly keyPath: KeyPath
  readonly span: Span
}

/**
 * The most deeply-nested thing written at `offset`.
 */
const locationAtOffset = (
  { spans, propertyKeySpans }: ParsedProgram,
  offset: number,
): Option<Location> =>
  [...spans, ...propertyKeySpans]
    .flatMap(([stringifiedKeyPath, span]): readonly Location[] =>
      offset < span[0] || offset >= span[1] ?
        []
      : option.match(keyPathFromInternalUse(stringifiedKeyPath), {
          none: _ => [],
          some: keyPath =>
            // The program's span contains every offset, but we don't want to
            // describe the entire file when pointing at empty space.
            keyPath.length === 0 ? [] : [{ keyPath, span }],
        }),
    )
    .reduce<Option<Location>>(
      (narrowest, candidate) =>
        option.makeSome(
          option.match(narrowest, {
            none: _ => candidate,
            some: incumbent =>
              isNarrower(candidate, incumbent) ? candidate : incumbent,
          }),
        ),
      option.none,
    )

const isNarrower = (candidate: Location, incumbent: Location): boolean => {
  const candidateWidth = candidate.span[1] - candidate.span[0]
  const incumbentWidth = incumbent.span[1] - incumbent.span[0]
  return (
    candidateWidth < incumbentWidth ||
    (candidateWidth === incumbentWidth &&
      candidate.keyPath.length > incumbent.keyPath.length)
  )
}

const typeOfTarget = (
  program: ParsedProgram,
  { keyPath, role }: HoverTarget,
): Option<Type> => {
  switch (role.kind) {
    case 'nameOperand':
      return inferredTypeAt(program, role.expression)
    case 'queryComponent':
      return typeOfPartialIndex(program, role.expression, role.componentIndex)
    case 'parameterName':
      // Describe the parameter type of the function, which can come from its
      // context (e.g. `@runtime`).
      return option.flatMap(
        inferredTypeAt(program, role.functionExpression),
        functionType =>
          functionType.kind !== 'function' ? option.none
          : functionType.signature.parameter.kind === 'parameter' ?
            option.makeSome(
              functionType.signature.parameter.constraint.assignableTo,
            )
          : option.makeSome(functionType.signature.parameter),
      )
    case 'other':
      return inferredTypeAt(program, keyPath)
  }
}

const roleAt = (program: ParsedProgram, keyPath: KeyPath): TargetRole =>
  option.match(roleOfAtomAt(program, keyPath), {
    none: _ =>
      option.match(unannotatedParameterNameAt(program, keyPath), {
        none: _ => ({ kind: 'other' }),
        some: role => role,
      }),
    some: role => role,
  })

/**
 * For keyword expressions with atom operands, hover shouldn't show the literal
 * atom type even though the atom is the most deeply-nested expression.
 */
const roleOfAtomAt = (
  program: ParsedProgram,
  keyPath: KeyPath,
): Option<TargetRole> => {
  const { length } = keyPath
  const lastKey = keyPath[length - 1]
  const enclosesAnOperand = keyPath[length - 2] === '1'

  if (enclosesAnOperand && (lastKey === 'key' || lastKey === 'name')) {
    const expression = keyPath.slice(0, length - 2)
    const readExpression =
      lastKey === 'key' ? readLookupExpression : readHoleExpression
    return isExpressionAt(program, expression, readExpression) ?
        option.makeSome({ kind: 'nameOperand', expression })
      : option.none
  } else if (keyPath[length - 3] === '1' && keyPath[length - 2] === 'query') {
    const expression = keyPath.slice(0, length - 3)
    const componentIndex = Number(lastKey)
    return (
        Number.isInteger(componentIndex) &&
          isExpressionAt(program, expression, readIndexExpression)
      ) ?
        option.makeSome({ kind: 'queryComponent', expression, componentIndex })
      : option.none
  } else {
    return option.none
  }
}

/**
 * `a` in `a => …`.
 */
const unannotatedParameterNameAt = (
  program: ParsedProgram,
  keyPath: KeyPath,
): Option<TargetRole> => {
  const functionExpression = keyPath.slice(0, -2)
  const [operandsKey, operandKey] = keyPath.slice(-2)
  return (
      operandsKey === '1' &&
        operandKey === 'parameter' &&
        isExpressionAt(program, functionExpression, readFunctionExpression)
    ) ?
      option.flatMap(nodeAt(program, keyPath), node =>
        typeof node === 'string' ?
          option.makeSome({ kind: 'parameterName', functionExpression })
        : option.none,
      )
    : option.none
}

const isExpressionAt = (
  program: ParsedProgram,
  keyPath: KeyPath,
  readExpression: (node: SemanticGraph) => Either<unknown, unknown>,
): boolean =>
  option.match(nodeAt(program, keyPath), {
    none: _ => false,
    some: node => either.isRight(readExpression(node)),
  })

const typeOfPartialIndex = (
  program: ParsedProgram,
  expression: KeyPath,
  componentIndex: number,
): Option<Type> => {
  const queryKeyPath = [...expression, '1', 'query']
  return option.flatMap(nodeAt(program, queryKeyPath), query =>
    isObjectNode(query) ?
      either.match(
        typeKeyPathFromObjectNode(
          objectNodeFromOrderedEntries(
            orderedEntriesOfObjectNode(query).slice(0, componentIndex + 1),
          ),
          inferenceContextAt(program, queryKeyPath),
        ),
        {
          left: _ => option.none,
          right: typeKeyPath =>
            option.flatMap(
              inferredTypeAt(program, [...expression, '1', 'object']),
              objectType => applyKeyPathToType(objectType, typeKeyPath),
            ),
        },
      )
    : option.none,
  )
}

const inferredTypeAt = (
  program: ParsedProgram,
  keyPath: KeyPath,
): Option<Type> => {
  const inferTypeOfNode =
    isWithinTypeAnnotation(program, keyPath) ?
      inferTypeOfTypeAnnotation
    : inferType
  return option.flatMap(nodeAt(program, keyPath), node =>
    either.match(inferTypeOfNode(node, inferenceContextAt(program, keyPath)), {
      left: _ => option.none,
      right: type => option.makeSome(type),
    }),
  )
}

const inferenceContextAt = (
  program: ParsedProgram,
  keyPath: KeyPath,
): ExpressionContext => ({
  // The context's inference caches hold details from elaboration. Inferring
  // with fresh caches would give less-resolved (but still valid) answers.
  ...program.context,
  location: keyPath,
  cacheKeyPrefixOverride: undefined,
})

/**
 * Whether `keyPath` is in a type position (e.g. a parameter annotation). In
 * type position plain objects represent open types (in other locations they're
 * closed).
 */
const isWithinTypeAnnotation = (
  program: ParsedProgram,
  keyPath: KeyPath,
): boolean =>
  keyPath.some((_key, index) =>
    [
      {
        readExpression: readCheckExpression,
        operandKeySubpath: ['1', 'type'],
      },
      {
        readExpression: readFunctionExpression,
        // `undefined` stands for any key in `operandKeySubpath`s
        operandKeySubpath: ['1', 'parameter', undefined],
      },
      {
        readExpression: readHoleExpression,
        operandKeySubpath: ['1', 'constraint', 'assignableTo'],
      },
      {
        readExpression: readObjectTypeExpression,
        operandKeySubpath: ['1', 'properties', undefined],
      },
      {
        readExpression: readObjectTypeExpression,
        operandKeySubpath: ['1', 'excess', undefined, undefined],
      },
    ].some(
      ({ readExpression, operandKeySubpath }) =>
        operandKeySubpath.every((operandKey, offset) => {
          const key = keyPath[index + offset]
          return (
            key !== undefined &&
            (operandKey === undefined || operandKey === key)
          )
        }) && isExpressionAt(program, keyPath.slice(0, index), readExpression),
    ),
  )

const nodeAt = (
  program: ParsedProgram,
  keyPath: KeyPath,
): Option<SemanticGraph> =>
  applyKeyPathToSemanticGraph(program.context.program, keyPath)
