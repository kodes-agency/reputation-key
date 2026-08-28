import type {
  OrganizationId,
  PortalApprovedDestinationId,
  PropertyId,
  UserId,
} from '#/shared/domain/ids'
import { portalError } from './errors'

export const PORTAL_DESTINATION_VALIDATION_VERSION =
  'portal-destination-https-v1' as const

export type PortalApprovedDestinationSource = 'recognized' | 'custom' | 'provider'
export type PortalApprovedDestinationState =
  'pending' | 'approved' | 'disabled' | 'quarantined'

export type PortalApprovedDestination = Readonly<{
  id: PortalApprovedDestinationId
  organizationId: OrganizationId
  propertyId: PropertyId
  normalizedUri: string
  hostname: string
  sourceType: PortalApprovedDestinationSource
  approvalState: PortalApprovedDestinationState
  validationVersion: typeof PORTAL_DESTINATION_VALIDATION_VERSION
  requestedBy: UserId
  approvedBy: UserId | null
  approvedAt: Date | null
  disabledAt: Date | null
  disabledReason: string | null
  lastValidatedAt: Date
  createdAt: Date
  updatedAt: Date
}>

const RECOGNIZED_HOSTS = new Set([
  'booking.com',
  'expedia.com',
  'facebook.com',
  'instagram.com',
  'linkedin.com',
  'tripadvisor.com',
  'x.com',
  'youtube.com',
])

function isRecognizedHostname(hostname: string): boolean {
  for (const candidate of RECOGNIZED_HOSTS) {
    if (hostname === candidate || hostname.endsWith(`.${candidate}`)) return true
  }
  return false
}

function isForbiddenHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    isLiteralIpHostname(hostname)
  )
}

function isLiteralIpHostname(hostname: string): boolean {
  // WHATWG URL parsing accepts only valid IPv6 inside brackets and canonicalizes
  // legacy IPv4 spellings (for example, 127.1) to four decimal octets.
  if (hostname.startsWith('[') && hostname.endsWith(']')) return true
  const octets = hostname.split('.')
  return (
    octets.length === 4 &&
    octets.every((octet) => {
      if (octet.length === 0 || octet.length > 3) return false
      for (const character of octet) {
        if (character < '0' || character > '9') return false
      }
      return Number(octet) <= 255
    })
  )
}

export type ValidatedPortalDestination = Readonly<{
  normalizedUri: string
  hostname: string
  sourceType: Exclude<PortalApprovedDestinationSource, 'provider'>
}>

/**
 * Synchronous admission for manager-supplied secondary destinations. DNS and
 * redirect revalidation remain an infrastructure concern; this boundary keeps
 * credentials, non-HTTPS schemes, literal network addresses, fragments, and
 * deceptive host spellings out of durable Portal state.
 */
export function validatePortalDestinationUri(uri: string): ValidatedPortalDestination {
  const trimmed = uri.trim()
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw portalError('invalid_url', 'Destination must be a valid HTTPS address')
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/u, '')
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    (parsed.port !== '' && parsed.port !== '443') ||
    parsed.hash !== '' ||
    hostname.length === 0 ||
    hostname.length > 253 ||
    isForbiddenHostname(hostname)
  ) {
    throw portalError(
      'invalid_url',
      'Destination must be a public HTTPS address without credentials or a fragment',
    )
  }
  parsed.hostname = hostname
  parsed.port = ''
  return {
    normalizedUri: parsed.toString(),
    hostname,
    sourceType: isRecognizedHostname(hostname) ? 'recognized' : 'custom',
  }
}
