import type { AuthContext } from '#/shared/domain/auth-context'
import type { ExecutionPolicy } from '#/shared/auth/execution-policy'
import { contactRequestError } from '../domain/errors'
import type {
  ContactRequestAuthorityAction,
  ContactRequestManagerAuthority,
  ContactRequestResponseAuthority,
} from './contact-request-authority.server'
import type { ContactRequestRepository } from './contact-request.repository.server'
import {
  CONTACT_REQUEST_RETENTION_MS,
  contactRequestContactSchema,
  contactRequestPolicyInput,
  contactRequestPurposeSchema,
  type ContactRequestAccessPurpose,
  type ContactRequestGuestAuthority,
  type ContactRequestManagerAuthorityBasis,
  type ContactRequestPolicyAction,
  type ContactRequestPolicyPurpose,
  type ContactRequestPurpose,
  type ContactRequestScope,
} from './contracts'

const MAX_PURGE_BATCH = 1_000
const MAX_RETENTION_BATCHES = 100

export type SubmitContactRequestInput = ContactRequestScope &
  Readonly<{
    email: string
    name?: string
    consent?: boolean
    purpose?: ContactRequestPurpose
    authority: ContactRequestGuestAuthority
  }>

const isBatchSize = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 1 && value <= MAX_PURGE_BATCH

export function contactRequestLifecycle(
  deps: Readonly<{
    repo: ContactRequestRepository
    policy: Pick<ExecutionPolicy, 'decide'>
    managerAuthority: ContactRequestManagerAuthority
    responseAuthority: ContactRequestResponseAuthority
    /** The launch switch. Withdrawal and expiry run whether it is on or off. */
    isEnabled: () => boolean
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

  const requireEnabled = (): void => {
    if (!deps.isEnabled()) {
      throw contactRequestError('contact_disabled', 'Contact requests are not available')
    }
  }

  const requireGuestResponse = async (
    action: ContactRequestAuthorityAction,
    input: ContactRequestScope & Readonly<{ authority: ContactRequestGuestAuthority }>,
    at: Date,
  ): Promise<string> => {
    const responseId = await deps.responseAuthority.authorize({
      action,
      scope: scopeOf(input),
      authority: input.authority,
      at,
    })
    if (responseId === null) {
      throw contactRequestError(
        'not_authorized',
        'Contact Request response authority denied',
      )
    }
    return responseId
  }

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
    isEnabled: deps.isEnabled,

    submit: async (input: SubmitContactRequestInput) => {
      requireEnabled()
      const submittedAt = deps.clock()
      const responseId = await requireGuestResponse('submit', input, submittedAt)
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
        responseId,
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
      input: ContactRequestScope & Readonly<{ responseId: string }>,
      ctx: AuthContext,
    ) => {
      requireEnabled()
      const at = deps.clock()
      await requireManagerPolicy(
        scopeOf(input),
        ctx,
        ['inbox.read', 'feedback.read'],
        'view_contact_request',
        at,
      )
      const basis = await requireManagerAuthority(scopeOf(input), ctx, at)
      const request = await deps.repo.findMasked({
        scope: scopeOf(input),
        responseId: input.responseId,
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
      requireEnabled()
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
      const basis = await requireManagerAuthority(scopeOf(input), ctx, at)
      const result = await deps.repo.reveal({
        scope: scopeOf(input),
        contactRequestId: input.contactRequestId,
        authorization: { actorId: ctx.userId, basis, checkedAt: at },
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
      input: ContactRequestScope & Readonly<{ authority: ContactRequestGuestAuthority }>,
    ) => {
      const at = deps.clock()
      const responseId = await requireGuestResponse('withdraw', input, at)
      const result = await deps.repo.withdraw({
        scope: scopeOf(input),
        responseId,
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
      if (!isBatchSize(input.batchSize)) {
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

export type ContactRequestRetentionSweepResult = Readonly<{
  batches: number
  processed: number
  capped: boolean
  completedThrough: Date | null
}>

/** Bounded sweep over expired contact material; runs whether or not the launch switch is on. */
export const contactRequestRetentionSweep = (
  deps: Readonly<{
    repo: Pick<ContactRequestRepository, 'purgeExpired'>
    clock: () => Date
    maxBatches?: number
  }>,
) => {
  const maxBatches = deps.maxBatches ?? MAX_RETENTION_BATCHES
  if (!Number.isSafeInteger(maxBatches) || maxBatches < 1 || maxBatches > 100) {
    throw new Error('Contact Request retention bounds are invalid')
  }

  return async (
    input: Readonly<{ batchSize: number }>,
  ): Promise<ContactRequestRetentionSweepResult> => {
    if (!isBatchSize(input.batchSize)) {
      throw new Error('Contact Request retention bounds are invalid')
    }

    const through = deps.clock()
    let batches = 0
    let processed = 0
    let completedThrough: Date | null = null

    while (batches < maxBatches) {
      const result = await deps.repo.purgeExpired({
        through,
        batchSize: input.batchSize,
      })
      completedThrough = result.completedThrough
      if (result.processed === 0) {
        return { batches, processed, capped: false, completedThrough }
      }
      batches += 1
      processed += result.processed
    }

    return { batches, processed, capped: true, completedThrough }
  }
}
