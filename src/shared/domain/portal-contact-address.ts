// A phone number or an email address a Portal Linktree tile may open, besides a
// website (owner decision 2026-10-26: allowed, never waiting for an account
// admin, and tapped like any other link).
//
// A manager may type the number or address as people write them ("+1 (555)
// 123-4567", "front@hotel.com") or as a `tel:` or `mailto:` address; both reach
// one stored form, `tel:+15551234567` or `mailto:front@hotel.com`. That form is
// the only one the guest edge and the guest page follow: a stored address is
// accepted only when reading it again gives the very same string
// (`isPortalContactUri`), so no query, header, second recipient, encoded
// character or other scheme can travel inside one.
//
// Pure on purpose (no zod, no I/O), so the Portal domain, the editor and the
// guest page share one reading.

import type { PortalLinkIconKey } from './portal-link-icon'

export type PortalContactKind = 'phone' | 'email'

export type PortalContactAddress = Readonly<{
  kind: PortalContactKind
  /** The stored form: `tel:+15551234567` or `mailto:front@hotel.com`. */
  uri: string
  /** The number or address without its scheme, as the editor shows it. */
  address: string
}>

/**
 * What a typed address says it is. Null when it is not a phone number or an
 * email address at all (a website, or nothing the Linktree takes); otherwise the
 * stored form, or the kind it was meant to be when it cannot be read as one.
 */
export type PortalContactInput =
  | Readonly<{ ok: true; contact: PortalContactAddress }>
  | Readonly<{ ok: false; kind: PortalContactKind }>
  | null

/** The icon a contact tile gets when the manager chose none. */
export const PORTAL_CONTACT_ICON_KEYS: Readonly<
  Record<PortalContactKind, PortalLinkIconKey>
> = { phone: 'phone', email: 'mail' }

const PHONE_SCHEME = 'tel:'
const EMAIL_SCHEME = 'mailto:'

// E.164 allows at most 15 digits; 7 is the shortest local number worth calling.
const PHONE_DIGITS = /^(\+?)([0-9]{7,15})$/u
// Spaces (plain, no-break and narrow no-break), dashes (hyphen, the Unicode
// dashes and the minus sign), dots and brackets people write between groups of
// digits. Nothing else is dropped.
const PHONE_SEPARATORS = /[ \u00a0\u202f().\-\u2010-\u2015\u2212]/gu
const PHONE_SHAPED = /^\+?[0-9 \u00a0\u202f().\-\u2010-\u2015\u2212]+$/u
const HAS_DIGIT = /[0-9]/u

// A deliberately small part of RFC 5321: letters, digits and . _ ' + - before
// the @, so no character can start a query, a header, a second recipient or an
// encoding inside a `mailto:` address. A dot may not start or end it, or follow
// another dot.
const EMAIL_LOCAL_CHARACTERS = /^[A-Za-z0-9_'+.-]+$/u
const DOMAIN_LABEL_CHARACTERS = /^[a-z0-9-]{1,63}$/u
const TOP_LEVEL_DOMAIN = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/u
const EMAIL_LOCAL_MAX = 64
const EMAIL_DOMAIN_MAX = 253
const EMAIL_ADDRESS_MAX = 254

function withoutScheme(value: string, scheme: string): string | null {
  return value.slice(0, scheme.length).toLowerCase() === scheme
    ? value.slice(scheme.length)
    : null
}

function kindOf(value: string): PortalContactKind | null {
  if (withoutScheme(value, PHONE_SCHEME) !== null) return 'phone'
  if (withoutScheme(value, EMAIL_SCHEME) !== null) return 'email'
  // A website always carries a scheme, so an @ with no colon is an email address.
  if (value.includes('@') && !value.includes(':')) return 'email'
  if (PHONE_SHAPED.test(value) && HAS_DIGIT.test(value)) return 'phone'
  return null
}

function readPhone(value: string): PortalContactAddress | null {
  const body = withoutScheme(value, PHONE_SCHEME) ?? value
  const match = PHONE_DIGITS.exec(body.replace(PHONE_SEPARATORS, ''))
  if (!match) return null
  const address = `${match[1] ?? ''}${match[2] ?? ''}`
  return { kind: 'phone', uri: `${PHONE_SCHEME}${address}`, address }
}

function isDotSeparated(value: string): boolean {
  return !value.startsWith('.') && !value.endsWith('.') && !value.includes('..')
}

function isLocalPart(local: string): boolean {
  return (
    local.length <= EMAIL_LOCAL_MAX &&
    EMAIL_LOCAL_CHARACTERS.test(local) &&
    isDotSeparated(local)
  )
}

function isDomainLabel(label: string): boolean {
  return (
    DOMAIN_LABEL_CHARACTERS.test(label) && !label.startsWith('-') && !label.endsWith('-')
  )
}

function isDomain(domain: string): boolean {
  const labels = domain.split('.')
  const top = labels[labels.length - 1] ?? ''
  return (
    domain.length <= EMAIL_DOMAIN_MAX &&
    labels.length >= 2 &&
    labels.every(isDomainLabel) &&
    TOP_LEVEL_DOMAIN.test(top)
  )
}

function readEmail(value: string): PortalContactAddress | null {
  const body = withoutScheme(value, EMAIL_SCHEME) ?? value
  const parts = body.split('@')
  if (parts.length !== 2) return null
  const [local = '', rawDomain = ''] = parts
  const domain = rawDomain.toLowerCase()
  const address = `${local}@${domain}`
  if (address.length > EMAIL_ADDRESS_MAX || !isLocalPart(local) || !isDomain(domain)) {
    return null
  }
  return { kind: 'email', uri: `${EMAIL_SCHEME}${address}`, address }
}

/** Reads what a manager typed as a phone number or an email address (see the type). */
export function parsePortalContactInput(input: string): PortalContactInput {
  const value = input.trim()
  const kind = kindOf(value)
  if (kind === null) return null
  const contact = kind === 'phone' ? readPhone(value) : readEmail(value)
  return contact ? { ok: true, contact } : { ok: false, kind }
}

/** The contact a stored address names, only when it is exactly the stored form. */
export function portalContactOf(uri: string): PortalContactAddress | null {
  const parsed = parsePortalContactInput(uri)
  return parsed?.ok === true && parsed.contact.uri === uri ? parsed.contact : null
}

/** Whether `uri` is a phone number or email address in its stored form. */
export function isPortalContactUri(uri: string): boolean {
  return portalContactOf(uri) !== null
}
