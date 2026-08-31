import type {
  ContactRequestAccessPurpose,
  ContactRequestPurpose,
  ContactRequestScope,
  MaskedContactRequest,
} from '../../domain/contact-request'
import type { ContactRequestManagerAuthorization } from './contact-request-manager-authority.port'

export type ContactRequestRepository = Readonly<{
  create(input: {
    id: string
    scope: ContactRequestScope
    responseId: string
    purpose: ContactRequestPurpose
    consent: true
    email: string
    name?: string
    submittedAt: Date
    expiresAt: Date
  }): Promise<
    Readonly<{
      outcome: 'created' | 'duplicate' | 'source_unavailable' | 'contact_disabled'
    }>
  >
  findMasked(input: {
    scope: ContactRequestScope
    contactRequestId: string
    authorization: ContactRequestManagerAuthorization
    asOf: Date
  }): Promise<MaskedContactRequest | null>
  reveal(input: {
    scope: ContactRequestScope
    contactRequestId: string
    authorization: ContactRequestManagerAuthorization
    auditId: string
    accessPurpose: ContactRequestAccessPurpose
    at: Date
  }): Promise<
    | Readonly<{ outcome: 'revealed'; email: string; name?: string }>
    | Readonly<{ outcome: 'not_found' | 'unavailable' | 'not_authorized' }>
  >
  withdraw(input: {
    scope: ContactRequestScope
    contactRequestId: string
    responseId: string
    at: Date
  }): Promise<Readonly<{ outcome: 'withdrawn' | 'not_found' | 'unavailable' }>>
  purgeExpired(input: { through: Date; batchSize: number }): Promise<
    Readonly<{
      processed: number
      checkpoint: Readonly<{ expiresAt: Date; id: string }> | null
      completedThrough: Date | null
    }>
  >
}>
