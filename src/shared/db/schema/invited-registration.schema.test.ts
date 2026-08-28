import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { invitedRegistrationAttempts } from './invited-registration.schema'

describe('invited registration recovery schema', () => {
  it('stores only identifiers, lifecycle evidence, and recovery controls', () => {
    const columns = Object.keys(invitedRegistrationAttempts)

    expect(columns).toEqual(
      expect.arrayContaining([
        'invitationId',
        'organizationId',
        'expectedUserId',
        'expectedCredentialAccountId',
        'expectedInitialSessionId',
        'state',
        'nextRecoveryAt',
      ]),
    )
    expect(columns).not.toEqual(
      expect.arrayContaining(['password', 'email', 'name', 'token', 'session']),
    )
  })

  it('enforces one unresolved attempt and exact terminal-state shapes', () => {
    const config = getTableConfig(invitedRegistrationAttempts)
    const indexNames = config.indexes.map((candidate) => candidate.config.name)
    const checkNames = config.checks.map((candidate) => candidate.name)

    expect(indexNames).toEqual(
      expect.arrayContaining([
        'invited_registration_expected_user_unique',
        'invited_registration_expected_account_unique',
        'invited_registration_expected_session_unique',
        'invited_registration_invitation_ordinal_unique',
        'invited_registration_one_unresolved_per_invitation',
        'invited_registration_recovery_due_idx',
      ]),
    )
    expect(checkNames).toEqual(
      expect.arrayContaining([
        'invited_registration_state_valid',
        'invited_registration_lease_pair',
        'invited_registration_terminal_shape',
      ]),
    )
  })
})
