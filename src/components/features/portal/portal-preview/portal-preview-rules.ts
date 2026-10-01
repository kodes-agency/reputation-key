// What the pane says when it has no page to draw. Pure, so the wording is
// pinned by a test and not by JSX.

import type { PortalPreviewUnavailableReason } from '#/contexts/portal/application/public-api'

export type PreviewUnavailableNote = Readonly<{ title: string; body: string }>

export function describeUnavailable(
  reason: PortalPreviewUnavailableReason,
): PreviewUnavailableNote {
  switch (reason) {
    case 'not_published':
      return {
        title: 'Nothing is live yet',
        body: 'Publish this portal to compare the live page with your draft.',
      }
    case 'earlier_design':
      return {
        title: 'The live page uses the earlier design',
        body: 'There is no matching preview of it. Publishing again moves the page to the new design, and the live preview will show it.',
      }
    case 'incomplete':
      return {
        title: 'The live page can’t be shown here',
        body: 'The live version is missing something this preview needs. The draft preview still works.',
      }
  }
}

/** The line shown while "Try as guest" is on. */
export const TRY_AS_GUEST_NOTICE =
  'Trying as a guest. Nothing is saved or counted, and links don’t open.'
