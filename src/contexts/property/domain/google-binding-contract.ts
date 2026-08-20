import type { GoogleConnectionId, OrganizationId, PropertyId } from '#/shared/domain/ids'

export const GOOGLE_BINDING_STATES = [
  'unbound',
  'account_confirmation_required',
  'active',
  'disconnected',
] as const
export type GoogleBindingState = (typeof GOOGLE_BINDING_STATES)[number]

const GOOGLE_BINDING_STATE_SET = new Set<string>(GOOGLE_BINDING_STATES)

export function isGoogleBindingState(value: string): value is GoogleBindingState {
  return GOOGLE_BINDING_STATE_SET.has(value)
}

export function isGoogleResourceSuffix(value: string): boolean {
  if (
    value.length < 1 ||
    value.length > 255 ||
    value.includes('/') ||
    value.includes('?') ||
    value.includes('#') ||
    /\s/u.test(value)
  ) {
    return false
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) return false
  }
  return true
}

export type GoogleBindingTuple = Readonly<{
  state: GoogleBindingState
  connectionId: GoogleConnectionId | null
  accountId: string | null
  locationId: string | null
}>

export function isGoogleBindingTupleValid(tuple: GoogleBindingTuple): boolean {
  const connectionPresent = tuple.connectionId !== null
  const accountValid = tuple.accountId !== null && isGoogleResourceSuffix(tuple.accountId)
  const locationValid =
    tuple.locationId !== null && isGoogleResourceSuffix(tuple.locationId)

  switch (tuple.state) {
    case 'unbound':
      return !connectionPresent && tuple.accountId === null && tuple.locationId === null
    case 'account_confirmation_required':
      return connectionPresent && tuple.accountId === null && locationValid
    case 'active':
    case 'disconnected':
      return connectionPresent && accountValid && locationValid
  }
}

export type GoogleLocationBinding = Readonly<{
  connectionId: GoogleConnectionId
  accountId: string
  locationId: string
  sourceEpoch: number
}>

export const PROPERTY_GOOGLE_BINDING_CHANGED_EVENT =
  'property.google_binding.changed' as const

export type PropertyGoogleBindingChangedV1 = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  connectionId: GoogleConnectionId
  sourceEpoch: number
  change: 'created' | 'relinked' | 'disconnected' | 'deletion_started'
}>
