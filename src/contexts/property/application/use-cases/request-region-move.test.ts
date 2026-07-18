// BQC-4.5 — request region move use case (unit, in-memory ports).
//
// Beta reality (ADR 0048): 'us' is the ONLY approved cell, so every real
// move request resolves to a TYPED DENIAL + operator audit — denied requests
// never create a region_moves row. The approved path is proven here with a
// stubbed approved-cell set ('europe' injected), mirroring the rehearsal.

import { describe, it, expect, beforeEach } from 'vitest'
import { createInMemoryPropertyRepo } from '#/shared/testing/in-memory-property-repo'
import { buildTestAuthContext, buildTestProperty } from '#/shared/testing/fixtures'
import type { RegionMoveRecord } from '../../domain/region-move-workflow'
import type {
  RegionMoveAuditWriter,
  RegionMoveStateUpdate,
  RegionMoveStore,
} from '../ports/region-move-store.port'
import { requestRegionMove, type RegionMoveDenialReason } from './request-region-move'

const NOW = new Date('2026-07-18T12:00:00.000Z')
let moveSeq = 0

function createInMemoryMoveStore() {
  const rows: RegionMoveRecord[] = []
  const store: RegionMoveStore = {
    insertMove: async (move) => {
      rows.push(move)
    },
    findMoveById: async (_orgId, moveId) => rows.find((r) => r.id === moveId) ?? null,
    findActiveMoveForProperty: async (_orgId, propertyId) =>
      rows.find((r) => r.propertyId === propertyId && r.state === 'requested') ?? null,
    updateMoveState: async (_orgId, moveId, update: RegionMoveStateUpdate) => {
      const i = rows.findIndex((r) => r.id === moveId)
      if (i >= 0) rows[i] = { ...rows[i], ...update }
    },
    activateTargetRegion: async () => 'swapped',
    restoreSourceRegion: async () => 'already_active',
  }
  return { store, rows }
}

type AuditEntry = Parameters<RegionMoveAuditWriter>[0]

function setup(approvedCells: ReadonlySet<string> = new Set(['us'])) {
  const propertyRepo = createInMemoryPropertyRepo()
  const { store, rows } = createInMemoryMoveStore()
  const audits: AuditEntry[] = []
  const useCase = requestRegionMove({
    propertyRepo,
    moveStore: store,
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
  })
})
