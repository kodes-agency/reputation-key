// Story-only helper for the Goal Program dialogs; the `.stories.` segment keeps
// this module out of production-shaped source inventories and bundles.

import { expect, userEvent, waitFor, within } from 'storybook/test'

/**
 * Clicks the dialog's trigger in the story canvas and returns the open dialog
 * once its description shows.
 *
 * Retried, not asserted once. The dialog has only just been found, and Radix
 * animates its content in from opacity: 0 — so a getByText resolved on the
 * very next tick finds the node while it is still invisible, and a bare
 * toBeVisible() fails intermittently on exactly that span.
 */
export async function openGoalProgramDialog(
  canvasElement: HTMLElement,
  trigger: string,
  description: RegExp,
) {
  await userEvent.click(within(canvasElement).getByRole('button', { name: trigger }))
  const dialog = within(await within(document.body).findByRole('dialog'))
  await waitFor(() => expect(dialog.getByText(description)).toBeVisible())
  return dialog
}
