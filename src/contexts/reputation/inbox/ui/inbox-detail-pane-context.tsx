import { createContext, useContext, type ReactNode } from 'react'
import type { InboxAssignmentOption } from '#/components/inbox/inbox-owner-view'
import type { InboxDetailFns } from '#/components/inbox/types'
import type { ComposerFocusBox } from '#/components/inbox/use-inbox-composer-controller'
import type { InboxCurrentUser } from './inbox-case-toolbar-props'

/**
 * What the detail pane needs from the page beyond the item's own state: the
 * detail commands, the signed-in viewer, the people an item can be assigned
 * to, and the box the page's `r` / `n` shortcuts reach the composer through.
 * The panel and the sheet both mount `InboxDetailContent`, so the page provides
 * this once instead of each surface relaying four props.
 */
export type InboxDetailPaneEnv = Readonly<{
  detailFns: InboxDetailFns
  currentUser?: InboxCurrentUser
  assignmentOptions?: ReadonlyArray<InboxAssignmentOption>
  composerFocusRef?: ComposerFocusBox
}>

const InboxDetailPaneContext = createContext<InboxDetailPaneEnv | null>(null)

export function InboxDetailPaneProvider({
  value,
  children,
}: Readonly<{ value: InboxDetailPaneEnv; children: ReactNode }>) {
  return (
    <InboxDetailPaneContext.Provider value={value}>
      {children}
    </InboxDetailPaneContext.Provider>
  )
}

export function useInboxDetailPane(): InboxDetailPaneEnv {
  const env = useContext(InboxDetailPaneContext)
  if (!env) throw new Error('useInboxDetailPane needs an InboxDetailPaneProvider')
  return env
}
