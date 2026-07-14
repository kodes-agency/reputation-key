import { useRouterState } from '@tanstack/react-router'

export interface InboxFolderCounts {
  open: number
  escalated: number
  closed: number
}

export const DEFAULT_COUNTS: InboxFolderCounts = {
  open: 0,
  escalated: 0,
  closed: 0,
}

export function useInboxFolder(): string {
  return useRouterState({
    select: (s) => new URLSearchParams(s.location.searchStr).get('folder') ?? '',
  })
}

export function useInboxPlatform(): string {
  return useRouterState({
    select: (s) => new URLSearchParams(s.location.searchStr).get('platform') ?? '',
  })
}

/** Maps a sidebar folder slug to the counts key. The default (no folder) is
 *  the Open working view (ADR 0023). */
export function folderCountKey(
  folder: 'open' | 'escalated' | 'closed' | '',
): keyof InboxFolderCounts {
  if (folder === '') return 'open'
  return folder as keyof InboxFolderCounts
}
