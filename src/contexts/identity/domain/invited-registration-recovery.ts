export type InvitedRegistrationRecoveryInput = Readonly<{
  expected: Readonly<{
    attemptId: string
    invitationId: string
    organizationId: string
    userId: string
    credentialAccountId: string
    initialSessionId: string
  }>
  now: Date
  user: Readonly<{ id: string; email: string }> | null
  invitation: Readonly<{
    id: string
    organizationId: string
    email: string
    status: string
    expiresAt: Date
  }> | null
  accounts: ReadonlyArray<
    Readonly<{
      id: string
      userId: string
      providerId: string
      accountId: string
    }>
  >
  sessions: ReadonlyArray<Readonly<{ id: string; userId: string }>>
  memberships: ReadonlyArray<Readonly<{ organizationId: string }>>
  binding: Readonly<{ organizationId: string | null; state: string }> | null
}>

export type InvitedRegistrationRecoveryDecision =
  | Readonly<{ kind: 'awaiting_provider' }>
  | Readonly<{ kind: 'ready_to_accept' }>
  | Readonly<{ kind: 'already_accepted' }>
  | Readonly<{
      kind: 'safe_to_compensate'
      reason: 'partial_provider_commit' | 'invitation_unavailable'
    }>
  | Readonly<{
      kind: 'manual_review'
      reason: 'unexpected_authority'
    }>

export function classifyInvitedRegistrationRecovery(
  input: InvitedRegistrationRecoveryInput,
): InvitedRegistrationRecoveryDecision {
  const invitationMatchesAttempt =
    input.invitation?.id === input.expected.invitationId &&
    input.invitation.organizationId === input.expected.organizationId
  const invitationIsCurrent =
    invitationMatchesAttempt &&
    input.invitation.status === 'pending' &&
    input.invitation.expiresAt > input.now
  const userIsExpected =
    input.user?.id === input.expected.userId &&
    input.invitation !== null &&
    input.user.email.toLowerCase() === input.invitation.email.toLowerCase()
  const credentialAccountIsExpected =
    input.accounts.length === 1 &&
    input.accounts[0]?.id === input.expected.credentialAccountId &&
    input.accounts[0].userId === input.expected.userId &&
    input.accounts[0].providerId === 'credential' &&
    input.accounts[0].accountId === input.expected.userId
  const sessionsAreExpected =
    input.sessions.length === 0 ||
    (input.sessions.length === 1 &&
      input.sessions[0]?.id === input.expected.initialSessionId &&
      input.sessions[0].userId === input.expected.userId)
  const providerArtifactsAreFenced =
    (input.accounts.length === 0 || credentialAccountIsExpected) && sessionsAreExpected
  const hasNoObservedAuthority =
    input.accounts.length === 0 &&
    input.sessions.length === 0 &&
    input.memberships.length === 0 &&
    !input.binding

  if (!input.user && hasNoObservedAuthority && invitationIsCurrent) {
    return { kind: 'awaiting_provider' }
  }

  if (
    !input.user &&
    hasNoObservedAuthority &&
    (input.invitation === null || (invitationMatchesAttempt && !invitationIsCurrent))
  ) {
    return { kind: 'safe_to_compensate', reason: 'invitation_unavailable' }
  }

  if (
    invitationMatchesAttempt &&
    input.invitation?.status === 'accepted' &&
    userIsExpected &&
    credentialAccountIsExpected &&
    sessionsAreExpected &&
    input.memberships.length === 1 &&
    input.memberships[0]?.organizationId === input.expected.organizationId &&
    input.binding?.state === 'active' &&
    input.binding.organizationId === input.expected.organizationId
  ) {
    return { kind: 'already_accepted' }
  }

  if (
    invitationIsCurrent &&
    userIsExpected &&
    credentialAccountIsExpected &&
    sessionsAreExpected &&
    input.memberships.length === 0 &&
    !input.binding
  ) {
    return { kind: 'ready_to_accept' }
  }

  if (
    invitationIsCurrent &&
    userIsExpected &&
    input.accounts.length === 0 &&
    input.sessions.length === 0 &&
    input.memberships.length === 0 &&
    !input.binding
  ) {
    return { kind: 'safe_to_compensate', reason: 'partial_provider_commit' }
  }

  if (
    invitationMatchesAttempt &&
    !invitationIsCurrent &&
    userIsExpected &&
    providerArtifactsAreFenced &&
    input.memberships.length === 0 &&
    !input.binding
  ) {
    return { kind: 'safe_to_compensate', reason: 'invitation_unavailable' }
  }

  return { kind: 'manual_review', reason: 'unexpected_authority' }
}
