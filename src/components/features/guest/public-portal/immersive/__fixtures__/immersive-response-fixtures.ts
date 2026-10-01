// Shared fixtures for the Immersive Hub response tests: the two v2 packs, one
// renderer for the response view, and handlers that fail the test if a render
// ever calls one. Nothing here asserts; the tests do.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { GuestPagePreviewState } from '../../guest-page-preview-state'
import type { GuestPortalCopyV2 } from '../../language-packs/guest-copy-v2'
import { loadGuestPortalCopyV2 } from '../../language-packs/load-guest-copy-v2'
import { immersiveResponseProps } from '../immersive-response-preview'
import {
  ImmersiveResponseView,
  type ImmersiveResponseViewProps,
} from '../immersive-response-view'

export const RATINGS = [1, 2, 3, 4, 5] as const
// Loaded the way a request loads them: a locale module is imported by the
// loader alone (`load-guest-copy-v2.test.ts` holds the codebase to that).
export const PACKS: readonly GuestPortalCopyV2[] = await Promise.all([
  loadGuestPortalCopyV2('en'),
  loadGuestPortalCopyV2('bg'),
])
export const DISPLAY_NAME = 'Avela Resort'

/** Renders the response view for a controlled state, as a preview or a story would. */
export function renderResponse(
  pack: GuestPortalCopyV2,
  state: GuestPagePreviewState,
  overrides: Partial<ImmersiveResponseViewProps> = {},
  threshold?: number,
): string {
  return renderToStaticMarkup(
    createElement(ImmersiveResponseView, {
      ...immersiveResponseProps(state, {
        pack,
        displayName: DISPLAY_NAME,
        privateFeedbackThreshold: threshold,
      }),
      ...overrides,
    }),
  )
}
