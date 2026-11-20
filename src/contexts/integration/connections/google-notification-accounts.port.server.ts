export type GoogleNotificationAccountState = Readonly<{
  attemptedAt: number | null
  verifiedAt: number | null
  configuration: string | null
}>

/** Shared across processes and Organizations; provider I/O holds no transaction. */
export type GoogleNotificationAccounts = Readonly<{
  withAccount: <T>(accountId: string, run: () => Promise<T>) => Promise<T>
  read: (accountId: string) => Promise<GoogleNotificationAccountState | null>
  attempted: (accountId: string) => Promise<void>
  verified: (accountId: string, configuration: string) => Promise<void>
  invalidate: (accountId: string) => Promise<void>
}>
