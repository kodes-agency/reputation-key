import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { catchUntagged } from '#/shared/auth/server-errors'
import { getContainer } from '#/composition'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import {
  activateRecognitionSchema,
  deactivateRecognitionSchema,
  getRecognitionBoardSchema,
  getRecognitionSettingsSchema,
} from '../application/dto/leaderboard.dto'

export const getRecognitionBoard = createServerFn({ method: 'GET' })
  .validator(getRecognitionBoardSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        try {
          const ctx = await resolveTenantContext(await headersFromContext())
          await requireExecutionAllowed({
            actor: ctx,
            action: 'leaderboard.read',
            propertyId: data.propertyId,
          })
          return getContainer().leaderboardPublicApi.recognition.getBoard(
            {
              organizationId: ctx.organizationId,
              userId: ctx.userId,
              role: ctx.role,
            },
            data,
          )
        } catch (error) {
          throw catchUntagged(error)
        }
      },
      'GET',
      'recognition.getBoard',
    ),
  )

export const getRecognitionSettings = createServerFn({ method: 'GET' })
  .validator(getRecognitionSettingsSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        try {
          const ctx = await resolveTenantContext(await headersFromContext())
          await requireExecutionAllowed({
            actor: ctx,
            action: 'badge.manage',
            propertyId: data.propertyId,
          })
          await requireExecutionAllowed({
            actor: ctx,
            action: 'leaderboard.read',
            propertyId: data.propertyId,
          })
          return getContainer().leaderboardPublicApi.recognition.getSettings(
            {
              organizationId: ctx.organizationId,
              userId: ctx.userId,
              role: ctx.role,
            },
            data.propertyId,
          )
        } catch (error) {
          throw catchUntagged(error)
        }
      },
      'GET',
      'recognition.getSettings',
    ),
  )

export const activateRecognition = createServerFn({ method: 'POST' })
  .validator(activateRecognitionSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        try {
          const ctx = await resolveTenantContext(await headersFromContext())
          await requireExecutionAllowed({
            actor: ctx,
            action: 'badge.manage',
            propertyId: data.propertyId,
          })
          await requireExecutionAllowed({
            actor: ctx,
            action: 'leaderboard.read',
            propertyId: data.propertyId,
          })
          return getContainer().leaderboardPublicApi.recognition.activate(
            {
              organizationId: ctx.organizationId,
              userId: ctx.userId,
              role: ctx.role,
            },
            data,
            getContainer().clock(),
          )
        } catch (error) {
          throw catchUntagged(error)
        }
      },
      'POST',
      'recognition.activate',
    ),
  )

export const deactivateRecognition = createServerFn({ method: 'POST' })
  .validator(deactivateRecognitionSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        try {
          const ctx = await resolveTenantContext(await headersFromContext())
          await requireExecutionAllowed({
            actor: ctx,
            action: 'badge.manage',
            propertyId: data.propertyId,
          })
          await requireExecutionAllowed({
            actor: ctx,
            action: 'leaderboard.read',
            propertyId: data.propertyId,
          })
          return getContainer().leaderboardPublicApi.recognition.deactivate(
            {
              organizationId: ctx.organizationId,
              userId: ctx.userId,
              role: ctx.role,
            },
            data,
            getContainer().clock(),
          )
        } catch (error) {
          throw catchUntagged(error)
        }
      },
      'POST',
      'recognition.deactivate',
    ),
  )
