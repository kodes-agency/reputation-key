import { expect, userEvent, within } from 'storybook/test'

/** The acknowledgement a merchant ticks before consent, for any property. */
export const AI_CONSENT_ACKNOWLEDGEMENT =
  /I have read this notice and, as an account admin, agree to this data use for/i

/**
 * Drives the merchant AI consent card the way a merchant does: acknowledge the
 * notice, Enable, then the confirmation dialog, which renders in a portal
 * outside the story canvas. Shared by the Settings and import-onboarding
 * stories.
 */
export async function consentToAi(canvasElement: HTMLElement): Promise<void> {
  const canvas = within(canvasElement)
  const enable = canvas.getByRole('button', { name: /^enable ai features$/i })
  await expect(enable).toBeDisabled()
  await userEvent.click(
    await canvas.findByRole('checkbox', { name: AI_CONSENT_ACKNOWLEDGEMENT }),
  )
  await userEvent.click(enable)
  const page = within(canvasElement.ownerDocument.body)
  await userEvent.click(page.getByRole('button', { name: /confirm and enable/i }))
}
