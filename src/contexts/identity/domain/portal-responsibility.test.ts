import { describe, it, expect } from 'vitest'
import {
  type PortalResponsibility,
  createResponsibility,
  endResponsibility,
  changeKind,
  isActive,
  isPrimary,
  validatePrimaryUniqueness,
  resolveResponsibleAt,
} from './portal-responsibility'

describe('PortalResponsibility', () => {
  const baseParams = {
    id: 'resp-1',
    organizationId: 'org-1',
    propertyId: 'prop-1',
    portalId: 'portal-1',
    staffParticipationId: 'part-1',
    kind: 'primary' as const,
    effectiveFrom: new Date('2026-01-01'),
    createdBy: 'admin-1',
  }

  describe('createResponsibility', () => {
    it('creates an active responsibility', () => {
      const r = createResponsibility(baseParams)
      expect(r.kind).toBe('primary')
      expect(r.effectiveTo).toBeNull()
      expect(isActive(r, new Date('2026-03-01'))).toBe(true)
    })
  })

  describe('endResponsibility', () => {
    it('ends an active responsibility', () => {
      const r = createResponsibility(baseParams)
      const result = endResponsibility(r, new Date('2026-06-01'), 'reassignment')
      expect(result).toHaveProperty('effectiveTo')
      if (!('code' in result) && result.effectiveTo) {
        expect(result.endReason).toBe('reassignment')
      }
    })

    it('prevents ending an already-ended responsibility', () => {
      const r = endResponsibility(
        createResponsibility(baseParams),
        new Date('2026-06-01'),
        'done',
      ) as PortalResponsibility
      const result = endResponsibility(r, new Date('2026-07-01'), 'again')
      expect(result).toHaveProperty('code', 'already_ended')
    })
  })

  describe('changeKind', () => {
    it('ends old responsibility and starts new with new kind', () => {
      const r = createResponsibility(baseParams)
      const result = changeKind(r, 'supporting', new Date('2026-03-01'), 'resp-2')
      if ('ended' in result) {
        expect(result.ended.effectiveTo).toEqual(new Date('2026-03-01'))
        expect(result.started.kind).toBe('supporting')
      }
    })

    it('prevents changing kind on ended responsibility', () => {
      const r = endResponsibility(
        createResponsibility(baseParams),
        new Date('2026-06-01'),
        'done',
      ) as PortalResponsibility
      const result = changeKind(r, 'supporting', new Date('2026-07-01'), 'resp-2')
      expect(result).toHaveProperty('code', 'cannot_change_kind_on_ended')
    })
  })

  describe('isActive', () => {
    it('active within interval', () => {
      const r = createResponsibility(baseParams)
      expect(isActive(r, new Date('2026-03-01'))).toBe(true)
    })

    it('inactive after end', () => {
      const r = endResponsibility(
        createResponsibility(baseParams),
        new Date('2026-06-01'),
        'done',
      ) as PortalResponsibility
      expect(isActive(r, new Date('2026-07-01'))).toBe(false)
    })

    it('half-open: active at start, inactive at end', () => {
      const r = endResponsibility(
        createResponsibility(baseParams),
        new Date('2026-06-01'),
        'done',
      ) as PortalResponsibility
      expect(isActive(r, new Date('2026-01-01'))).toBe(true)
      expect(isActive(r, new Date('2026-06-01'))).toBe(false)
    })
  })

  describe('validatePrimaryUniqueness', () => {
    it('returns null when no active primary exists', () => {
      const existing = [
        createResponsibility({ ...baseParams, kind: 'supporting' as const }),
      ]
      expect(
        validatePrimaryUniqueness(existing, 'portal-1', new Date('2026-02-01')),
      ).toBeNull()
    })

    it('returns error when active primary exists', () => {
      const existing = [createResponsibility(baseParams)]
      const result = validatePrimaryUniqueness(
        existing,
        'portal-1',
        new Date('2026-02-01'),
      )
      expect(result).toHaveProperty('code', 'primary_exists')
    })
  })

  describe('resolveResponsibleAt', () => {
    it('finds the responsible staff at a given time', () => {
      const r1 = createResponsibility(baseParams)
      const r2 = createResponsibility({
        ...baseParams,
        id: 'resp-2',
        staffParticipationId: 'part-2',
        kind: 'supporting' as const,
      })
      const result = resolveResponsibleAt([r1, r2], 'portal-1', new Date('2026-03-01'))
      expect(result).toHaveLength(2)
    })

    it('excludes ended responsibilities', () => {
      const r1 = endResponsibility(
        createResponsibility(baseParams),
        new Date('2026-03-01'),
        'done',
      ) as PortalResponsibility
      const r2 = createResponsibility({
        ...baseParams,
        id: 'resp-2',
        staffParticipationId: 'part-2',
        effectiveFrom: new Date('2026-03-01'),
      })
      const result = resolveResponsibleAt([r1, r2], 'portal-1', new Date('2026-04-01'))
      expect(result).toHaveLength(1)
      expect(result[0].staffParticipationId).toBe('part-2')
    })

    it('returns empty when no active responsibility', () => {
      const result = resolveResponsibleAt([], 'portal-1', new Date('2026-04-01'))
      expect(result).toHaveLength(0)
    })
  })

  describe('isPrimary', () => {
    it('returns true for primary kind', () => {
      const r = createResponsibility(baseParams)
      expect(isPrimary(r)).toBe(true)
    })

    it('returns false for supporting kind', () => {
      const r = createResponsibility({ ...baseParams, kind: 'supporting' as const })
      expect(isPrimary(r)).toBe(false)
    })
  })
})
