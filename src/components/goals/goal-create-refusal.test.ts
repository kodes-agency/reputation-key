import { describe, expect, it } from 'vitest'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import type { GoalSubject } from '#/contexts/reporting/application/public-api'
import type { GoalSubjectHold } from '#/contexts/reporting/application/goal-subject-holds'
import { goalCreateRefusal, type GoalCreateRefusalContext } from './goal-create-refusal'

const ZONE = 'Europe/Sofia'
const LOBBY: GoalSubject = { kind: 'portal', portalId: 'portal-lobby' }
const POOL: GoalSubject = { kind: 'portal', portalId: 'portal-pool' }
const NAMES: Readonly<Record<string, string>> = {
  'portal-lobby': 'Lobby',
  'portal-pool': 'Pool bar',
}

const refusal = (code: string, status = 409) =>
  new ServerFunctionError('GoalProgramError', code, code, status)

const hold = (overrides: Partial<GoalSubjectHold> = {}): GoalSubjectHold => ({
  subject: LOBBY,
  programId: 'program-1',
  programName: 'Lobby ratings',
  targetValue: 400,
  heldUntil: null,
  ...overrides,
})

const context = (
  overrides: Partial<GoalCreateRefusalContext> = {},
): GoalCreateRefusalContext => ({
  subjects: [LOBBY],
  holds: [],
  startsThisMonth: true,
  subjectName: (subject) =>
    subject.kind === 'portal' ? (NAMES[subject.portalId] ?? 'Portal') : 'Subject',
  timezone: ZONE,
  now: new Date('2026-10-11T09:00:00.000Z'),
  ...overrides,
})

describe('goalCreateRefusal', () => {
  it('says the month changed while the form was open', () => {
    const message = goalCreateRefusal(refusal('start_month_changed'), context())

    expect(message).toBe('The month has changed. Check the start and save again.')
  })

  it('names the goal that holds a subject and how to free it', () => {
    const message = goalCreateRefusal(
      refusal('subject_has_goal'),
      context({ holds: [hold()] }),
    )

    expect(message).toBe(
      'Lobby is part of Lobby ratings. Remove it from that goal’s subjects first.',
    )
  })

  it('says when a goal that is ending frees its subject, and offers next month', () => {
    // An ended goal holds its subject until the month it had open is over.
    const message = goalCreateRefusal(
      refusal('subject_has_goal'),
      context({ holds: [hold({ heldUntil: new Date('2026-10-31T22:00:00.000Z') })] }),
    )

    expect(message).toBe(
      'Lobby has a goal for this measure that ends Oct 31. Start the new goal next month.',
    )
  })

  it('offers no next month to a goal that already starts then', () => {
    const message = goalCreateRefusal(
      refusal('subject_has_goal'),
      context({
        startsThisMonth: false,
        holds: [hold({ heldUntil: new Date('2026-11-30T22:00:00.000Z') })],
      }),
    )

    expect(message).toBe('Lobby has a goal for this measure that ends Nov 30.')
  })

  it('says one sentence for each subject that is held', () => {
    const message = goalCreateRefusal(
      refusal('subject_has_goal'),
      context({
        subjects: [LOBBY, POOL],
        holds: [
          hold(),
          hold({
            subject: POOL,
            programName: 'Pool ratings',
            heldUntil: new Date('2026-10-31T22:00:00.000Z'),
          }),
        ],
      }),
    )

    expect(message).toBe(
      'Lobby is part of Lobby ratings. Remove it from that goal’s subjects first. Pool bar has a goal for this measure that ends Oct 31. Start the new goal next month.',
    )
  })

  it('leaves out a hold on a subject the form did not choose', () => {
    const message = goalCreateRefusal(
      refusal('subject_has_goal'),
      context({ subjects: [POOL], holds: [hold()] }),
    )

    expect(message).toBe('A subject you chose already has a goal for this measure.')
  })

  it('still says what is wrong before the goals have been read', () => {
    const message = goalCreateRefusal(refusal('subject_has_goal'), context())

    expect(message).toBe('A subject you chose already has a goal for this measure.')
  })

  it('offers next month when the measure cannot be read for this one', () => {
    const message = goalCreateRefusal(refusal('metric_unavailable'), context())

    expect(message).toBe(
      'This measure can’t be read for this month right now. Start the goal next month, or try again later.',
    )
  })

  it('says a measure cannot be read when the goal starts next month', () => {
    const message = goalCreateRefusal(
      refusal('metric_unavailable'),
      context({ startsThisMonth: false }),
    )

    expect(message).toBe('This measure can’t be read right now. Try again later.')
  })

  it('hands any other failure on untouched, for the banner’s own rule', () => {
    const other = refusal('invalid_target', 400)
    const failure = new Error('socket hang up')

    expect(goalCreateRefusal(other, context())).toBe(other)
    expect(goalCreateRefusal(failure, context())).toBe(failure)
    expect(goalCreateRefusal(null, context())).toBeNull()
  })
})
