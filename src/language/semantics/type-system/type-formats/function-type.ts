import type { Type } from './type.js'

export type FunctionType = {
  readonly kind: 'function'
  readonly signature: {
    readonly parameter: Type
    readonly return: Type
  }
}

export const makeFunctionType = <Signature extends FunctionType['signature']>(
  signature: Signature,
): FunctionType & {
  readonly signature: Signature
} => ({
  kind: 'function',
  signature,
})
