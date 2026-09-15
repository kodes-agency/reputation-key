import { createServerFn } from '@tanstack/react-start'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import {
  MerchantAiAuthorizationError,
  MerchantAiAuthorizationStoreError,
} from '../application/use-cases/merchant-ai-authorization'
import { MERCHANT_AI_NOTICE } from '../application/dto/merchant-ai-notice.dto'
import { isMerchantAiDecisionError } from '../domain/merchant-ai-decision-errors'
import {
  merchantAiAuthorizationInputSchema,
  merchantAiCapabilityChangeInputSchema,
  merchantAiCommandInputSchema,
  merchantAiConsentCommandInputSchema,
  merchantAiEnableForPropertiesInputSchema,
  merchantAiPropertyInputSchema,
} from '../application/dto/merchant-ai-command.dto'

function merchantAiErrorStatus(code: MerchantAiAuthorizationError['code']): number {
  if (code === 'capability_denied') return 403
  // A stale notice is a conflict with the served state: reload, then retry.
  if (code === 'notice_mismatch') return 409
  return 400
}

/** Logged, never sent: which Property of a ceremony refused. */
function refusalContext(propertyId: string | undefined) {
  return propertyId === undefined ? {} : { context: { propertyId } }
}

function mapMerchantAiError(error: unknown): never {
  if (isMerchantAiDecisionError(error)) {
    throwContextError(
      'MerchantAiDecisionError',
      error,
      error.code === 'already_enabled' ? 409 : 404,
    )
  }
  if (error instanceof MerchantAiAuthorizationError) {
    const status = merchantAiErrorStatus(error.code)
    throwContextError(
      'MerchantAiAuthorizationError',
      { code: error.code, message: error.message, ...refusalContext(error.propertyId) },
      status,
    )
  }
  if (error instanceof MerchantAiAuthorizationStoreError) {
    const status =
      error.code === 'version_conflict' || error.code === 'idempotency_conflict'
        ? 409
        : error.code === 'membership_denied' || error.code === 'assignment_denied'
          ? 403
          : 400
    throwContextError(
      'MerchantAiAuthorizationError',
      { code: error.code, message: error.message, ...refusalContext(error.propertyId) },
      status,
    )
  }
  throw catchUntagged(error)
}

async function managementContext(propertyId: string | undefined) {
  const headers = await headersFromContext()
  const actor = await resolveTenantContext(headers)
  await requireExecutionAllowed({
    actor,
    action: 'ai.manage',
    ...(propertyId ? { propertyId } : {}),
  })
  return { headers, actor }
}

export const getMerchantAiAuthorizationFn = createServerFn({ method: 'GET' })
  .validator(merchantAiAuthorizationInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const { actor } = await managementContext(data.propertyId)
        if (!data.propertyId) {
          return { authorization: null, notice: MERCHANT_AI_NOTICE }
        }
        try {
          const authorization =
            await getContainer().identityPublicApi.requests.merchantAiAuthorization.get({
              organizationId: actor.organizationId as string,
              propertyId: data.propertyId,
              actorUserId: actor.userId as string,
            })
          return { authorization, notice: MERCHANT_AI_NOTICE }
        } catch (error) {
          mapMerchantAiError(error)
        }
      },
      'GET',
      'identity.getMerchantAiAuthorization',
    ),
  )

export const enableMerchantAiFn = createServerFn({ method: 'POST' })
  .validator(merchantAiConsentCommandInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const { headers, actor } = await managementContext(data.propertyId)
        try {
          return await getContainer().identityPublicApi.requests.merchantAiAuthorization.enable(
            {
              organizationId: actor.organizationId as string,
              propertyId: data.propertyId,
              actorUserId: actor.userId as string,
              idempotencyKey: data.idempotencyKey,
              expectedStateVersion: data.expectedStateVersion,
              acknowledgement: data.acknowledgement,
              requestHeaders: headers,
              reasonCode: 'merchant_enabled',
            },
          )
        } catch (error) {
          mapMerchantAiError(error)
        }
      },
      'POST',
      'identity.enableMerchantAi',
    ),
  )

