// Notification context — port for sending transactional emails.
// Per architecture: type alias + Readonly<{…}>, no classes.

export type EmailSenderPort = Readonly<{
  send(params: Readonly<{ to: string; subject: string; html: string }>): Promise<void>
}>
