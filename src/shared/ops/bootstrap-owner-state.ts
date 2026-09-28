// Whether ops:bootstrap-owner may run, and from where.
//
// The command creates the owner through Better Auth's sign-up, which commits
// the user and credential account on its own connection (and sends the
// verification email). Everything after it — email verification, the
// password, the Organization and the owner membership — commits in one
// transaction. So a failed run leaves exactly one state behind: a single user
// with the owner's email and no Organization or membership. Only that state is
// resumed. Every other non-empty database is refused, so the command can
// never become a back door into a populated cell.

export type BootstrapSnapshot = Readonly<{
  users: number
  organizations: number
  members: number
  /** The only user, read when `users` is exactly 1. */
  soleUser: Readonly<{ id: string; email: string }> | null
}>

export type BootstrapState =
  | Readonly<{ kind: 'fresh' }>
  | Readonly<{ kind: 'resume'; userId: string }>
  | Readonly<{ kind: 'refuse'; reason: string }>

export function bootstrapState(
  snapshot: BootstrapSnapshot,
  email: string,
): BootstrapState {
  const { users, organizations, members, soleUser } = snapshot
  const noOrganization = organizations === 0 && members === 0
  if (noOrganization && users === 0) return { kind: 'fresh' }
  if (
    noOrganization &&
    users === 1 &&
    soleUser !== null &&
    soleUser.email.toLowerCase() === email.toLowerCase()
  ) {
    return { kind: 'resume', userId: soleUser.id }
  }
  return {
    kind: 'refuse',
    reason:
      'runs only on an empty database, or to finish its own interrupted run for the ' +
      `same owner email (users=${users}, organizations=${organizations}, members=${members}); ` +
      'invite further accounts from the app',
  }
}
