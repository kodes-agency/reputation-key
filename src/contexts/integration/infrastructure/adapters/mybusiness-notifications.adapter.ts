import { z } from 'zod/v4'
import type { GoogleProviderRouteDescriptor } from '#/shared/google-provider-control/route-catalogue'
import type { MyBusinessNotificationsPort } from '../../application/ports/mybusiness-notifications.port'
import type { GoogleProviderCallAuthorization } from '../../application/google-provider-contract'
import type { GoogleAuthorizedProviderExecutor } from '../../application/ports/google-authorized-provider-executor.port'
import { createGbpApiError, isGbpApiError } from '../../domain/gbp-api-error'
import {
  executeGoogleProviderJson,
  executeGoogleProviderRaw,
} from './google-provider-adapter'

const settingSchema = z
  .object({
    name: z.string().min(1).max(520),
    pubsubTopic: z.string().max(1_024).optional(),
    notificationTypes: z
      .array(z.enum(['NEW_REVIEW', 'UPDATED_REVIEW']))
      .max(2)
      .optional(),
  })
  .passthrough()

type NotificationSetting = z.infer<typeof settingSchema>

function sameTypes(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  )
}

function writeOutcomeCouldBeAmbiguous(error: unknown): boolean {
  return isGbpApiError(error) && error.kind === 'upstream_error'
}

export const createMyBusinessNotificationsAdapter = (
  deps: Readonly<{
    executor: GoogleAuthorizedProviderExecutor
    nowMs?: () => number
  }>,
): MyBusinessNotificationsPort => {
  const nowMs = deps.nowMs ?? Date.now

  const readSetting = async (input: {
    accessToken: string
    authorization: GoogleProviderCallAuthorization
    gbpAccountId: string
    signal?: AbortSignal
  }): Promise<NotificationSetting> => {
    const raw = await executeGoogleProviderJson({
      operation: 'readNotificationSetting',
      descriptor: {
        routeKey: 'notifications.get',
        accessToken: input.accessToken,
        accountId: input.gbpAccountId,
      },
      authorization: input.authorization,
      executor: deps.executor,
      nowMs,
      signal: input.signal,
    })
    const parsed = settingSchema.safeParse(raw)
    if (
      !parsed.success ||
      parsed.data.name !== `accounts/${input.gbpAccountId}/notificationSetting`
    ) {
      throw createGbpApiError('readNotificationSetting', 'parse_error')
    }
    return parsed.data
  }

  const writeThenConfirm = async (input: {
    operation: 'subscribe' | 'unsubscribe'
    descriptor: GoogleProviderRouteDescriptor
    accessToken: string
    authorization: GoogleProviderCallAuthorization
    gbpAccountId: string
    desired: (setting: NotificationSetting) => boolean
    signal?: AbortSignal
  }): Promise<void> => {
    let ambiguousWrite: unknown = null
    try {
      const write = await executeGoogleProviderRaw({
        operation: input.operation,
        descriptor: input.descriptor,
        authorization: input.authorization,
        executor: deps.executor,
        nowMs,
        signal: input.signal,
      })
      write.body.fill(0)
    } catch (error) {
      if (!writeOutcomeCouldBeAmbiguous(error)) throw error
      ambiguousWrite = error
    }

    let current: NotificationSetting
    try {
      current = await readSetting(input)
    } catch (error) {
      if (ambiguousWrite) throw ambiguousWrite
      throw error
    }
    if (input.desired(current)) return
    throw createGbpApiError(input.operation, 'upstream_error')
  }

  return Object.freeze({
    subscribe: async (input) => {
      await writeThenConfirm({
        operation: 'subscribe',
        descriptor: {
          routeKey: 'notifications.subscribe',
          accessToken: input.accessToken,
          accountId: input.gbpAccountId,
          pubsubTopic: input.pubsubTopic,
          notificationTypes: input.notificationTypes,
        },
        accessToken: input.accessToken,
        authorization: input.authorization,
        gbpAccountId: input.gbpAccountId,
        desired: (setting) =>
          setting.pubsubTopic === input.pubsubTopic &&
          sameTypes(setting.notificationTypes ?? [], input.notificationTypes),
        signal: input.signal,
      })
    },
    unsubscribe: async (input) => {
      await writeThenConfirm({
        operation: 'unsubscribe',
        descriptor: {
          routeKey: 'notifications.unsubscribe',
          accessToken: input.accessToken,
          accountId: input.gbpAccountId,
        },
        accessToken: input.accessToken,
        authorization: input.authorization,
        gbpAccountId: input.gbpAccountId,
        desired: (setting) => !setting.pubsubTopic,
        signal: input.signal,
      })
    },
  })
}
