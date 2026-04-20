// Brand type utility — creates a nominal type from a primitive
export type Brand<T, B extends string> = T & { __brand: B }

// Branded ID types for domain objects
export type OrganizationId = Brand<string, 'OrganizationId'>
export type UserId = Brand<string, 'UserId'>
export type PropertyId = Brand<string, 'PropertyId'>
export type PortalId = Brand<string, 'PortalId'>

// Brand type helpers
export function createId<T extends string>(id: string, _brand: T): Brand<string, T> {
  return id as Brand<string, T>
}
