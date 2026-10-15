// What the plays of the Google rating goal wizard's stories share: setting the
// plan picked and landing on the done screen, wherever the wizard sits (a
// dialog, the setup frame at import).
import { expect, userEvent, waitFor, type within } from 'storybook/test'

type Scope = ReturnType<typeof within>

/** Presses "Set goal" and waits for "Your goal is set" to take the focus. */
export async function setGoalAndLand(scope: Scope): Promise<void> {
  await userEvent.click(scope.getByRole('button', { name: 'Set goal' }))
  await waitFor(() =>
    expect(scope.getByRole('heading', { name: 'Your goal is set' })).toHaveFocus(),
  )
}
