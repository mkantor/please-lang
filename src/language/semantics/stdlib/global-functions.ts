import either from '@matt.kantor/either'
import option, { type Option } from '@matt.kantor/option'
import type { Atom } from '../../parsing.js'
import { withDynamicEvaluationState } from '../expression-elaboration.js'
import {
  stringifyResolvedTypeForEndUser,
  stringifySemanticGraphForEndUser,
} from '../semantic-graph.js'
import {
  isAssignable,
  makeFunctionType,
  makeIntrinsicApplicationType,
  makeObjectType,
  makeTypeParameter,
  makeUnionType,
  matchTypeFormat,
  types,
  unionOfTypes,
  type Type,
} from '../type-system.js'
import { typeFromSemanticGraph } from '../type-system/literal-type.js'
import {
  asUnionWithLiteralAtomMembers,
  excessBoundForKey,
} from '../type-system/subtyping.js'
import {
  applicableFunctionSignatures,
  applyKeyPathToType,
  applyTypeToArgumentType,
  concreteUpperBound,
  replaceAllTypeParametersWithTheirConstraints,
} from '../type-system/type-substitution.js'
import {
  anyValue,
  functionParameter,
  objectOfFunctionsParameter,
  taggedParameter,
  typeOfParameter,
  type Parameter,
  type TaggedNode,
} from './parameters.js'
import {
  applyValidatingParameterType,
  emptyContextForStdlibApplications,
  preludeFunction,
} from './stdlib-utilities.js'

const A = makeTypeParameter('a', { assignableTo: types.something })
const B = makeTypeParameter('b', { assignableTo: types.something })
const C = makeTypeParameter('c', { assignableTo: types.something })

/**
 * Computes the upper bound of `match`'s return type, which is the union of each
 * reachable case's return type.
 */
const computeMatchReturnType = (parameterTypes: readonly Type[]): Type => {
  const [casesType, matcheeType] = parameterTypes
  if (casesType === undefined || matcheeType === undefined) {
    throw new Error(
      '`match` function did not receive two arguments. This is a bug!',
    )
  } else {
    // For every statically-known tag of the matchee, look up the case for that
    // tag and apply its type to the matchee's `value` type.
    return option.match(
      option.flatMap(
        enumerateTaggedVariants(matcheeUpperBound(matcheeType)),
        variants =>
          option.sequence(
            variants.map(({ tag, value }) =>
              option.flatMap(applyKeyPathToType(casesType, [tag]), caseType =>
                applyTypeToArgumentType(caseType, value),
              ),
            ),
          ),
      ),
      {
        none: _ =>
          // TODO: Ideally this would be impossible, but `match` needs a fancier
          // signature to make that happen.
          types.something,
        some: unionOfTypes,
      },
    )
  }
}

const anyTaggedValue = typeOfParameter(taggedParameter, [])

const matcheeParameter: Parameter<TaggedNode> = {
  ...taggedParameter,
  // The `matchee`'s type is constrained by the cases object supplied to `match`
  // parameter.
  type: ([casesType]) =>
    casesType === undefined ? anyTaggedValue : (
      makeIntrinsicApplicationType(
        [casesType],
        ([cases]) =>
          cases === undefined ?
            either.makeLeft({
              kind: 'bug',
              message:
                "`match`'s matchee type was computed without cases being known",
            })
          : either.map(
              typeFromSemanticGraph(cases, { objectsAreExact: true }),
              matcheeTypeForCases,
            ),
        ([casesType]) =>
          casesType === undefined ? anyTaggedValue : (
            matcheeTypeForCases(casesType)
          ),
      )
    ),
}

