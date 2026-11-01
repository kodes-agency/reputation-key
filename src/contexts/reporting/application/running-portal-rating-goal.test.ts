import { describe, expect, it, vi } from 'vitest'
import type { PortalRatingFact } from '#/contexts/portal/application/public-api'
import { findPortalRatingGoalBlock } from './running-portal-rating-goal'
import { propertyGoal } from './use-cases/monthly-portal-goal-test-fixtures'

const now = new Date('2026-11-18T10:00:00.000Z')
const property = propertyGoal('goal', 'portal_rating_count', { status: 'active' })
const rating = {
  ...property,
  assignments: property.assignments.map((assignment) => ({
    ...assignment,
    subject: { kind: 'portal' as const, portalId: 'portal' },
  })),
}
const member = (
  id: string,
  skip: boolean,
  publicationState: PortalRatingFact['publicationState'] = 'published',
): PortalRatingFact => ({
  portalId: id,
  portalGroupId: 'group',
  skipPrivateRating: skip,
  publicationState,
})

describe('running rating goal guard', () => {
  it('refuses a direct Portal subject but allows ending it', async () => {
    const read = vi.fn(async () => [])
    expect(await findPortalRatingGoalBlock([rating], 'portal', now, read)).toBe('portal')
    expect(read).not.toHaveBeenCalled()
    expect(
      await findPortalRatingGoalBlock(
        [{ ...rating, program: { ...rating.program, status: 'ended' } }],
        'portal',
        now,
        read,
      ),
    ).toBeNull()
  })

  it.each(['group', 'property', 'monthly'] as const)(
    'protects the last rating collector for a %s goal',
    async (kind) => {
      const goal = {
        ...property,
        program: {
          ...property.program,
          name: kind === 'monthly' ? 'Monthly portal goal' : 'Ratings',
        },
        assignments: property.assignments.map((assignment) => ({
          ...assignment,
          subject:
            kind === 'group'
              ? { kind: 'portal_group' as const, portalGroupId: 'group' }
              : { kind: 'property' as const, propertyId: property.program.propertyId },
        })),
      }
      const read = vi.fn(async () => [member('portal', false), member('sibling', true)])
      expect(await findPortalRatingGoalBlock([goal], 'portal', now, read)).toBe(
        'last_collector',
      )
      read.mockResolvedValue([member('portal', false), member('sibling', false)])
      expect(await findPortalRatingGoalBlock([goal], 'portal', now, read)).toBeNull()
    },
  )

  it('counts only published Property siblings and requires the target to be published', async () => {
    const read = vi.fn(async () => [
      member('portal', false),
      member('draft', false, 'draft'),
    ])
    expect(await findPortalRatingGoalBlock([property], 'portal', now, read)).toBe(
      'last_collector',
    )
    read.mockResolvedValue([member('portal', false, 'draft'), member('published', true)])
    expect(await findPortalRatingGoalBlock([property], 'portal', now, read)).toBeNull()
  })

  it('keeps the running rating month guarded while a scans version waits', async () => {
    const nextMonth = new Date('2026-12-01T00:00:00.000Z')
    const scans = {
      ...rating.version,
      id: 'scans',
      version: 2,
      metric: 'qualified_scans' as const,
      effectiveFrom: nextMonth,
    }
    expect(
      await findPortalRatingGoalBlock(
        [
          {
            ...rating,
            version: scans,
            versions: [{ ...rating.version, effectiveTo: nextMonth }, scans],
            assignments: rating.assignments.map((assignment) => ({
              ...assignment,
              effectiveTo: nextMonth,
            })),
          },
        ],
        'portal',
        now,
        async () => [],
      ),
    ).toBe('portal')
  })
})
