import { describe, expect, it } from 'vitest'
import { portalLifetimeReconciliationPresentation } from './portal-lifetime-reconciliation-presentation'

describe('Portal lifetime reconciliation presentation', () => {
  it('describes a reconciled aggregate without turning it into a time trend', () => {
    expect(
      portalLifetimeReconciliationPresentation(
        {
          state: 'reconciled',
          projectionRevision: 12,
          sealedThroughLocalDate: '2026-07-01',
          lastRebuiltAt: new Date('2026-08-14T09:00:00.000Z'),
          lastSealedAt: new Date('2026-08-01T08:00:00.000Z'),
        },
        'en-GB',
        'UTC',
      ),
    ).toEqual({
      summary: 'All-time totals passed their latest consistency check.',
      revision: 'Revision 12',
      lastCheck: '14 Aug 2026, 09:00',
      anonymousBaseline: 'Through 1 Jul 2026',
      lastRetentionCheckpoint: '1 Aug 2026, 08:00',
    })
  })

  it('uses gentle, explicit copy while the first reconciliation is pending', () => {
    expect(
      portalLifetimeReconciliationPresentation({
        state: 'awaiting_first_reconciliation',
        projectionRevision: 3,
        sealedThroughLocalDate: null,
        lastRebuiltAt: null,
        lastSealedAt: null,
      }),
    ).toMatchObject({
      summary:
        'All-time totals are available while their first consistency check finishes.',
      revision: 'Revision 3',
      lastCheck: 'Not completed yet',
      anonymousBaseline: 'Not established yet',
      lastRetentionCheckpoint: 'Not completed yet',
    })
  })
})
