// Integration context — property lookup port
// Per architecture: "Ports are TypeScript types defining capability contracts."
// Used by the GBP webhook handler to resolve a property by its Google Business Profile place ID.
// Unlike the property context's own repo, this does not require an organizationId —
// the webhook is push-based from Google, not tenant-initiated.

export type PropertyLookup = Readonly<{
  id: string
  organizationId: string
  googleConnectionId: string | null
}>

export type PropertyLookupPort = Readonly<{
  findByGbpPlaceId: (gbpPlaceId: string) => Promise<PropertyLookup | null>
}>
