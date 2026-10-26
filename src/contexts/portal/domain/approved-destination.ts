import type {
  OrganizationId,
  PortalApprovedDestinationId,
  PropertyId,
  UserId,
} from '#/shared/domain/ids'
import {
  isPortalContactUri,
  parsePortalContactInput,
  portalContactOf,
  PORTAL_CONTACT_ICON_KEYS,
} from '#/shared/domain/portal-contact-address'
import type { PortalLinkIconKey } from '#/shared/domain/portal-link-icon'
import { portalError } from './errors'

/**
 * Stored on every destination row, a phone number or email address included.
 * A contact row is told apart by its `sourceType`, not by a version of its own:
 * an older server reads every row of a Property's list and refuses any other
 * version, so a second one would break the list on a rollback.
 */
export const PORTAL_DESTINATION_VALIDATION_VERSION =
  'portal-destination-https-v1' as const

/**
 * `contact` is a phone number or an email address (`tel:`/`mailto:`). It is
 * approved as it is entered, never checked over the network, and is not one
 * of the "Sites allowed for links".
 */
export type PortalApprovedDestinationSource =
  'recognized' | 'custom' | 'provider' | 'contact'
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

/** A website a manager entered: never a contact, which only `validatePortalLinkDestination` admits. */
export type ValidatedPortalWebsite = ValidatedPortalDestination &
  Readonly<{ sourceType: 'recognized' | 'custom' }>

/**
 * The `contact` source exempts a row from the network check and from the
 * guest edge's freshness cut-off, so it must name exactly a stored phone number
 * or email address, and such an address may be nothing but a contact.
 */
export function isConsistentDestinationKind(
  destination: Readonly<{
    normalizedUri: string
    sourceType: PortalApprovedDestinationSource
  }>,
): boolean {
  return (
    (destination.sourceType === 'contact') ===
    isPortalContactUri(destination.normalizedUri)
  )
}

/** A destination that is a website, the only kind the list of sites shows. */
export type PortalSiteDestination = PortalApprovedDestination &
  Readonly<{ sourceType: Exclude<PortalApprovedDestinationSource, 'contact'> }>

export function isSiteDestination(
  destination: PortalApprovedDestination,
): destination is PortalSiteDestination {
  return destination.sourceType !== 'contact'
}

/** What a manager is told when the address of a tile cannot be read. */
export const PORTAL_LINK_ADDRESS_REFUSALS = {
  website: 'Enter a website starting with https://, a phone number or an email address.',
  phone:
    'Enter a phone number of 7 to 15 digits. It may start with + and use spaces, dashes, dots or brackets.',
  email: 'Enter one email address, such as front@hotel.com, with nothing after it.',
} as const

/**
 * Admission for a Linktree tile's address: a phone number or an email address
 * in its stored form (see `portal-contact-address.ts`), or else a website, which
 * `validatePortalDestinationUri` admits. A contact's `hostname` is its number or
 * address without the scheme: it has no host, the column is what lists and the
 * export name a destination by, and a value with an @ or a leading + or digit is
 * never read as a host (the network check never takes a contact row).
 */
export function validatePortalLinkDestination(input: string): ValidatedPortalDestination {
  const contact = parsePortalContactInput(input)
  if (contact === null) return validatePortalDestinationUri(input)
  if (!contact.ok) {
    throw portalError('invalid_url', PORTAL_LINK_ADDRESS_REFUSALS[contact.kind])
  }
  return {
    normalizedUri: contact.contact.uri,
    hostname: contact.contact.address,
    sourceType: 'contact',
  }
}

/**
 * The icon a tile that opens `uri` wears when the manager chose none: a phone
 * for a phone number, a letter for an email address, nothing for a site.
 */
export function defaultLinkIconKey(uri: string): PortalLinkIconKey | null {
  const contact = portalContactOf(uri)
  return contact ? PORTAL_CONTACT_ICON_KEYS[contact.kind] : null
}

/**
 * Synchronous admission for manager-supplied secondary destinations. DNS and
 * redirect revalidation remain an infrastructure concern; this boundary keeps
 * credentials, non-HTTPS schemes, literal network addresses, fragments, and
 * deceptive host spellings out of durable Portal state.
 */
export function validatePortalDestinationUri(uri: string): ValidatedPortalWebsite {
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
