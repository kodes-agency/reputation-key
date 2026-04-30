// Brand type utility — creates a nominal type from a primitive
// Used to create distinct ID types that can't be accidentally swapped.
export type Brand<T, B extends string> = T & { __brand: B }

// Brand constructor and guard are inlined by consumers when needed.
// Per conventions: "as casts except for branded ID parsing" are forbidden.
// The Brand type itself is the only export required.
