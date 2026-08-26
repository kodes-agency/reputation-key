// Notification context — domain errors

import { createErrorFactory } from '#/shared/domain/errors'

export type NotificationErrorCode =
  | 'invalid_input'
  | 'invalid_type'
  | 'invalid_resource_type'
  | 'invalid_resource_id'
  | 'invalid_event_id'
  | 'invalid_status'
  | 'insert_failed'
  | 'email_send_failed'
  | 'not_found'

export type NotificationError = Readonly<{
  _tag: 'NotificationError'
  code: NotificationErrorCode
  message: string
  context?: Readonly<Record<string, unknown>>
}>

export const notificationError = createErrorFactory<
  NotificationError['_tag'],
  NotificationError['code']
>('NotificationError')

export const isNotificationError = (e: unknown): e is NotificationError =>
  typeof e === 'object' &&
  e !== null &&
  '_tag' in e &&
  (e as { _tag: string })._tag === 'NotificationError'
