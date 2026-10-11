// What a goal command's refusal says to the person who pressed the button.
//
// The goal commands refuse with a code, and the server sends that code as the
// message as well, so a banner or a toast that printed the message printed
// "revision_conflict". Here each code has one sentence. The refusal keeps its
// name, code and status and takes the sentence as its message, so the one rule
// the banner and the toast share (`actionErrorMessage`) prints it unchanged,
// and a caller can still tell refusals apart by code.
import {
  isServerFunctionError,
  ServerFunctionError,
} from '#/shared/auth/server-function-error'
import type { GoalProgramError } from '#/contexts/reporting/application/public-api'

const GOAL_REFUSAL = 'GoalProgramError'

const SENTENCES: Readonly<Record<GoalProgramError['code'], string>> = {
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
}

const sentenceFor = (code: string): string | undefined =>
  Object.hasOwn(SENTENCES, code) ? SENTENCES[code as GoalProgramError['code']] : undefined

/** The code of a refusal a command sent; null for any other failure. */
export function goalRefusalCode(error: unknown): string | null {
  return isServerFunctionError(error) ? error.code : null
}

/**
 * A goal command's refusal with its sentence as the message. Any other failure
 * (another context's refusal, a code with no sentence here, a fault) is handed
 * back as it is, and the banner or the toast applies its own rule to it.
 */
export function goalRefusal(error: unknown): unknown {
  if (!isServerFunctionError(error) || error.name !== GOAL_REFUSAL) return error
  const sentence = sentenceFor(error.code)
  if (sentence === undefined || sentence === error.message) return error
  return new ServerFunctionError(error.name, sentence, error.code, error.status)
}

/**
 * The same command, refusing in sentences. A mutation built on it holds the
 * sentence as its error, so the dialog banner, the confirmation and the toast
 * that read that error all say it, and the error is one object per attempt.
 */
export function withGoalRefusals<TInput, TOutput>(
  command: (input: TInput) => Promise<TOutput>,
): (input: TInput) => Promise<TOutput> {
  return async (input) => {
    try {
      return await command(input)
    } catch (error) {
      throw goalRefusal(error)
    }
  }
}
