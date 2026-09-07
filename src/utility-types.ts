export type JsonArray = readonly JsonValue[]
export type JsonRecord = { readonly [key: string]: JsonValue }
export type JsonValue =
  null | boolean | number | string | JsonArray | JsonRecord

export type Writable<T> = { -readonly [P in keyof T]: T[P] }

export type RemoveIndexSignatures<T> = {
  [
    K in keyof T as string extends K ? never
    : number extends K ? never
    : symbol extends K ? never
    : K
  ]: T[K]
} &
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  unknown // Improves type display.
