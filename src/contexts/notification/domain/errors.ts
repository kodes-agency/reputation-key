// Notification context — domain errors

export type NotificationErrorCode =
  | 'invalid_input'
  | 'invalid_type'
  | 'invalid_resource_type'
  | 'invalid_title'
  | 'invalid_resource_id'
  | 'invalid_event_id'
  | 'invalid_status'
  | 'insert_failed'
  | 'not_found'

export type NotificationError = Readonly<{
  _tag: 'NotificationError'
  code: NotificationErrorCode
  message: string
  details?: Record<string, unknown>
}>

export const notificationError = (
  code: NotificationErrorCode,
  message: string,
  details?: Record<string, unknown>,
): NotificationError => ({
  _tag: 'NotificationError',
  code,
  message,
  ...(details ? { details } : {}),
})

export const isNotificationError = (e: unknown): e is NotificationError =>
  typeof e === 'object' &&
  e !== null &&
  '_tag' in e &&
  (e as { _tag: string })._tag === 'NotificationError'
