import type { GuestNetworkPressureAction } from '../../domain/networkPressure'

export type GuestNetworkPressureConsumeInput = Readonly<{
  organizationId: string
  propertyId: string
  portalId: string
  pseudonym: string
  action: GuestNetworkPressureAction
  observedAt: Date
  maxRequests: number
  windowSeconds: number
}>

export type GuestNetworkPressureDecision = Readonly<{
  allowed: boolean
  remaining: number
  resetAt: Date
}>

export type GuestNetworkPressureStore = Readonly<{
  consume(input: GuestNetworkPressureConsumeInput): Promise<GuestNetworkPressureDecision>
}>
