export const atomTypeSymbol = Symbol('atom')
export const integerTypeSymbol = Symbol('integer')
export const naturalNumberTypeSymbol = Symbol('natural_number')

// Despite not being opaque, `something` gets a type symbol to avoid
// complications stemming from its circular definition.
export const somethingTypeSymbol = Symbol('something')
