import { userEvent, within } from 'storybook/test'

/**
 * Drives the merchant AI consent card the way a merchant does: password,
 * Enable, then the confirmation dialog, which renders in a portal outside the
 * story canvas. Shared by the Settings and import-onboarding stories.
 */
export async function consentToAi(canvasElement: HTMLElement): Promise<void> {
  const canvas = within(canvasElement)
  await userEvent.type(
    await canvas.findByLabelText(/confirm with your password/i),
    'correct-password',
  )
  await userEvent.click(canvas.getByRole('button', { name: /^enable ai features$/i }))
  const page = within(canvasElement.ownerDocument.body)
  await userEvent.click(page.getByRole('button', { name: /confirm and enable/i }))
}
