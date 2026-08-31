import {
  contactRequestContactSchema,
  contactRequestPurposeSchema,
} from '../dto/contact-request.dto'
import type { ContactRequestRepository } from '../ports/contact-request.repository'
import type { AuthContext } from '#/shared/domain/auth-context'
import { contactRequestError } from '../../domain/errors'
import {
  contactRequestPolicyInput,
  type ContactRequestExecutionPolicyPort,
  type ContactRequestPolicyAction,
  type ContactRequestPolicyPurpose,
} from '../ports/contact-request-execution-policy.port'
import type { ContactRequestResponseAuthorityPort } from '../ports/contact-request-response-authority.port'
import type { ContactRequestGuestAuthority } from '../ports/contact-request-response-authority.port'
import type {
  ContactRequestManagerAuthorityBasis,
  ContactRequestManagerAuthorityPort,
} from '../ports/contact-request-manager-authority.port'
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
    authority: ContactRequestGuestAuthority
  }>

export function contactRequestLifecycle(
  deps: Readonly<{
    repo: ContactRequestRepository
    policy: ContactRequestExecutionPolicyPort
    managerAuthority: ContactRequestManagerAuthorityPort
    responseAuthority: ContactRequestResponseAuthorityPort
    clock: () => Date
    idGen: () => string
    revealAuditIdGen: () => string
  }>,
) {
  const scopeOf = (input: ContactRequestScope): ContactRequestScope => ({
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    portalId: input.portalId,
  })

  const requireManagerPolicy = async (
    scope: ContactRequestScope,
    ctx: AuthContext,
    actions: ReadonlyArray<ContactRequestPolicyAction>,
    purpose: ContactRequestPolicyPurpose,
    at: Date,
  ): Promise<void> => {
    const decisions = await Promise.all(
      actions.map((action) =>
        deps.policy.decide(contactRequestPolicyInput(ctx, scope, action, purpose, at)),
      ),
    )
    if (decisions.some((decision) => !decision.allowed)) {
      throw contactRequestError(
        'not_authorized',
        'Contact Request access is not authorized',
      )
    }
  }

  const requireManagerAuthority = async (
    scope: ContactRequestScope,
    ctx: AuthContext,
    at: Date,
  ): Promise<ContactRequestManagerAuthorityBasis> => {
    const basis = await deps.managerAuthority.resolve({
      scope,
      actorId: ctx.userId,
      at,
    })
    if (!basis) {
      throw contactRequestError(
        'not_authorized',
        'Contact Request manager authority is not current',
      )
    }
    return basis
  }

  return {
    submit: async (input: SubmitContactRequestInput) => {
      const submittedAt = deps.clock()
      const authorized = await deps.responseAuthority.authorize({
        action: 'submit',
        scope: scopeOf(input),
        responseId: input.responseId,
        authority: input.authority,
        at: submittedAt,
      })
      if (!authorized) {
        throw contactRequestError(
          'not_authorized',
          'Contact Request response authority denied',
        )
      }
      if (input.consent !== true) {
        throw contactRequestError(
          'consent_required',
          'Contact Request consent is required',
        )
      }
      if (input.purpose === undefined) {
        throw contactRequestError(
          'purpose_required',
          'Contact Request purpose is required',
        )
      }
      const parsedPurpose = contactRequestPurposeSchema.safeParse(input.purpose)
      if (!parsedPurpose.success) {
        throw contactRequestError('invalid_purpose', 'Contact Request purpose is invalid')
      }
      const parsedContact = contactRequestContactSchema.safeParse({
        email: input.email,
        ...(input.name === undefined ? {} : { name: input.name }),
      })
      if (!parsedContact.success) {
        throw contactRequestError('invalid_contact', 'Contact Request contact is invalid')
      }
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
        throw contactRequestError(
          result.outcome,
          'Contact Request could not be submitted',
        )
      }
      return { status: 'submitted' as const }
    },
    getMasked: async (
      input: ContactRequestScope & Readonly<{ contactRequestId: string }>,
      ctx: AuthContext,
    ) => {
      const at = deps.clock()
      await requireManagerPolicy(
        scopeOf(input),
        ctx,
        ['inbox.read', 'feedback.read'],
        'view_contact_request',
        at,
      )
      // Resolve owning-context relationships immediately before the Guest
      // operation. See the port's documented cross-transaction race posture.
      const basis = await requireManagerAuthority(scopeOf(input), ctx, at)
      const request = await deps.repo.findMasked({
        scope: scopeOf(input),
        contactRequestId: input.contactRequestId,
        authorization: { actorId: ctx.userId, basis, checkedAt: at },
        asOf: at,
      })
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
          accessPurpose?: ContactRequestAccessPurpose
        }>,
      ctx: AuthContext,
    ) => {
      if (input.accessPurpose === undefined) {
        throw contactRequestError(
          'access_purpose_required',
          'Contact Request access purpose is required',
        )
      }
      const at = deps.clock()
      await requireManagerPolicy(
        scopeOf(input),
        ctx,
        ['inbox.read', 'feedback.read', 'feedback.contact_read'],
        input.accessPurpose,
        at,
      )
      const authorityBasis = await requireManagerAuthority(scopeOf(input), ctx, at)
      const result = await deps.repo.reveal({
        scope: scopeOf(input),
        contactRequestId: input.contactRequestId,
        authorization: {
          actorId: ctx.userId,
          basis: authorityBasis,
          checkedAt: at,
        },
        auditId: deps.revealAuditIdGen(),
        accessPurpose: input.accessPurpose,
        at,
      })
      if (result.outcome !== 'revealed') {
        throw contactRequestError(result.outcome, 'Contact Request could not be revealed')
      }
      return {
        email: result.email,
        ...(result.name === undefined ? {} : { name: result.name }),
      }
    },
    withdraw: async (
      input: ContactRequestScope &
        Readonly<{
          contactRequestId: string
          responseId: string
          authority: ContactRequestGuestAuthority
        }>,
    ) => {
      const at = deps.clock()
      const authorized = await deps.responseAuthority.authorize({
        action: 'withdraw',
        scope: scopeOf(input),
        responseId: input.responseId,
        authority: input.authority,
        at,
      })
      if (!authorized) {
        throw contactRequestError(
          'not_authorized',
          'Contact Request response authority denied',
        )
      }
      const result = await deps.repo.withdraw({
        scope: scopeOf(input),
        contactRequestId: input.contactRequestId,
        responseId: input.responseId,
        at,
      })
      if (result.outcome !== 'withdrawn') {
        throw contactRequestError(
          result.outcome,
          'Contact Request could not be withdrawn',
        )
      }
      return { status: 'withdrawn' as const }
    },
    purgeExpired: async (input: Readonly<{ batchSize: number }>) => {
      if (!Number.isSafeInteger(input.batchSize) || input.batchSize < 1) {
        throw contactRequestError(
          'invalid_batch_size',
          'Contact Request purge batch is invalid',
        )
      }
      if (input.batchSize > 1_000) {
        throw contactRequestError(
          'invalid_batch_size',
          'Contact Request purge batch is invalid',
        )
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
