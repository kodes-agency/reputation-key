import type { Args, ReactRenderer } from '@storybook/react'
import type { PlayFunction } from 'storybook/internal/types'
import { afterEach as checkAccessibility } from '@storybook/addon-a11y/preview'
import { clearAllMocks } from 'storybook/test'
import { checkPhoneWidths } from '../src/shared/testing/phone-width'

/** One state, with a fresh component and the same checks in each theme. */
export function playInThemes<TArgs extends Args = Args>(
  play?: PlayFunction<ReactRenderer, TArgs>,
): PlayFunction<ReactRenderer, TArgs> {
  // Storybook detects the destructured mount and lets this play own rendering.
  return async ({ mount, ...rest }) => {
    const context = { ...rest, mount }
    // Leave the original theme mounted for the preview and metrics consumers.
    const themes =
      context.parameters.theme === 'light' ? ['dark', 'light'] : ['light', 'dark']
    for (const theme of themes) {
      await context.step(theme, async () => {
        context.parameters.theme = theme
        clearAllMocks()
        await mount()
        await play?.(context)
        await checkAccessibility(context)
        // The runner provides resizing; an ordinary Storybook preview does not.
        if (import.meta.env.MODE === 'test') {
          await checkPhoneWidths(context.canvasElement.ownerDocument)
        }
      })
    }
  }
}