export const globalFunctions = {
  identity: preludeFunction(['identity'], [anyValue(A)], A, either.makeRight),

  // a ~> ((a ~> b) ~> b)
  apply: preludeFunction(
    ['apply'],
    [
      anyValue(A),
      functionParameter(makeFunctionType({ parameter: A, return: B })),
    ],
    B,
    argument =>
      either.makeRight((functionToApply, contextOfApplication) =>
        functionToApply(
          argument,
          withDynamicEvaluationState(
            emptyContextForStdlibApplications,
            contextOfApplication,
          ),
        ),
      ),
  ),

  // a ~> something ~> a
  // terminates with a `typeMismatch` error the value doesn't typecheck
  assume: preludeFunction(
    ['assume'],
    [anyValue(A), anyValue(types.something)],
    A,
    type =>
      either.makeRight(value =>
        either.flatMap(
          typeFromSemanticGraph(value, { objectsAreExact: true }),
          valueAsType =>
            either.flatMap(
              typeFromSemanticGraph(type, { objectsAreExact: false }),
              typeAsType =>
                isAssignable({ source: valueAsType, target: typeAsType }) ?
                  either.makeRight(value)
                : either.makeLeft({
                    kind: 'typeMismatch',
                    message: `the value \`${stringifySemanticGraphForEndUser(
                      value,
                    )}\` is not assignable to the type \`${stringifyResolvedTypeForEndUser(typeAsType)}\``,
                  }),
            ),
        ),
      ),
  ),

  // (b ~> c) ~> (a ~> b) ~> (a ~> c)
  flow: preludeFunction(
    ['flow'],
    [
      functionParameter(makeFunctionType({ parameter: B, return: C })),
      functionParameter(makeFunctionType({ parameter: A, return: B })),
      anyValue(A),
    ],
    C,
    secondFunction =>
      either.makeRight(firstFunction =>
        either.makeRight((firstArgument, contextOfApplication) =>
          either.flatMap(
            firstFunction(
              firstArgument,
              withDynamicEvaluationState(
                emptyContextForStdlibApplications,
                contextOfApplication,
              ),
            ),
            secondArgument =>
              secondFunction(
                secondArgument,
                withDynamicEvaluationState(
                  emptyContextForStdlibApplications,
                  contextOfApplication,
                ),
              ),
          ),
        ),
      ),
  ),

  match: preludeFunction(
    ['match'],
    [objectOfFunctionsParameter, matcheeParameter],
    types.something,
    cases =>
      either.makeRight((argument, contextOfApplication) => {
        const relevantCase = cases[argument.tag]
        return relevantCase === undefined ?
            either.makeLeft({
              kind: 'panic',
              message: `case for tag '${argument.tag}' was not defined`,
            })
          : applyValidatingParameterType(
              relevantCase,
              argument.value ?? unitValue,
              contextOfApplication,
            )
      }),
    computeMatchReturnType,
  ),
} as const

/**
 * Handed to a `match` case whose variant carries no `value` (e.g. `option`'s
 * `none`). This is the inhabitant of `types._`.
 */
const unitValue: Atom = '_'

/**
 * The widest matchee type the given cases can handle.
 */
const matcheeTypeForCases = (casesType: Type): Type =>
  casesType.kind !== 'object' ?
    anyTaggedValue
  : unionOfTypes(
      Object.entries(casesType.children).map(([tag, caseType]) => {
        const acceptedPayloadType = option.match(
          payloadTypeAcceptedByCase(caseType),
          {
            // A case whose type isn't a single function type (see
            // `payloadTypeAcceptedByCase`) doesn't constrain its payload.
            // `match` validates payloads against the applied case, so a bad
            // payload type is still rejected, just later.
            none: _ => types.something,
            some: payloadType => payloadType,
          },
        )
        // A variant with no `value` passes the unit value, so `value` is only
        // required when unit wouldn't satisfy the case.
        return isAssignable({ source: types._, target: acceptedPayloadType }) ?
            makeObjectType({ tag: makeUnionType([tag]) }, [
              { keys: makeUnionType(['value']), values: acceptedPayloadType },
            ])
          : makeObjectType({
              tag: makeUnionType([tag]),
              value: acceptedPayloadType,
            })
      }),
    )

const payloadTypeAcceptedByCase = (caseType: Type): Option<Type> =>
  option.flatMap(
    applicableFunctionSignatures(caseType),
    // TODO: Satisfying multiple signatures would require intersection types.
    ([signature, ...additionalSignatures]) =>
      signature === undefined || additionalSignatures.length > 0 ?
        option.none
      : option.makeSome(
          replaceAllTypeParametersWithTheirConstraints(signature.parameter),
        ),
  )

type TaggedVariant = {
  readonly tag: Atom
  readonly value: Type
}

const matcheeUpperBound = (matcheeType: Type): Type =>
  concreteUpperBound(replaceAllTypeParametersWithTheirConstraints(matcheeType))

const enumerateTaggedVariants = (
  type: Type,
): Option<readonly TaggedVariant[]> =>
  matchTypeFormat(type, {
    union: type =>
      option.map(
        option.sequence([
          ...type.members
            .values()
            .map(member =>
              typeof member === 'string' ?
                option.none
              : enumerateTaggedVariants(member),
            ),
        ]),
        variantsPerMember => variantsPerMember.flat(),
      ),
    object: type => {
      const tagType = type.children['tag']
      // An unlisted `value` may be absent (making the variant's payload
      // `unitValue`) or present within whatever bound the excess clauses allow.
      const valueType =
        type.children['value'] ??
        unionOfTypes([types._, excessBoundForKey('value', type.excess)])
      return tagType?.kind !== 'union' ?
          option.none
        : option.map(asUnionWithLiteralAtomMembers(tagType), tags => [
            ...tags.members.values().map(tag => ({ tag, value: valueType })),
          ])
    },
    application: _ => option.none,
    function: _ => option.none,
    indexedAccess: _ => option.none,
    intrinsicApplication: _ => option.none,
    opaque: _ => option.none,
    parameter: _ => option.none,
  })
