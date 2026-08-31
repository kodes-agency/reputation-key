export const CONTACT_REQUEST_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export type ContactRequestScope = Readonly<{
  organizationId: string
  propertyId: string
  portalId: string
}>

export type ContactRequestPurpose = 'manager_follow_up'
export type ContactRequestAccessPurpose = 'respond_to_contact_request'

export type ContactRequestContact = Readonly<{
  email: string
  name?: string
}>

export type MaskedContactRequest = Readonly<{
  id: string
  scope: ContactRequestScope
  responseId: string
  purpose: ContactRequestPurpose
  maskedContact: '••••••••'
  submittedAt: Date
  expiresAt: Date
}>
