// Notification context — domain errors

export type NotificationError = Readonly<{
  _tag: 'NotificationError'
  code: string
  message: string
  details?: Record<string, unknown>
}>

export const notificationError = (
  code: string,
  message: string,
  details?: Record<string, unknown>,
): NotificationError => ({
  _tag: 'NotificationError',
  code,
  message,
  ...(details ? { details } : {}),
})
