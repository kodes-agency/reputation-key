// Integration context — property lookup port
// Per architecture: "Ports are TypeScript types defining capability contracts."
// Used by the GBP webhook handler to resolve a property by its Business Profile location ID.
// Unlike the property context's own repo, this does not require an organizationId because
// the webhook is push-based from Google rather than tenant-initiated.

export type PropertyLookup = Readonly<{
  id: string
  organizationId: string
  googleConnectionId: string | null
  gbpAccountId: string | null
  gbpLocationId: string | null
  googleBindingState:
    'unbound' | 'account_confirmation_required' | 'active' | 'disconnected'
  sourceEpoch: number
}>

export type PropertyLookupPort = Readonly<{
  findByGbpLocationId: (gbpLocationId: string) => Promise<PropertyLookup | null>
}>
