// BQC-4.5 — request region move use case (unit, in-memory ports).
//
// Beta reality (ADR 0057): 'us' is the ONLY accepting Data Cell, so every real
// move request resolves to a TYPED DENIAL + operator audit — denied requests
// never create a region_moves row. The approved path is proven here with a
// stubbed approved-cell set ('europe' injected), mirroring the rehearsal.

import { describe, it, expect, beforeEach } from 'vitest'
import { createInMemoryPropertyRepo } from '#/shared/testing/in-memory-property-repo'
import { buildTestAuthContext, buildTestProperty } from '#/shared/testing/fixtures'
import { isPropertyError } from '../../domain/errors'
import type { RegionMoveRecord } from '../../domain/region-move-workflow'
import type {
  RegionMoveAuditWriter,
  RegionMoveRequestCommandStore,
} from '../ports/region-move-request-command-store.port'
import { requestRegionMove, type RegionMoveDenialReason } from './request-region-move'

const NOW = new Date('2026-07-18T12:00:00.000Z')
let moveSeq = 0

function createInMemoryMoveStore(
  recordOutcome: 'recorded' | 'active_move_exists' = 'recorded',
) {
  const rows: RegionMoveRecord[] = []
  const audits: AuditEntry[] = []
  const store: RegionMoveRequestCommandStore = {
    recordRequest: async (command) => {
      if (recordOutcome === 'active_move_exists') return recordOutcome
      rows.push(command.move)
      audits.push(command.audit)
      return recordOutcome
    },
  }
  return { store, rows, audits }
}

type AuditEntry = Parameters<RegionMoveAuditWriter>[0]

function setup(
  approvedCells: ReadonlySet<string> = new Set(['us']),
  recordOutcome: 'recorded' | 'active_move_exists' = 'recorded',
) {
  const propertyRepo = createInMemoryPropertyRepo()
  const { store, rows, audits } = createInMemoryMoveStore(recordOutcome)
  const useCase = requestRegionMove({
    propertyRepo,
    requestCommandStore: store,
    approvedCells,
    writeOperatorAudit: async (entry) => {
      audits.push(entry)
    },
    idGen: () => `move-00000000-0000-0000-0000-${String(++moveSeq).padStart(12, '0')}`,
    clock: () => NOW,
  })
  return { useCase, propertyRepo, rows, audits }
}

const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

function seedUsProperty() {
  return buildTestProperty({
    id: 'a0000000-0000-0000-0000-0000000000aa',
    countryCode: 'US',
    processingRegion: 'us',
    processingRegionResolvedAt: NOW,
  })
}

