import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
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

const propertyInputSchema = z.object({ propertyId: z.uuid() })
const commandSchema = propertyInputSchema.extend({
  idempotencyKey: z.string().min(8).max(128),
  expectedStateVersion: z.number().int().safe().nonnegative(),
  password: z.string().min(1).max(256),
})
const capabilitySchema = z.enum(['review_analysis', 'reply_drafting', 'property_trends'])

function mapMerchantAiError(error: unknown): never {
  if (error instanceof MerchantAiAuthorizationError) {
    const status = error.code === 'capability_denied' ? 403 : 400
    throwContextError(
      'MerchantAiAuthorizationError',
      { code: error.code, message: error.message },
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
      { code: error.code, message: error.message },
      status,
    )
  }
  throw catchUntagged(error)
}

async function managementContext(propertyId: string) {
  const headers = await headersFromContext()
  const actor = await resolveTenantContext(headers)
  await requireExecutionAllowed({ actor, action: 'ai.manage', propertyId })
  return { headers, actor }
}

export const getMerchantAiAuthorizationFn = createServerFn({ method: 'GET' })
  .validator(propertyInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const { actor } = await managementContext(data.propertyId)
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
  .validator(commandSchema)
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
              stepUpProof: data.password,
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

export const changeMerchantAiCapabilitiesFn = createServerFn({ method: 'POST' })
  .validator(
    commandSchema.extend({
      capabilities: z.array(capabilitySchema).min(1).max(3),
    }),
  )
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
              stepUpProof: data.password,
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
  .validator(commandSchema)
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
              stepUpProof: data.password,
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
