import { expect } from 'vitest'

// Exactly one of two racing commands wins; the other is refused with the named error.
export function expectSingleWinner(
  outcomes: readonly PromiseSettledResult<unknown>[],
  isExpectedRefusal: (reason: unknown) => boolean,
): void {
  expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
  expect(outcomes.find((outcome) => outcome.status === 'rejected')).toSatisfy(
    (outcome: PromiseSettledResult<unknown> | undefined) =>
      outcome?.status === 'rejected' && isExpectedRefusal(outcome.reason),
  )
}