describe('requestRegionMove (BQC-4.5)', () => {
  beforeEach(() => {
    moveSeq = 0
  })

  it('requires policy administration authority before reading or writing', async () => {
    const { useCase, rows, audits } = setup(new Set(['us', 'europe']))
    const unauthorized = buildTestAuthContext({ role: 'Staff' })

    await expect(
      useCase(
        {
          propertyId: 'a0000000-0000-0000-0000-00000000dead',
          toRegion: 'europe',
          reason: 'unauthorized move request',
        },
        unauthorized,
      ),
    ).rejects.toSatisfy(
      (error: unknown) => isPropertyError(error) && error.code === 'forbidden',
    )
    expect(rows).toHaveLength(0)
    expect(audits).toHaveLength(0)
  })

  describe('typed denials — beta approved cell set is us-only', () => {
    it.each<[string, () => ReturnType<typeof setup>, RegionMoveDenialReason]>([
      [
        'europe target is denied (target_cell_not_approved)',
        () => setup(new Set(['us'])),
        'target_cell_not_approved',
      ],
      [
        'global target is a denied placeholder (target_cell_not_approved)',
        () => setup(new Set(['us'])),
        'target_cell_not_approved',
      ],
    ])('%s', async (_label, make, expected) => {
      const { useCase, propertyRepo, rows, audits } = make()
      const prop = seedUsProperty()
      propertyRepo.seed([prop])

      const result = await useCase(
        {
          propertyId: prop.id,
          toRegion: _label.startsWith('global') ? 'global' : 'europe',
          reason: 'planned EU expansion',
        },
        ctx,
      )

      expect(result).toEqual({ ok: false, reason: expected })
      expect(rows).toHaveLength(0) // denied requests never create a machine row
      expect(audits).toHaveLength(1)
      expect(audits[0]).toMatchObject({
        actorUserId: ctx.userId,
        organizationId: ctx.organizationId,
        propertyId: prop.id,
        action: 'policy.region.move.request',
        decision: 'deny',
      })
      expect(audits[0].reason).toContain(expected)
    })

    it('us → us denies already_in_cell', async () => {
      const { useCase, propertyRepo, rows, audits } = setup()
      const prop = seedUsProperty()
      propertyRepo.seed([prop])

      const result = await useCase(
        { propertyId: prop.id, toRegion: 'us', reason: 'no-op move' },
        ctx,
      )

      expect(result).toEqual({ ok: false, reason: 'already_in_cell' })
      expect(rows).toHaveLength(0)
      expect(audits[0]?.decision).toBe('deny')
    })

    it('a missing property denies property_missing', async () => {
      const { useCase, rows, audits } = setup()

      const result = await useCase(
        {
          propertyId: 'a0000000-0000-0000-0000-00000000dead',
          toRegion: 'europe',
          reason: 'planned EU expansion',
        },
        ctx,
      )

      expect(result).toEqual({ ok: false, reason: 'property_missing' })
      expect(rows).toHaveLength(0)
      expect(audits[0]).toMatchObject({ decision: 'deny' })
    })

    it.each([
      ['unresolved', 'unresolved'],
      ['null', null],
    ] as const)(
      'a property with region %s denies region_unresolved',
      async (_l, region) => {
        const { useCase, propertyRepo, rows } = setup()
        const prop = buildTestProperty({
          id: 'a0000000-0000-0000-0000-0000000000ab',
          processingRegion: region as string | null,
        })
        propertyRepo.seed([prop])

        const result = await useCase(
          { propertyId: prop.id, toRegion: 'europe', reason: 'planned EU expansion' },
          ctx,
        )

        expect(result).toEqual({ ok: false, reason: 'region_unresolved' })
        expect(rows).toHaveLength(0)
      },
    )

    it.each([['unresolved'], ['atlantis'], ['US']])(
      'an unknown target identifier (%s) denies region_unresolved',
      async (toRegion) => {
        const { useCase, propertyRepo, rows } = setup()
        const prop = seedUsProperty()
        propertyRepo.seed([prop])

        const result = await useCase(
          { propertyId: prop.id, toRegion, reason: 'planned move' },
          ctx,
        )

        expect(result).toEqual({ ok: false, reason: 'region_unresolved' })
        expect(rows).toHaveLength(0)
      },
    )
  })

  describe('approved target (stubbed — the future Europe path)', () => {
    it('creates the row in state requested and returns it', async () => {
      const { useCase, propertyRepo, rows, audits } = setup(new Set(['us', 'europe']))
      const prop = seedUsProperty()
      propertyRepo.seed([prop])

      const result = await useCase(
        { propertyId: prop.id, toRegion: 'europe', reason: 'planned EU expansion' },
        ctx,
      )

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.move).toMatchObject({
        propertyId: prop.id,
        organizationId: ctx.organizationId,
        fromRegion: 'us',
        toRegion: 'europe',
        state: 'requested',
        stateRevision: 1,
        requestedBy: ctx.userId,
        requestedAt: NOW,
        stateChangedAt: NOW,
        completedAt: null,
        denialReason: null,
        error: null,
      })
      expect(rows).toHaveLength(1)
      expect(audits[0]).toMatchObject({
        action: 'policy.region.move.request',
        decision: 'allow',
      })
      expect(audits[0]?.reason).toContain('us')
      expect(audits[0]?.reason).toContain('europe')
    })

    it('a denied-region property may move INTO the approved us cell (remediation path)', async () => {
      const { useCase, propertyRepo, rows } = setup(new Set(['us']))
      const prop = buildTestProperty({
        id: 'a0000000-0000-0000-0000-0000000000ac',
        countryCode: 'DE',
        processingRegion: 'europe',
        processingRegionResolvedAt: NOW,
      })
      propertyRepo.seed([prop])

      const result = await useCase(
        { propertyId: prop.id, toRegion: 'us', reason: 'consolidate into us cell' },
        ctx,
      )

      expect(result.ok).toBe(true)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ fromRegion: 'europe', toRegion: 'us' })
    })

    it('returns a typed denial when the PostgreSQL authority wins a concurrent request', async () => {
      const { useCase, propertyRepo, rows, audits } = setup(
        new Set(['us', 'europe']),
        'active_move_exists',
      )
      const prop = seedUsProperty()
      propertyRepo.seed([prop])

      await expect(
        useCase(
          {
            propertyId: prop.id,
            toRegion: 'europe',
            reason: 'concurrent operator request',
          },
          ctx,
        ),
      ).resolves.toEqual({ ok: false, reason: 'active_move_exists' })
      expect(rows).toHaveLength(0)
      expect(audits).toEqual([
        expect.objectContaining({ decision: 'deny', reason: expect.any(String) }),
      ])
      expect(audits[0]?.reason).toContain('active_move_exists')
    })
  })
})
