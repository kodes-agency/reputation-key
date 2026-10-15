// What a Google rating goal command's refusal says to the person who pressed
// the button. The commands refuse with a code (`RatingGoalError`); here each
// code has one plain sentence, as `goal-refusal.ts` does for Goal Programs. The
// refusal keeps its name, code and status and takes the sentence as its
// message, so the banner's one rule (`FormErrorBanner`: a 4xx refusal's own
// sentence) prints it unchanged, and a caller can still tell refusals apart.
import {
  isServerFunctionError,
  ServerFunctionError,
} from '#/shared/auth/server-function-error'

const RATING_GOAL_REFUSAL = 'RatingGoalError'

const SENTENCES: Readonly<Record<string, string>> = {
  forbidden: 'You don’t have permission to do that.',
  not_found: 'This goal can’t be found. It may have been reached or ended.',
  not_eligible:
    'This property can’t have a Google rating goal right now. It needs at least 10 Google reviews and Google’s latest numbers.',
  goal_exists:
    'This property already has a Google rating goal. Close this to see it on the Goals page.',
  not_active: 'This goal has been reached or ended, so it can’t be changed.',
  version_conflict:
    'This goal changed after you opened this. Close it and open it again to start from the latest.',
  invalid_target:
    'That goal isn’t available any more: Google’s number may have moved. Close this and open it again.',
  invalid_quality:
    'That average is too close to what the goal needs. Pick a higher one, or close this and open it again.',
  invalid_pace: 'Enter a whole number of reviews a week, from 1 to 200.',
  no_change: 'Nothing has changed. Pick another plan, or cancel.',
  organization_closing:
    'This organization is being closed, so its goals can’t be set or changed.',
}

/** The code of a rating goal refusal; null for any other failure. */
export function ratingGoalRefusalCode(error: unknown): string | null {
  return isServerFunctionError(error) && error.name === RATING_GOAL_REFUSAL
    ? error.code
    : null
}

/**
 * A rating goal refusal with its sentence as the message. Any other failure (a
 * code with no sentence here, a fault) is handed back as it is, and the banner
 * applies its own rule to it.
 */
export function ratingGoalRefusal(error: unknown): unknown {
  const code = ratingGoalRefusalCode(error)
  if (code === null || !isServerFunctionError(error)) return error
  const sentence = Object.hasOwn(SENTENCES, code) ? SENTENCES[code] : undefined
  if (sentence === undefined || sentence === error.message) return error
  return new ServerFunctionError(error.name, sentence, code, error.status)
}

/** The same command, refusing in sentences. */
export function withRatingGoalRefusals<TInput, TOutput>(
  command: (input: TInput) => Promise<TOutput>,
): (input: TInput) => Promise<TOutput> {
  return async (input) => {
    try {
      return await command(input)
    } catch (error) {
      throw ratingGoalRefusal(error)
    }
  }
}
