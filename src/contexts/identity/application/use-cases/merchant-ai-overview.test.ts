import { describe, expect, it, vi } from 'vitest'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import {
  listMerchantAiOverview,
  type MerchantAiManagementScope,
  type MerchantAiOverviewDeps,
  type MerchantAiOverviewRecord,
} from './merchant-ai-overview'

const NOW = new Date('2026-09-15T12:00:00.000Z')
const PREVIOUS_NOTICE_VERSION = 'merchant-ai-notice-2026-09-08.v1'
const PREVIOUS_NOTICE_DIGEST =
  'c24030bc98918d3fa6a8e820bf6bca6489a4c8835cf61bd12ab6b84a8f0a0865'
const input = { organizationId: 'org-overview', actorUserId: 'admin-1' } as const

function record(
  propertyId: string,
  overrides: Partial<MerchantAiOverviewRecord> = {},
): MerchantAiOverviewRecord {
  return {
    propertyId,
    propertyName: `Property ${propertyId}`,
    googleBindingActive: true,
    authorization: null,
    decisionDeferredAt: null,
    ...overrides,
  }
}

function authorization(
  state: 'disabled' | 'enabled' | 'revoked',
  notice: Readonly<{ noticeVersion: string; noticeDigest: string }> = {
    noticeVersion: MERCHANT_AI_NOTICE_VERSION,
    noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
  },
): NonNullable<MerchantAiOverviewRecord['authorization']> {
  return {
    state,
    capabilities: state === 'enabled' ? ['review_analysis', 'reply_drafting'] : [],
    ...notice,
  }
}

function harness(
  records: readonly MerchantAiOverviewRecord[],
  scope: MerchantAiManagementScope = { kind: 'organization' },
) {
  const deps = {
    reader: { listOverview: vi.fn(async () => records) },
    resolveManagementScope: vi.fn(async () => scope),
    clock: () => NOW,
    noticeVersion: MERCHANT_AI_NOTICE_VERSION,
    noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
  } satisfies MerchantAiOverviewDeps
  return { deps, list: listMerchantAiOverview(deps) }
}

describe('listMerchantAiOverview', () => {
  it('lists every Property organization-wide with its authorization standing', async () => {
    const deferredAt = new Date('2026-09-14T08:00:00.000Z')
    const { deps, list } = harness([
      record('enabled', { authorization: authorization('enabled') }),
      record('never', { decisionDeferredAt: deferredAt, googleBindingActive: false }),
    ])

    await expect(list(input)).resolves.toEqual({
      properties: [
        {
          propertyId: 'enabled',
          propertyName: 'Property enabled',
          state: 'enabled',
          capabilities: ['review_analysis', 'reply_drafting'],
          noticeVersion: MERCHANT_AI_NOTICE_VERSION,
          reconsentRequired: false,
          decisionDeferredAt: null,
          googleBindingActive: true,
        },
        {
          propertyId: 'never',
          propertyName: 'Property never',
          state: 'disabled',
          capabilities: [],
          noticeVersion: null,
          reconsentRequired: false,
          decisionDeferredAt: deferredAt.toISOString(),
          googleBindingActive: false,
        },
      ],
    })
    expect(deps.resolveManagementScope).toHaveBeenCalledWith({ ...input, now: NOW })
    expect(deps.reader.listOverview).toHaveBeenCalledWith({
      organizationId: input.organizationId,
      propertyIds: null,
    })
  })

  it('flags re-consent only for consent recorded under a notice other than the served one', async () => {
    const previous = {
      noticeVersion: PREVIOUS_NOTICE_VERSION,
      noticeDigest: PREVIOUS_NOTICE_DIGEST,
    }
    const { list } = harness([
      record('enabled-current', { authorization: authorization('enabled') }),
      record('enabled-previous', { authorization: authorization('enabled', previous) }),
      record('revoked-previous', { authorization: authorization('revoked', previous) }),
      record('revoked-current', { authorization: authorization('revoked') }),
      // A restore reset records no consent, whatever notice it carries.
      record('disabled-previous', { authorization: authorization('disabled', previous) }),
      record('digest-drift', {
        authorization: authorization('enabled', {
          noticeVersion: MERCHANT_AI_NOTICE_VERSION,
          noticeDigest: PREVIOUS_NOTICE_DIGEST,
        }),
      }),
    ])

    const { properties } = await list(input)

    expect(
      Object.fromEntries(
        properties.map((entry) => [entry.propertyId, entry.reconsentRequired]),
      ),
    ).toEqual({
      'enabled-current': false,
      'enabled-previous': true,
      'revoked-previous': true,
      'revoked-current': false,
      'disabled-previous': false,
      'digest-drift': true,
    })
    expect(
      properties.find((entry) => entry.propertyId === 'enabled-previous'),
    ).toMatchObject({ noticeVersion: PREVIOUS_NOTICE_VERSION })
  })

  it('reads exactly the granted Properties for an assigned manager', async () => {
    const { deps, list } = harness([record('granted')], {
      kind: 'properties',
      propertyIds: ['granted'],
    })

    await expect(list(input)).resolves.toMatchObject({
      properties: [{ propertyId: 'granted' }],
    })
    expect(deps.reader.listOverview).toHaveBeenCalledWith({
      organizationId: input.organizationId,
      propertyIds: ['granted'],
    })
  })

  it('returns an empty overview for a manager without grants and skips the read', async () => {
    const { deps, list } = harness([record('unreachable')], {
      kind: 'properties',
      propertyIds: [],
    })

    await expect(list(input)).resolves.toEqual({ properties: [] })
    expect(deps.reader.listOverview).not.toHaveBeenCalled()
  })

  it('denies an actor without AI management authority before reading', async () => {
    const { deps, list } = harness([record('hidden')], { kind: 'denied' })

    await expect(list(input)).rejects.toMatchObject({
      name: 'MerchantAiAuthorizationError',
      code: 'capability_denied',
    })
    expect(deps.reader.listOverview).not.toHaveBeenCalled()
  })

  it('rejects a request without an organization or actor', async () => {
    const { deps, list } = harness([])

    await expect(list({ ...input, organizationId: '' })).rejects.toMatchObject({
      code: 'invalid_command',
    })
    await expect(list({ ...input, actorUserId: '' })).rejects.toMatchObject({
      code: 'invalid_command',
    })
    expect(deps.resolveManagementScope).not.toHaveBeenCalled()
  })
})
