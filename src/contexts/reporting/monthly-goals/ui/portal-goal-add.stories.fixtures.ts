// What "Add a portal goal" reads, for its stories and its view's tests: Seaview's
// three Portals, as the screens show them. The read decides every number; these
// are its answers, never worked out here.
import type {
  PortalGoalAddOffer,
  PortalGoalAddOptions,
} from '#/contexts/reporting/application/dto/monthly-portal-goal-add.types'

const RECEPTION = 'a0000000-0000-4000-8000-000000000001'
const RESTAURANT = 'a0000000-0000-4000-8000-000000000002'
const SPA = 'a0000000-0000-4000-8000-000000000003'
const ROOMS = 'b0000000-0000-4000-8000-000000000001'

export const ADD_IDS = { RECEPTION, RESTAURANT, SPA, ROOMS } as const

const offer = (
  portalId: string,
  name: string,
  patch: Partial<PortalGoalAddOffer> = {},
): PortalGoalAddOffer => ({
  subject: { kind: 'portal', portalId },
  name,
  choices: null,
  soFar: null,
  readyOn: null,
  heldBy: null,
  ...patch,
})

/** Nov 22: December is offered; Reception's own usual gives 20 · 22 · 24. */
const NOV_22_PORTALS = [
  offer(RECEPTION, 'Reception', { choices: { usual: 20, aBitMore: 22, stretch: 24 } }),
  offer(RESTAURANT, 'Restaurant', { choices: { usual: 11, aBitMore: 13, stretch: 14 } }),
  offer(SPA, 'Spa', { choices: { usual: 9, aBitMore: 10, stretch: 11 } }),
]

export const ADD_SEAVIEW: PortalGoalAddOptions = {
  month: '2026-12',
  current: false,
  measure: 'portal_rating_count',
  onePortal: NOV_22_PORTALS,
  eachPortal: NOV_22_PORTALS.map((row) => ({
    offer: row,
    ticked: true,
    number: row.choices?.aBitMore ?? null,
  })),
  groups: [
    {
      subject: { kind: 'portal_group', portalGroupId: ROOMS },
      name: 'Rooms',
      choices: { usual: 30, aBitMore: 35, stretch: 40 },
      soFar: null,
      readyOn: null,
      heldBy: null,
    },
  ],
  average: { available: true, last4Weeks: 40, heldBy: null },
  timezone: 'Europe/Sofia',
}

/** The same, with only 6 private ratings in the last 4 weeks: no average yet. */
export const ADD_AVERAGE_DISABLED: PortalGoalAddOptions = {
  ...ADD_SEAVIEW,
  groups: [],
  average: { available: false, last4Weeks: 6, heldBy: null },
}

/**
 * Oct 23: November is offered. Reception and Restaurant have 2 weeks live and
 * are ticked with their recommended numbers; Spa went live on Oct 15 and is
 * ready on Oct 29.
 */
const OCT_23_PORTALS = [
  offer(RECEPTION, 'Reception', { choices: { usual: 24, aBitMore: 26, stretch: 29 } }),
  offer(RESTAURANT, 'Restaurant', { choices: { usual: 11, aBitMore: 12, stretch: 13 } }),
  offer(SPA, 'Spa', { readyOn: '2026-10-29' }),
]

export const ADD_EACH_OCT_23: PortalGoalAddOptions = {
  ...ADD_SEAVIEW,
  month: '2026-11',
  onePortal: OCT_23_PORTALS,
  eachPortal: OCT_23_PORTALS.map((row) => ({
    offer: row,
    ticked: row.choices !== null,
    number: row.choices?.aBitMore ?? null,
  })),
}

/** Reception already has a goal of its own. */
export const ADD_RECEPTION_HELD: PortalGoalAddOptions = {
  ...ADD_EACH_OCT_23,
  onePortal: ADD_EACH_OCT_23.onePortal.map((row) =>
    row.name === 'Reception'
      ? {
          ...row,
          heldBy: {
            programId: 'c0000000-0000-4000-8000-000000000001',
            name: 'Reception · Private ratings',
          },
        }
      : row,
  ),
  eachPortal: ADD_EACH_OCT_23.eachPortal.map((row) =>
    row.offer.name === 'Reception'
      ? {
          ...row,
          ticked: false,
          offer: {
            ...row.offer,
            heldBy: {
              programId: 'c0000000-0000-4000-8000-000000000001',
              name: 'Reception · Private ratings',
            },
          },
        }
      : row,
  ),
}

/** One live Portal and 6 private ratings: nothing to add, so no "More portal goals". */
export const ADD_NOTHING: PortalGoalAddOptions = {
  ...ADD_AVERAGE_DISABLED,
  onePortal: [],
  eachPortal: [],
}

/** This month offered (Nov 18): Reception's 3 already count. */
export const ADD_THIS_MONTH: PortalGoalAddOptions = {
  ...ADD_SEAVIEW,
  month: '2026-11',
  current: true,
  onePortal: [
    offer(RECEPTION, 'Reception', {
      choices: { usual: 9, aBitMore: 10, stretch: 11 },
      soFar: 3,
    }),
    offer(SPA, 'Spa', { choices: { usual: 4, aBitMore: 5, stretch: 6 }, soFar: 0 }),
  ],
}
