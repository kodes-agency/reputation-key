// What the plays of the Google rating goal's stories share: setting the plan
// picked and landing on the done screen, wherever the wizard sits (a dialog, the
// setup frame at import), and finding a forecast sentence on the screen.
import { expect, userEvent, waitFor, type within } from 'storybook/test'

type Scope = ReturnType<typeof within>

/**
 * A forecast sentence as the screen sets it. Its dates sit in nowrap spans
 * (`RatingGoalWholeDates`), so the sentence is an element's words, not one text
 * node: this matches the innermost element whose words are exactly `text`.
 */
export const wholeText =
  (text: string) =>
  (_content: string, element: Element | null): boolean =>
    element?.textContent === text &&
    Array.from(element.children).every((child) => child.textContent !== text)

/** Presses "Set goal" and waits for "Your goal is set" to take the focus. */
export async function setGoalAndLand(scope: Scope): Promise<void> {
  await userEvent.click(scope.getByRole('button', { name: 'Set goal' }))
  await waitFor(() =>
    expect(scope.getByRole('heading', { name: 'Your goal is set' })).toHaveFocus(),
  )
}
