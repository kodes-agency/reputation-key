import { describe, expect, it } from 'vitest'
import { DATA_CELL_CATALOGUE_POLICY_VERSION } from '#/shared/domain/data-cell-catalogue'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import {
  canReplaceGoogleCredentialHome,
  resolveExactGoogleCredentialRoute,
  signGoogleCredentialRoutingDirectory,
  validateGoogleCredentialRoutingDirectory,
  type GoogleCredentialRoutingDirectoryPayload,
} from './google-credential-routing'

const NOW = Date.parse('2026-08-27T12:00:00Z')
const keys = () => createVersionedHmacKeyring(`v1:${'11'.repeat(32)}`)
const payload = (): GoogleCredentialRoutingDirectoryPayload => ({
  contractVersion: 'v1',
  revision: 7,
  cataloguePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
  issuedAtMs: NOW - 1_000,
  expiresAtMs: NOW + 60_000,
  organizationHomes: [
    { organizationId: 'org-1', homeCellId: 'us', authorityGeneration: 3 },
  ],
  connectionHomes: [
    {
      organizationId: 'org-1',
      connectionId: 'connection-1',
      homeCellId: 'us',
      authorityGeneration: 3,
    },
  ],
  propertyTargets: [
    {
      organizationId: 'org-1',
      connectionId: 'connection-1',
      propertyId: 'property-1',
      targetCellId: 'us',
    },
  ],
})

describe('Google credential routing directory', () => {
  it('validates an exact signed revision and resolves without fallback', () => {
    const keyring = keys()
    const signed = signGoogleCredentialRoutingDirectory(payload(), keyring)
    const validated = validateGoogleCredentialRoutingDirectory(signed, {
      keys: keyring,
      nowMs: NOW,
      minimumRevision: 7,
    })
    expect(validated.ok).toBe(true)
    if (!validated.ok) return
    expect(
      resolveExactGoogleCredentialRoute(validated.value, {
        organizationId: 'org-1',
        connectionId: 'connection-1',
        propertyId: 'property-1',
      }),
    ).toEqual({ homeCellId: 'us', targetCellId: 'us', authorityGeneration: 3 })
    expect(
      resolveExactGoogleCredentialRoute(validated.value, {
        organizationId: 'org-1',
        connectionId: 'connection-1',
        propertyId: 'missing',
      }),
    ).toBeNull()
  })

  it.each([
    ['stale revision', { minimumRevision: 8 }, 'stale_revision'],
    [
      'stale policy',
      {
        expectedCataloguePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION + 1,
      },
      'policy_mismatch',
    ],
    ['expired revision', { nowMs: NOW + 60_001 }, 'expired'],
  ] as const)('rejects %s', (_name, override, code) => {
    const keyring = keys()
    const signed = signGoogleCredentialRoutingDirectory(payload(), keyring)
    expect(
      validateGoogleCredentialRoutingDirectory(signed, {
        keys: keyring,
        nowMs: NOW,
        minimumRevision: 7,
        ...override,
      }),
    ).toEqual({ ok: false, code })
  })

  it('rejects tampering, unsorted entries, unknown fields, and non-accepting cells', () => {
    const keyring = keys()
    const valid = signGoogleCredentialRoutingDirectory(payload(), keyring)
    expect(
      validateGoogleCredentialRoutingDirectory(
        { ...valid, revision: valid.revision + 1 },
        { keys: keyring, nowMs: NOW, minimumRevision: 1 },
      ),
    ).toEqual({ ok: false, code: 'digest_mismatch' })

    const unsorted = signGoogleCredentialRoutingDirectory(
      {
        ...payload(),
        organizationHomes: [
          { organizationId: 'org-z', homeCellId: 'us', authorityGeneration: 1 },
          { organizationId: 'org-a', homeCellId: 'us', authorityGeneration: 1 },
        ],
        connectionHomes: [],
        propertyTargets: [],
      },
      keyring,
    )
    expect(
      validateGoogleCredentialRoutingDirectory(unsorted, {
        keys: keyring,
        nowMs: NOW,
        minimumRevision: 1,
      }),
    ).toEqual({ ok: false, code: 'unsorted_or_duplicate' })

    expect(
      validateGoogleCredentialRoutingDirectory(
        { ...valid, countryCode: 'US' },
        { keys: keyring, nowMs: NOW, minimumRevision: 1 },
      ),
    ).toEqual({ ok: false, code: 'malformed' })

    const provisioning = signGoogleCredentialRoutingDirectory(
      {
        ...payload(),
        organizationHomes: [
          { organizationId: 'org-1', homeCellId: 'europe', authorityGeneration: 3 },
        ],
        connectionHomes: [
          {
            organizationId: 'org-1',
            connectionId: 'connection-1',
            homeCellId: 'europe',
            authorityGeneration: 3,
          },
        ],
      },
      keyring,
    )
    expect(
      validateGoogleCredentialRoutingDirectory(provisioning, {
        keys: keyring,
        nowMs: NOW,
        minimumRevision: 1,
      }),
    ).toEqual({ ok: false, code: 'cell_not_accepting' })
  })

  it('rejects a connection bound to a superseded Organization authority generation', () => {
    const keyring = keys()
    const staleConnection = signGoogleCredentialRoutingDirectory(
      {
        ...payload(),
        connectionHomes: [
          {
            organizationId: 'org-1',
            connectionId: 'connection-1',
            homeCellId: 'us',
            authorityGeneration: 2,
          },
        ],
      },
      keyring,
    )
    expect(
      validateGoogleCredentialRoutingDirectory(staleConnection, {
        keys: keyring,
        nowMs: NOW,
        minimumRevision: 7,
      }),
    ).toEqual({ ok: false, code: 'home_mismatch' })
  })

  it('keeps an active grant home immutable except at governed reconnect', () => {
    const current = {
      homeCellId: 'us' as const,
      cataloguePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
    }
    expect(canReplaceGoogleCredentialHome(current, current, 'credential_rotation')).toBe(
      true,
    )
    // Europe is not accepting yet, so even the governed seam cannot pretend it is live.
    expect(
      canReplaceGoogleCredentialHome(
        current,
        {
          homeCellId: 'europe',
          cataloguePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
        },
        'governed_reconnect',
      ),
    ).toBe(false)
    expect(
      canReplaceGoogleCredentialHome(
        current,
        {
          homeCellId: 'us',
          cataloguePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION - 1,
        },
        'credential_rotation',
      ),
    ).toBe(false)
  })
})
