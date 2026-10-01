// The phone of the round-4 boards, for stories: 390 x 844, so an Immersive
// shell at `container` height has a frame to fill. The guest fonts are linked
// as the public route links them.

import type { Decorator } from '@storybook/react'
import { GUEST_FONT_STYLESHEET } from '#/shared/font-sets'

export const PHONE_WIDTH = 390
export const PHONE_HEIGHT = 844

/** `parameters.frameWidth` widens the frame for the wide-viewport stories. */
export const PhoneFrame: Decorator = (Story, { parameters }) => (
  <div
    data-testid="phone-frame"
    style={{
      width: parameters.frameWidth ?? PHONE_WIDTH,
      height: PHONE_HEIGHT,
      margin: '0 auto',
      overflowY: 'auto',
    }}
  >
    <link rel="stylesheet" href={GUEST_FONT_STYLESHEET} />
    <Story />
  </div>
)
