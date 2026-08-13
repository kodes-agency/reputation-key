export type ProviderContentLeaseDto = Readonly<{
  leaseRef: string
  expiresAt: string
  ttlSeconds: number
  renewAfterMs: 10_000
}>
