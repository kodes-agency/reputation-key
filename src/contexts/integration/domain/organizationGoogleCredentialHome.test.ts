import { describe, expect, it } from 'vitest'
import { DATA_CELL_CATALOGUE_POLICY_VERSION } from '#/shared/domain/data-cell-catalogue'
import { organizationId } from '#/shared/domain/ids'
import {
  decideOrganizationGoogleCredentialHomeTransition,
  type OrganizationGoogleCredentialHome,
} from './organizationGoogleCredentialHome'

const current = (): OrganizationGoogleCredentialHome => ({
  organizationId: organizationId('org-credential-home-1'),
  homeCellId: 'us',
  cataloguePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
  authorityGeneration: 3,
  createdAt: new Date('2026-08-27T10:00:00Z'),
  updatedAt: new Date('2026-08-27T11:00:00Z'),
})

describe('Organization Google credential home', () => {
  it('establishes one accepting home at generation one', () => {
    expect(
      decideOrganizationGoogleCredentialHomeTransition({
        current: null,
        requested: {
          homeCellId: 'us',
          cataloguePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
        },
        reason: 'new_grant',
        otherActiveGrantCount: 0,
      }),
    ).toEqual({ kind: 'establish', nextGeneration: 1 })
    expect(
      decideOrganizationGoogleCredentialHomeTransition({
        current: null,
        requested: {
          homeCellId: 'us',
          cataloguePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
        },
        reason: 'credential_rotation',
        otherActiveGrantCount: 0,
      }),
    ).toEqual({ kind: 'deny', code: 'active_grants_without_authority' })
  })

  it('does not establish from a new grant while legacy active grants lack authority', () => {
    expect(
      decideOrganizationGoogleCredentialHomeTransition({
        current: null,
        requested: {
          homeCellId: 'us',
          cataloguePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
        },
        reason: 'new_grant',
        otherActiveGrantCount: 1,
      }),
    ).toEqual({ kind: 'deny', code: 'active_grants_without_authority' })
    expect(
      decideOrganizationGoogleCredentialHomeTransition({
        current: null,
        requested: {
          homeCellId: 'us',
          cataloguePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
        },
        reason: 'governed_reconnect',
        otherActiveGrantCount: 0,
      }),
    ).toEqual({ kind: 'establish', nextGeneration: 1 })
  })

  it('preserves the exact authority without advancing its generation', () => {
    expect(
      decideOrganizationGoogleCredentialHomeTransition({
        current: current(),
        requested: {
          homeCellId: 'us',
          cataloguePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
        },
        reason: 'credential_rotation',
        otherActiveGrantCount: 4,
      }),
    ).toEqual({ kind: 'preserve', expectedGeneration: 3 })
  })

  it('allows replacement only through reconnect with no other active grant', () => {
    const requested = {
      homeCellId: 'europe' as const,
      cataloguePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
    }
    expect(
      decideOrganizationGoogleCredentialHomeTransition({
        current: current(),
        requested,
        reason: 'governed_reconnect',
        otherActiveGrantCount: 0,
        isAcceptingCell: () => true,
        expectedCataloguePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
      }),
    ).toEqual({ kind: 'replace', expectedGeneration: 3, nextGeneration: 4 })
    expect(
      decideOrganizationGoogleCredentialHomeTransition({
        current: current(),
        requested,
        reason: 'governed_reconnect',
        otherActiveGrantCount: 1,
        isAcceptingCell: () => true,
        expectedCataloguePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
      }),
    ).toEqual({ kind: 'deny', code: 'other_active_grants' })
  })

  it.each(['new_grant', 'credential_rotation'] as const)(
    'denies a home change through %s',
    (reason) => {
      expect(
        decideOrganizationGoogleCredentialHomeTransition({
          current: current(),
          requested: {
            homeCellId: 'europe',
            cataloguePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
          },
          reason,
          otherActiveGrantCount: 0,
          isAcceptingCell: () => true,
          expectedCataloguePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
        }),
      ).toEqual({ kind: 'deny', code: 'replacement_not_authorized' })
    },
  )

  it('fails closed on a stale policy, non-accepting cell, or unsafe generation', () => {
    expect(
      decideOrganizationGoogleCredentialHomeTransition({
        current: null,
        requested: {
          homeCellId: 'us',
          cataloguePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION - 1,
        },
        reason: 'new_grant',
        otherActiveGrantCount: 0,
      }),
    ).toEqual({ kind: 'deny', code: 'policy_mismatch' })
    expect(
      decideOrganizationGoogleCredentialHomeTransition({
        current: null,
        requested: {
          homeCellId: 'europe',
          cataloguePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
        },
        reason: 'new_grant',
        otherActiveGrantCount: 0,
      }),
    ).toEqual({ kind: 'deny', code: 'cell_not_accepting' })
    expect(
      decideOrganizationGoogleCredentialHomeTransition({
        current: { ...current(), authorityGeneration: Number.MAX_SAFE_INTEGER },
        requested: {
          homeCellId: 'europe',
          cataloguePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
        },
        reason: 'governed_reconnect',
        otherActiveGrantCount: 0,
        isAcceptingCell: () => true,
        expectedCataloguePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
      }),
    ).toEqual({ kind: 'deny', code: 'generation_exhausted' })
    expect(
      decideOrganizationGoogleCredentialHomeTransition({
        current: current(),
        requested: {
          homeCellId: 'us',
          cataloguePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
        },
        reason: 'credential_rotation',
        otherActiveGrantCount: -1,
      }),
    ).toEqual({ kind: 'deny', code: 'invalid_active_grant_count' })
  })
})
