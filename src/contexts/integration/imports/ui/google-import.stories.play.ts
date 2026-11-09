import { expect, userEvent, within } from 'storybook/test'

/**
 * Unfolds a finished import's rows behind "Import details" and checks that one
 * property's link is on screen. The desktop table and the mobile cards both
 * render every row, so the check is that one of the two copies is visible.
 * Shared by the manager and progress view stories.
 */
export async function openImportDetailsForProperty(
  canvasElement: HTMLElement,
  propertyLink: RegExp,
): Promise<void> {
  const canvas = within(canvasElement)
  await userEvent.click(canvas.getByRole('button', { name: /import details/i }))
  const propertyLinks = await canvas.findAllByRole('link', { name: propertyLink })
  await expect(propertyLinks.some((link) => link.checkVisibility())).toBe(true)
}
