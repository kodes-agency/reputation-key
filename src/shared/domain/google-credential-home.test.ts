import { describe, expect, it } from 'vitest'
import { DATA_CELL_CATALOGUE_POLICY_VERSION } from './data-cell-catalogue'
import {
  canReplaceGoogleCredentialHome,
  type GoogleCredentialHome,
} from './google-credential-home'

const US_HOME: GoogleCredentialHome = {
  homeCellId: 'us',
  cataloguePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
}

describe('Google credential home replacement', () => {
  it('rejects a next home whose Data Cell is not accepting work', () => {
    expect(
      canReplaceGoogleCredentialHome(
        null,
        { ...US_HOME, homeCellId: 'europe' },
        'new_grant',
      ),
    ).toBe(false)
  })

  it('rejects a next home from a stale catalogue policy', () => {
    expect(
      canReplaceGoogleCredentialHome(
        null,
        {
          ...US_HOME,
          cataloguePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION - 1,
        },
        'new_grant',
      ),
    ).toBe(false)
  })

  it.each([
    ['new_grant', true],
    ['governed_reconnect', true],
    ['credential_rotation', false],
  ] as const)('handles an initial home for reason %s', (reason, expected) => {
    expect(canReplaceGoogleCredentialHome(null, US_HOME, reason)).toBe(expected)
  })

  it('allows credential rotation when the established home is unchanged', () => {
    expect(canReplaceGoogleCredentialHome(US_HOME, US_HOME, 'credential_rotation')).toBe(
      true,
    )
  })

  it('allows a governed reconnect to replace a different established home', () => {
    expect(
      canReplaceGoogleCredentialHome(
        { ...US_HOME, homeCellId: 'global' },
        US_HOME,
        'governed_reconnect',
      ),
    ).toBe(true)
  })

  it('does not let a new grant replace a different established home', () => {
    expect(
      canReplaceGoogleCredentialHome(
        { ...US_HOME, homeCellId: 'global' },
        US_HOME,
        'new_grant',
      ),
    ).toBe(false)
  })

  it('treats a policy-version change as a governed reconnect', () => {
    expect(
      canReplaceGoogleCredentialHome(
        {
          ...US_HOME,
          cataloguePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION - 1,
        },
        US_HOME,
        'governed_reconnect',
      ),
    ).toBe(true)
  })
})
