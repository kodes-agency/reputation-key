// Notification context — domain errors

export type NotificationErrorCode =
  | 'invalid_type'
  | 'invalid_resource_type'
  | 'invalid_title'
  | 'invalid_resource_id'
  | 'invalid_event_id'
  | 'invalid_status'
  | 'insert_failed'

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
