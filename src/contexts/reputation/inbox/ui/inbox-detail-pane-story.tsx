import type { ComponentType } from 'react'
import {
  InboxDetailPaneProvider,
  type InboxDetailPaneEnv,
} from './inbox-detail-pane-context'

/**
 * A pane surface that takes the page's environment as props, for stories whose
 * args pick the detail commands, viewer and assignment options per story.
 */
export function withInboxDetailPaneEnv<P extends object>(
  Surface: ComponentType<P>,
): ComponentType<P & InboxDetailPaneEnv> {
  return function SurfaceWithPaneEnv({
    detailFns,
    currentUser,
    assignmentOptions,
    composerFocusRef,
    ...surfaceProps
  }: P & InboxDetailPaneEnv) {
    return (
      <InboxDetailPaneProvider
        value={{ detailFns, currentUser, assignmentOptions, composerFocusRef }}
      >
        <Surface {...(surfaceProps as unknown as P)} />
      </InboxDetailPaneProvider>
    )
  }
}
