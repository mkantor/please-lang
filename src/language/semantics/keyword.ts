export const isExemptFromElaboration = (input: Keyword) =>
  input === '@hole' || input === '@object' || input === '@union'

export const isKeyword = (input: string) =>
  input === '@apply' ||
  input === '@check' ||
  input === '@function' ||
  input === '@hole' ||
  input === '@if' ||
  input === '@index' ||
  input === '@lookup' ||
  input === '@object' ||
  input === '@panic' ||
  input === '@runtime' ||
  input === '@todo' ||
  input === '@union'

export type Keyword =
  typeof isKeyword extends (input: string) => input is string & infer Keyword ?
    Keyword
  : never