/**
 * One consent ceremony for several Properties at once, such as an import
 * batch. Every Property passes the same execution gate as a single enable; the
 * use case requires an AccountAdmin and commits all Properties or none.
 */
export const enableMerchantAiForPropertiesFn = createServerFn({ method: 'POST' })
  .validator(merchantAiEnableForPropertiesInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const { headers, actor } = await managementContext(undefined)
        for (const propertyId of data.propertyIds) {
          await requireExecutionAllowed({ actor, action: 'ai.manage', propertyId })
        }
        try {
          return await getContainer().identityPublicApi.requests.merchantAiAuthorization.enableForProperties(
            {
              organizationId: actor.organizationId as string,
              actorUserId: actor.userId as string,
              propertyIds: data.propertyIds,
              capabilities: data.capabilities,
              acknowledgement: data.acknowledgement,
              idempotencyKey: data.idempotencyKey,
              requestHeaders: headers,
              reasonCode: 'merchant_enabled',
            },
          )
        } catch (error) {
          mapMerchantAiError(error)
        }
      },
      'POST',
      'identity.enableMerchantAiForProperties',
    ),
  )

export const changeMerchantAiCapabilitiesFn = createServerFn({ method: 'POST' })
  .validator(merchantAiCapabilityChangeInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const { headers, actor } = await managementContext(data.propertyId)
        try {
          return await getContainer().identityPublicApi.requests.merchantAiAuthorization.change(
            {
              organizationId: actor.organizationId as string,
              propertyId: data.propertyId,
              actorUserId: actor.userId as string,
              idempotencyKey: data.idempotencyKey,
              expectedStateVersion: data.expectedStateVersion,
              acknowledgement: data.acknowledgement,
              requestHeaders: headers,
              reasonCode: 'capabilities_changed',
              capabilities: data.capabilities,
            },
          )
        } catch (error) {
          mapMerchantAiError(error)
        }
      },
      'POST',
      'identity.changeMerchantAiCapabilities',
    ),
  )

export const revokeMerchantAiFn = createServerFn({ method: 'POST' })
  .validator(merchantAiCommandInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const { headers, actor } = await managementContext(data.propertyId)
        try {
          return await getContainer().identityPublicApi.requests.merchantAiAuthorization.revoke(
            {
              organizationId: actor.organizationId as string,
              propertyId: data.propertyId,
              actorUserId: actor.userId as string,
              idempotencyKey: data.idempotencyKey,
              expectedStateVersion: data.expectedStateVersion,
              requestHeaders: headers,
              reasonCode: 'merchant_revoked',
            },
          )
        } catch (error) {
          mapMerchantAiError(error)
        }
      },
      'POST',
      'identity.revokeMerchantAi',
    ),
  )

/**
 * Record "not now" for a Property's AI decision. It carries no consent and no
 * step-up proof: nothing is authorized, so there is nothing to re-verify.
 */
export const deferMerchantAiDecisionFn = createServerFn({ method: 'POST' })
  .validator(merchantAiPropertyInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const { actor } = await managementContext(data.propertyId)
        try {
          return await getContainer().identityPublicApi.requests.merchantAiAuthorization.defer(
            {
              organizationId: actor.organizationId as string,
              propertyId: data.propertyId,
              actorUserId: actor.userId as string,
            },
          )
        } catch (error) {
          mapMerchantAiError(error)
        }
      },
      'POST',
      'identity.deferMerchantAiDecision',
    ),
  )

/**
 * Read-only Organization AI overview: every Property the actor may manage AI
 * for, with its authorization state, re-consent flag and standing deferral.
 */
export const listMerchantAiOverviewFn = createServerFn({ method: 'GET' }).handler(
  tracedHandler(
    async () => {
      const { actor } = await managementContext(undefined)
      try {
        return await getContainer().identityPublicApi.requests.merchantAiAuthorization.listOverview(
          {
            organizationId: actor.organizationId as string,
            actorUserId: actor.userId as string,
          },
        )
      } catch (error) {
        mapMerchantAiError(error)
      }
    },
    'GET',
    'identity.listMerchantAiOverview',
  ),
)
