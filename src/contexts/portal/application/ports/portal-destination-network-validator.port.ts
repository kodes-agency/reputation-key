export type PortalDestinationNetworkValidation =
  | Readonly<{
      outcome: 'safe'
      validatedAt: Date
      finalUri: string
      redirectCount: number
    }>
  | Readonly<{
      outcome: 'unsafe'
      reason:
        | 'dns_non_public'
        | 'dns_address_changed'
        | 'redirect_target_invalid'
        | 'redirect_host_changed'
        | 'redirect_limit_exceeded'
      observedAt: Date
    }>
  | Readonly<{
      outcome: 'unavailable'
      reason: 'dns_unavailable' | 'request_unavailable' | 'invalid_response'
      observedAt: Date
    }>

export type PortalDestinationNetworkValidator = Readonly<{
  validate(uri: string): Promise<PortalDestinationNetworkValidation>
}>
