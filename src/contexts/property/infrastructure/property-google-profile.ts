import { isValidIanaTimezone } from '#/shared/domain/timezones'
import { PropertyGoogleBindingError } from '../application/ports/property-google-binding.port'
import { isGoogleBindingTupleValid } from '../domain/google-binding-contract'
import type { GoogleConnectionId } from '#/shared/domain/ids'

export function assertBindingProfile(input: {
  state: 'unbound' | 'account_confirmation_required' | 'active' | 'disconnected'
  connectionId: GoogleConnectionId | null
  accountId: string | null
  locationId: string | null
  profileVersion: number
  profileSource: string
  profileConfirmedAt: Date | null
  profileConfirmedBy: string | null
}): void {
  if (
    !isGoogleBindingTupleValid(input) ||
    input.state !== 'active' ||
    input.profileSource !== 'tenant_confirmed' ||
    input.profileConfirmedAt === null ||
    input.profileConfirmedBy === null ||
    !Number.isSafeInteger(input.profileVersion) ||
    input.profileVersion < 1
  ) {
    throw new PropertyGoogleBindingError('invalid_binding')
  }
}

export function normalizeConfirmedProfile(profile: {
  name: string
  address: string | null
  timezone: string
  confirmedBy: string
}): {
  name: string
  address: string | null
  timezone: string
  confirmedBy: string
} {
  const name = profile.name.trim()
  const address = profile.address?.trim() || null
  const confirmedBy = profile.confirmedBy.trim()
  if (
    name.length < 1 ||
    name.length > 100 ||
    (address !== null && address.length > 500) ||
    !isValidIanaTimezone(profile.timezone) ||
    confirmedBy.length < 1 ||
    confirmedBy.length > 255
  ) {
    throw new PropertyGoogleBindingError('invalid_binding')
  }
  return { name, address, timezone: profile.timezone, confirmedBy }
}
