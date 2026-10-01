// What the pane says when it has no page to draw. Pure, so the wording is
// pinned by a test and not by JSX.

import type {
  PortalPreviewLinkState,
  PortalPreviewUnavailableReason,
} from '#/contexts/portal/application/public-api'

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
        body: 'This preview does not draw it. The draft preview shows the new design.',
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

/**
 * The line under the Draft page. Until publishing writes the new design
 * (slice 19 of the round-4 plan), the draft is the page guests get in an
 * upcoming release, not the one Publish makes live today. Slice 19 replaces
 * this line, and the `earlier_design` body above, with the published wording.
 */
export const DRAFT_DESIGN_NOTICE =
  'This is the new design, which reaches guests in an upcoming release. Until then, Publish keeps the earlier page.'

/** What a tile with no approved address says in place of its line. */
export const TILE_PLACEHOLDER_NOTE: Readonly<
  Record<Exclude<PortalPreviewLinkState, 'ready'>, string>
> = {
  awaiting_approval: 'Waiting for approval',
  not_approved: 'Not approved, hidden from guests',
}

/** Said under the caption when the language has no guest wording yet. */
export function packFallbackNotice(languageName: string): string {
  return `The guest wording for ${languageName} isn’t ready yet, so the page’s fixed text is shown in English. This language can’t be published in the new design until it is.`
}
