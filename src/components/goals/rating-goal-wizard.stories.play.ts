// What the plays of the Google rating goal's stories share: setting the plan
// picked and landing on the done screen, wherever the wizard sits (a dialog, the
// setup frame at import), and finding a forecast sentence on the screen.
import { expect, userEvent, waitFor, type within } from 'storybook/test'

type Scope = ReturnType<typeof within>

/**
 * A sentence as the screen sets it, which may be an element's words rather
 * than one text node (a figure in its own span): this matches the innermost
 * element whose words are exactly `text`.
 */
export const wholeText =
  (text: string) =>
  (_content: string, element: Element | null): boolean =>
    element?.textContent === text &&
    Array.from(element.children).every((child) => child.textContent !== text)

/** Presses "Aim for {T}" and waits for "Your goal is set" to take the focus. */
export async function setGoalAndLand(scope: Scope): Promise<void> {
  await userEvent.click(scope.getByRole('button', { name: /^Aim for / }))
  await waitFor(() =>
    expect(scope.getByRole('heading', { name: 'Your goal is set' })).toHaveFocus(),
  )
}
