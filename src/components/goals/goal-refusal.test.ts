import { describe, expect, it } from 'vitest'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { actionErrorMessage } from '#/components/hooks/use-action-mutation'
import { goalRefusal, goalRefusalCode, withGoalRefusals } from './goal-refusal'

// A goal command refuses with a code, and the server sends the code as the
// message too: that is what the banner and the toast used to print.
const refusal = (code: string, status = 409) =>
  new ServerFunctionError('GoalProgramError', code, code, status)

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const SENTENCES: Readonly<Record<string, string>> = {
  forbidden: 'You don’t have permission to do that.',
  not_found: 'This goal can’t be found.',
  invalid_name: 'Enter a goal name.',
  invalid_target: 'Enter a valid monthly target for this measure.',
  invalid_subject: 'Choose at least one subject that is part of this property.',
  duplicate_subject: 'A subject is chosen more than once. Choose each subject once.',
  assignment_limit_exceeded:
    'That is too many subjects for one goal. Choose fewer and save again.',
  metric_unavailable: 'This measure can’t be read right now. Try again later.',
  invalid_transition:
    'This goal’s status no longer allows that. Reload the page to see where it stands.',
  revision_conflict:
    'This goal changed while you were working on it. Reload the page and try again.',
  subject_has_goal: 'A subject you chose already has a goal for this measure.',
  start_month_changed: 'The month has changed. Check the start and save again.',
  month_locked: 'This month has ended. Its target can’t be changed.',
  no_open_month: 'This month’s result isn’t open yet. Try again in a few minutes.',
}

describe('goalRefusal', () => {
  it.each(Object.entries(SENTENCES))('says a sentence for %s', (code, sentence) => {
    const mapped = goalRefusal(refusal(code))

    expect(messageOf(mapped)).toBe(sentence)
  })

  it('never prints a code as its own message', () => {
    for (const code of Object.keys(SENTENCES)) {
      const message = messageOf(goalRefusal(refusal(code)))

      expect(message).not.toContain('_')
      expect(message).toMatch(/^[A-Z].*\.$/u)
    }
  })

  it('keeps the code and the status, so a caller can still tell refusals apart', () => {
    const mapped = goalRefusal(refusal('forbidden', 403))

    expect(goalRefusalCode(mapped)).toBe('forbidden')
    expect(mapped).toMatchObject({ name: 'GoalProgramError', status: 403 })
  })

  it('reads as its sentence under the rule the toast and the banner share', () => {
    expect(actionErrorMessage(goalRefusal(refusal('revision_conflict')))).toBe(
      SENTENCES.revision_conflict,
    )
  })

  it('says the same sentence when it is asked twice', () => {
    const once = goalRefusal(refusal('revision_conflict'))

    expect(messageOf(goalRefusal(once))).toBe(SENTENCES.revision_conflict)
  })

  it('leaves a failure that is not a goal refusal as it is', () => {
    const anotherContext = new ServerFunctionError(
      'PortalError',
      'Portal not found',
      'not_found',
      404,
    )
    const newCode = refusal('some_new_code')
    const failure = new Error('socket hang up')

    expect(goalRefusal(anotherContext)).toBe(anotherContext)
    expect(goalRefusal(newCode)).toBe(newCode)
    expect(goalRefusal(failure)).toBe(failure)
    expect(goalRefusal(null)).toBeNull()
  })
})

describe('goalRefusalCode', () => {
  it('reads the code of a refusal the command sent', () => {
    expect(goalRefusalCode(refusal('subject_has_goal'))).toBe('subject_has_goal')
  })

  it('is null for any other failure', () => {
    expect(goalRefusalCode(new Error('socket hang up'))).toBeNull()
    expect(goalRefusalCode(undefined)).toBeNull()
  })
})

describe('withGoalRefusals', () => {
  it('hands back what the command answered', async () => {
    const command = withGoalRefusals(async (input: number) => input + 1)

    await expect(command(1)).resolves.toBe(2)
  })

  it('rejects with the sentence when the command refuses', async () => {
    const command = withGoalRefusals(async () => {
      throw refusal('invalid_transition')
    })

    await expect(command(undefined)).rejects.toMatchObject({
      message: SENTENCES.invalid_transition,
      code: 'invalid_transition',
      status: 409,
    })
  })

  it('rejects with the failure itself when it is not a goal refusal', async () => {
    const failure = new Error('socket hang up')
    const command = withGoalRefusals(async () => {
      throw failure
    })

    await expect(command(undefined)).rejects.toBe(failure)
  })
})
