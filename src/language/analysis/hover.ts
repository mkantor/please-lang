import either, { type Either } from '@matt.kantor/either'
import option, { type Option } from '@matt.kantor/option'
import { stripVTControlCharacters } from 'node:util'
import type { Atom } from '../parsing.js'
import {
  applyKeyPathToSemanticGraph,
  applyKeyPathToType,
  inferType,
  inferTypeOfTypeAnnotation,
  keyPathFromInternalUse,
  readCheckExpression,
  readFunctionExpression,
  readHoleExpression,
  readIndexExpression,
  readLookupExpression,
  readObjectTypeExpression,
  rigidTypeParameterIdentities,
  stringifyResolvedTypeForEndUser,
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
  option.flatMap(locationAtOffset(program, offset), ({ keyPath, span }) =>
    option.map(typeAtLocation(program, keyPath), type => ({
      span,
      type: renderType(type, typeParametersInScopeAt(program, keyPath)),
    })),
  )

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

const typeAtLocation = (
  program: ParsedProgram,
  keyPath: KeyPath,
): Option<Type> =>
  option.match(roleOfAtomAt(program, keyPath), {
    none: _ => inferredTypeAt(program, keyPath),
    some: role =>
      role.kind === 'nameOperand' ?
        inferredTypeAt(program, role.expression)
      : typeOfPartialIndex(program, role.expression, role.componentIndex),
  })

/**
 * For keyword expressions with atom operands, hover shouldn't show the literal
 * atom type even though the atom is the most deeply-nested expression.
 * `AtomRole` models the "roles" for these atoms, which determines what type to
 * show in tooltips.
 */
type AtomRole =
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

const roleOfAtomAt = (
  program: ParsedProgram,
  keyPath: KeyPath,
): Option<AtomRole> => {
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
  const componentKeys = Array.from({ length: componentIndex + 1 }, (_, index) =>
    String(index),
  )
  const components = componentKeys.flatMap((componentKey): readonly Atom[] =>
    option.match(nodeAt(program, [...queryKeyPath, componentKey]), {
      none: _ => [],
      some: component => (typeof component === 'string' ? [component] : []),
    }),
  )
  return components.length !== componentKeys.length ?
      // Part of the query is computed, fall back to the deepest index.
      // TODO: This is wrong unless the happens to be last. Use each component's
      // inferred type instead (like `typeKeyPathFromObjectNode`).
      inferredTypeAt(program, expression)
    : option.flatMap(
        inferredTypeAt(program, [...expression, '1', 'object']),
        objectType => applyKeyPathToType(objectType, components),
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
    either.match(
      // The context's inference caches hold details from elaboration. Inferring
      // with fresh caches would give less-resolved (but still valid) answers.
      inferTypeOfNode(node, {
        ...program.context,
        location: keyPath,
        cacheKeyPrefixOverride: undefined,
      }),
      { left: _ => option.none, right: type => option.makeSome(type) },
    ),
  )
}

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
