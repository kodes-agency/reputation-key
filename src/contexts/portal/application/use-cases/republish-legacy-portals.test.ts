// Portal context — republish every live v1/v2 Portal (round 4, slice 46).

import { describe, expect, it, vi } from 'vitest'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { portalError } from '../../domain/errors'
import {
  MAX_LEGACY_PORTAL_PAGE,
  type LegacyLivePortal,
  type PortalLegacyPublicationReader,
} from '../ports/portal-legacy-publication.reader'
import type {
  PreviewPortalChangesResult,
  PublishPortalChangesResult,
} from './publish-portal-changes'
import { republishLegacyPortals } from './republish-legacy-portals'

const ORG = organizationId('org-republish-000000000000000001')
const OTHER_ORG = organizationId('org-republish-000000000000000002')
const PROPERTY_A = propertyId('a0000000-0000-4000-8000-00000000000a')
const PROPERTY_B = propertyId('b0000000-0000-4000-8000-00000000000b')
const NOW = new Date('2026-10-01T09:00:00.000Z')

const live = (
  index: number,
  overrides: Partial<LegacyLivePortal> = {},
): LegacyLivePortal => ({
  organizationId: ORG,
  propertyId: PROPERTY_A,
  portalId: portalId(`c0000000-0000-4000-8000-${String(index).padStart(12, '0')}`),
  liveVersion: 1,
  liveSchemaVersion: 2,
  ...overrides,
})

type Fault = (portal: string) => unknown

/**
 * A reader over a mutable list of live Portals, so the run can be repeated: a
 * publication moves its Portal to schema 3, which the reader no longer lists.
 */
function setup(
  portals: readonly LegacyLivePortal[],
  refuse: Fault = () => null,
  /** Open pending content changes per Portal id: a manager's unpublished edits. */
  pending: Readonly<Record<string, number>> = {},
) {
  const rows = new Map(portals.map((portal) => [String(portal.portalId), portal]))
  const published: Array<{ portalId: string; ctx: AuthContext }> = []
  const previewed: string[] = []
  const reads: Array<{ afterPortalId: string | null; limit: number }> = []
  const logger = { ...createMockLogger(), error: vi.fn() } satisfies LoggerPort

  const reader: PortalLegacyPublicationReader = {
    listLiveLegacyPortals: async (input) => {
      reads.push({
        afterPortalId: input.afterPortalId === null ? null : String(input.afterPortalId),
        limit: input.limit,
      })
      return [...rows.values()]
        .filter(
          (row) =>
            row.organizationId === input.organizationId &&
            (input.propertyId === undefined || row.propertyId === input.propertyId) &&
            (input.afterPortalId === null ||
              String(row.portalId) > String(input.afterPortalId)),
        )
        .sort((a, b) => String(a.portalId).localeCompare(String(b.portalId)))
        .slice(0, input.limit)
    },
  }
  const gate = (id: string) => {
    const fault = refuse(id)
    if (fault) throw fault
  }
  const publishPortalChanges = async (
    input: Readonly<{ portalId: string }>,
    ctx: AuthContext,
  ): Promise<PublishPortalChangesResult> => {
    gate(input.portalId)
    published.push({ portalId: input.portalId, ctx })
    const row = rows.get(input.portalId)
    rows.delete(input.portalId)
    return {
      outcome: 'published',
      snapshotId: `snapshot-${input.portalId}`,
      version: (row?.liveVersion ?? 0) + 1,
      configurationDigest: 'd'.repeat(64),
      activatedAt: NOW,
    }
  }
  const previewPortalChanges = async (
    input: Readonly<{ portalId: string }>,
  ): Promise<PreviewPortalChangesResult> => {
    gate(input.portalId)
    previewed.push(input.portalId)
    return {
      outcome: 'would_publish',
      version: (rows.get(input.portalId)?.liveVersion ?? 0) + 1,
      pendingEdits: pending[input.portalId] ?? 0,
    }
  }
  return {
    published,
    previewed,
    reads,
    rows,
    logger,
    run: republishLegacyPortals({
      reader,
      publishPortalChanges,
      previewPortalChanges,
      logger,
    }),
  }
}

