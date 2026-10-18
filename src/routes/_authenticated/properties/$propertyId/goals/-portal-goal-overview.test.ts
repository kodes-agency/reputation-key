import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import type { PortalGoalCardView } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { CARD_RUNNING } from '#/components/goals/portal-goal-running.stories.fixtures'
import {
  CARD_READY,
  CARD_SCANS_ONLY,
} from '#/components/goals/portal-goal.stories.fixtures'
import { putOffPortalGoalPrompt } from './-portal-goal-overview'
import { portalGoalCardQuery } from './-portal-goal-queries'

// "Not now" on the Overview's prompt (PLAN PG-16): the card's read is written
// as the server will answer it, before the command is sent, and put back when
// the command fails.

const PROPERTY = 'property-1'
const { queryKey } = portalGoalCardQuery(PROPERTY)

function holding(card: PortalGoalCardView | undefined): QueryClient {
  const queryClient = new QueryClient()
  if (card !== undefined) queryClient.setQueryData(queryKey, card)
  return queryClient
}

describe('putOffPortalGoalPrompt', () => {
  it("puts the named month's prompt off, and its thunk puts back the read before", () => {
    const queryClient = holding(CARD_READY)

    const putBack = putOffPortalGoalPrompt(queryClient, PROPERTY, '2026-11')

    expect(queryClient.getQueryData(queryKey)).toEqual({
      ...CARD_READY,
      prompt: { month: '2026-11', number: 40, deferred: true },
    })
    expect(putBack).toBeTypeOf('function')
    putBack?.()
    expect(queryClient.getQueryData(queryKey)).toEqual(CARD_READY)
  })

  it('the scans-only prompt is put off the same way', () => {
    const queryClient = holding(CARD_SCANS_ONLY)

    putOffPortalGoalPrompt(queryClient, PROPERTY, '2026-11')

    expect(queryClient.getQueryData(queryKey)).toMatchObject({
      state: 'scans_only',
      prompt: { month: '2026-11', deferred: true },
    })
  })

  it('a prompt for another month, a card with no prompt, or no read: nothing is written', () => {
    const october = holding(CARD_READY)
    const running = holding(CARD_RUNNING)
    const unread = holding(undefined)

    expect(putOffPortalGoalPrompt(october, PROPERTY, '2026-10')).toBeUndefined()
    expect(putOffPortalGoalPrompt(running, PROPERTY, '2026-11')).toBeUndefined()
    expect(putOffPortalGoalPrompt(unread, PROPERTY, '2026-11')).toBeUndefined()

    expect(october.getQueryData(queryKey)).toBe(CARD_READY)
    expect(running.getQueryData(queryKey)).toBe(CARD_RUNNING)
    expect(unread.getQueryData(queryKey)).toBeUndefined()
  })

  it("another Property's read is not this one's", () => {
    const queryClient = holding(CARD_READY)

    expect(putOffPortalGoalPrompt(queryClient, 'property-2', '2026-11')).toBeUndefined()
    expect(queryClient.getQueryData(queryKey)).toBe(CARD_READY)
  })
})
