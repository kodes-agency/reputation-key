import { useRouterState } from '@tanstack/react-router'

export interface InboxFolderCounts {
  inbox: number
  unaddressed: number
  escalated: number
  addressed: number
  archived: number
}

export const DEFAULT_COUNTS: InboxFolderCounts = {
  inbox: 0,
  unaddressed: 0,
  escalated: 0,
  addressed: 0,
  archived: 0,
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

export function folderCountKey(
  folder: 'inbox' | 'escalated' | 'addressed' | 'archived' | '',
): keyof InboxFolderCounts {
  if (folder === '') return 'unaddressed'
  return folder as keyof InboxFolderCounts
}