const baseInput = {
  organizationId: ORG,
  operatorId: 'denev',
  dryRun: false,
  pageSize: 50,
} as const

describe('republishLegacyPortals', () => {
  it('republishes every selected Portal and reports it with the version it replaced', async () => {
    const harness = setup([
      live(1, { liveVersion: 4, liveSchemaVersion: 1 }),
      live(2, { propertyId: PROPERTY_B, liveVersion: 7, liveSchemaVersion: 2 }),
    ])

    const report = await harness.run(baseInput)

    expect(report.mode).toBe('apply')
    expect(report.rows).toEqual([
      {
        organizationId: ORG,
        propertyId: PROPERTY_A,
        portalId: live(1).portalId,
        fromVersion: 4,
        fromSchemaVersion: 1,
        outcome: 'republished',
        toVersion: 5,
        pendingEdits: 0,
      },
      {
        organizationId: ORG,
        propertyId: PROPERTY_B,
        portalId: live(2).portalId,
        fromVersion: 7,
        fromSchemaVersion: 2,
        outcome: 'republished',
        toVersion: 8,
        pendingEdits: 0,
      },
    ])
    expect(report.totals).toEqual({
      processed: 2,
      republished: 2,
      wouldRepublish: 0,
      skipped: 0,
      unchanged: 0,
      failed: 0,
    })
    expect(report.halted).toBeNull()
  })

  it('publishes as the operator, with organisation-wide Portal authority and no user identity', async () => {
    const harness = setup([live(1)])

    await harness.run({ ...baseInput, operatorId: 'denev' })

    expect(harness.published).toHaveLength(1)
    expect(harness.published[0]?.ctx).toEqual({
      userId: 'ops:denev',
      organizationId: ORG,
      role: 'AccountAdmin',
    })
  })

  it('refuses an operator identity that cannot be recorded as an actor', async () => {
    const harness = setup([live(1)])

    await expect(
      harness.run({ ...baseInput, operatorId: 'a b; drop table' }),
    ).rejects.toThrow('operator identity')
    expect(harness.published).toEqual([])
  })

  it('writes nothing in a dry run and says what it would republish', async () => {
    const harness = setup([live(1, { liveVersion: 3 }), live(2)])

    const report = await harness.run({ ...baseInput, dryRun: true })

    expect(harness.published).toEqual([])
    expect(harness.previewed).toHaveLength(2)
    expect(report.mode).toBe('dry_run')
    expect(
      report.rows.map((row) => [row.outcome, 'toVersion' in row ? row.toVersion : null]),
    ).toEqual([
      ['would_republish', 4],
      ['would_republish', 2],
    ])
    expect(report.totals).toMatchObject({
      processed: 2,
      wouldRepublish: 2,
      republished: 0,
    })
    expect(harness.rows.size).toBe(2)
  })

  it('skips a Portal that is not ready, says why, and carries on with the rest', async () => {
    const blocked = live(2, { propertyId: PROPERTY_B })
    const harness = setup(
      [live(1), blocked, live(3)],
      (id) =>
        id === String(blocked.portalId) &&
        portalError(
          'responsible_manager_ineligible',
          'Assign at least one responsible manager before publishing',
        ),
    )

    const report = await harness.run(baseInput)

    expect(report.rows.map((row) => row.outcome)).toEqual([
      'republished',
      'skipped',
      'republished',
    ])
    expect(report.rows[1]).toMatchObject({
      portalId: blocked.portalId,
      propertyId: PROPERTY_B,
      outcome: 'skipped',
      reason: {
        code: 'responsible_manager_ineligible',
        message: 'Assign at least one responsible manager before publishing',
      },
    })
    expect(report.rows[1]).not.toHaveProperty('toVersion')
    expect(report.totals).toMatchObject({ processed: 3, republished: 2, skipped: 1 })
    expect(harness.rows.has(String(blocked.portalId))).toBe(true)
  })

  it('reports a not-ready Portal in a dry run too, so the report predicts the apply', async () => {
    const blocked = live(1)
    const harness = setup(
      [blocked, live(2)],
      (id) =>
        id === String(blocked.portalId) &&
        portalError('portal_inactive', 'This Portal cannot be published'),
    )

    const report = await harness.run({ ...baseInput, dryRun: true })

    expect(report.rows.map((row) => row.outcome)).toEqual(['skipped', 'would_republish'])
    expect(report.totals).toMatchObject({ skipped: 1, wouldRepublish: 1 })
  })

  it('is idempotent: a second run finds the republished Portals gone and the skipped ones still skipped', async () => {
    const blocked = live(2)
    const harness = setup(
      [live(1), blocked],
      (id) =>
        id === String(blocked.portalId) &&
        portalError('token_unavailable', 'Create the Portal public address first'),
    )

    const first = await harness.run(baseInput)
    const second = await harness.run(baseInput)

    expect(first.totals).toMatchObject({ processed: 2, republished: 1, skipped: 1 })
    expect(second.totals).toMatchObject({ processed: 1, republished: 0, skipped: 1 })
    expect(harness.published).toHaveLength(1)
  })

  it('reports a Portal with nothing left to publish as unchanged', async () => {
    const run = republishLegacyPortals({
      reader: { listLiveLegacyPortals: async () => [live(1)] },
      publishPortalChanges: async () => ({ outcome: 'unchanged', version: 1 }),
      previewPortalChanges: async () => ({
        outcome: 'unchanged',
        version: 1,
        pendingEdits: 0,
      }),
      logger: createMockLogger(),
    })

    const report = await run({ ...baseInput, pageSize: 5 })

    expect(report.rows).toMatchObject([{ outcome: 'unchanged' }])
    expect(report.totals).toMatchObject({ processed: 1, unchanged: 1, republished: 0 })
  })

  it('pages through every Portal, resuming after the last one seen', async () => {
    const harness = setup([live(1), live(2), live(3), live(4), live(5)])

    const report = await harness.run({ ...baseInput, pageSize: 2 })

    expect(report.totals.republished).toBe(5)
    expect(harness.reads.map((read) => read.afterPortalId)).toEqual([
      null,
      String(live(2).portalId),
      String(live(4).portalId),
    ])
    expect(harness.reads.every((read) => read.limit === 2)).toBe(true)
  })

  it('does not revisit a skipped Portal while paging', async () => {
    const stuck = live(1)
    const harness = setup(
      [stuck, live(2), live(3)],
      (id) => id === String(stuck.portalId) && portalError('portal_inactive', 'inactive'),
    )

    const report = await harness.run({ ...baseInput, pageSize: 1 })

    expect(report.rows.map((row) => row.outcome)).toEqual([
      'skipped',
      'republished',
      'republished',
    ])
  })

  it('narrows to one Property when asked', async () => {
    const harness = setup([live(1), live(2, { propertyId: PROPERTY_B })])

    const report = await harness.run({ ...baseInput, propertyId: PROPERTY_B })

    expect(report.rows.map((row) => row.portalId)).toEqual([live(2).portalId])
    expect(harness.rows.has(String(live(1).portalId))).toBe(true)
  })

  it('never reaches another organisation', async () => {
    const harness = setup([live(1), live(2, { organizationId: OTHER_ORG })])

    const report = await harness.run(baseInput)

    expect(report.rows.map((row) => row.portalId)).toEqual([live(1).portalId])
    expect(harness.rows.has(String(live(2).portalId))).toBe(true)
  })

  it('reports an empty selection', async () => {
    const harness = setup([])

    const report = await harness.run(baseInput)

    expect(report.rows).toEqual([])
    expect(report.totals).toEqual({
      processed: 0,
      republished: 0,
      wouldRepublish: 0,
      skipped: 0,
      unchanged: 0,
      failed: 0,
    })
  })

  it('stops at a fault that is not a Portal refusal and returns what it did so far', async () => {
    const harness = setup([live(1), live(2), live(3)], (id) =>
      id === String(live(2).portalId) ? new TypeError('connection reset: secret') : null,
    )

    const report = await harness.run(baseInput)

    expect(report.rows.map((row) => row.outcome)).toEqual(['republished', 'failed'])
    expect(report.halted).toEqual({
      portalId: live(2).portalId,
      fault: 'TypeError',
    })
    expect(JSON.stringify(report)).not.toContain('secret')
    expect(harness.rows.has(String(live(3).portalId))).toBe(true)
  })

  it('logs the fault that stopped the run, and the report names the Portal it stopped at', async () => {
    const fault = new TypeError('connection reset')
    const harness = setup([live(1), live(2)], (id) =>
      id === String(live(2).portalId) ? fault : null,
    )

    const report = await harness.run(baseInput)

    expect(harness.logger.error).toHaveBeenCalledTimes(1)
    expect(harness.logger.error).toHaveBeenCalledWith(
      { error: fault },
      expect.stringContaining('republish'),
    )
    expect(report.halted?.portalId).toBe(live(2).portalId)
  })

  describe("a manager's unpublished edits", () => {
    const edited = live(2, { propertyId: PROPERTY_B })
    const pendingFor = (count: number) => ({ [String(edited.portalId)]: count })

    it('does not publish them: the Portal is skipped with a reason of its own and the rest carry on', async () => {
      const harness = setup([live(1), edited, live(3)], () => null, pendingFor(2))

      const report = await harness.run(baseInput)

      expect(report.rows.map((row) => row.outcome)).toEqual([
        'republished',
        'skipped',
        'republished',
      ])
      expect(report.rows[1]).toMatchObject({
        portalId: edited.portalId,
        outcome: 'skipped',
        reason: {
          code: 'pending_edits',
          message: expect.stringContaining('2 unpublished edits'),
        },
      })
      expect(harness.published.map((entry) => entry.portalId)).not.toContain(
        String(edited.portalId),
      )
      expect(harness.rows.has(String(edited.portalId))).toBe(true)
      expect(report.totals).toMatchObject({ republished: 2, skipped: 1 })
    })

    it('says "edit" for one', async () => {
      const harness = setup([edited], () => null, pendingFor(1))

      const report = await harness.run({ ...baseInput, dryRun: true })

      expect(report.rows[0]).toMatchObject({
        outcome: 'skipped',
        reason: { message: expect.stringContaining('1 unpublished edit;') },
      })
    })

    it('reports it in a dry run too, so the report predicts the apply', async () => {
      const harness = setup([live(1), edited], () => null, pendingFor(3))

      const report = await harness.run({ ...baseInput, dryRun: true })

      expect(report.rows.map((row) => row.outcome)).toEqual([
        'would_republish',
        'skipped',
      ])
      expect(harness.published).toEqual([])
    })

    it('publishes them only when the operator asks for it, and says how many went live', async () => {
      const harness = setup([live(1), edited], () => null, pendingFor(2))

      const report = await harness.run({ ...baseInput, includePendingEdits: true })

      expect(report.rows).toMatchObject([
        { outcome: 'republished', pendingEdits: 0 },
        { outcome: 'republished', pendingEdits: 2 },
      ])
      expect(harness.published).toHaveLength(2)
    })

    it('shows what the opt-in would do in a dry run', async () => {
      const harness = setup([edited], () => null, pendingFor(2))

      const report = await harness.run({
        ...baseInput,
        dryRun: true,
        includePendingEdits: true,
      })

      expect(report.rows[0]).toMatchObject({
        outcome: 'would_republish',
        pendingEdits: 2,
      })
    })
  })

  it('never asks the reader for more than it can give, and still visits every Portal', async () => {
    const count = MAX_LEGACY_PORTAL_PAGE + 1
    const harness = setup(Array.from({ length: count }, (_, index) => live(index + 1)))

    const report = await harness.run({
      ...baseInput,
      pageSize: MAX_LEGACY_PORTAL_PAGE * 2,
    })

    expect(report.totals.republished).toBe(count)
    expect(harness.reads.every((read) => read.limit === MAX_LEGACY_PORTAL_PAGE)).toBe(
      true,
    )
    expect(report.halted).toBeNull()
  })
})
