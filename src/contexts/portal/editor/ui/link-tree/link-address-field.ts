// What the field a tile's address is typed in says, in the add form and in the
// open tile alike: a website, a phone number or an email address. It is a plain
// text field, because a browser's own check of a `url` field would refuse a
// phone number or an email address before the form could take it.
//
// A phone number or an email address is saved as `tel:+15551234567` or
// `mailto:front@hotel.com`; the field shows it without that scheme.

import {
  parsePortalContactInput,
  portalContactOf,
} from '#/shared/domain/portal-contact-address'

export const LINK_ADDRESS_FIELD = {
  label: 'Website, phone or email',
  description:
    'A website starting with https://, a phone number guests can call, or an email address they can write to.',
} as const

/** A saved address as the field shows it: a phone number or an email address plainly. */
export function linkAddressForField(url: string): string {
  return portalContactOf(url)?.address ?? url
}

/**
 * Whether what the field holds is the saved address, in the field's spelling or,
 * for a phone number or an email address, in any spelling stored as the same
 * one: leaving the field then saves nothing.
 */
export function isSavedLinkAddress(value: string, url: string): boolean {
  if (value.trim() === linkAddressForField(url)) return true
  const contact = parsePortalContactInput(value)
  return contact?.ok === true && contact.contact.uri === url
}
