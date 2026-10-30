import type { QueryClient } from '@tanstack/react-query'
import { can } from '#/shared/domain/permissions'
import type { Role } from '#/shared/domain/roles'

type ReplySettingsLoaderContext = Readonly<{
  role: Role
  queryClient: Pick<QueryClient, 'ensureQueryData'>
}>

export default async function loadReplySettings(
  context: ReplySettingsLoaderContext,
  propertyId: string,
): Promise<void> {
  if (!can(context.role, 'reply.manage')) return
  const { propertyReplyLibraryQuery } = await import('./-reply-library-query')
  await context.queryClient.ensureQueryData(propertyReplyLibraryQuery(propertyId))
}
