const DAY_MS = 24 * 60 * 60 * 1000

export const GUEST_NETWORK_PRESSURE_RETENTION_MS = 7 * DAY_MS

export const GUEST_NETWORK_PRESSURE_ACTIONS = Object.freeze([
  'rating',
  'private_feedback',
  'destination_action',
  'qualified_scan',
] as const)

export type GuestNetworkPressureAction = (typeof GUEST_NETWORK_PRESSURE_ACTIONS)[number]

export type GuestNetworkPressureRecord = Readonly<{
  id: string
  organizationId: string
  propertyId: string
  portalId: string
  pseudonym: string
  action: GuestNetworkPressureAction
  observedAt: Date
  expiresAt: Date
}>

export type GuestNetworkPressureError = Readonly<{
  _tag: 'GuestNetworkPressureError'
  code: 'invalid_scope' | 'invalid_pseudonym' | 'invalid_action' | 'invalid_time'
  message: string
}>

const invalid = (
  code: GuestNetworkPressureError['code'],
  message: string,
): GuestNetworkPressureError => ({ _tag: 'GuestNetworkPressureError', code, message })

export function createGuestNetworkPressureRecord(
  input: Omit<GuestNetworkPressureRecord, 'expiresAt'>,
): Result<GuestNetworkPressureRecord, GuestNetworkPressureError> {
  for (const [label, value] of [
    ['Organization', input.organizationId],
    ['Property', input.propertyId],
    ['Portal', input.portalId],
  ] as const) {
    if (!value.trim()) return err(invalid('invalid_scope', `${label} scope is required`))
  }
  if (!/^[a-f0-9]{64}$/u.test(input.pseudonym)) {
    return err(
      invalid(
        'invalid_pseudonym',
        'Guest network pseudonym must be a 64-character keyed digest',
      ),
    )
  }
  if (!GUEST_NETWORK_PRESSURE_ACTIONS.includes(input.action)) {
    return err(invalid('invalid_action', 'Guest network pressure action is invalid'))
  }
  if (!Number.isFinite(input.observedAt.getTime())) {
    return err(invalid('invalid_time', 'Guest network pressure time is invalid'))
  }

  return ok({
    ...input,
    expiresAt: new Date(input.observedAt.getTime() + GUEST_NETWORK_PRESSURE_RETENTION_MS),
  })
}
import { err, ok, type Result } from '#/shared/domain'
