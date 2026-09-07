export type InvitedRegistrationRecoveryInput = Readonly<{
  expected: Readonly<{
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

type InvitationObservation = Readonly<{
  matchesAttempt: boolean
  isCurrent: boolean
  isAccepted: boolean
}>

type ProviderObservation = Readonly<{
  userIsExpected: boolean
  credentialAccountIsExpected: boolean
  sessionsAreExpected: boolean
  artifactsAreFenced: boolean
  artifactsAreAbsent: boolean
}>

type AuthorityObservation = Readonly<{
  isAbsent: boolean
  matchesAttempt: boolean
}>

function observeInvitation(
  input: InvitedRegistrationRecoveryInput,
): InvitationObservation {
  const matchesAttempt =
    input.invitation?.id === input.expected.invitationId &&
    input.invitation.organizationId === input.expected.organizationId
  return {
    matchesAttempt,
    isCurrent:
      matchesAttempt &&
      input.invitation.status === 'pending' &&
      input.invitation.expiresAt > input.now,
    isAccepted: matchesAttempt && input.invitation?.status === 'accepted',
  }
}

function observeProviderArtifacts(
  input: InvitedRegistrationRecoveryInput,
): ProviderObservation {
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
  return {
    userIsExpected:
      input.user?.id === input.expected.userId &&
      input.invitation !== null &&
      input.user.email.toLowerCase() === input.invitation.email.toLowerCase(),
    credentialAccountIsExpected,
    sessionsAreExpected,
    artifactsAreFenced:
      (input.accounts.length === 0 || credentialAccountIsExpected) && sessionsAreExpected,
    artifactsAreAbsent: input.accounts.length === 0 && input.sessions.length === 0,
  }
}

function observeAuthority(input: InvitedRegistrationRecoveryInput): AuthorityObservation {
  return {
    isAbsent: input.memberships.length === 0,
    matchesAttempt:
      input.memberships.length === 1 &&
      input.memberships[0]?.organizationId === input.expected.organizationId,
  }
}

/**
 * Attempts that left no provider user and no authority behind. Returns null when the
 * attempt does not fit that shape so the caller can keep classifying.
 */
function classifyAttemptWithoutArtifacts(
  input: InvitedRegistrationRecoveryInput,
  invitation: InvitationObservation,
  provider: ProviderObservation,
  authority: AuthorityObservation,
): InvitedRegistrationRecoveryDecision | null {
  if (input.user || !provider.artifactsAreAbsent || !authority.isAbsent) {
    return null
  }
  if (invitation.isCurrent) {
    return { kind: 'awaiting_provider' }
  }
  if (input.invitation === null || invitation.matchesAttempt) {
    return { kind: 'safe_to_compensate', reason: 'invitation_unavailable' }
  }
  return null
}

/**
 * Attempts whose provider user matches the verification record. Returns null
 * when the observed records do not match a settled shape so the caller can
 * fall back to manual review.
 */
function classifyAttemptWithExpectedUser(
  invitation: InvitationObservation,
  provider: ProviderObservation,
  authority: AuthorityObservation,
): InvitedRegistrationRecoveryDecision | null {
  if (!provider.userIsExpected) {
    return null
  }

  if (
    invitation.isAccepted &&
    provider.credentialAccountIsExpected &&
    provider.sessionsAreExpected &&
    authority.matchesAttempt
  ) {
    return { kind: 'already_accepted' }
  }

  if (!authority.isAbsent) {
    return null
  }

  if (
    invitation.isCurrent &&
    provider.credentialAccountIsExpected &&
    provider.sessionsAreExpected
  ) {
    return { kind: 'ready_to_accept' }
  }

  if (invitation.isCurrent && provider.artifactsAreAbsent) {
    return { kind: 'safe_to_compensate', reason: 'partial_provider_commit' }
  }

  if (invitation.matchesAttempt && !invitation.isCurrent && provider.artifactsAreFenced) {
    return { kind: 'safe_to_compensate', reason: 'invitation_unavailable' }
  }

  return null
}

export function classifyInvitedRegistrationRecovery(
  input: InvitedRegistrationRecoveryInput,
): InvitedRegistrationRecoveryDecision {
  const invitation = observeInvitation(input)
  const provider = observeProviderArtifacts(input)
  const authority = observeAuthority(input)

  return (
    classifyAttemptWithoutArtifacts(input, invitation, provider, authority) ??
    classifyAttemptWithExpectedUser(invitation, provider, authority) ?? {
      kind: 'manual_review',
      reason: 'unexpected_authority',
    }
  )
}
