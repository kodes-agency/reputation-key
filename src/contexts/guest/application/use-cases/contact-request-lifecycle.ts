import {
  contactRequestContactSchema,
  contactRequestPurposeSchema,
} from '../dto/contact-request.dto'
import type { ContactRequestRepository } from '../ports/contact-request.repository'
import {
  CONTACT_REQUEST_RETENTION_MS,
  type ContactRequestAccessPurpose,
  type ContactRequestPurpose,
  type ContactRequestScope,
} from '../../domain/contact-request'

export type SubmitContactRequestInput = ContactRequestScope &
  Readonly<{
    responseId: string
    email: string
    name?: string
    consent?: boolean
    purpose?: ContactRequestPurpose
  }>

export class ContactRequestLifecycleError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'ContactRequestLifecycleError'
  }
}

export function contactRequestLifecycle(
  deps: Readonly<{
    repo: ContactRequestRepository
    clock: () => Date
    idGen: () => string
  }>,
) {
  const scopeOf = (input: ContactRequestScope): ContactRequestScope => ({
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    portalId: input.portalId,
  })

  return {
    submit: async (input: SubmitContactRequestInput) => {
      if (input.consent !== true) {
        throw new ContactRequestLifecycleError('consent_required')
      }
      if (input.purpose === undefined) {
        throw new ContactRequestLifecycleError('purpose_required')
      }
      const parsedPurpose = contactRequestPurposeSchema.safeParse(input.purpose)
      if (!parsedPurpose.success) {
        throw new ContactRequestLifecycleError('invalid_purpose')
      }
      const parsedContact = contactRequestContactSchema.safeParse({
        email: input.email,
        ...(input.name === undefined ? {} : { name: input.name }),
      })
      if (!parsedContact.success) {
        throw new ContactRequestLifecycleError('invalid_contact')
      }
      const submittedAt = deps.clock()
      const result = await deps.repo.create({
        id: deps.idGen(),
        scope: scopeOf(input),
        responseId: input.responseId,
        purpose: parsedPurpose.data,
        consent: true,
        ...parsedContact.data,
        submittedAt,
        expiresAt: new Date(submittedAt.getTime() + CONTACT_REQUEST_RETENTION_MS),
      })
      if (result.outcome !== 'created') {
        throw new ContactRequestLifecycleError(result.outcome)
      }
      return { status: 'submitted' as const }
    },
    getMasked: async (
      input: ContactRequestScope & Readonly<{ contactRequestId: string }>,
    ) => {
      const request = await deps.repo.findMasked(
        scopeOf(input),
        input.contactRequestId,
        deps.clock(),
      )
      return request
        ? {
            id: request.id,
            responseId: request.responseId,
            purpose: request.purpose,
            maskedContact: request.maskedContact,
            submittedAt: request.submittedAt.toISOString(),
            expiresAt: request.expiresAt.toISOString(),
          }
        : null
    },
    reveal: async (
      input: ContactRequestScope &
        Readonly<{
          contactRequestId: string
          actorId: string
          accessPurpose?: ContactRequestAccessPurpose
        }>,
    ) => {
      if (input.accessPurpose === undefined) {
        throw new ContactRequestLifecycleError('access_purpose_required')
      }
      const result = await deps.repo.reveal({
        scope: scopeOf(input),
        contactRequestId: input.contactRequestId,
        actorId: input.actorId,
        accessPurpose: input.accessPurpose,
        at: deps.clock(),
      })
      if (result.outcome !== 'revealed') {
        throw new ContactRequestLifecycleError(result.outcome)
      }
      return {
        email: result.email,
        ...(result.name === undefined ? {} : { name: result.name }),
      }
    },
    withdraw: async (
      input: ContactRequestScope & Readonly<{ contactRequestId: string }>,
    ) => {
      const result = await deps.repo.withdraw({
        scope: scopeOf(input),
        contactRequestId: input.contactRequestId,
        at: deps.clock(),
      })
      if (result.outcome !== 'withdrawn') {
        throw new ContactRequestLifecycleError(result.outcome)
      }
      return { status: 'withdrawn' as const }
    },
    purgeExpired: async (input: Readonly<{ batchSize: number }>) => {
      if (!Number.isSafeInteger(input.batchSize) || input.batchSize < 1) {
        throw new ContactRequestLifecycleError('invalid_batch_size')
      }
      if (input.batchSize > 1_000) {
        throw new ContactRequestLifecycleError('invalid_batch_size')
      }
      const result = await deps.repo.purgeExpired({
        through: deps.clock(),
        batchSize: input.batchSize,
      })
      return {
        processed: result.processed,
        checkpoint: result.checkpoint
          ? {
              expiresAt: result.checkpoint.expiresAt.toISOString(),
              id: result.checkpoint.id,
            }
          : null,
        completedThrough: result.completedThrough?.toISOString() ?? null,
      }
    },
  }
}
