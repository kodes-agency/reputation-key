// A rating goal command refuses with a code; the person reads a sentence.
import { describe, expect, it } from 'vitest'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import {
  ratingGoalRefusal,
  ratingGoalRefusalCode,
  withRatingGoalRefusals,
} from './rating-goal-refusal'

const refused = (code: string, status = 409) =>
  new ServerFunctionError('RatingGoalError', code, code, status)

describe('a rating goal refusal', () => {
  it('reads a version conflict as a way back to the latest goal', () => {
    const error = ratingGoalRefusal(refused('version_conflict'))

    expect(error).toBeInstanceOf(ServerFunctionError)
    expect(error).toMatchObject({
      name: 'RatingGoalError',
      code: 'version_conflict',
      status: 409,
      message:
        'This goal changed after you opened this. Close it and open it again to start from the latest.',
    })
  })

  it.each([
    ['goal_exists', /already has a Google rating goal/u],
    ['not_eligible', /at least 10 Google reviews/u],
    ['invalid_target', /Google’s number may have moved/u],
    ['invalid_quality', /^That average is too close to what the goal needs/u],
    ['no_change', /^Nothing has changed\. Pick another plan, or cancel\.$/u],
  ])('words %s in plain words', (code, sentence) => {
    expect((ratingGoalRefusal(refused(code)) as Error).message).toMatch(sentence)
  })

  it('hands back any other failure as it is', () => {
    const goalProgram = new ServerFunctionError('GoalProgramError', 'x', 'not_found', 404)
    const unknownCode = refused('something_new')
    const fault = new Error('boom')

    expect(ratingGoalRefusal(goalProgram)).toBe(goalProgram)
    expect(ratingGoalRefusal(unknownCode)).toBe(unknownCode)
    expect(ratingGoalRefusal(fault)).toBe(fault)
  })

  it('names the code of a rating goal refusal only', () => {
    expect(ratingGoalRefusalCode(refused('goal_exists'))).toBe('goal_exists')
    expect(ratingGoalRefusalCode(new Error('boom'))).toBeNull()
  })

  it('rewords the refusal of a command it wraps', async () => {
    const command = withRatingGoalRefusals(async () => {
      throw refused('goal_exists')
    })

    await expect(command(undefined)).rejects.toThrow(/already has a Google rating goal/u)
  })
})
