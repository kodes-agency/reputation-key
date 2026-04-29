// Brand type utility — creates a nominal type from a primitive
// Used to create distinct ID types that can't be accidentally swapped.
export type Brand<T, B extends string> = T & { __brand: B }

// Brand constructor — the only acceptable `as` cast in the codebase.
// Per conventions: "as casts except for branded ID parsing" are forbidden.
function brandId<T extends string>(id: string, _brand: T): Brand<string, T> {
  return id as Brand<string, T>
}

// Brand guard — checks if a value is branded with a specific tag.
function isBrand<T extends string>(
  value: unknown,
  brand: T,
): value is Brand<string, T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__brand' in value &&
    (value as { __brand: string }).__brand === brand
  )
}
